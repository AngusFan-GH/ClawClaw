/** Same-origin client for the Desktop expert center JSON API. */

import {
  DESKTOP_EXPERTS_ACTION_PATH, DESKTOP_EXPERTS_PATH,
  type ExpertInvalidView, type ExpertSummonResult, type ExpertView, type ExpertsView,
} from '../expert-center-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown, max = 4096): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max
}

function parseExpert(value: unknown): ExpertView {
  if (!isRecord(value) || !text(value.id, 128) || !text(value.version, 64) || !text(value.category, 64)
    || !isRecord(value.display) || !text(value.display.name, 128) || !text(value.display.title, 128)
    || !text(value.display.description, 4096) || !isRecord(value.entry)
    || !text(value.entry.defaultPrompt, 4096) || typeof value.available !== 'boolean'
    || !text(value.presetId, 128)) {
    throw new Error('dsh-plugin-desktop: invalid expert response')
  }
  const tags = Array.isArray(value.display.tags)
    && value.display.tags.every(tag => typeof tag === 'string')
    ? value.display.tags as readonly string[]
    : []
  const quickPrompts = Array.isArray(value.entry.quickPrompts)
    && value.entry.quickPrompts.every(prompt => typeof prompt === 'string')
    ? value.entry.quickPrompts as readonly string[]
    : []
  return Object.freeze({
    id: value.id, version: value.version, category: value.category,
    display: Object.freeze({
      name: value.display.name, title: value.display.title,
      description: value.display.description, tags: Object.freeze(tags),
    }),
    entry: Object.freeze({ defaultPrompt: value.entry.defaultPrompt, quickPrompts: Object.freeze(quickPrompts) }),
    presetId: value.presetId,
    available: value.available,
    ...(typeof value.unavailableReason === 'string' && value.unavailableReason !== ''
      ? { unavailableReason: value.unavailableReason }
      : {}),
  })
}

export function parseExpertsView(value: unknown): ExpertsView {
  if (!isRecord(value) || !Array.isArray(value.experts) || !Array.isArray(value.invalid)
    || !Array.isArray(value.categories)) {
    throw new Error('dsh-plugin-desktop: invalid Experts response')
  }
  const experts = value.experts.map(parseExpert)
  const invalid = value.invalid.map(item => {
    if (!isRecord(item) || !text(item.id, 128) || !text(item.reason, 512)) {
      throw new Error('dsh-plugin-desktop: invalid invalid-expert row')
    }
    return Object.freeze({ id: item.id, reason: item.reason })
  })
  const categories = value.categories.filter((category): category is string => typeof category === 'string')
  return Object.freeze({
    experts: Object.freeze(experts),
    invalid: Object.freeze(invalid),
    categories: Object.freeze(categories),
  })
}

export interface ExpertsApi {
  read(): Promise<ExpertsView>
  summon(expertId: string, workspaceId?: string): Promise<ExpertSummonResult>
}

async function responseJson(response: Response): Promise<unknown> {
  const body = await response.text()
  let value: unknown
  try { value = JSON.parse(body) as unknown } catch {
    const detail = body.trim()
    throw new Error(`Expert request returned HTTP ${String(response.status)} with a non-JSON response${detail === '' ? '' : `: ${detail}`}`)
  }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}

export function createExpertsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): ExpertsApi {
  return Object.freeze({
    async read() {
      return parseExpertsView(await responseJson(await fetcher(DESKTOP_EXPERTS_PATH, {
        method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json' },
      })))
    },
    async summon(expertId: string, workspaceId?: string) {
      const value = await responseJson(await fetcher(DESKTOP_EXPERTS_ACTION_PATH, {
        method: 'POST', credentials: 'same-origin', redirect: 'error',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
        body: JSON.stringify({
          action: 'summon', expertId,
          ...(workspaceId === undefined || workspaceId === '' ? {} : { workspaceId }),
        }),
      }))
      if (!isRecord(value) || !text(value.sessionId, 128) || !text(value.agentPreset, 128)) {
        throw new Error('dsh-plugin-desktop: invalid summon response')
      }
      return Object.freeze({ sessionId: value.sessionId, agentPreset: value.agentPreset })
    },
  })
}

export type { ExpertInvalidView }

/** Filter experts by keyword (name/title/tags/category/id) and exact category. */
export function filterExperts(
  experts: readonly ExpertView[],
  query: string,
  category: string,
): readonly ExpertView[] {
  const q = query.trim().toLowerCase()
  return experts.filter(expert => {
    if (category !== '' && expert.category !== category) return false
    if (q === '') return true
    const haystack = [
      expert.display.name, expert.display.title, expert.category,
      ...expert.display.tags, expert.id,
    ].join(' ').toLowerCase()
    return haystack.includes(q)
  })
}
