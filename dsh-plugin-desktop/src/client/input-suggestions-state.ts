import type { InputActions, InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { suggestionText, type SuggestionResult, type SuggestionClientDiagnostic } from '../input-suggestions-contract.ts'

export interface SuggestionSnapshot {
  sessionId: string
  context: string
  endSeq: number
  enabled: boolean
  visible: boolean
  idle: boolean
  menu: boolean
  input: InputState
}
export function emptySuggestionInput(input: InputState): boolean {
  return input.draft === '' && input.attachmentIds.length === 0 && input.occurrences.length === 0
    && input.phase === 'plain' && input.claim === undefined && input.queue.length === 0
}
function available(s: SuggestionSnapshot): boolean {
  return s.enabled && s.visible && s.idle && !s.menu && emptySuggestionInput(s.input)
}
export interface SuggestionTransport {
  generate(sessionId: string, requestId: string, endSeq: number, signal: AbortSignal): Promise<SuggestionResult>
  cancel(requestId: string): void
  report?(event: SuggestionClientDiagnostic, endSeq: number): void
}

/** One mounted composer lifetime. Invalidated in-flight work can never become valid again. */
export class InputSuggestionState {
  private snapshot: SuggestionSnapshot | undefined
  private completed: { context: string; text: string } | undefined
  private attempted = new Set<string>()
  private active: { id: string; abort: AbortController; timeout?: ReturnType<typeof setTimeout> } | undefined
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private revision = 0
  private shown = ''
  constructor(private readonly transport: SuggestionTransport, private readonly changed: () => void,
    private readonly id: () => string = () => crypto.randomUUID()) {}
  get text(): string { return this.shown }
  update(next: SuggestionSnapshot, completedTurn = false): void {
    if (this.disposed) return
    const previous = this.snapshot
    this.snapshot = next
    const different = previous?.context !== next.context || previous.sessionId !== next.sessionId
    if (different || !next.enabled || !next.idle) this.completed = undefined
    // Draft revision also catches type-and-delete inside a single React render.
    if (different || !available(next) || previous?.input.draftRev !== next.input.draftRev) this.cancel()
    this.publish()
    if (completedTurn && available(next) && !this.attempted.has(next.context)) {
      // Reserve immediately: editing during the stable window consumes this opportunity too.
      this.attempted.add(next.context)
      if (this.attempted.size > 128) this.attempted.delete(this.attempted.values().next().value!)
      this.timer = setTimeout(() => { this.timer = undefined; void this.request(next) }, 500)
    }
  }
  private publish(): void {
    const next = this.snapshot !== undefined && available(this.snapshot)
      && this.completed?.context === this.snapshot.context ? this.completed.text : ''
    if (next !== this.shown) { this.shown = next; this.changed() }
  }
  private cancel(): void {
    this.revision++
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const active = this.active
    this.active = undefined
    if (active !== undefined) { clearTimeout(active.timeout); active.abort.abort(); this.transport.cancel(active.id) }
  }
  /** Called synchronously on composition/beforeinput/paste/drop, before editor reconciliation. */
  interacting(): void { this.cancel(); this.shown = ''; this.changed() }
  private async request(snapshot: SuggestionSnapshot): Promise<void> {
    if (this.disposed || this.snapshot?.context !== snapshot.context || !available(this.snapshot)) return
    const active: NonNullable<InputSuggestionState['active']> = { id: this.id(), abort: new AbortController() }
    this.active = active
    const revision = this.revision
    const timeout = setTimeout(() => { if (this.active === active) this.cancel() }, 3000)
    active.timeout = timeout
    try {
      const result = await this.transport.generate(snapshot.sessionId, active.id, snapshot.endSeq, active.abort.signal)
      if (this.disposed || this.active !== active || this.revision !== revision || active.abort.signal.aborted
        || this.snapshot?.context !== snapshot.context || !available(this.snapshot)
        || result.requestId !== active.id || result.endSeq !== snapshot.endSeq) return
      const text = suggestionText(result.text)
      if (text !== '') this.completed = { context: snapshot.context, text }
      this.publish()
    } catch { /* Opportunistic: no notice, retry, or loading state. */ }
    finally { clearTimeout(timeout); if (this.active === active) this.active = undefined }
  }
  accept(event: { key: string; isComposing: boolean; keyCode: number; repeat: boolean; defaultPrevented: boolean;
    altKey: boolean; ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; preventDefault(): void; stopPropagation(): void },
    actions: Pick<InputActions, 'captureInsertion' | 'insertText'>, composing = false): boolean {
    const snapshot = this.snapshot
    if ((event.key !== 'Tab' && event.key !== 'Enter') || event.isComposing || event.keyCode === 229
      || composing || event.repeat || event.defaultPrevented || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey
      || snapshot === undefined || !available(snapshot) || this.completed?.context !== snapshot.context || this.shown === '') return false
    const span = actions.captureInsertion()
    if (span.draftRev !== snapshot.input.draftRev || span.start !== 0 || span.end !== 0) return false
    const text = this.shown
    // Consume before mutation: a synchronous store publication cannot insert twice or submit.
    this.completed = undefined
    this.cancel()
    this.publish()
    event.preventDefault()
    event.stopPropagation()
    actions.insertText(text, span)
    return true
  }
  dispose(): void { this.disposed = true; this.cancel(); this.completed = undefined; this.shown = '' }
}
