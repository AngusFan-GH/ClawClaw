/** Project-scoped Skill discovery for ClawClaw Workspaces. */

import { join, resolve, win32 } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {
  SkillCandidate,
  SkillDefinition,
  SkillLookupOptions,
  SkillProvider,
  SkillProviderControl,
  SkillProviderObservation,
} from '@deepseek-ai/dsh-skill'
import { FileSystemSkillProvider } from '@deepseek-ai/dsh-skill-filesystem'
import { DESKTOP_SKILL_SCAN_SETTINGS_NAMESPACE, type DesktopSkillScanSettings } from './skill-scan-settings.ts'

const PROJECT_CLAWCLAW_RANK = 250
const MAX_OBSERVED_WORKSPACES = 128

interface ProjectLocator {
  readonly owner: FileSystemSkillProvider
  readonly candidate: SkillCandidate
  readonly source: 'project-clawclaw' | 'external-clawclaw'
}

interface ProjectProviderEntry {
  readonly provider: FileSystemSkillProvider
  readonly lifecycle: AbortController
}

export const name = 'clawclaw-skill-filesystem'
export const inject = ['skills', 'settings']

/** Resolve the only project-local Skill root ClawClaw owns. */
export function clawClawProjectSkillRoot(cwd: string): string {
  return join(resolve(cwd), '.clawclaw', 'skills')
}

/** Windows-only cache identity: drive and path casing do not create duplicate watchers. */
export function windowsWorkspaceKey(cwd: string): string {
  return win32.resolve(cwd).toLocaleLowerCase('en-US')
}

function workspaceKey(cwd: string): string {
  const path = resolve(cwd)
  return process.platform === 'win32' ? path.toLocaleLowerCase('en-US') : path
}

function mappedCandidate(
  owner: FileSystemSkillProvider,
  candidate: SkillCandidate,
  source: ProjectLocator['source'],
  rank: number,
): SkillCandidate {
  return {
    ...candidate,
    source,
    rank,
    locator: { owner, candidate, source } satisfies ProjectLocator,
  }
}

function projectObservation(
  owner: FileSystemSkillProvider,
  observation: readonly SkillCandidate[] | SkillProviderObservation,
  source: ProjectLocator['source'],
  rank: number,
): readonly SkillCandidate[] | SkillProviderObservation {
  if (!('candidates' in observation)) return observation.map(candidate => mappedCandidate(owner, candidate, source, rank))
  return {
    complete: observation.complete,
    candidates: observation.candidates.map(candidate => mappedCandidate(owner, candidate, source, rank)),
  }
}

function projectLocator(value: unknown): ProjectLocator | undefined {
  if (typeof value !== 'object' || value === null) return undefined
  const locator = value as Partial<ProjectLocator>
  if (!(locator.owner instanceof FileSystemSkillProvider) || typeof locator.candidate !== 'object' || locator.candidate === null) return undefined
  return locator as ProjectLocator
}

/**
 * Reuse the upstream filesystem implementation for parsing, symlink handling,
 * and depth-matched watching while selecting a ClawClaw-owned root per cwd.
 */
export class ClawClawProjectSkillProvider implements SkillProvider {
  readonly name = 'clawclaw-project-filesystem'
  private readonly providers = new Map<string, ProjectProviderEntry>()
  private external: (ProjectProviderEntry & { readonly fingerprint: string }) | undefined
  private disposal: Promise<void> | undefined

  constructor(
    private readonly ctx: Context,
    private readonly control: SkillProviderControl,
  ) {
    control.signal.addEventListener('abort', () => { void this.dispose() }, { once: true })
    ctx.on('settings/updated', (namespace) => {
      if (namespace !== DESKTOP_SKILL_SCAN_SETTINGS_NAMESPACE) return
      const previous = this.external
      this.external = undefined
      if (previous !== undefined) {
        previous.lifecycle.abort()
        void previous.provider.dispose()
      }
      control.invalidate()
    })
  }

  async list(options: SkillLookupOptions): Promise<readonly SkillCandidate[] | SkillProviderObservation> {
    options.signal?.throwIfAborted()
    if (options.cwd === undefined) return []
    const owner = await this.providerFor(options.cwd)
    const project = projectObservation(owner, await owner.list(options), 'project-clawclaw', PROJECT_CLAWCLAW_RANK)
    const paths = (this.ctx.settings.get(DESKTOP_SKILL_SCAN_SETTINGS_NAMESPACE) as DesktopSkillScanSettings | undefined)?.paths ?? []
    const externalOwner = paths.length === 0 ? undefined : await this.externalProvider(paths)
    const external = externalOwner === undefined
      ? []
      : projectObservation(externalOwner, await externalOwner.list(options), 'external-clawclaw', 350)
    options.signal?.throwIfAborted()
    const projectCandidates = 'candidates' in project ? project.candidates : project
    const externalCandidates = 'candidates' in external ? external.candidates : external
    const complete = !('candidates' in project) || project.complete
    const externalComplete = !('candidates' in external) || external.complete
    const candidates = [...projectCandidates, ...externalCandidates]
    return complete && externalComplete ? candidates : { candidates, complete: false }
  }

  async get(candidate: SkillCandidate, options: SkillLookupOptions): Promise<SkillDefinition | undefined> {
    options.signal?.throwIfAborted()
    const locator = projectLocator(candidate.locator)
    if (locator === undefined || (![...this.providers.values()].some(entry => entry.provider === locator.owner)
      && this.external?.provider !== locator.owner)) return undefined
    const definition = await locator.owner.get(locator.candidate, options)
    if (definition === undefined) return undefined
    return { ...definition, source: locator.source, provider: this.name }
  }

  async dispose(): Promise<void> {
    this.disposal ??= this.disposeProviders()
    return await this.disposal
  }

  private async providerFor(cwd: string): Promise<FileSystemSkillProvider> {
    const key = workspaceKey(cwd)
    const current = this.providers.get(key)
    if (current !== undefined) {
      this.providers.delete(key)
      this.providers.set(key, current)
      return current.provider
    }
    const lifecycle = new AbortController()
    const provider = new FileSystemSkillProvider(this.ctx, {
      signal: lifecycle.signal,
      invalidate: this.control.invalidate,
    }, {
      providerName: this.name,
      includeDefaultRoots: false,
      customSkillDirs: [clawClawProjectSkillRoot(cwd)],
      watch: true,
      watchMaxProjects: 1,
    })
    this.providers.set(key, { provider, lifecycle })
    if (this.providers.size > MAX_OBSERVED_WORKSPACES) {
      const oldest = this.providers.entries().next().value as [string, ProjectProviderEntry] | undefined
      if (oldest !== undefined) {
        this.providers.delete(oldest[0])
        oldest[1].lifecycle.abort()
        await oldest[1].provider.dispose()
      }
    }
    return provider
  }

  private async externalProvider(paths: readonly string[]): Promise<FileSystemSkillProvider> {
    const fingerprint = JSON.stringify(paths)
    if (this.external?.fingerprint === fingerprint) return this.external.provider
    const previous = this.external
    this.external = undefined
    if (previous !== undefined) {
      previous.lifecycle.abort()
      await previous.provider.dispose()
    }
    const lifecycle = new AbortController()
    const provider = new FileSystemSkillProvider(this.ctx, {
      signal: lifecycle.signal,
      invalidate: this.control.invalidate,
    }, {
      providerName: this.name,
      includeDefaultRoots: false,
      customSkillDirs: [...paths],
      watch: true,
    })
    this.external = { provider, lifecycle, fingerprint }
    return provider
  }

  private async disposeProviders(): Promise<void> {
    const providers = [...this.providers.values()]
    this.providers.clear()
    if (this.external !== undefined) providers.push(this.external)
    this.external = undefined
    for (const entry of providers) entry.lifecycle.abort()
    await Promise.all(providers.map(async entry => { await entry.provider.dispose() }))
  }
}

export function apply(ctx: Context): void {
  let provider: ClawClawProjectSkillProvider | undefined
  ctx.skills.registerProvider(control => {
    provider = new ClawClawProjectSkillProvider(ctx, control)
    return provider
  })
  ctx.effect(function* () {
    yield async () => { await provider?.dispose() }
  }, 'clawclaw project Skill watchers')
}
