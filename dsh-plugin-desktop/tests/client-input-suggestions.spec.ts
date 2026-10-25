// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createElement, act, useSyncExternalStore } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import { Context as CordisContext } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InputState, InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { InputSuggestionState, type SuggestionSnapshot, type SuggestionTransport } from '../src/client/input-suggestions-state.ts'
import { applyInputSuggestions, createSuggestionRuntime, immediateSuggestionSettings, SuggestionComposer, SuggestionSettings, INPUT_SUGGESTIONS_INJECT } from '../src/client/input-suggestions.tsx'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import type { InputSuggestionsSettings, SuggestionResult } from '../src/input-suggestions-contract.ts'
import { createDraftAssistanceRuntime, DraftOptimizationButton } from '../src/client/input-assistance.tsx'

const EMPTY: InputState = { draft: '', draftRev: 1, attachmentIds: [], occurrences: [], phase: 'plain', queue: [] }
function snapshot(overrides: Partial<SuggestionSnapshot> = {}): SuggestionSnapshot {
  return { sessionId: 'a', context: 'a:turn1:model1', endSeq: 10, enabled: true, visible: true, idle: true, menu: false, input: EMPTY, ...overrides }
}
function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
function key(value = 'Enter') {
  return { key: value, isComposing: false, keyCode: 0, repeat: false, defaultPrevented: false,
    altKey: false, ctrlKey: false, metaKey: false, shiftKey: false, preventDefault: vi.fn(), stopPropagation: vi.fn() }
}
function harness() {
  const pending = deferred<SuggestionResult>()
  const api = { generate: vi.fn((_s: string, _r: string, _e: number, _signal: AbortSignal) => pending.promise), cancel: vi.fn() }
  let count = 0
  const state = new InputSuggestionState(api, vi.fn(), () => `r${++count}`)
  const actions = { captureInsertion: vi.fn(() => ({ start: 0, end: 0, draftRev: 1 })), insertText: vi.fn(() => true) }
  return { state, api, pending, actions,
    complete: async () => { pending.resolve({ requestId: 'r1', endSeq: 10, text: '请为这个修改补充回归测试。' }); await Promise.resolve() } }
}
beforeEach(() => vi.useFakeTimers())
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks() })

describe('suggestion state and keyboard adoption', () => {
  it.each(['Tab', 'Enter'])('%s adopts exactly once without submitting; ordinary editing and sending then resume', async value => {
    const h = harness(); h.state.update(snapshot(), true)
    expect(h.state.text).toBe('')
    await vi.advanceTimersByTimeAsync(500); await h.complete()
    expect(h.state.text).toBe('请为这个修改补充回归测试。')
    const event = key(value)
    expect(h.state.accept(event, h.actions)).toBe(true)
    expect(event.preventDefault).toHaveBeenCalledOnce()
    expect(event.stopPropagation).toHaveBeenCalledOnce()
    expect(h.actions.insertText).toHaveBeenCalledExactlyOnceWith('请为这个修改补充回归测试。', { start: 0, end: 0, draftRev: 1 })
    expect(h.state.accept(key(value), h.actions)).toBe(false)
    h.state.update(snapshot({ input: { ...EMPTY, draft: 'edited suggestion', draftRev: 2 } }))
    expect(h.state.accept(key('Enter'), h.actions)).toBe(false)
    h.state.dispose()
  })
  it.each(['Escape', 'ArrowDown', 'Tab', 'Enter'])('preserves %s without a valid suggestion', value => {
    const h = harness(); h.state.update(snapshot())
    const event = key(value)
    expect(h.state.accept(event, h.actions)).toBe(false)
    expect(event.preventDefault).not.toHaveBeenCalled()
  })
  it('leaves Esc visible and does not intercept IME, modifiers, repeats, or consumed keys', async () => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(500); await h.complete()
    for (const override of [{ key: 'Escape' }, { isComposing: true }, { keyCode: 229 }, { repeat: true }, { shiftKey: true }, { ctrlKey: true }, { defaultPrevented: true }]) {
      expect(h.state.accept({ ...key(), ...override }, h.actions)).toBe(false)
    }
    expect(h.state.accept(key(), h.actions, true)).toBe(false)
    expect(h.state.text).not.toBe('')
  })
  it.each([
    { draft: 'typed' }, { draft: ' ' }, { attachmentIds: ['file'] },
    { occurrences: [{ source: 'quote' }] }, { phase: 'claimed', claim: { name: 'help', token: '/help' } }, { queue: [{}] },
  ])('does not generate or display with nonempty input %j', async input => {
    const h = harness()
    h.state.update(snapshot({ input: { ...EMPTY, ...input } as InputState }), true)
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.api.generate).not.toHaveBeenCalled()
    expect(h.state.text).toBe('')
  })
  it('cancels within the stable window and never requests on clear, focus, or navigation alone', async () => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(400)
    h.state.update(snapshot({ input: { ...EMPTY, draft: 'x', draftRev: 2 } }))
    h.state.update(snapshot({ input: { ...EMPTY, draftRev: 3 } }))
    h.state.update(snapshot({ sessionId: 'b', context: 'b:turn1' }))
    h.state.update(snapshot({ visible: false }))
    h.state.update(snapshot())
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.api.generate).not.toHaveBeenCalled()
  })
  it('never revives an in-flight response after typing and deleting', async () => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(500)
    h.state.update(snapshot({ input: { ...EMPTY, draft: 'x', draftRev: 2 } }))
    h.state.update(snapshot({ input: { ...EMPTY, draftRev: 3 } }))
    await h.complete()
    expect(h.api.generate.mock.calls[0]?.[3].aborted).toBe(true)
    expect(h.state.text).toBe('')
    expect(h.state.accept(key(), h.actions)).toBe(false)
  })
  it('restores only a completed suggestion after clearing, without another model call', async () => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(500); await h.complete()
    h.state.update(snapshot({ input: { ...EMPTY, draft: 'x', draftRev: 2 } }))
    expect(h.state.text).toBe('')
    h.state.update(snapshot({ input: { ...EMPTY, draftRev: 3 } }))
    expect(h.state.text).not.toBe('')
    await vi.advanceTimersByTimeAsync(1000)
    expect(h.api.generate).toHaveBeenCalledOnce()
    h.state.update(snapshot({ context: 'branch-2', input: { ...EMPTY, draftRev: 3 } }))
    expect(h.state.text).toBe('')
  })
  it.each([{ enabled: false }, { idle: false }, { menu: true }, { visible: false }, { context: 'model-2' }, { sessionId: 'b', context: 'b' }])('rejects stale results after %j', async change => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(500)
    h.state.update(snapshot(change)); await h.complete()
    expect(h.state.text).toBe('')
    expect(h.api.cancel).toHaveBeenCalledWith('r1')
  })
  it('keeps command/reference menus ahead of adoption', async () => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(500); await h.complete()
    h.state.update(snapshot({ menu: true }))
    expect(h.state.accept(key(), h.actions)).toBe(false)
    h.state.update(snapshot())
    expect(h.state.text).not.toBe('')
  })
  it('rejects changed revision or selection immediately before insertion', async () => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(500); await h.complete()
    h.actions.captureInsertion.mockReturnValue({ start: 0, end: 0, draftRev: 2 })
    expect(h.state.accept(key(), h.actions)).toBe(false)
    expect(h.actions.insertText).not.toHaveBeenCalled()
  })
  it('does not let out-of-order responses or old timeout cancel a newer request', async () => {
    const h = harness(); const newer = deferred<SuggestionResult>()
    h.api.generate.mockReturnValueOnce(h.pending.promise).mockReturnValueOnce(newer.promise)
    h.state.update(snapshot(), true); await vi.advanceTimersByTimeAsync(500)
    h.state.update(snapshot({ context: 'turn2', endSeq: 20 }), true)
    await vi.advanceTimersByTimeAsync(500)
    await h.complete()
    expect(h.state.text).toBe('')
    newer.resolve({ requestId: 'r2', endSeq: 20, text: 'Add a targeted regression test.' })
    await Promise.resolve()
    expect(h.state.text).toBe('Add a targeted regression test.')
    await vi.advanceTimersByTimeAsync(2500)
    expect(h.state.text).toBe('Add a targeted regression test.')
    h.state.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it('abandons timeout and clears timers on plugin teardown', async () => {
    const h = harness(); h.state.update(snapshot(), true)
    await vi.advanceTimersByTimeAsync(3500); await h.complete()
    expect(h.state.text).toBe('')
    h.state.dispose(); expect(vi.getTimerCount()).toBe(0)
    const other = harness(); other.state.update(snapshot(), true); other.state.dispose()
    await vi.advanceTimersByTimeAsync(500)
    expect(other.api.generate).not.toHaveBeenCalled()
  })
})

function store<T>(value: T) {
  const listeners = new Set<() => void>()
  return { getSnapshot: () => value, subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: (next: T) => { value = next; [...listeners].forEach(listener => listener()) }, get size() { return listeners.size } }
}
function runtimeFixture(api: SuggestionTransport, changed = () => {}, visible = () => true) {
  const input = store(EMPTY)
  const session = store({ running: true, removed: false, openState: 'open', pendingSubmissions: [] })
  const events = store({ revision: 0, entries: [], change: { kind: 'append', entries: [] } } as { revision: number; entries?: unknown[]; change: { kind: string; entries: unknown[] } })
  const menu = store({ open: false })
  const model = store<unknown>({ next: { provider: 'p', model: 'm' } })
  const generation = store<unknown>({ id: 1 })
  const preference = store({ value: { enabled: true } })
  const remoteListeners = new Map<string, () => void>()
  const settings = { ...preference } as unknown as ConfigForm<InputSuggestionsSettings>
  const ctx = { locale: { getSnapshot: () => ({ active: 'zh' }), subscribe: () => () => {} }, get: (name: string) => ({
    sessions: { binding: () => ({ ctx: {}, session: { ...session, projections: { faceOf: () => model } }, eventSource: events }) },
    connection: { generation }, remote: { $on: (event: string, listener: () => void) => { remoteListeners.set(event, listener); return () => { remoteListeners.delete(event) } } },
  })[name], conversation: { input: { for: () => ({ state: input }) } }, inputTriggers: { sessionOf: () => ({ menu }) } } as unknown as Context
  const runtime = createSuggestionRuntime(ctx, 'a' as SessionId, settings, changed, api, visible)!
  const finish = () => {
    events.set({ revision: events.getSnapshot().revision + 1, change: { kind: 'append', entries: [
      { type: 'event', event: { type: 'turn/end', seq: 10, data: { reason: { kind: 'completed' } } } },
    ] } })
    session.set({ ...session.getSnapshot(), running: false })
  }
  return { ctx, settings, runtime, input, session, events, menu, model, generation, preference, finish, remoteListeners }
}

describe('public composer integration', () => {
  it('shows the default-enabled optimization action with automatic features off, previews and replaces through the public composer', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const f = runtimeFixture({ generate: vi.fn(), cancel: vi.fn() })
    f.session.set({ ...f.session.getSnapshot(), running: false })
    const disabled = { ...store({ value: { enabled: false } }) } as unknown as ConfigForm<InputSuggestionsSettings>
    const actions = { captureInsertion: () => ({ start: 0, end: 0, draftRev: f.input.getSnapshot().draftRev }),
      insertText: vi.fn((text: string) => { f.input.set({ ...EMPTY, draft: text, draftRev: 3 }); return true }) } as unknown as InputActions
    const fetcher = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const request = JSON.parse(String(options?.body)) as { requestId: string; draftRev: number }
      return { ok: true, json: async () => ({ requestId: request.requestId, draftRev: request.draftRev, text: '请为这个功能补充回归测试。', notes: [] }) }
    })
    vi.stubGlobal('fetch', fetcher)
    const Composer = () => createElement('div', {}, createElement(DraftOptimizationButton, {
      inputActions: actions,
      useInput: selector => useSyncExternalStore(f.input.subscribe, () => selector(f.input.getSnapshot())),
    } as Parameters<typeof DraftOptimizationButton>[0]))
    const container = document.createElement('div'); document.body.append(container); const root = createRoot(container)
    try {
      await act(async () => root.render(createElement(SuggestionComposer, { sectionComponent: Composer, suggestionContext: f.ctx,
        suggestionSettings: disabled, continuationSettings: disabled, optimizationSettings: f.settings, sessionId: 'a' as SessionId,
        inputActions: actions } as unknown as Parameters<typeof SuggestionComposer>[0])))
      const button = [...container.querySelectorAll('button')].find(item => item.textContent === '优化草稿')!
      expect(button).toBeDefined(); expect(button.disabled).toBe(true); expect(fetcher).not.toHaveBeenCalled()
      await act(async () => f.input.set({ ...EMPTY, draft: '给这个功能加测试', draftRev: 2 }))
      expect(button.disabled).toBe(false)
      await act(async () => button.click())
      expect(document.querySelector('[role="dialog"]')?.textContent).toContain('请为这个功能补充回归测试。')
      expect(actions.insertText).not.toHaveBeenCalled()
      const replace = [...document.querySelectorAll('button')].find(item => item.textContent === '替换草稿')!
      await act(async () => replace.click())
      expect(actions.insertText).toHaveBeenCalledExactlyOnceWith('请为这个功能补充回归测试。', { start: 0, end: '给这个功能加测试'.length, draftRev: 2 })
    } finally { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals() }
  })
  it('initializes draft assistance with real Cordis services and adopts a continuation through the scoped DOM capture', async () => {
    const f = runtimeFixture({ generate: vi.fn(), cancel: vi.fn() })
    f.session.set({ ...f.session.getSnapshot(), running: false })
    const container = document.createElement('div'); const editor = document.createElement('div')
    editor.setAttribute('contenteditable', 'true'); editor.tabIndex = 0; container.append(editor); document.body.append(container)
    const originalRangeBounds = Object.getOwnPropertyDescriptor(Range.prototype, 'getBoundingClientRect')
    Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(20, 20, 0, 22) })
    vi.spyOn(container, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 600, 200))
    const actions = { captureInsertion: () => ({ start: f.input.getSnapshot().draft.length, end: f.input.getSnapshot().draft.length, draftRev: f.input.getSnapshot().draftRev }),
      insertText: vi.fn(() => true) }
    const api = { generate: vi.fn(async (request: { requestId: string; draftRev: number }) => ({ requestId: request.requestId, draftRev: request.draftRev, text: ' regression tests.', notes: [] })), cancel: vi.fn() }
    const root = new CordisContext(); let stop: (() => void) | undefined; let runtime: ReturnType<typeof createDraftAssistanceRuntime>
    try {
      await root.plugin({ name: 'assist-test-services', apply(scope: Context) {
        scope.provide('conversation', f.ctx.conversation); scope.provide('inputTriggers', f.ctx.inputTriggers)
        for (const name of ['sessions', 'connection', 'remote']) scope.provide(name, f.ctx.get(name) as never)
      } })
      await root.plugin({ name: 'assist-test-consumer', inject: [...INPUT_SUGGESTIONS_INJECT, 'inputTriggers'], apply(scope: Context) {
        runtime = createDraftAssistanceRuntime(scope, 'a' as SessionId, actions as unknown as InputActions,
          { current: container }, () => false, f.settings, f.settings, () => {}, api)
        stop = runtime?.start()
      } })
      editor.focus(); editor.textContent = 'Please help me with'
      document.getSelection()!.collapse(editor.firstChild, editor.textContent.length)
      f.input.set({ ...EMPTY, draft: editor.textContent, draftRev: 2 })
      await vi.advanceTimersByTimeAsync(800)
      expect(api.generate).toHaveBeenCalledOnce(); expect(runtime!.state.text).toBe(' regression tests.')
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect() })
      const invisible = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      editor.dispatchEvent(invisible); expect(invisible.defaultPrevented).toBe(false); expect(actions.insertText).not.toHaveBeenCalled()
      Object.defineProperty(Range.prototype, 'getBoundingClientRect', { configurable: true, value: () => new DOMRect(20, 20, 0, 22) })
      const event = new KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true })
      editor.dispatchEvent(event)
      expect(event.defaultPrevented).toBe(true); expect(actions.insertText).toHaveBeenCalledOnce()
      editor.dispatchEvent(new CompositionEvent('compositionstart', { bubbles: true }))
      editor.textContent = '请帮助我为这个功能编写'
      document.getSelection()!.collapse(editor.firstChild, editor.textContent.length)
      f.input.set({ ...EMPTY, draft: editor.textContent, draftRev: 3 })
      editor.dispatchEvent(new CompositionEvent('compositionend', { bubbles: true }))
      await vi.advanceTimersByTimeAsync(9); expect(api.generate).toHaveBeenCalledOnce()
      await vi.advanceTimersByTimeAsync(3001)
      expect(api.generate).toHaveBeenCalledTimes(2)
      expect(runtime!.state.text).toBe(' regression tests.')
    } finally {
      stop?.(); await root.fiber.dispose(); container.remove(); document.getSelection()?.removeAllRanges()
      if (originalRangeBounds) Object.defineProperty(Range.prototype, 'getBoundingClientRect', originalRangeBounds)
      else Reflect.deleteProperty(Range.prototype, 'getBoundingClientRect')
    }
    expect(f.input.size).toBe(0); expect(f.remoteListeners.size).toBe(0)
  })
  it.each(['mount', 'enable', 'history-replace'] as const)('suggests from an existing completed conversation on %s without a new reply', async trigger => {
    const api = { generate: vi.fn(async (_s: string, requestId: string, endSeq: number) => ({ text: 'Add regression coverage.', requestId, endSeq })), cancel: vi.fn() }
    const f = runtimeFixture(api)
    f.session.set({ ...f.session.getSnapshot(), running: false })
    const entries = [{ type: 'event', event: { type: 'turn/end', seq: 15, data: { reason: { kind: 'completed' } } } }]
    if (trigger !== 'history-replace') f.events.set({ ...f.events.getSnapshot(), entries })
    if (trigger === 'enable') f.preference.set({ value: { enabled: false } })
    const stop = f.runtime.start()
    if (trigger === 'enable') { await vi.advanceTimersByTimeAsync(600); expect(api.generate).not.toHaveBeenCalled(); f.preference.set({ value: { enabled: true } }) }
    if (trigger === 'history-replace') f.events.set({ revision: 1, entries, change: { kind: 'replace', entries: [] } })
    await vi.advanceTimersByTimeAsync(500)
    expect(api.generate).toHaveBeenCalledOnce(); expect(f.runtime.state.text).toBe('Add regression coverage.')
    f.runtime.sync(); await vi.advanceTimersByTimeAsync(1000); expect(api.generate).toHaveBeenCalledOnce()
    stop()
  })
  it('initializes and generates inside a real Cordis plugin with declared services', async () => {
    const api = { generate: vi.fn(async (_s: string, requestId: string, endSeq: number) => ({ text: '补充一项回归测试。', requestId, endSeq })), cancel: vi.fn(), report: vi.fn() }
    const f = runtimeFixture(api)
    const root = new CordisContext()
    let runtime: ReturnType<typeof createSuggestionRuntime>
    let stop: (() => void) | undefined
    try {
      await root.plugin({ name: 'suggestion-test-services', apply(scope: Context) {
        scope.provide('conversation', f.ctx.conversation)
        scope.provide('inputTriggers', f.ctx.inputTriggers)
        for (const name of ['sessions', 'connection', 'remote']) scope.provide(name, f.ctx.get(name) as never)
      } })
      await root.plugin({ name: 'suggestion-test-consumer', inject: [...INPUT_SUGGESTIONS_INJECT, 'inputTriggers'], apply(scope: Context) {
        runtime = createSuggestionRuntime(scope, 'a' as SessionId, f.settings, () => {}, api)
        stop = runtime?.start()
      } })
      expect(runtime!).toBeDefined()
      f.finish()
      await vi.advanceTimersByTimeAsync(500)
      expect(api.generate).toHaveBeenCalledOnce()
      expect(runtime!.state.text).toBe('补充一项回归测试。')
      expect(api.report).toHaveBeenCalledWith('shown', 10)
    } finally { stop?.(); await root.fiber.dispose() }
  })
  it('uses the shared General Settings Switch, reflects a toggle immediately and locks it while saving', async () => {
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const pending = deferred<boolean>()
    const source = store({ value: { enabled: false }, writable: true } as ConfigFormSnapshot<InputSuggestionsSettings>)
    const set = vi.fn(() => pending.promise)
    const settings = immediateSuggestionSettings({ ...source, set } as unknown as ConfigForm<InputSuggestionsSettings>)
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    try {
      await act(async () => { root.render(createElement(SuggestionSettings, { settings, t: key => key === 'title' ? 'AI 输入建议' : 'Description' })) })
      const toggle = container.querySelector<HTMLButtonElement>('button[role="switch"]')!
      expect(toggle).not.toBeNull()
      expect(toggle.getAttribute('aria-label')).toBe('AI 输入建议')
      expect(toggle.getAttribute('aria-checked')).toBe('false')
      expect(toggle.querySelector('span')).not.toBeNull()
      expect(container.querySelector('input[type="checkbox"]')).toBeNull()
      await act(async () => { toggle.click() })
      expect(set).toHaveBeenCalledExactlyOnceWith('enabled', true)
      expect(toggle.getAttribute('aria-checked')).toBe('true')
      expect(toggle.disabled).toBe(true)
      await act(async () => {
        source.set({ ...source.getSnapshot(), value: { enabled: true } })
        pending.resolve(true)
      })
      expect(toggle.disabled).toBe(false)
      expect(toggle.getAttribute('aria-checked')).toBe('true')
    } finally {
      await act(async () => root.unmount())
      container.remove()
    }
  })
  it('consumes the completion opportunity if an attachment arrives before Agent idle, even when removed immediately', async () => {
    const api = { generate: vi.fn(), cancel: vi.fn() }
    const f = runtimeFixture(api); const stop = f.runtime.start()
    f.events.set({ revision: 1, change: { kind: 'append', entries: [
      { type: 'event', event: { type: 'turn/end', seq: 10, data: { reason: { kind: 'completed' } } } },
    ] } })
    f.input.set({ ...EMPTY, attachmentIds: ['file' as InputState['attachmentIds'][number]] })
    f.input.set(EMPTY)
    f.session.set({ ...f.session.getSnapshot(), running: false })
    await vi.advanceTimersByTimeAsync(500)
    expect(api.generate).not.toHaveBeenCalled()
    stop()
  })
  it('keeps composition and the closing candidate key ahead of suggestion adoption', async () => {
    const api = { generate: vi.fn(async (_s: string, requestId: string, endSeq: number) => ({ text: '请补充回归测试。', requestId, endSeq })), cancel: vi.fn() }
    const f = runtimeFixture(api); const stop = f.runtime.start()
    f.finish(); await vi.advanceTimersByTimeAsync(500)
    const actions = harness().actions as unknown as InputActions
    expect(f.runtime.state.text).not.toBe('')
    f.runtime.composition(true)
    expect(f.runtime.state.text).toBe('')
    expect(f.runtime.accept(key(), actions)).toBe(false)
    f.runtime.composition(false)
    expect(f.runtime.accept(key(), actions)).toBe(false)
    await vi.advanceTimersByTimeAsync(10)
    expect(f.runtime.state.text).not.toBe('')
    expect(f.runtime.accept({ ...key(), keyCode: 229 }, actions)).toBe(false)
    expect(api.generate).toHaveBeenCalledOnce()
    stop(); expect(vi.getTimerCount()).toBe(0)
  })
  it('rechecks actual visibility at dispatch and response boundaries', async () => {
    let visible = true
    const pending = deferred<SuggestionResult>()
    const api = { generate: vi.fn(() => pending.promise), cancel: vi.fn() }
    const f = runtimeFixture(api, () => {}, () => visible); const stop = f.runtime.start()
    f.finish(); visible = false
    await vi.advanceTimersByTimeAsync(500)
    expect(api.generate).not.toHaveBeenCalled()
    stop()
    visible = true
    const other = runtimeFixture(api, () => {}, () => visible); const stopOther = other.runtime.start()
    other.finish(); await vi.advanceTimersByTimeAsync(500)
    visible = false
    pending.resolve({ requestId: 'ignored', endSeq: 10, text: 'Do not display this.' })
    await Promise.resolve(); await Promise.resolve()
    expect(other.runtime.state.text).toBe('')
    expect(api.cancel).toHaveBeenCalled()
    stopOther()
  })
  it('waits for idle after a live completed turn; mount/focus alone never generates; subscriptions release', async () => {
    const api = { generate: vi.fn(async () => ({ text: 'Add regression coverage.', requestId: 'unused', endSeq: 10 })), cancel: vi.fn() }
    const f = runtimeFixture(api); const stop = f.runtime.start()
    await vi.advanceTimersByTimeAsync(600)
    expect(api.generate).not.toHaveBeenCalled()
    f.finish(); await vi.advanceTimersByTimeAsync(500)
    expect(api.generate).toHaveBeenCalledOnce()
    stop()
    for (const source of [f.input, f.session, f.events, f.menu, f.model, f.generation, f.preference]) expect(source.size).toBe(0)
    expect(f.remoteListeners.size).toBe(0)
  })
  it.each(['llm/adapters-updated', 'credentials/reference-updated', 'generation'])('invalidates already displayed text on %s', async event => {
    const api = { generate: vi.fn(async (_s: string, requestId: string, endSeq: number) => ({ text: 'Add regression coverage.', requestId, endSeq })), cancel: vi.fn() }
    const f = runtimeFixture(api); const stop = f.runtime.start()
    f.finish(); await vi.advanceTimersByTimeAsync(500)
    expect(f.runtime.state.text).not.toBe('')
    if (event === 'generation') f.generation.set({ id: 2 })
    else f.remoteListeners.get(event)!()
    expect(f.runtime.state.text).toBe('')
    stop()
  })
  it('switches off immediately while the Profile write is pending', async () => {
    const pending = deferred<boolean>()
    const source = store({ value: { enabled: true } } as ConfigFormSnapshot<InputSuggestionsSettings>)
    const form = immediateSuggestionSettings({ ...source, set: () => pending.promise } as unknown as ConfigForm<InputSuggestionsSettings>)
    const changed = vi.fn(); const stop = form.subscribe(changed)
    const write = form.set('enabled', false)
    expect(form.getSnapshot().value?.enabled).toBe(false)
    expect(changed).toHaveBeenCalledOnce()
    source.set({ ...source.getSnapshot(), value: { enabled: false } })
    pending.resolve(true); await write
    expect(form.getSnapshot().value?.enabled).toBe(false)
    stop(); expect(source.size).toBe(0)
  })
  it.each(['Tab', 'Enter'])('React capture %s adoption prevents the resident editor from also sending, then restores its keys', async adoptionKey => {
    vi.useRealTimers()
    const generate = vi.fn(async (_url: unknown, options?: RequestInit) => {
      const body = JSON.parse(String(options?.body)) as { requestId: string; endSeq: number }
      return { ok: true, json: async () => ({ text: 'Add regression coverage.', requestId: body.requestId, endSeq: body.endSeq }) }
    })
    vi.stubGlobal('fetch', generate)
    ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
    const f = runtimeFixture({ generate: vi.fn(), cancel: vi.fn() })
    const insert = vi.fn((_text: string) => { f.input.set({ ...EMPTY, draft: _text, draftRev: 2 }); return true })
    const send = vi.fn()
    const actions = { captureInsertion: () => ({ start: 0, end: 0, draftRev: f.input.getSnapshot().draftRev }), insertText: insert } as unknown as InputActions
    const container = document.createElement('div'); document.body.append(container)
    let root: Root | undefined
    const Composer = (props: Record<string, unknown>) => createElement('div', {},
      createElement('span', { 'data-placeholder': true }, props.placeholder as string),
      createElement('div', { contentEditable: true, onKeyDown: (event: { key: string }) => { if (event.key === 'Enter') send() } }))
    try {
      await act(async () => {
        root = createRoot(container)
        root.render(createElement(SuggestionComposer, { sectionComponent: Composer, suggestionContext: f.ctx, suggestionSettings: f.settings,
          sessionId: 'a' as SessionId, inputActions: actions, placeholder: 'Original placeholder' } as unknown as Parameters<typeof SuggestionComposer>[0]))
      })
      await act(async () => { f.finish(); await new Promise(resolve => setTimeout(resolve, 550)) })
      expect(container.querySelector('[data-placeholder]')?.textContent).toBe('Add regression coverage.')
      const editor = container.querySelector('[contenteditable]')!
      await act(async () => { editor.dispatchEvent(new KeyboardEvent('keydown', { key: adoptionKey, bubbles: true, cancelable: true })) })
      expect(insert).toHaveBeenCalledOnce(); expect(send).not.toHaveBeenCalled()
      expect(container.querySelector('[data-placeholder]')?.textContent).toBe('Original placeholder')
      await act(async () => { editor.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true, cancelable: true })) })
      expect(send).toHaveBeenCalledOnce()
    } finally {
      await act(async () => root?.unmount()); container.remove(); vi.unstubAllGlobals()
    }
  })
  it('composes through the public slot and preserves upstream child extensions, injection and disposal ownership', async () => {
    const core = new SlotCore()
    const disposers: Array<() => void> = []
    const register = (options: Record<string, unknown>, component: unknown = () => null) => core.register(options as never, component as never)
    register({ name: 'root', children: {
      'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
      'settings.general.item': { kind: 'list', scope: 'root' },
    } })
    const Composer = () => null
    const retire = register({ name: 'conversation.composer.bar', locale: 'conversation', inject: () => ({ existing: 'untouched' }),
      children: { 'conversation.input.overlay': { kind: 'list', scope: 'session' }, 'conversation.input.left': { kind: 'list', scope: 'session' } } }, Composer)
    register({ name: 'conversation.input.overlay', id: 'selection-quote' })
    const settings = store({ value: { enabled: false } })
    const ctx = {
      slots: {
        register,
        entries: (name: string) => core.entries(name),
        subscribe: (name: string, listener: () => void) => core.subscribe(name, listener),
        inject: (_name: string, install: () => (() => void) | Iterable<() => void>) => {
          const value = install()
          const stops = typeof value === 'function' ? [value] : [...value]
          const cleanup = () => { stops.reverse().forEach(stop => stop()) }
          disposers.push(cleanup)
          return cleanup
        },
      },
      effect: (mount: () => (() => void) | void) => { const stop = mount(); if (stop) disposers.push(stop) },
      configForms: { get: () => settings }, locale: { register: () => () => {} },
    } as unknown as Context
    applyInputSuggestions(ctx)
    await Promise.resolve()
    expect(core.entriesOfSlot('conversation.composer.bar')[0]?.component).toBe(Composer)
    settings.set({ value: { enabled: true } })
    await Promise.resolve()
    const projected = core.entriesOfSlot('conversation.composer.bar')[0]!
    expect(projected.component).toBe(SuggestionComposer)
    expect(projected.locale).toBe('conversation')
    expect(projected.inject?.()).toMatchObject({ sectionComponent: Composer, existing: 'untouched' })
    expect(core.entriesOfSlot('conversation.input.overlay')).toHaveLength(1)
    disposers.reverse().forEach(stop => stop())
    expect(core.entriesOfSlot('conversation.composer.bar')[0]?.component).toBe(Composer)
    expect(core.entriesOfSlot('conversation.input.overlay')).toHaveLength(1)
    retire()
    expect(core.entriesOfSlot('conversation.input.overlay')).toHaveLength(0)
  })
})
