import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { AUTOMATIC_ASSIST_CLIENT_TIMEOUT_MS, OPTIMIZATION_CLIENT_TIMEOUT_MS, continuationText, optimizationValue, type DraftAssistRequest, type DraftAssistResult, type DraftAssistProgress, type ContinuationDiagnostic, type AssistCancellation } from '../input-assistance-contract.ts'

export interface AssistSnapshot {
  sessionId: string; context: string; input: InputState
  available: boolean; continuationEnabled: boolean; optimizationEnabled: boolean; atEnd: boolean
}
export interface AssistTransport {
  generate(request: DraftAssistRequest, signal: AbortSignal, progress?: (event: DraftAssistProgress) => void): Promise<DraftAssistResult>
  cancel(request: DraftAssistRequest, reason?: AssistCancellation): void
  report?(event: ContinuationDiagnostic, draftRev: number): void
}
export type OptimizationPhase = 'idle' | 'generating' | 'preview' | 'empty' | 'error'
export class DraftAssistanceState {
  private snapshot: AssistSnapshot | undefined
  private active: { request: DraftAssistRequest; abort: AbortController; timeout: ReturnType<typeof setTimeout> } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private revision = 0
  private attempted = -1
  private lastRequestAt = -Infinity
  private disposed = false
  private suppressNextEdit = false
  private bound: AssistSnapshot | undefined
  text = ''
  phase: OptimizationPhase = 'idle'
  original = ''
  notes: readonly string[] = []
  reasoning = ''
  streamText = ''
  get optimizationAvailable(): boolean {
    const s = this.snapshot
    return s !== undefined && s.available && s.optimizationEnabled && this.plain(s.input)
      && s.input.draft.trim() !== '' && s.input.draft.length <= 8000
  }
  constructor(private readonly transport: AssistTransport, private readonly changed: () => void,
    private readonly id: () => string = () => crypto.randomUUID()) {}
  private cancel(reason: AssistCancellation = 'interaction'): void {
    this.revision++; clearTimeout(this.timer); this.timer = undefined
    const active = this.active; this.active = undefined
    if (active !== undefined) { clearTimeout(active.timeout); active.abort.abort(); this.transport.cancel(active.request, reason) }
  }
  update(next: AssistSnapshot, scheduleEdit = true): void {
    if (this.disposed) return
    const before = this.snapshot; this.snapshot = next
    const availabilityChanged = before?.available !== next.available || before.optimizationEnabled !== next.optimizationEnabled
    const edited = before !== undefined && before.input.draftRev !== next.input.draftRev
    const wasOptimizing = this.phase !== 'idle'
    const suppress = edited && this.suppressNextEdit
    if (edited) this.suppressNextEdit = false
    if (edited && (suppress || wasOptimizing)) this.attempted = next.input.draftRev
    const invalid = before?.context !== next.context || !next.available || !this.plain(next.input)
      || (before !== undefined && JSON.stringify(before.input.attachmentIds) !== JSON.stringify(next.input.attachmentIds))
      || (this.phase !== 'idle' ? !next.optimizationEnabled : !next.continuationEnabled || !next.atEnd)
    if (invalid || edited) {
      const visible = this.text !== '' || this.phase !== 'idle'
      this.cancel(edited ? 'draft-edited' : before?.context !== next.context ? 'context-changed' : !next.available ? 'unavailable'
        : !next.atEnd && !wasOptimizing ? 'caret-moved' : (!next.continuationEnabled && !wasOptimizing) || (!next.optimizationEnabled && wasOptimizing) ? 'disabled' : 'content-changed')
      this.text = ''; this.notes = []; this.reasoning = ''; this.streamText = ''; this.bound = undefined; this.phase = 'idle'; if (visible) this.changed()
    }
    if (availabilityChanged) this.changed()
    // Seed/mount, focus and toggles do not constitute an edit. Optimization's
    // programmatic replacement is consumed by close() before subscriptions run.
    if (scheduleEdit && edited && !invalid && !wasOptimizing && !suppress) this.edited(next.input.draftRev)
  }
  /** Only an observed edit or the end of an edited IME composition may call this. */
  edited(draftRev: number): void {
    const next = this.snapshot
    if (!this.disposed && next !== undefined && next.input.draftRev === draftRev && this.phase === 'idle'
      && this.eligible(next) && draftRev !== this.attempted) {
      this.attempted = draftRev
      const delay = Math.max(800, this.lastRequestAt + 3000 - Date.now())
      this.timer = setTimeout(() => { this.timer = undefined; void this.run('continuation', next) }, delay)
    }
  }
  private plain(input: InputState): boolean {
    return input.phase === 'plain' && input.claim === undefined && input.occurrences.length === 0 && input.queue.length === 0
  }
  private eligible(s: AssistSnapshot): boolean {
    return s.available && s.continuationEnabled && s.atEnd && this.plain(s.input) && s.input.attachmentIds.length === 0
      && s.input.draft.length <= 4000 && s.input.draft.replace(/\s/gu, '').length >= 6
  }
  interacting(reason: AssistCancellation = 'interaction'): void {
    this.cancel(reason); this.text = ''; this.notes = []; this.reasoning = ''; this.streamText = ''; this.bound = undefined; this.phase = 'idle'; this.changed()
  }
  optimize(): void {
    const s = this.snapshot
    if (s === undefined || !s.available || !s.optimizationEnabled || !this.plain(s.input)
      || s.input.draft.trim() === '' || s.input.draft.length > 8000) return
    this.cancel('optimization-started'); this.text = ''; this.notes = []; this.reasoning = ''; this.streamText = ''; this.original = s.input.draft; this.phase = 'generating'
    this.attempted = s.input.draftRev; this.changed()
    void this.run('optimization', s)
  }
  private async run(kind: DraftAssistRequest['kind'], s: AssistSnapshot): Promise<void> {
    if (this.disposed || this.snapshot?.context !== s.context || this.snapshot.input.draftRev !== s.input.draftRev) return
    const request: DraftAssistRequest = { kind, sessionId: s.sessionId, requestId: this.id(), draft: s.input.draft, draftRev: s.input.draftRev }
    const abort = new AbortController()
    const revision = this.revision
    const active = { request, abort, timeout: setTimeout(() => {
      if (this.active !== active) return
      this.cancel('timeout'); this.text = ''; this.bound = undefined
      if (kind === 'optimization') this.phase = 'error'
      this.changed()
    }, kind === 'optimization' ? OPTIMIZATION_CLIENT_TIMEOUT_MS : AUTOMATIC_ASSIST_CLIENT_TIMEOUT_MS) }
    this.active = active; this.lastRequestAt = Date.now()
    try {
      const result = await this.transport.generate(request, abort.signal, event => {
        if (kind !== 'optimization' || this.phase !== 'generating' || this.active !== active || this.disposed || abort.signal.aborted
          || revision !== this.revision || this.snapshot?.context !== s.context || this.snapshot.input.draftRev !== s.input.draftRev
          || event.requestId !== request.requestId || event.draftRev !== s.input.draftRev) return
        if (event.channel === 'reasoning') this.reasoning = (this.reasoning + event.delta).slice(0, 16_000)
        else this.streamText = (this.streamText + event.delta).slice(0, 8000)
        this.changed()
      })
      if (this.disposed || this.active !== active || abort.signal.aborted || revision !== this.revision
        || this.snapshot?.context !== s.context || this.snapshot.input.draftRev !== s.input.draftRev
        || result.requestId !== request.requestId || result.draftRev !== s.input.draftRev) return
      if (kind === 'continuation') {
        if (!this.eligible(this.snapshot)) return
        this.text = continuationText(result.text, s.input.draft)
      } else {
        if (result.error !== undefined) { this.phase = 'error'; this.streamText = ''; this.changed(); return }
        const parsed = optimizationValue({ optimized: result.text, notes: result.notes })
        this.text = parsed?.text ?? ''; this.notes = parsed?.notes ?? []
        this.phase = this.text === '' || this.text === s.input.draft ? 'empty' : 'preview'
      }
      this.bound = s; this.changed()
    } catch {
      if (this.active === active && !abort.signal.aborted && kind === 'optimization') { this.phase = 'error'; this.changed() }
    } finally { clearTimeout(active.timeout); if (this.active === active) this.active = undefined }
  }
  accept(event: KeyboardEvent, actions: Pick<InputActions, 'captureInsertion' | 'insertText'>): boolean {
    const s = this.snapshot
    if (event.key !== 'Tab' || event.repeat || event.defaultPrevented || event.isComposing || event.keyCode === 229
      || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || this.phase !== 'idle' || this.text === ''
      || s === undefined || !this.eligible(s) || this.bound?.context !== s.context || this.bound.input.draftRev !== s.input.draftRev) return false
    const span = actions.captureInsertion()
    if (span.draftRev !== s.input.draftRev || span.start !== s.input.draft.length || span.end !== span.start) return false
    const text = this.text; this.interacting()
    event.preventDefault(); event.stopPropagation(); actions.insertText(text, span); return true
  }
  replace(actions: Pick<InputActions, 'insertText'>): boolean {
    const s = this.snapshot; const bound = this.bound
    if (this.phase !== 'preview' || s === undefined || bound === undefined || !s.available || !s.optimizationEnabled
      || !this.plain(s.input) || s.context !== bound.context || s.input.draftRev !== bound.input.draftRev
      || JSON.stringify(s.input.attachmentIds) !== JSON.stringify(bound.input.attachmentIds)) return false
    const text = this.text
    // Public span-CAS whole-text insertion gives one undoable edit and retains attachments.
    this.close()
    this.suppressNextEdit = true
    return actions.insertText(text, { start: 0, end: s.input.draft.length, draftRev: s.input.draftRev })
  }
  close(): void {
    this.attempted = this.snapshot?.input.draftRev ?? -1
    this.interacting('closed')
  }
  dispose(): void { this.disposed = true; this.cancel('disposed'); this.text = ''; this.reasoning = ''; this.streamText = ''; this.phase = 'idle' }
}
