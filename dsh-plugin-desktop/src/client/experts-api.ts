/** Same-origin client for the Desktop expert center. */

import {
  DESKTOP_EXPERTS_ACTION_PATH, DESKTOP_EXPERTS_PATH,
  type ExpertCategory, type ExpertDisplay, type ExpertEntry, type ExpertProblem, type ExpertStatus,
  type ExpertSummonValue, type ExpertView, type ExpertsView,
} from '../experts-contract.ts'

export { DESKTOP_EXPERTS_ACTION_PATH, DESKTOP_EXPERTS_PATH } from '../experts-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>

const STATUSES: readonly ExpertStatus[] = ['available', 'unavailable', 'invalid']
const PROBLEMS: readonly ExpertProblem[] = [
  'missing-files', 'unreadable', 'unsafe-path', 'invalid-yaml', 'invalid-manifest', 'id-mismatch',
  'duplicate-id', 'too-large', 'preset-missing', 'preset-broken', 'preset-invalid',
  'preset-registry-unavailable',
]

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max = 16_384): value is string {
  return typeof value === 'string' && value.length <= max
}
function isProblem(value: unknown): value is ExpertProblem {
  return typeof value === 'string' && (PROBLEMS as readonly string[]).includes(value)
}

function parseDisplay(value: unknown): ExpertDisplay {
  if (!isRecord(value) || !text(value.name, 256) || value.name === '') throw new Error('dsh-plugin-desktop: invalid expert display')
  if (value.title !== undefined && !text(value.title, 512)) throw new Error('dsh-plugin-desktop: invalid expert title')
  if (value.description !== undefined && !text(value.description, 8_192)) throw new Error('dsh-plugin-desktop: invalid expert description')
  if (!Array.isArray(value.tags) || value.tags.length > 64 || value.tags.some(tag => !text(tag, 256))) {
    throw new Error('dsh-plugin-desktop: invalid expert tags')
  }
  return Object.freeze({
    name: value.name,
    ...(value.title === undefined ? {} : { title: value.title }),
    ...(value.description === undefined ? {} : { description: value.description }),
    tags: Object.freeze([...value.tags] as string[]),
  })
}

function parseEntry(value: unknown): ExpertEntry {
  if (!isRecord(value)) throw new Error('dsh-plugin-desktop: invalid expert entry')
  if (value.defaultPrompt !== undefined && !text(value.defaultPrompt, 16_384)) throw new Error('dsh-plugin-desktop: invalid expert prompt')
  if (!Array.isArray(value.quickPrompts) || value.quickPrompts.length > 64
    || value.quickPrompts.some(prompt => !text(prompt, 16_384))) throw new Error('dsh-plugin-desktop: invalid expert quick prompts')
  return Object.freeze({
    ...(value.defaultPrompt === undefined ? {} : { defaultPrompt: value.defaultPrompt }),
    quickPrompts: Object.freeze([...value.quickPrompts] as string[]),
  })
}

/** Validate one expert row; every field the panel renders is checked here. */
export function parseExpertView(value: unknown): ExpertView {
  if (!isRecord(value) || !text(value.id, 128) || value.id === '' || !text(value.presetId, 128)
    || typeof value.status !== 'string' || !(STATUSES as readonly string[]).includes(value.status)
    || !text(value.directory, 8_192)) throw new Error('dsh-plugin-desktop: invalid expert response')
  if (value.problem !== undefined && !isProblem(value.problem)) throw new Error('dsh-plugin-desktop: invalid expert problem')
  for (const field of ['message', 'presetName', 'presetDescription', 'version', 'category'] as const) {
    if (value[field] !== undefined && !text(value[field], 8_192)) throw new Error(`dsh-plugin-desktop: invalid expert ${field}`)
  }
  const view: {
    id: string
    status: ExpertStatus
    problem?: ExpertProblem
    message?: string
    presetId: string
    presetName?: string
    presetDescription?: string
    version?: string
    category?: string
    display?: ExpertDisplay
    entry?: ExpertEntry
    directory: string
  } = { id: value.id, status: value.status as ExpertStatus, presetId: value.presetId, directory: value.directory }
  // Absent optional fields stay absent: the frozen row is exactly what the Host sent.
  if (value.problem !== undefined) view.problem = value.problem
  if (value.message !== undefined) view.message = value.message as string
  if (value.presetName !== undefined) view.presetName = value.presetName as string
  if (value.presetDescription !== undefined) view.presetDescription = value.presetDescription as string
  if (value.version !== undefined) view.version = value.version as string
  if (value.category !== undefined) view.category = value.category as string
  if (value.display !== undefined) view.display = parseDisplay(value.display)
  if (value.entry !== undefined) view.entry = parseEntry(value.entry)
  return Object.freeze(view)
}

/** Validate one catalog view, including its category totals. */
export function parseExpertsView(value: unknown): ExpertsView {
  if (!isRecord(value) || !text(value.root, 8_192) || !Array.isArray(value.experts) || value.experts.length > 4_096
    || !Array.isArray(value.categories) || value.categories.length > 512) {
    throw new Error('dsh-plugin-desktop: invalid experts response')
  }
  const categories: ExpertCategory[] = value.categories.map(category => {
    if (!isRecord(category) || !text(category.id, 128) || category.id === ''
      || typeof category.count !== 'number' || !Number.isInteger(category.count) || category.count < 0) {
      throw new Error('dsh-plugin-desktop: invalid expert category')
    }
    return Object.freeze({ id: category.id, count: category.count })
  })
  return Object.freeze({
    root: value.root,
    experts: Object.freeze(value.experts.map(parseExpertView)),
    categories: Object.freeze(categories),
    truncated: value.truncated === true,
  })
}

/** Validate one summon result before the Client navigates anywhere. */
export function parseExpertSummon(value: unknown): ExpertSummonValue {
  if (!isRecord(value) || !text(value.sessionId, 512) || value.sessionId === ''
    || !text(value.expertId, 128) || !text(value.presetId, 128)
    || (value.prompt !== undefined && !text(value.prompt, 16_384))) {
    throw new Error('dsh-plugin-desktop: invalid expert summon response')
  }
  return Object.freeze({
    sessionId: value.sessionId,
    expertId: value.expertId,
    presetId: value.presetId,
    ...(value.prompt === undefined ? {} : { prompt: value.prompt }),
  })
}

/** Expert center transport bound to one fetch implementation. */
export interface ExpertCenterApi {
  /** Unfiltered catalog read; also the roster the conversation badge consults. */
  read(signal?: AbortSignal): Promise<ExpertsView>
  /** Host-side keyword search and category filter. */
  list(query: { readonly q?: string; readonly category?: string }, signal?: AbortSignal): Promise<ExpertsView>
  detail(id: string, signal?: AbortSignal): Promise<ExpertView>
  summon(input: {
    readonly id: string
    readonly prompt?: string
    readonly workspaceId?: string
  }, signal?: AbortSignal): Promise<ExpertSummonValue>
}

/** Reason text of a refused call, preferring the Host's own message. */
export function expertFailureMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createExpertCenterApi(fetcher: FetchLike = fetch): ExpertCenterApi {
  const readResponse = async (response: Response): Promise<unknown> => {
    const payload: unknown = await response.json().catch(() => null)
    if (!response.ok) {
      const message = isRecord(payload) && typeof payload.error === 'string' ? payload.error : `HTTP ${String(response.status)}`
      throw new Error(message)
    }
    return payload
  }
  const post = async (body: object, signal?: AbortSignal): Promise<unknown> => await readResponse(await fetcher(
    DESKTOP_EXPERTS_ACTION_PATH,
    {
      method: 'POST', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
      headers: { 'content-type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      ...(signal === undefined ? {} : { signal }),
    },
  ))
  return {
    async read(signal) {
      return parseExpertsView(await readResponse(await fetcher(DESKTOP_EXPERTS_PATH, {
        method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store',
        headers: { Accept: 'application/json' },
        ...(signal === undefined ? {} : { signal }),
      })))
    },
    async list(query, signal) {
      return parseExpertsView(await post({
        action: 'list',
        ...(query.q === undefined ? {} : { q: query.q }),
        ...(query.category === undefined ? {} : { category: query.category }),
      }, signal))
    },
    async detail(id, signal) {
      return parseExpertView(await post({ action: 'detail', id }, signal))
    },
    async summon(input, signal) {
      return parseExpertSummon(await post({
        action: 'summon', id: input.id,
        ...(input.prompt === undefined ? {} : { prompt: input.prompt }),
        ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
      }, signal))
    },
  }
}
