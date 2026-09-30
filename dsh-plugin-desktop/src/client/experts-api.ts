import {
  DESKTOP_EXPERTS_ACTION_PATH, DESKTOP_EXPERTS_PATH,
  type DesktopExpertEntry, type DesktopExpertInvalid, type DesktopExpertSummonResult, type DesktopExpertsView,
} from '../experts-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max = 16_384): value is string { return typeof value === 'string' && value.length <= max }

function parseExpert(value: unknown): DesktopExpertEntry {
  if (!isRecord(value) || !text(value.id, 128) || !text(value.version, 64) || !text(value.category, 64)
    || !isRecord(value.display) || !text(value.display.name, 128) || !text(value.display.title, 256)
    || !text(value.display.description, 2000) || !Array.isArray(value.display.tags)
    || !isRecord(value.entry) || !text(value.entry.defaultPrompt, 4000) || !Array.isArray(value.entry.quickPrompts)
    || !text(value.presetId, 128) || typeof value.available !== 'boolean'
    || (value.unavailableReason !== undefined && !text(value.unavailableReason, 4000))) {
    throw new Error('dsh-plugin-desktop: invalid Expert response')
  }
  const tags = value.display.tags.map((tag, index) => {
    if (!text(tag, 128)) throw new Error(`dsh-plugin-desktop: invalid Expert tag [${String(index)}]`)
    return tag
  })
  const quickPrompts = value.entry.quickPrompts.map((prompt, index) => {
    if (!text(prompt, 500)) throw new Error(`dsh-plugin-desktop: invalid quick prompt [${String(index)}]`)
    return prompt
  })
  if (value.presetId !== value.id) throw new Error('dsh-plugin-desktop: Expert presetId must equal id')
  return Object.freeze({
    id: value.id, version: value.version, category: value.category,
    display: Object.freeze({ name: value.display.name, title: value.display.title,
      description: value.display.description, tags: Object.freeze(tags) }),
    entry: Object.freeze({ defaultPrompt: value.entry.defaultPrompt, quickPrompts: Object.freeze(quickPrompts) }),
    presetId: value.presetId, available: value.available,
    ...(value.unavailableReason === undefined ? {} : { unavailableReason: value.unavailableReason }),
  })
}

function parseInvalid(value: unknown): DesktopExpertInvalid {
  if (!isRecord(value) || !text(value.id, 128) || !text(value.directory, 4096) || !text(value.reason, 4000)) {
    throw new Error('dsh-plugin-desktop: invalid invalid-Expert row')
  }
  return Object.freeze({ id: value.id, directory: value.directory, reason: value.reason })
}

export function parseDesktopExpertsView(value: unknown): DesktopExpertsView {
  if (!isRecord(value) || !Array.isArray(value.experts) || value.experts.length > 10_000
    || !Array.isArray(value.invalid) || value.invalid.length > 10_000
    || !Array.isArray(value.categories)) {
    throw new Error('dsh-plugin-desktop: invalid Experts response')
  }
  const experts = value.experts.map(parseExpert)
  if (new Set(experts.map(expert => expert.id)).size !== experts.length) {
    throw new Error('dsh-plugin-desktop: duplicate Expert response row')
  }
  const invalid = value.invalid.map(parseInvalid)
  const categories = value.categories.map(category => {
    if (!text(category, 64)) throw new Error('dsh-plugin-desktop: invalid category')
    return category
  })
  return Object.freeze({
    experts: Object.freeze(experts),
    invalid: Object.freeze(invalid),
    categories: Object.freeze(categories),
  })
}

export function parseDesktopExpertSummonResult(value: unknown): DesktopExpertSummonResult {
  if (!isRecord(value) || !text(value.sessionId, 512) || !text(value.workspaceId, 512)
    || !text(value.agentPreset, 128) || !text(value.expertName, 128)) {
    throw new Error('dsh-plugin-desktop: invalid summon result')
  }
  return Object.freeze({
    sessionId: value.sessionId, workspaceId: value.workspaceId,
    agentPreset: value.agentPreset, expertName: value.expertName,
  })
}

async function readResponse(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('Experts response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}

export interface DesktopExpertsApi {
  read(): Promise<DesktopExpertsView>
  list(query?: string, category?: string): Promise<DesktopExpertsView>
  detail(id: string): Promise<DesktopExpertEntry>
  summon(id: string, prompt?: string): Promise<DesktopExpertSummonResult>
}

export function createDesktopExpertsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopExpertsApi {
  const post = async (value: object): Promise<unknown> => readResponse(await fetcher(DESKTOP_EXPERTS_ACTION_PATH, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  }))
  return Object.freeze({
    async read() {
      return parseDesktopExpertsView(await readResponse(await fetcher(DESKTOP_EXPERTS_PATH, {
        method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json' },
      })))
    },
    async list(query: string | undefined, category: string | undefined) {
      return parseDesktopExpertsView(await post({
        action: 'list',
        ...(query === undefined || query === '' ? {} : { query }),
        ...(category === undefined || category === '' ? {} : { category }),
      }))
    },
    async detail(id: string) {
      const value = await post({ action: 'detail', id })
      return parseExpert(value)
    },
    async summon(id: string, prompt?: string) {
      return parseDesktopExpertSummonResult(await post({
        action: 'summon', id, ...(prompt === undefined ? {} : { prompt }),
      }))
    },
  })
}
