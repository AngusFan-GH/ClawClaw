/**
 * Expert center client state.
 *
 * The center owns three surfaces over one catalog read: the browse page, the
 * conversation badge that names the expert a Session runs, and the one-shot
 * first-input prefill a summon hands to the new Session's composer. Sessions
 * are created by the Host, so a refused summon leaves nothing behind.
 */

import type { ExpertCategory, ExpertView, ExpertsView } from '../experts-contract.ts'
import { expertFailureMessage, type ExpertCenterApi } from './experts-api.ts'

/** Which page the panel shows. */
export type ExpertCenterPhase = 'loading' | 'ready' | 'error'
export type ExpertDetailPhase = 'idle' | 'loading' | 'ready' | 'error'

/** Localized notice codes; the panel owns the wording. */
export type ExpertNoticeCode = 'summonFailed' | 'sessionPending' | 'loadFailed' | 'detailFailed'

export interface ExpertNotice {
  readonly kind: 'info' | 'error'
  readonly code: ExpertNoticeCode
  /** Raw Host or transport message, shown after the localized sentence. */
  readonly detail?: string
}

export interface ExpertCenterState {
  readonly phase: ExpertCenterPhase
  /** Rows for the current query, as the Host filtered them. */
  readonly experts: readonly ExpertView[]
  /** Unfiltered roster, read by the conversation badge. */
  readonly roster: readonly ExpertView[]
  readonly categories: readonly ExpertCategory[]
  readonly root: string
  readonly truncated: boolean
  readonly query: string
  readonly category: string
  readonly error?: string
  readonly selectedId?: string
  readonly detailPhase: ExpertDetailPhase
  readonly detail?: ExpertView
  readonly detailError?: string
  /** Expert whose summon is in flight. */
  readonly summoningId?: string
  readonly notice?: ExpertNotice
}

/** Patch accepted by `ExpertCenter.set`; `undefined` clears an optional field. */
export type ExpertCenterPatch = { readonly [K in keyof ExpertCenterState]?: ExpertCenterState[K] | undefined }

export interface ExpertCenterDeps {
  readonly api: ExpertCenterApi
  /** Open an existing Session in the conversation view. */
  readonly openSession: (sessionId: string) => void
  /** Workspace a summoned Session should attach to; undefined keeps the Host default. */
  readonly resolveWorkspaceId: () => string | undefined
  /** Resolve once the Session is addressable by the Client catalog. */
  readonly awaitSession: (sessionId: string) => Promise<boolean>
  readonly warn?: (message: string, reason: unknown) => void
}

/** Expert that runs `presetId`; only an available package names a Session identity. */
export function expertForPreset(
  state: Pick<ExpertCenterState, 'roster'>,
  presetId: string | null | undefined,
): ExpertView | undefined {
  if (presetId === null || presetId === undefined || presetId === '') return undefined
  return state.roster.find(expert => expert.presetId === presetId && expert.status === 'available')
}

const EMPTY: ExpertCenterState = Object.freeze({
  phase: 'loading', experts: Object.freeze([]), roster: Object.freeze([]), categories: Object.freeze([]),
  root: '', truncated: false, query: '', category: '', detailPhase: 'idle',
})

function failureDetail(cause: unknown): string {
  const message = expertFailureMessage(cause)
  return message === '' ? 'unknown failure' : message
}

/** Browse, search, inspect, and summon local experts. */
export class ExpertCenter {
  private state: ExpertCenterState = EMPTY
  private readonly listeners = new Set<() => void>()
  private readonly prefills = new Map<string, string>()
  /** Monotone guard: a superseded search never republishes its rows. */
  private generation = 0
  private disposed = false

  constructor(private readonly deps: ExpertCenterDeps) {
    this.subscribe = this.subscribe.bind(this)
    this.getSnapshot = this.getSnapshot.bind(this)
  }

  /** Snapshot accessor bounded for `useSyncExternalStore`. */
  getSnapshot(): ExpertCenterState {
    return this.state
  }

  /** Subscription bounded for `useSyncExternalStore`. */
  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  /** Release in-flight state; later responses are ignored. */
  dispose(): void {
    this.disposed = true
    this.generation += 1
    this.listeners.clear()
    this.prefills.clear()
  }

  /** Read the roster and the current query result. Idempotent per mount. */
  async start(): Promise<void> {
    await this.load(true)
  }

  /** Re-read the roster and the current query result. */
  async refresh(): Promise<void> {
    await this.load(true)
  }

  /** Apply a new keyword query through the Host search. */
  async setQuery(query: string): Promise<void> {
    if (query === this.state.query) return
    this.set({ query })
    await this.load(false)
  }

  /** Apply a new category filter; an empty id clears it. */
  async setCategory(category: string): Promise<void> {
    if (category === this.state.category) return
    this.set({ category })
    await this.load(false)
  }

  /** Drop the notice a previous action produced. */
  clearNotice(): void {
    if (this.state.notice === undefined) return
    this.set({ notice: undefined })
  }

  /** Load one expert's detail view. */
  async openDetail(id: string): Promise<void> {
    this.set({ selectedId: id, detailPhase: 'loading', detail: undefined, detailError: undefined, notice: undefined })
    const generation = ++this.generation
    try {
      const detail = await this.deps.api.detail(id)
      if (generation !== this.generation) return
      this.set({ detailPhase: 'ready', detail })
    } catch (cause) {
      if (generation !== this.generation) return
      this.set({ detailPhase: 'error', detailError: failureDetail(cause) })
    }
  }

  /** Leave the detail view. */
  closeDetail(): void {
    this.generation += 1
    this.set({ selectedId: undefined, detailPhase: 'idle', detail: undefined, detailError: undefined })
  }

  /**
   * Create a Session that runs the expert's Agent preset, open it, and stage
   * the first-input prefill. The Host creates the Session, so a refused
   * summon leaves no Session and no prefill behind.
   * @param id - expert id.
   * @param prompt - quick-task text; defaults to the expert's default prompt.
   */
  async summon(id: string, prompt?: string): Promise<void> {
    if (this.state.summoningId !== undefined) return
    this.set({ summoningId: id, notice: undefined })
    try {
      const workspaceId = this.deps.resolveWorkspaceId()
      const value = await this.deps.api.summon({
        id,
        ...(prompt === undefined ? {} : { prompt }),
        ...(workspaceId === undefined ? {} : { workspaceId }),
      })
      if (value.prompt !== undefined && value.prompt !== '') this.prefills.set(value.sessionId, value.prompt)
      const addressable = await this.deps.awaitSession(value.sessionId)
      if (this.disposed) return
      if (!addressable) {
        this.set({ notice: { kind: 'info', code: 'sessionPending', detail: value.sessionId } })
        return
      }
      try {
        this.deps.openSession(value.sessionId)
      } catch (cause) {
        this.set({ notice: { kind: 'info', code: 'sessionPending', detail: failureDetail(cause) } })
      }
    } catch (cause) {
      if (this.disposed) return
      this.set({ notice: { kind: 'error', code: 'summonFailed', detail: failureDetail(cause) } })
    } finally {
      if (!this.disposed) this.set({ summoningId: undefined })
    }
  }

  /** Expert that runs `presetId`, as the conversation badge reads it. */
  expertForPreset(presetId: string | null | undefined): ExpertView | undefined {
    return expertForPreset(this.state, presetId)
  }

  /** Consume the staged first-input prefill for one Session, at most once. */
  takePrefill(sessionId: string): string | undefined {
    const text = this.prefills.get(sessionId)
    if (text === undefined) return undefined
    this.prefills.delete(sessionId)
    return text
  }

  /** Read the roster without a filter; used by refresh paths and tests. */
  private async load(full: boolean): Promise<void> {
    const generation = ++this.generation
    this.set({ phase: 'loading', error: undefined, notice: undefined })
    try {
      const view: ExpertsView = full ? await this.deps.api.read() : await this.deps.api.list({
        ...(this.state.query === '' ? {} : { q: this.state.query }),
        ...(this.state.category === '' ? {} : { category: this.state.category }),
      })
      if (generation !== this.generation || this.disposed) return
      const roster = full ? view.experts : this.state.roster
      this.set({
        phase: 'ready', experts: view.experts, roster, categories: view.categories,
        root: view.root, truncated: view.truncated,
      })
      if (full && (this.state.query !== '' || this.state.category !== '')) await this.load(false)
    } catch (cause) {
      if (generation !== this.generation || this.disposed) return
      const detail = failureDetail(cause)
      this.set({
        phase: 'error', error: detail,
        notice: { kind: 'error', code: 'loadFailed', detail },
      })
    }
  }

  private set(patch: ExpertCenterPatch): void {
    const merged = { ...this.state } as Record<string, unknown>
    for (const [key, value] of Object.entries(patch)) {
      if (value === undefined) delete merged[key]
      else merged[key] = value
    }
    this.state = Object.freeze(merged) as unknown as ExpertCenterState
    for (const listener of [...this.listeners]) {
      try {
        listener()
      } catch (cause) {
        this.deps.warn?.('dsh-plugin-desktop: expert center listener failed', cause)
      }
    }
  }
}
