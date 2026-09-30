/** Desktop-owned local expert discovery and same-origin JSON API. */

import { lstat, readFile, readdir } from 'node:fs/promises'
import { join, resolve, sep } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { AgentPresetRegistry } from '@deepseek-ai/dsh-agent-preset-registry'
import type { SessionController } from '@deepseek-ai/dsh-api-session-controller'
import type { WorkspaceId } from '@deepseek-ai/dsh-workspace/types'
import { resolveDshHome } from '@deepseek-ai/dsh-home-paths'
import { parseDocument } from 'yaml'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import {
  DESKTOP_EXPERTS_ACTION_PATH, DESKTOP_EXPERTS_PATH,
  EXPERT_LIST_LIMIT, EXPERT_MANIFEST_MAX_BYTES, EXPERT_PRESET_MAX_BYTES,
  type ExpertInvalidView, type ExpertSummonRequest, type ExpertSummonResult,
  type ExpertView, type ExpertsView,
} from './expert-center-contract.ts'

export * from './expert-center-contract.ts'

export const name = 'desktop-expert-center'
export const inject = ['agentPresets', 'webServer', 'connection', 'sessionController']

const EXPERT_ID = /^[A-Za-z0-9_-]{1,128}$/u

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function text(value: unknown, max: number): string | undefined {
  return typeof value === 'string' && value.length > 0 && value.length <= max ? value : undefined
}

/** Server-side listing filter: keyword and exact category. */
export interface ExpertListFilter {
  readonly query: string
  readonly category: string
  /** Exact expert id; when set, only that expert is returned. */
  readonly id?: string
}

const EMPTY_FILTER: ExpertListFilter = Object.freeze({ query: '', category: '', id: '' })

/** Parse the `q` and `category` query parameters from a request URL. */
function parseExpertQuery(url: string | undefined): ExpertListFilter {
  if (url === undefined) return EMPTY_FILTER
  let query = ''
  let category = ''
  let id = ''
  try {
    const parsed = new URL(url, 'http://127.0.0.1')
    const q = parsed.searchParams.get('q')
    const cat = parsed.searchParams.get('category')
    const rawId = parsed.searchParams.get('id')
    if (typeof q === 'string' && q.length > 0 && q.length <= 200) query = q
    if (typeof cat === 'string' && cat.length > 0 && cat.length <= 128) category = cat
    if (typeof rawId === 'string' && EXPERT_ID.test(rawId)) id = rawId
  } catch {
    return EMPTY_FILTER
  }
  return Object.freeze({ query, category, id })
}

/** Apply keyword (name/title/tags/category/id) and exact-category filtering. */
function filterExpertsView(view: ExpertsView, filter: ExpertListFilter): ExpertsView {
  if (filter.query === '' && filter.category === '' && (filter.id === undefined || filter.id === '')) return view
  const q = filter.query.trim().toLowerCase()
  const experts = view.experts.filter(expert => {
    if (filter.id !== undefined && filter.id !== '' && expert.id !== filter.id) return false
    if (filter.category !== '' && expert.category !== filter.category) return false
    if (q === '') return true
    const haystack = [
      expert.display.name, expert.display.title, expert.category,
      ...expert.display.tags, expert.id,
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
  return Object.freeze({
    experts: Object.freeze(experts),
    invalid: view.invalid,
    categories: view.categories,
  })
}

/** Read a regular, non-symlink file with a size ceiling; throws on anything else. */
async function regularFile(path: string, maxBytes: number): Promise<string> {
  const info = await lstat(path)
  if (!info.isFile() || info.isSymbolicLink()) throw new Error('must be a regular file')
  if (info.size > maxBytes) throw new Error(`exceeds ${String(maxBytes)} bytes`)
  return await readFile(path, 'utf8')
}

function parseYaml(path: string, source: string): unknown {
  const document = parseDocument(source, { prettyErrors: true })
  if (document.errors.length > 0) {
    throw new Error(`${path}: ${document.errors.map(error => error.message).join('; ')}`)
  }
  return document.toJS()
}

function isPathInside(root: string, target: string): boolean {
  const resolved = resolve(root, target)
  return resolved === root || resolved.startsWith(root + sep)
}

/** Validate one expert.yml document against the supported contract. */
function parseExpertManifest(directory: string, data: unknown): ExpertView {
  if (!isRecord(data)) throw new Error('expert.yml must be a map')
  const id = text(data.id, 128)
  if (id === undefined) throw new Error('expert.yml requires a non-empty id')
  if (!EXPERT_ID.test(id)) throw new Error(`invalid expert id: ${id}`)
  if (id !== directory) throw new Error(`expert id "${id}" does not match directory name "${directory}"`)
  const version = text(data.version, 64)
  if (version === undefined) throw new Error('expert.yml requires a non-empty version')
  const category = text(data.category, 64)
  if (category === undefined) throw new Error('expert.yml requires a non-empty category')
  const display = data.display
  if (!isRecord(display)) throw new Error('expert.yml requires a display map')
  const name = text(display.name, 128)
  if (name === undefined) throw new Error('expert.yml requires display.name')
  const title = text(display.title, 128)
  if (title === undefined) throw new Error('expert.yml requires display.title')
  const description = text(display.description, 4096)
  if (description === undefined) throw new Error('expert.yml requires display.description')
  const tags = Array.isArray(display.tags)
    ? display.tags.filter((tag): tag is string => typeof tag === 'string' && tag.length > 0 && tag.length <= 64)
    : []
  const entry = data.entry
  if (!isRecord(entry)) throw new Error('expert.yml requires an entry map')
  const defaultPrompt = text(entry.defaultPrompt, 4096)
  if (defaultPrompt === undefined) throw new Error('expert.yml requires entry.defaultPrompt')
  const quickPrompts = Array.isArray(entry.quickPrompts)
    ? entry.quickPrompts.filter((prompt): prompt is string => typeof prompt === 'string' && prompt.length > 0 && prompt.length <= 4096)
    : []
  return Object.freeze({
    id, version, category,
    display: Object.freeze({ name, title, description, tags: Object.freeze(tags) }),
    entry: Object.freeze({ defaultPrompt, quickPrompts: Object.freeze(quickPrompts) }),
    presetId: id,
    available: false,
  })
}

interface DiscoveredExpert {
  readonly view: ExpertView
  readonly reason?: string
}

/** Merge scanned packages into the listing view, isolating failures and duplicates. */
export function buildExpertsView(
  discovered: readonly DiscoveredExpert[],
  presets: readonly { id: string; broken?: string }[],
): ExpertsView {
  const byId = new Map(presets.map(preset => [preset.id, preset]))
  const experts: ExpertView[] = []
  const invalid: ExpertInvalidView[] = []
  const seen = new Set<string>()
  for (const item of discovered) {
    if (item.reason !== undefined) {
      invalid.push(Object.freeze({ id: item.view.id, reason: item.reason }))
      continue
    }
    if (seen.has(item.view.id)) {
      invalid.push(Object.freeze({ id: item.view.id, reason: `duplicate expert id: ${item.view.id}` }))
      continue
    }
    seen.add(item.view.id)
    const preset = byId.get(item.view.presetId)
    const broken = preset?.broken
    experts.push(Object.freeze({
      ...item.view,
      available: preset !== undefined && broken === undefined,
      ...(preset === undefined
        ? { unavailableReason: `Agent preset "${item.view.presetId}" is not registered` }
        : broken === undefined ? {} : { unavailableReason: broken }),
    }))
  }
  const categories = [...new Set(experts.map(expert => expert.category))].sort((a, b) => a.localeCompare(b))
  return Object.freeze({
    experts: Object.freeze(experts),
    invalid: Object.freeze(invalid),
    categories: Object.freeze(categories),
  })
}

/** Scan one candidate directory; never throws for an invalid package. */
async function scanExpertDirectory(root: string, directory: string): Promise<DiscoveredExpert> {
  const dirPath = join(root, directory)
  const manifestPath = join(dirPath, 'expert.yml')
  const presetPath = join(dirPath, 'preset.yml')
  const pluginsPath = join(dirPath, 'agent.cordis.yml')
  try {
    const dirInfo = await lstat(dirPath)
    if (!dirInfo.isDirectory() || dirInfo.isSymbolicLink()) throw new Error('not a regular directory')
    if (!isPathInside(root, dirPath)) throw new Error('unsafe expert path')
    for (const path of [presetPath, pluginsPath, manifestPath]) {
      let info
      try {
        info = await lstat(path)
      } catch (cause) {
        if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
          throw new Error(`missing required file: ${path}`)
        }
        throw cause
      }
      if (info.isSymbolicLink()) throw new Error(`must be a regular file: ${path}`)
      if (!info.isFile()) throw new Error(`missing required file: ${path}`)
    }
    const manifest = parseYaml(manifestPath, await regularFile(manifestPath, EXPERT_MANIFEST_MAX_BYTES))
    // Preset composition files are validated by the registry; only size/readability gates apply here.
    await regularFile(presetPath, EXPERT_PRESET_MAX_BYTES)
    await regularFile(pluginsPath, EXPERT_PRESET_MAX_BYTES)
    const view = parseExpertManifest(directory, manifest)
    return { view }
  } catch (cause) {
    const reason = cause instanceof Error ? cause.message : String(cause)
    return { view: Object.freeze({
      id: directory, version: '', category: '',
      display: Object.freeze({ name: directory, title: '', description: '', tags: Object.freeze([]) }),
      entry: Object.freeze({ defaultPrompt: '', quickPrompts: Object.freeze([]) }),
      presetId: directory, available: false, unavailableReason: reason,
    }), reason }
  }
}

export class DesktopExpertCenter {
  constructor(
    private readonly ctx: Context,
    private readonly root: string,
    private readonly sessionController: SessionController,
  ) {}

  /** Read every expert, each isolated from its neighbours' failures. */
  async list(filter: ExpertListFilter = EMPTY_FILTER): Promise<ExpertsView> {
    let entries: string[]
    try {
      entries = (await readdir(this.root, { withFileTypes: true }))
        .map(entry => entry.name)
        .sort((a, b) => a.localeCompare(b))
    } catch (cause) {
      if ((cause as NodeJS.ErrnoException).code === 'ENOENT') {
        return Object.freeze({ experts: Object.freeze([]), invalid: Object.freeze([]), categories: Object.freeze([]) })
      }
      throw cause
    }
    const presets = await (this.ctx.get('agentPresets') as AgentPresetRegistry | undefined)?.list() ?? []
    const discovered: DiscoveredExpert[] = []
    for (const directory of entries.slice(0, EXPERT_LIST_LIMIT)) {
      discovered.push(await scanExpertDirectory(this.root, directory))
    }
    const view = buildExpertsView(discovered, presets)
    return filterExpertsView(view, filter)
  }

  /**
   * Create a Session bound to the expert's Agent preset.
   *
   * Validation happens before any Session exists: an unknown expert, an
   * unavailable preset, or a refused composition never leaves a partial
   * Session behind.
   */
  async summon(request: ExpertSummonRequest): Promise<ExpertSummonResult> {
    if (!EXPERT_ID.test(request.expertId)) throw new TypeError('invalid expertId')
    const view = (await this.list()).experts.find(expert => expert.id === request.expertId)
    if (view === undefined) throw new Error(`unknown expert: ${request.expertId}`)
    if (!view.available) throw new Error(view.unavailableReason ?? `expert ${view.id} is unavailable`)
    // Re-resolve against the live registry: the listing may have aged since it
    // was read, and a broken preset must never compose a Session.
    const resolved = await (this.ctx.get('agentPresets') as AgentPresetRegistry | undefined)?.resolve(view.presetId)
    if (resolved === undefined || resolved.broken !== undefined) {
      throw new Error(resolved?.broken ?? `Agent preset "${view.presetId}" is not available`)
    }
    const created = await this.sessionController.create({
      agentPreset: view.presetId,
      ...(request.workspaceId === undefined || request.workspaceId === ''
        ? {}
        : { workspaceId: request.workspaceId as WorkspaceId }),
    })
    return Object.freeze({ sessionId: created.sessionId, agentPreset: created.agentPreset ?? view.presetId })
  }
}

export function expertRoot(config: { root?: string } = {}): string {
  return resolve(config.root ?? join(resolveDshHome(), '.agent-presets'))
}

export function apply(ctx: Context, config: { root?: string } = {}): void {
  const controller = new DesktopExpertCenter(
    ctx,
    expertRoot(config),
    ctx.sessionController,
  )
  registerDesktopJsonApi(ctx, {
    label: 'Experts',
    readPath: DESKTOP_EXPERTS_PATH,
    actionPath: DESKTOP_EXPERTS_ACTION_PATH,
    read: req => controller.list(parseExpertQuery(req.url)),
    action: async value => {
      if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('invalid Experts action')
      if (value.action === 'summon') {
        if (typeof value.expertId !== 'string' || !EXPERT_ID.test(value.expertId)) {
          throw new TypeError('invalid expertId')
        }
        const request: ExpertSummonRequest = {
          action: 'summon',
          expertId: value.expertId,
          ...(typeof value.workspaceId === 'string' && value.workspaceId !== ''
            ? { workspaceId: value.workspaceId }
            : {}),
        }
        return controller.summon(request)
      }
      throw new TypeError('invalid Experts action')
    },
  })
}
