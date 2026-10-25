import { afterEach, describe, expect, it, vi } from 'vitest'
import type { SessionEvent } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { GenerateOptions, StreamChunk, ConfigureCall, ReasoningEffortId } from '@deepseek-ai/dsh-llm'
import { apply, generateInputSuggestion, inputSuggestionCallControls, HostInputSuggestions, InputSuggestionsSchema, suggestionContext, type HostSuggestionSnapshot } from '../src/input-suggestions.ts'
import { registerDesktopJsonApi } from '../src/desktop-json-api.ts'
import { suggestionText } from '../src/input-suggestions-contract.ts'
import { AUTOMATIC_ASSIST_TIMEOUT_MS } from '../src/input-assistance-contract.ts'
vi.mock('../src/desktop-json-api.ts', () => ({ registerDesktopJsonApi: vi.fn() }))

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(done => { resolve = done })
  return { promise, resolve }
}
const request = { sessionId: 'a', requestId: 'request-a', endSeq: 9 }
const snapshot: HostSuggestionSnapshot = { identity: 'generation-model-context', endSeq: 9, context: '[]', route: { provider: 'configured', model: 'configured-model' } }
function host() {
  let enabled = true
  let valid = true
  const pending = deferred<string>()
  const generate = vi.fn((_snapshot: HostSuggestionSnapshot, _signal: AbortSignal) => pending.promise)
  const deps = { enabled: () => enabled, snapshot: vi.fn(async () => snapshot), current: () => valid, generate }
  const controller = new HostInputSuggestions(deps)
  return { controller, pending, generate, deps, disable: () => { enabled = false }, invalidate: () => { valid = false } }
}
afterEach(() => vi.useRealTimers())

describe('Host input suggestions', () => {
  it('restores a still-valid completed suggestion across composer remounts without another model call', async () => {
    const h = host(); const first = h.controller.request(request)
    await Promise.resolve(); h.pending.resolve('请补充回归测试。')
    expect((await first).text).toBe('请补充回归测试。')
    expect(await h.controller.request({ ...request, requestId: 'remounted' })).toEqual({ requestId: 'remounted', endSeq: request.endSeq, text: '请补充回归测试。' })
    expect(h.generate).toHaveBeenCalledOnce()
    h.invalidate()
    expect((await h.controller.request({ ...request, requestId: 'changed-context' })).text).toBe('')
    h.controller.dispose()
  })
  it('keeps a slow configured model alive beyond the former three-second cutoff', async () => {
    vi.useFakeTimers(); const h = host(); const result = h.controller.request(request)
    await vi.advanceTimersByTimeAsync(5000)
    expect(h.generate.mock.calls[0]?.[1].aborted).toBe(false)
    h.pending.resolve('请补充回归测试。')
    expect((await result).text).toBe('请补充回归测试。'); h.controller.dispose()
  })
  it('accepts only fixed diagnostic codes and never logs client-supplied text', async () => {
    const info = vi.fn()
    const ctx = { settings: { register: () => ({ get: () => ({ enabled: true }), watch: () => () => {} }) },
      on: () => {}, effect: (mount: () => unknown) => mount(), logger: { info } } as unknown as Context
    apply(ctx)
    const options = vi.mocked(registerDesktopJsonApi).mock.calls.at(-1)![1]
    await expect(options.action({ diagnostic: 'SENSITIVE_BODY', endSeq: 43 })).rejects.toThrow('Invalid suggestion diagnostic')
    await expect(options.action({ diagnostic: 'completion-eligible', endSeq: 43, text: 'SENSITIVE_BODY' })).resolves.toEqual({ recorded: true })
    expect(info).toHaveBeenCalledExactlyOnceWith('input-suggestions: client-completion-eligible endSeq=43')
  })
  it.each(['empty', 'failed', 'timeout'] as const)('records a distinct %s outcome without transcript or error contents', async outcome => {
    vi.useFakeTimers()
    const h = host()
    const trace = vi.fn()
    const controller = new HostInputSuggestions({ ...h.deps, trace })
    if (outcome === 'failed') h.generate.mockRejectedValueOnce(new Error('SENSITIVE_PROVIDER_ERROR'))
    const result = controller.request(request)
    await Promise.resolve()
    if (outcome === 'empty') h.pending.resolve('')
    if (outcome === 'timeout') await vi.advanceTimersByTimeAsync(AUTOMATIC_ASSIST_TIMEOUT_MS)
    expect((await result).text).toBe('')
    expect(trace.mock.calls.map(call => call[0])).toEqual(['request', 'model-start', outcome === 'empty' ? 'empty-or-invalid-result' : outcome])
    expect(JSON.stringify(trace.mock.calls)).not.toContain('SENSITIVE_PROVIDER_ERROR')
    controller.dispose(); h.pending.resolve('')
  })
  it('defaults off and never calls a model when disabled', async () => {
    expect(InputSuggestionsSchema({} as { enabled: boolean })).toEqual({ enabled: false })
    const h = host(); h.disable()
    expect((await h.controller.request(request)).text).toBe('')
    expect(h.generate).not.toHaveBeenCalled()
  })
  it('makes one call per completed context, with no retry after an empty result', async () => {
    const h = host()
    const result = h.controller.request(request)
    await Promise.resolve(); h.pending.resolve('')
    expect((await result).text).toBe('')
    await h.controller.request({ ...request, requestId: 'second' })
    expect(h.generate).toHaveBeenCalledTimes(1)
  })
  it('does not dispatch if disabled while the context read is settling', async () => {
    const h = host()
    const read = deferred<HostSuggestionSnapshot>()
    h.deps.snapshot.mockReturnValueOnce(read.promise)
    const result = h.controller.request(request)
    h.disable(); read.resolve(snapshot)
    expect((await result).text).toBe('')
    expect(h.generate).not.toHaveBeenCalled()
  })
  it.each(['cancel', 'disable', 'context', 'dispose'] as const)('rejects a late response after %s', async action => {
    const h = host()
    const result = h.controller.request(request)
    await Promise.resolve()
    if (action === 'cancel') h.controller.cancel(request.requestId)
    if (action === 'disable') { h.disable(); h.controller.cancel() }
    if (action === 'context') h.invalidate()
    if (action === 'dispose') h.controller.dispose()
    h.pending.resolve('请为这些边界条件补充测试。')
    expect((await result).text).toBe('')
    expect(h.generate.mock.calls[0]?.[1].aborted).toBe(action !== 'context')
  })
  it('bounds wall time and physical concurrency even when cancellation is ignored', async () => {
    vi.useFakeTimers()
    const h = host()
    const result = h.controller.request(request)
    await vi.advanceTimersByTimeAsync(AUTOMATIC_ASSIST_TIMEOUT_MS)
    expect((await result).text).toBe('')
    expect(h.generate.mock.calls[0]?.[1].aborted).toBe(true)
    await h.controller.request({ sessionId: 'b', requestId: 'b', endSeq: 20 })
    expect(h.generate).toHaveBeenCalledTimes(1)
    h.pending.resolve('Never show this late answer.')
    await Promise.resolve(); await Promise.resolve()
    expect(vi.getTimerCount()).toBe(0)
  })
  it('handles cancellation arriving ahead of the generate HTTP request', async () => {
    const h = host(); h.controller.cancel(request.requestId)
    expect((await h.controller.request(request)).text).toBe('')
    expect(h.generate).not.toHaveBeenCalled()
  })
  it('does not let another session disposal cancel the current request', async () => {
    const h = host(); const result = h.controller.request(request)
    await Promise.resolve(); h.controller.forget('other')
    h.pending.resolve('Add a regression test for this fix.')
    expect((await result).text).toBe('Add a regression test for this fix.')
  })
  it('fails silently without retries when the model fails', async () => {
    const h = host(); h.generate.mockRejectedValueOnce(new Error('offline'))
    expect((await h.controller.request(request)).text).toBe('')
    await h.controller.request({ ...request, requestId: 'second' })
    expect(h.generate).toHaveBeenCalledTimes(1)
  })
})

describe('suggestion content boundaries', () => {
  it.each(['', 'a', '- Do this', '1. Do this', '建议：做这个', 'Suggestion: do this', 'two\nlines', 'Keep going…', 'x'.repeat(241), '{"text":"oops"}'])('rejects invalid output %j', value => {
    expect(suggestionText(value)).toBe('')
  })
  it('preserves plain Chinese and English requests', () => {
    expect(suggestionText('  请补充边界条件测试。  ')).toBe('请补充边界条件测试。')
    expect(suggestionText('Add a regression test.')).toBe('Add a regression test.')
  })
  it('takes only human text and final replies, excludes thinking, tools, injected context, interrupted replies, and quote envelopes', () => {
    const event = (type: string, data: unknown) => ({ type, data }) as SessionEvent
    const events = [
      event('user/message', { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'Fix it. api_key=secret123 <clawclaw-selection-quote>private quote</clawclaw-selection-quote>' }] }),
      event('user/message', { role: 'user', source: { kind: 'model-selection' }, content: [{ type: 'text', text: 'injected-private' }] }),
      event('assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: 'intermediate' }, { type: 'tool-call', name: 'bash' }] } }),
      event('tool/result', { text: 'full-private-log' }),
      event('assistant/message', { turn: 1, message: { role: 'assistant', content: [{ type: 'reasoning', text: 'private-thought' }, { type: 'text', text: 'Fixed.' }] } }),
      event('turn/end', { turn: 1, reason: { kind: 'completed' } }),
      event('assistant/message', { turn: 2, interrupted: true, message: { role: 'assistant', content: [{ type: 'text', text: 'incomplete' }] } }),
      event('turn/end', { turn: 2, reason: { kind: 'aborted' } }),
    ]
    const context = suggestionContext(events)
    expect(context).toContain('Fix it. [redacted]')
    expect(context).toContain('Fixed.')
    for (const excluded of ['secret123', 'private quote', 'injected-private', 'intermediate', 'full-private-log', 'private-thought', 'incomplete']) expect(context).not.toContain(excluded)
  })
  it('bounds recent context independently of transcript size', () => {
    const events = Array.from({ length: 100 }, () => ({ type: 'user/message', data: {
      role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: 'x'.repeat(10_000) }],
    } }) as unknown as SessionEvent)
    expect(suggestionContext(events).length).toBeLessThanOrEqual(6000)
  })
})

describe('existing LLM adapter one-shot call', () => {
  it.each([
    { efforts: undefined, cap: undefined, expected: 1024 },
    { efforts: [], cap: undefined, expected: 1024 },
    { efforts: ['off'], cap: undefined, expected: 512 },
    { efforts: ['high'], cap: undefined, expected: 1536 },
    { efforts: ['low', 'high'], cap: undefined, expected: 1536 },
    { efforts: ['low', 'high'], cap: 256, expected: 256 },
    { efforts: ['off'], cap: 64000, expected: 512 },
    { efforts: undefined, cap: 0, expected: 1024 },
    { efforts: undefined, cap: Number.NaN, expected: 1024 },
  ])('selects a bounded output budget from model metadata: $expected', ({ efforts, cap, expected }) => {
    const metadata = { provider: 'configured', id: 'any-model-name', name: 'Any model',
      ...(efforts === undefined ? {} : { reasoning: { efforts: efforts.map(id => ({ id: id as ReasoningEffortId, name: id })) } }),
      ...(cap === undefined ? {} : { defaultMaxTokens: cap }),
    }
    const controls = inputSuggestionCallControls(metadata)
    expect(controls.maxTokens).toBe(expected)
    expect(controls.reasoningEffort).toBe(efforts?.[0])
  })
  function model(chunks: StreamChunk[]) {
    const stream = vi.fn(async function* (_options: GenerateOptions) { yield* chunks })
    const prepareCall = vi.fn(async (config: object, _signal: AbortSignal, configure: ConfigureCall) => {
      const controls = configure({}, { provider: 'configured', id: 'configured-model', name: 'Configured model', reasoning: {
        efforts: [{ id: 'off' as ReasoningEffortId, name: 'Off' }, { id: 'high' as ReasoningEffortId, name: 'High' }],
      } } as Parameters<ConfigureCall>[1])
      return { config: { ...config, ...controls }, stream }
    })
    const ctx = { llm: { prepareCall } } as unknown as Pick<Context, 'llm'>
    return { ctx, stream, prepareCall }
  }
  it.each([
    ['{"suggestion":"请继续检查这个问题。"}', '请继续检查这个问题。'],
    ['{"text":"Add a regression test."}', 'Add a regression test.'],
    ['"请继续检查\\n这个问题。"', '请继续检查 这个问题。'],
    ['{"suggestion":"First","text":"Second"}', ''],
    ['["First", "Second"]', ''],
    ['{"suggestion":"- First\\n- Second"}', ''],
  ])('decodes one unambiguous candidate from a model response: %s', async (raw, expected) => {
    const m = model([{ type: 'text-delta', index: 0, text: raw }, { type: 'finish', reason: { kind: 'stop' } }])
    expect(await generateInputSuggestion(m.ctx, snapshot, new AbortController().signal)).toBe(expected)
  })
  it('uses the configured route, minimum supported reasoning, no tools, and identity-free untrusted transcript', async () => {
    const m = model([{ type: 'reasoning-delta', index: 0, text: 'hidden' },
      { type: 'text-delta', index: 1, text: '"Add a regression test."' }, { type: 'finish', reason: { kind: 'stop' } }])
    const abort = new AbortController()
    expect(await generateInputSuggestion(m.ctx, snapshot, abort.signal)).toBe('Add a regression test.')
    expect(m.prepareCall.mock.calls[0]?.[0]).toEqual({ provider: 'configured', model: 'configured-model' })
    const options = m.stream.mock.calls[0]![0]
    expect(options.reasoningEffort).toBe('off')
    expect(options.maxTokens).toBe(1536)
    expect(options.tools).toEqual([])
    expect(options.messages).toEqual([{ role: 'user', content: [{ type: 'text', text: '[]' }] }])
    expect(options.sessionId).toBeUndefined()
    expect(options.system).toContain('untrusted data')
  })
  it('distinguishes a malformed model result without exposing it to diagnostics', async () => {
    const m = model([{ type: 'text-delta', index: 0, text: 'SENSITIVE_MODEL_OUTPUT' }, { type: 'finish', reason: { kind: 'stop' } }])
    const rejected = vi.fn()
    expect(await generateInputSuggestion(m.ctx, snapshot, new AbortController().signal, rejected)).toBe('')
    expect(rejected).toHaveBeenCalledExactlyOnceWith('invalid-json')
  })
  it.each(([
    [{ type: 'text-delta', index: 0, text: '"An unfinished request"' }],
    [{ type: 'text-delta', index: 0, text: '"An unfinished request"' }, { type: 'finish', reason: { kind: 'max-tokens' } }],
    [{ type: 'text-delta', index: 0, text: 'Here is a suggestion: do this.' }, { type: 'finish', reason: { kind: 'stop' } }],
    [{ type: 'text-delta', index: 0, text: '""' }, { type: 'finish', reason: { kind: 'stop' } }],
  ] as StreamChunk[][]).map(chunks => [chunks]))('rejects incomplete, wrapped, or empty output', async chunks => {
    const m = model(chunks)
    expect(await generateInputSuggestion(m.ctx, snapshot, new AbortController().signal)).toBe('')
  })
})
