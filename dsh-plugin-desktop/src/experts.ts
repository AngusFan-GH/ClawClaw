/** Local Expert center: discover expert packages and summon them as preset-bound Sessions. */

import { lstat, readFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_EXPERTS_ACTION_PATH, DESKTOP_EXPERTS_PATH,
  type DesktopExpertEntry, type DesktopExpertInvalid, type DesktopExpertSummonResult, type DesktopExpertsView,
} from './experts-contract.ts'

export * from './experts-contract.ts'
export const name = 'desktop-experts'
export const inject = ['webServer', 'connection']

const MAX_EXPERT_FILE_BYTES = 4 * 1024 * 1024
const PRESET_ID = /^[A-Za-z0-9_-]{1,128}$/u
const MAX_TAGS = 20
const MAX_QUICK_PROMPTS = 20
const MAX_PROMPT_CHARS = 4000

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

async function regularFile(path: string): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error(`must be a regular file: ${path}`)
  if (info.size > MAX_EXPERT_FILE_BYTES) throw new Error(`${path} exceeds ${String(MAX_EXPERT_FILE_BYTES)} bytes`)
  return await readFile(path, 'utf8')
}

function parseYaml(path: string, source: string): unknown {
  const document = parseDocument(source, { prettyErrors: true })
  if (document.errors.length > 0) {
    throw new Error(`${path}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  return document.toJS()
}

function textField(value: unknown, field: string, max: number, required = true): string {
  if (typeof value !== 'string' || value.trim() === '') {
    if (required) throw new Error(`expert.yml: ${field} must be non-empty text`)
    return ''
  }
  const trimmed = value.trim()
  if (trimmed.length > max) throw new Error(`expert.yml: ${field} exceeds ${String(max)} characters`)
  return trimmed
}

function stringList(value: unknown, field: string, max: number, itemMax: number): string[] {
  if (!Array.isArray(value)) throw new Error(`expert.yml: ${field} must be a list of text`)
  if (value.length > max) throw new Error(`expert.yml: ${field} has more than ${String(max)} entries`)
  return value.map((item, index) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new Error(`expert.yml: ${field}[${String(index)}] must be non-empty text`)
    }
    const trimmed = item.trim()
    if (trimmed.length > itemMax) throw new Error(`expert.yml: ${field}[${String(index)}] exceeds ${String(itemMax)} characters`)
    return trimmed
  })
}

/** Validate one parsed expert.yml document against the directory that owns it. */
export function parseExpertDocument(data: unknown, directory: string, directoryId: string): Omit<DesktopExpertEntry, 'presetId' | 'available' | 'unavailableReason'> {
  const manifestPath = join(directory, 'expert.yml')
  if (!isRecord(data)) throw new Error(`${manifestPath}: expert.yml must be a map`)
  const id = textField(data.id, 'id', 128)
  if (!PRESET_ID.test(id)) throw new Error(`${manifestPath}: illegal expert id "${id}" (allowed: A-Z, a-z, 0-9, -, _)`)
  if (id !== directoryId) throw new Error(`${manifestPath}: id "${id}" does not match directory name "${directoryId}"`)
  const version = textField(data.version, 'version', 64)
  const category = textField(data.category, 'category', 64)
  const display = data.display
  if (!isRecord(display)) throw new Error(`${manifestPath}: display must be a map`)
  const entry = data.entry
  if (!isRecord(entry)) throw new Error(`${manifestPath}: entry must be a map`)
  return {
    id,
    version,
    category,
    display: {
      name: textField(display.name, 'display.name', 128),
      title: textField(display.title, 'display.title', 256),
      description: textField(display.description, 'display.description', 2000),
      tags: stringList(display.tags, 'display.tags', MAX_TAGS, 128),
    },
    entry: {
      defaultPrompt: textField(entry.defaultPrompt, 'entry.defaultPrompt', MAX_PROMPT_CHARS),
      quickPrompts: stringList(entry.quickPrompts, 'entry.quickPrompts', MAX_QUICK_PROMPTS, 500),
    },
  }
}

/** Read and validate one expert.yml file without touching other packages. */
export async function parseExpertManifest(directory: string, directoryId: string): Promise<Omit<DesktopExpertEntry, 'presetId' | 'available' | 'unavailableReason'>> {
  const manifestPath = join(directory, 'expert.yml')
  const data = parseYaml(manifestPath, await regularFile(manifestPath))
  return parseExpertDocument(data, directory, directoryId)
}

/** Read a required regular file; ENOENT becomes a friendly "missing required file" reason. */
async function requireRegularFile(path: string, label: string): Promise<string> {
  try {
    return await regularFile(path)
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') throw new Error(`missing required file: ${label}`)
    throw cause
  }
}

export interface ExpertScanResult {
  readonly experts: readonly DesktopExpertEntry[]
  readonly invalid: readonly DesktopExpertInvalid[]
}

/**
 * Scan `.agent-presets/<id>/` for complete expert packages.
 * Every package is isolated: one failure never blocks the others.
 */
/**
 * Scan `.agent-presets/<id>/` for complete expert packages.
 * Every package is isolated: one failure never blocks the others.
 *
 * Two phases: collect every declared expert id first so duplicate claims are
 * isolated before full validation, then validate each surviving package.
 */
export async function scanExpertPackages(root: string): Promise<ExpertScanResult> {
  let entries
  try {
    entries = await readdir(root, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return { experts: [], invalid: [] }
    throw cause
  }

  interface RawPackage {
    readonly directory: string
    readonly packageId: string
    readonly document: unknown
    readonly declaredId: string | undefined
  }

  const raws: RawPackage[] = []
  const invalid: DesktopExpertInvalid[] = []

  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    if (!entry.isDirectory() || entry.isSymbolicLink()) continue
    const directory = join(root, entry.name)
    const packageId = entry.name
    if (!PRESET_ID.test(packageId)) {
      invalid.push({ id: packageId, directory, reason: `illegal package directory name "${packageId}"` })
      continue
    }
    // A directory without expert.yml is a historical Agent preset owned by
    // the legacy registrar, not an expert package: skip it silently.
    let source: string
    try {
      source = await requireRegularFile(join(directory, 'expert.yml'), 'expert.yml')
    } catch (cause) {
      if (cause instanceof Error && cause.message.startsWith('missing required file')) continue
      invalid.push({ id: packageId, directory, reason: cause instanceof Error ? cause.message : String(cause) })
      continue
    }
    try {
      const document = parseYaml(join(directory, 'expert.yml'), source)
      const declaredId = isRecord(document) && typeof document.id === 'string' && PRESET_ID.test(document.id)
        ? document.id
        : undefined
      raws.push({ directory, packageId, document, declaredId })
    } catch (cause) {
      invalid.push({ id: packageId, directory, reason: cause instanceof Error ? cause.message : String(cause) })
    }
  }

  // Duplicate declared ids: the claimer whose directory name equals the id
  // owns it; every other claim is isolated. When no directory owns the id,
  // every claim is a directory-name mismatch instead.
  const claims = new Map<string, RawPackage[]>()
  for (const raw of raws) {
    if (raw.declaredId === undefined) continue
    const list = claims.get(raw.declaredId) ?? []
    list.push(raw)
    claims.set(raw.declaredId, list)
  }
  const duplicateRaws = new Set<RawPackage>()
  for (const [id, claimants] of claims) {
    if (claimants.length <= 1) continue
    const winner = claimants.find(raw => raw.packageId === id)
    for (const raw of claimants) {
      if (raw === winner) continue
      duplicateRaws.add(raw)
      invalid.push({
        id: raw.packageId,
        directory: raw.directory,
        ...(winner === undefined
          ? { reason: `expert.yml declares id "${id}" which does not match directory name "${raw.packageId}"` }
          : { reason: `duplicate expert id "${id}" (already found in "${winner.packageId}")` }),
      })
    }
  }

  const valid: DesktopExpertEntry[] = []
  for (const raw of raws) {
    if (duplicateRaws.has(raw)) continue
    try {
      const manifest = parseExpertDocument(raw.document, raw.directory, raw.packageId)
      for (const required of ['preset.yml', 'agent.cordis.yml'] as const) {
        await requireRegularFile(join(raw.directory, required), required)
      }
      valid.push({ ...manifest, presetId: manifest.id, available: false })
    } catch (cause) {
      invalid.push({
        id: raw.packageId,
        directory: raw.directory,
        reason: cause instanceof Error ? cause.message : String(cause),
      })
    }
  }
  return { experts: valid, invalid }
}

export interface ExpertRuntime {
  readonly agentPresets?: {
    list(): Promise<readonly { readonly id: string; readonly name?: string; readonly broken?: string }[]>
    resolve(id: string): Promise<{ readonly id: string; readonly broken?: string }>
  } | undefined
  readonly sessionController?: {
    create(request: { readonly workspaceId?: string; readonly agentPreset?: string }): Promise<{ readonly sessionId: string; readonly agentPreset?: string }>
  } | undefined
  readonly workspaceRegistry?: {
    list(): readonly { readonly id: string; readonly title: string; readonly path: string }[]
    get(id: string): { readonly id: string; readonly path: string } | undefined
  } | undefined
  readonly defaultWorkspaceId?: () => string | undefined
}

function presetAvailability(
  experts: readonly DesktopExpertEntry[],
  rosters: ReadonlyMap<string, { readonly name?: string; readonly broken?: string }>,
): DesktopExpertEntry[] {
  return experts.map(expert => {
    const roster = rosters.get(expert.id)
    if (roster === undefined) {
      return { ...expert, available: false, unavailableReason: 'Agent preset not registered' }
    }
    if (roster.broken !== undefined) {
      return { ...expert, available: false, unavailableReason: roster.broken }
    }
    return { ...expert, available: true }
  })
}

function matchesQuery(expert: DesktopExpertEntry, query: string): boolean {
  const haystack = [
    expert.id, expert.display.name, expert.display.title, expert.display.description,
    ...expert.display.tags, ...expert.entry.quickPrompts,
  ].join('\n').toLowerCase()
  return haystack.includes(query.toLowerCase())
}

export class DesktopExpertsController {
  private readonly runtime: ExpertRuntime
  private readonly root: string

  constructor(runtime: ExpertRuntime, root?: string) {
    this.runtime = runtime
    this.root = root ?? join(resolveDshHome(), '.agent-presets')
  }

  private async scan(): Promise<ExpertScanResult> {
    return scanExpertPackages(this.root)
  }

  private async roster(): Promise<ReadonlyMap<string, { readonly name?: string; readonly broken?: string }>> {
    const presets = this.runtime.agentPresets
    if (presets === undefined) return new Map()
    const rows = await presets.list()
    return new Map(rows.map(row => [row.id, row]))
  }

  async read(query?: string, category?: string): Promise<DesktopExpertsView> {
    const [scan, roster] = await Promise.all([this.scan(), this.roster()])
    let experts = presetAvailability(scan.experts, roster)
    if (category !== undefined && category !== '') {
      experts = experts.filter(expert => expert.category === category)
    }
    if (query !== undefined && query.trim() !== '') {
      experts = experts.filter(expert => matchesQuery(expert, query.trim()))
    }
    const categories = [...new Set(scan.experts.map(expert => expert.category))].sort()
    return Object.freeze({
      experts: Object.freeze(experts),
      invalid: Object.freeze(scan.invalid),
      categories: Object.freeze(categories),
    })
  }

  async detail(id: string): Promise<DesktopExpertEntry> {
    if (typeof id !== 'string' || !PRESET_ID.test(id)) throw new TypeError('Invalid expert id')
    const view = await this.read()
    const expert = view.experts.find(item => item.id === id)
      ?? view.invalid.find(item => item.id === id)
    if (expert === undefined) throw new Error(`Unknown expert: ${id}`)
    if ('presetId' in expert) return expert
    throw new Error(`Expert ${id} is unavailable: ${expert.reason}`)
  }

  async summon(id: string, prompt?: string): Promise<DesktopExpertSummonResult> {
    if (typeof id !== 'string' || !PRESET_ID.test(id)) throw new TypeError('Invalid expert id')
    if (prompt !== undefined && (typeof prompt !== 'string' || prompt.length > MAX_PROMPT_CHARS)) {
      throw new TypeError('Invalid prompt')
    }
    const scan = await this.scan()
    const expert = scan.experts.find(item => item.id === id)
    if (expert === undefined) {
      const invalid = scan.invalid.find(item => item.id === id)
      throw new Error(invalid === undefined ? `Unknown expert: ${id}` : `Expert ${id} is unavailable: ${invalid.reason}`)
    }
    // Resolve the preset before creating anything: a failure must not produce
    // a session bound to the wrong (or no) preset.
    const presets = this.runtime.agentPresets
    if (presets === undefined) throw new Error('Agent preset registry is unavailable')
    const resolved = await presets.resolve(id)
    if (resolved.broken !== undefined) throw new Error(`Agent preset ${id} is unavailable: ${resolved.broken}`)
    if (resolved.id !== id) throw new Error(`Agent preset resolved to ${resolved.id}, expected ${id}`)

    const sessionController = this.runtime.sessionController
    if (sessionController === undefined) throw new Error('Session controller is unavailable')
    const workspaceRegistry = this.runtime.workspaceRegistry
    if (workspaceRegistry === undefined) throw new Error('Workspace registry is unavailable')
    const workspaceId = this.runtime.defaultWorkspaceId?.() ?? workspaceRegistry.list()[0]?.id
    if (workspaceId === undefined) throw new Error('No workspace is available to start a Session')
    if (workspaceRegistry.get(workspaceId) === undefined) throw new Error(`Workspace "${workspaceId}" no longer exists`)

    const created = await sessionController.create({ workspaceId, agentPreset: id })
    if (created.agentPreset !== id) {
      throw new Error(`Session ${created.sessionId} was created with preset ${created.agentPreset ?? '(none)'}, expected ${id}`)
    }
    return Object.freeze({
      sessionId: created.sessionId,
      workspaceId,
      agentPreset: id,
      expertName: expert.display.name,
    })
  }
}

function defaultWorkspaceId(ctx: Context): string | undefined {
  const settings = ctx.get('settings') as { describe(): Array<{ ns: unknown; value?: unknown }> } | undefined
  if (settings === undefined) return undefined
  const descriptor = settings.describe().find(item => String(item.ns) === 'dsh-desktop-workspace')
  const value = descriptor?.value as { readonly defaultWorkspaceId?: unknown } | undefined
  return typeof value?.defaultWorkspaceId === 'string' && value.defaultWorkspaceId !== '' ? value.defaultWorkspaceId : undefined
}

export function apply(ctx: Context): void {
  // Soft lookups resolve at request time: the declaring fiber must not assume
  // activation order against the bundle-owned session-controller row.
  const runtime: ExpertRuntime = {
    get agentPresets() { return ctx.get('agentPresets') as ExpertRuntime['agentPresets'] },
    get sessionController() { return ctx.get('sessionController') as ExpertRuntime['sessionController'] },
    get workspaceRegistry() { return ctx.get('workspaceRegistry') as ExpertRuntime['workspaceRegistry'] },
    defaultWorkspaceId: () => defaultWorkspaceId(ctx),
  }
  const controller = new DesktopExpertsController(runtime)
  registerDesktopJsonApi(ctx, {
    label: 'Experts',
    readPath: DESKTOP_EXPERTS_PATH,
    actionPath: DESKTOP_EXPERTS_ACTION_PATH,
    read: () => controller.read(),
    action: async value => {
      if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('invalid Experts action')
      if (value.action === 'list') {
        const query = value.query === undefined ? undefined : String(value.query)
        const category = value.category === undefined ? undefined : String(value.category)
        return controller.read(query, category)
      }
      if (value.action === 'detail' && typeof value.id === 'string') return controller.detail(value.id)
      if (value.action === 'summon' && typeof value.id === 'string') {
        const prompt = value.prompt === undefined ? undefined : String(value.prompt)
        return controller.summon(value.id, prompt)
      }
      throw new TypeError('invalid Experts action')
    },
  })
}
