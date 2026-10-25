// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DraftAssistanceState, type AssistSnapshot } from '../src/client/input-assistance-state.ts'
import { OPTIMIZATION_CLIENT_TIMEOUT_MS, type DraftAssistRequest, type DraftAssistResult, type DraftAssistProgress } from '../src/input-assistance-contract.ts'

const initial: AssistSnapshot = { sessionId: 'a', context: 'model:context', available: true, atEnd: true,
  continuationEnabled: true, optimizationEnabled: true,
  input: { draft: 'Please help me', draftRev: 1, attachmentIds: [], occurrences: [], phase: 'plain', queue: [] } }
function harness() {
  let resolve!: (value: DraftAssistResult) => void
  const pending = new Promise<DraftAssistResult>(done => { resolve = done })
  const api = { generate: vi.fn((_request: DraftAssistRequest, _signal: AbortSignal) => pending), cancel: vi.fn() }
  const state = new DraftAssistanceState(api, vi.fn(), () => 'r1')
  let current = initial
  state.update(current)
  const update = (changes: Partial<AssistSnapshot>) => { current = { ...current, ...changes }; state.update(current) }
  const edit = (draft = 'Please help me with') => update({ input: { ...current.input, draft, draftRev: current.input.draftRev + 1 } })
  return { state, api, update, edit, resolve, current: () => current,
    finish: async (text = ' regression tests.') => { resolve({ requestId: 'r1', draftRev: current.input.draftRev, text, notes: [] }); await Promise.resolve(); await Promise.resolve() } }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => vi.useRealTimers())
describe('continuation and optimization lifecycle', () => {
  it('requires a genuine edit and stable pause; focus/mount/toggle alone never calls', async () => {
    const h = harness(); h.update({ atEnd: false }); h.update({ atEnd: true }); await vi.advanceTimersByTimeAsync(1000)
    expect(h.api.generate).not.toHaveBeenCalled()
    h.edit(); await vi.advanceTimersByTimeAsync(799); expect(h.api.generate).not.toHaveBeenCalled()
    await vi.advanceTimersByTimeAsync(1); expect(h.api.generate).toHaveBeenCalledOnce(); h.state.dispose()
  })
  it.each(['edit', 'blur', 'menu', 'model', 'disable', 'optimization', 'dispose'] as const)('rejects late continuation after %s', async cause => {
    const h = harness(); h.edit(); await vi.advanceTimersByTimeAsync(800)
    if (cause === 'edit') h.edit()
    if (cause === 'blur') h.update({ atEnd: false })
    if (cause === 'menu') h.update({ available: false })
    if (cause === 'model') h.update({ context: 'new-model' })
    if (cause === 'disable') h.update({ continuationEnabled: false })
    if (cause === 'optimization') h.state.optimize()
    if (cause === 'dispose') h.state.dispose()
    await h.finish(); expect(h.state.phase === 'idle' ? h.state.text : '').toBe(''); h.state.dispose()
  })
  it('Tab adopts a single append; Enter and composing/modifier keys pass through', async () => {
    const h = harness(); h.edit(); await vi.advanceTimersByTimeAsync(800); await h.finish()
    const length = h.current().input.draft.length
    const actions = { captureInsertion: () => ({ start: length, end: length, draftRev: 2 }), insertText: vi.fn(() => true) }
    for (const init of [{ key: 'Enter' }, { key: 'Tab', isComposing: true }, { key: 'Tab', ctrlKey: true }]) {
      expect(h.state.accept(new KeyboardEvent('keydown', init), actions)).toBe(false)
    }
    const event = new KeyboardEvent('keydown', { key: 'Tab', cancelable: true })
    expect(h.state.accept(event, actions)).toBe(true); expect(event.defaultPrevented).toBe(true)
    expect(actions.insertText).toHaveBeenCalledExactlyOnceWith(' regression tests.', { start: length, end: length, draftRev: 2 })
    expect(h.state.accept(event, actions)).toBe(false); h.state.dispose()
  })
  it('optimization preserves the draft until explicit replace and uses a whole-text revision CAS', async () => {
    const h = harness(); const insertText = vi.fn(() => true)
    h.state.optimize(); expect(h.state.phase).toBe('generating')
    await h.finish('Please add regression tests.'); expect(h.state.phase).toBe('preview')
    expect(h.current().input.draft).toBe(initial.input.draft); expect(insertText).not.toHaveBeenCalled()
    expect(h.state.replace({ insertText })).toBe(true)
    expect(insertText).toHaveBeenCalledExactlyOnceWith('Please add regression tests.', { start: 0, end: initial.input.draft.length, draftRev: 1 })
    h.edit('Please add regression tests.'); await vi.advanceTimersByTimeAsync(4000)
    expect(h.api.generate).toHaveBeenCalledOnce(); h.state.dispose()
  })
  it.each(['edit', 'model', 'attachments', 'command', 'menu'] as const)('invalidates optimization preview on %s and never replaces it', async cause => {
    const h = harness(); h.state.optimize(); await h.finish('Improved draft.')
    if (cause === 'edit') h.edit()
    if (cause === 'model') h.update({ context: 'new-model' })
    if (cause === 'attachments') h.update({ input: { ...h.current().input, attachmentIds: ['new'] as never } })
    if (cause === 'command') h.update({ input: { ...h.current().input, phase: 'claimed' } })
    if (cause === 'menu') h.update({ available: false })
    const insertText = vi.fn(() => true)
    expect(h.state.replace({ insertText })).toBe(false); expect(insertText).not.toHaveBeenCalled(); h.state.dispose()
  })
  it('cancels optimization on close and never resumes continuation without an edit', async () => {
    const h = harness(); h.state.optimize(); h.state.close(); await h.finish('Late result.')
    expect(h.state.phase).toBe('idle'); expect(h.state.text).toBe('')
    h.update({ atEnd: true }); await vi.advanceTimersByTimeAsync(4000); expect(h.api.generate).toHaveBeenCalledOnce(); h.state.dispose()
  })
  it('handles a client timeout without leaving a late preview or timers', async () => {
    const h = harness(); h.state.optimize(); await vi.advanceTimersByTimeAsync(OPTIMIZATION_CLIENT_TIMEOUT_MS)
    expect(h.state.phase).toBe('error'); await h.finish('Late result.'); expect(h.state.text).toBe('')
    h.state.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it('keeps streamed output separate from adoptable text and rejects late progress after closing', async () => {
    let publish!: (event: DraftAssistProgress) => void
    let finish!: (value: DraftAssistResult) => void
    const state = new DraftAssistanceState({ generate: (_request, _signal, progress) => {
      publish = progress!; return new Promise(resolve => { finish = resolve })
    }, cancel: vi.fn() }, vi.fn(), () => 'stream')
    state.update(initial); state.optimize()
    publish({ requestId: 'stream', draftRev: 1, channel: 'reasoning', delta: '整理结构。' })
    publish({ requestId: 'stream', draftRev: 1, channel: 'text', delta: 'Improved' })
    expect(state.reasoning).toBe('整理结构。'); expect(state.streamText).toBe('Improved')
    expect(state.text).toBe(''); expect(state.phase).toBe('generating')
    const insertText = vi.fn(() => true)
    expect(state.replace({ insertText })).toBe(false); expect(insertText).not.toHaveBeenCalled()
    state.close()
    publish({ requestId: 'stream', draftRev: 1, channel: 'text', delta: 'late' })
    finish({ requestId: 'stream', draftRev: 1, text: 'Improved draft.', notes: [] })
    await vi.advanceTimersByTimeAsync(0)
    expect(state.streamText).toBe(''); expect(state.reasoning).toBe(''); expect(state.phase).toBe('idle')
    state.dispose()
  })
})
