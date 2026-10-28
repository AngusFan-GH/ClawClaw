import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigureCall, GenerateOptions, StreamChunk } from '@deepseek-ai/dsh-llm'
import { HostDraftAssistance, applyDraftAssistance, draftAssistanceInject, generateDraftAssistance, parseDraftAssistRequest } from '../src/input-assistance.ts'
import { registerDesktopJsonApi } from '../src/desktop-json-api.ts'
import { exclusiveInputCall } from '../src/input-assistance-call.ts'
import { AUTOMATIC_ASSIST_TIMEOUT_MS, OPTIMIZATION_TIMEOUT_MS, continuationText, optimizationValue, optimizationPreview, type DraftAssistRequest, type DraftAssistResult, type DraftAssistProgress } from '../src/input-assistance-contract.ts'
vi.mock('../src/desktop-json-api.ts', () => ({ registerDesktopJsonApi: vi.fn() }))

const request: DraftAssistRequest = { kind: 'continuation', sessionId: 'session:a', requestId: 'r1', draft: 'Please help me', draftRev: 2 }
const snapshot = { identity: 'model:context', route: { provider: 'existing', model: 'configured' }, context: '[]' }
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done }); return { promise, resolve } }
afterEach(() => vi.useRealTimers())

describe('strict assistance contracts', () => {
  it('keeps brevity as guidance rather than rejecting otherwise valid suffixes', () => {
    const text = ' write regression tests. Include edge cases and verify the existing behavior.'
    expect(continuationText(text, request.draft)).toBe(text)
    expect(continuationText('文'.repeat(300), request.draft)).toBe('文'.repeat(300))
    expect(continuationText('文'.repeat(301), request.draft)).toBe('')
  })
  it('preserves the whitespace needed to append English text', () => expect(continuationText(' write regression tests.', request.draft)).toBe(' write regression tests.'))
  it.each(['Please help me write tests.', '```text\nwrite tests\n```', 'Sure, here is a continuation.', '<tool>'])('rejects echoes and wrappers: %s', text => {
    expect(continuationText(text, request.draft)).toBe('')
  })
  it.each([null, 'plain output', { optimized: 'ok' }, { optimized: 'x'.repeat(8001), notes: [] }, { optimized: 'ok', notes: [1] }])('never treats malformed optimization as replacement prose', value => {
    expect(optimizationValue(value)).toBeUndefined()
  })
  it('keeps missing information separate from the replacement', () => {
    expect(optimizationValue({ optimized: ' Keep the existing scope. ', notes: [' Target version? '] }))
      .toEqual({ text: 'Keep the existing scope.', notes: ['Target version?'] })
  })
  it.each([{ draftRev: Number.NaN }, { draftRev: 0.5 }, { draftRev: -1 }, { draft: 'x'.repeat(4001) }, { requestId: 'a:b' }, { kind: 'optimization' }])('rejects invalid or mismatched request data', overrides => {
    expect(() => parseDraftAssistRequest({ ...request, ...overrides }, 'continuation')).toThrow()
  })
})

describe('Host cancellation and shared physical concurrency', () => {
  it('records only whitelisted edit-gate diagnostics and rejects arbitrary client text', async () => {
    const info = vi.fn()
    const ctx = { logger: { info }, settings: { register: () => ({ get: () => ({ enabled: true }), watch: () => () => {} }) },
      on: () => {}, effect: () => {} } as unknown as Context
    applyDraftAssistance(ctx, 'continuation')
    const api = vi.mocked(registerDesktopJsonApi).mock.calls.at(-1)![1]
    await expect(api.action({ diagnostic: 'edit-caret', draftRev: 17, draft: 'PRIVATE' })).resolves.toEqual({ recorded: true })
    await expect(api.action({ diagnostic: 'PRIVATE', draftRev: 17 })).rejects.toThrow('Invalid continuation diagnostic')
    expect(info).toHaveBeenCalledExactlyOnceWith('input-continuation: client-edit-caret draftRev=17')
  })
  function harness() {
    let enabled = true; let valid = true
    const pending = deferred<Pick<DraftAssistResult, 'text' | 'notes'>>()
    const generate = vi.fn(async () => pending.promise)
    const controller = new HostDraftAssistance({ enabled: () => enabled, current: () => valid, snapshot: async () => snapshot, generate })
    return { controller, generate, pending, disable: () => { enabled = false }, invalidate: () => { valid = false } }
  }
  it.each(['cancel', 'disable', 'context', 'dispose'] as const)('rejects late responses after %s', async reason => {
    const h = harness(); const result = h.controller.request(request); await Promise.resolve()
    if (reason === 'cancel') h.controller.cancel(request.requestId)
    if (reason === 'disable') h.disable()
    if (reason === 'context') h.invalidate()
    if (reason === 'dispose') h.controller.dispose()
    h.pending.resolve({ text: ' write tests.', notes: [] })
    expect((await result).text).toBe('')
    h.controller.dispose()
  })
  it.each(['continuation', 'optimization'] as const)('bounds %s deadlines even when the provider ignores abort', async kind => {
    vi.useFakeTimers(); const h = harness()
    const result = h.controller.request({ ...request, kind })
    await vi.advanceTimersByTimeAsync(kind === 'optimization' ? OPTIMIZATION_TIMEOUT_MS : AUTOMATIC_ASSIST_TIMEOUT_MS)
    expect((await result).text).toBe('')
    await h.controller.request({ ...request, requestId: 'r2' })
    expect(h.generate).toHaveBeenCalledOnce()
    h.pending.resolve({ text: ' ignored', notes: [] }); h.controller.dispose()
    await Promise.resolve(); expect(vi.getTimerCount()).toBe(0)
  })
  it('handles cancellation arriving before dispatch without billing a call', async () => {
    const h = harness(); h.controller.cancel(request.requestId)
    expect((await h.controller.request(request)).text).toBe(''); expect(h.generate).not.toHaveBeenCalled(); h.controller.dispose()
  })
  it('serializes all feature calls for the same LLM service until physical settlement', async () => {
    const owner = {}; const pending = deferred<string>(); const abort = new AbortController(); const second = vi.fn(async () => 'second')
    const first = exclusiveInputCall(owner, abort.signal, () => pending.promise)
    abort.abort()
    expect(await exclusiveInputCall(owner, new AbortController().signal, second)).toBeUndefined()
    expect(second).not.toHaveBeenCalled()
    pending.resolve('first'); expect(await first).toBe('first')
    expect(await exclusiveInputCall(owner, new AbortController().signal, second)).toBe('second')
  })
})

describe('one-shot model calls', () => {
  it('streams reasoning and decoded preview before a fully validated result is available', async () => {
    const next = deferred<void>(), finish = deferred<void>(), progress = vi.fn()
    const ctx = { llm: { prepareCall: async () => ({ config: {}, stream: async function* () {
      yield { type: 'reasoning-delta', index: 0, text: '整理语句结构。' }
      await next.promise
      yield { type: 'text-delta', index: 1, text: '{"optimized":"Clear\\n' }
      yield { type: 'text-delta', index: 1, text: 'draft","notes":[]}' }
      await finish.promise
      yield { type: 'finish', reason: { kind: 'stop' } }
    } }) } } as unknown as Pick<Context, 'llm'>
    const result = generateDraftAssistance(ctx, { ...request, kind: 'optimization' }, snapshot, new AbortController().signal, progress)
    await vi.waitFor(() => expect(progress).toHaveBeenCalledWith(expect.objectContaining({ channel: 'reasoning', delta: '整理语句结构。' })))
    next.resolve()
    await vi.waitFor(() => expect(progress.mock.calls.filter(([event]) => event.channel === 'text').map(([event]) => event.delta).join('')).toBe('Clear\ndraft'))
    finish.resolve()
    await expect(result).resolves.toEqual({ text: 'Clear\ndraft', notes: [] })
  })

  function model(raw: string, finish: 'stop' | 'max-tokens' = 'stop', cap = 10_000) {
    const stream = vi.fn(async function* (_options: GenerateOptions) {
      yield* [{ type: 'text-delta', index: 0, text: raw }, { type: 'finish', reason: { kind: finish } }] as StreamChunk[]
    })
    const prepareCall = vi.fn(async (route: object, _signal: AbortSignal, configure: ConfigureCall) => ({
      config: { ...route, ...configure({}, { provider: 'existing', id: 'configured', name: 'Any', defaultMaxTokens: cap }) }, stream,
    }))
    return { ctx: { llm: { prepareCall } } as unknown as Pick<Context, 'llm'>, stream, prepareCall }
  }
  it.each([
    ['{"continuation":""}', 'model-empty'],
    [JSON.stringify({ continuation: 'PRIVATE'.repeat(44) }), 'too-long'],
    ['{"unexpected":"PRIVATE"}', 'invalid-shape'],
    ['PRIVATE', 'invalid-json'],
    ['{"continuation":"<PRIVATE>"}', 'rejected-content'],
  ])('distinguishes empty output from validation failures without reporting content: %s', async (raw, reason) => {
    const m = model(raw), rejected = vi.fn()
    expect(await generateDraftAssistance(m.ctx, request, snapshot, new AbortController().signal, undefined, rejected))
      .toEqual({ text: '', notes: [] })
    expect(rejected.mock.calls).toEqual([[reason]])
  })
  it('uses current route, adaptive capabilities, no tools and untrusted draft data', async () => {
    const m = model('" write tests."')
    expect(await generateDraftAssistance(m.ctx, request, snapshot, new AbortController().signal)).toEqual({ text: ' write tests.', notes: [] })
    const options = m.stream.mock.calls[0]![0]
    expect(options.maxTokens).toBe(1024); expect(options.tools).toEqual([]); expect(options.sessionId).toBeUndefined()
    expect(options.system).toContain('untrusted DATA')
    expect(m.prepareCall.mock.calls[0]![0]).toEqual(snapshot.route)
  })
  it.each(['{"continuation":" write tests."}', '{"text":" write tests."}'])('accepts one structured continuation while preserving its join whitespace', async raw => {
    const m = model(raw)
    expect(await generateDraftAssistance(m.ctx, request, snapshot, new AbortController().signal)).toEqual({ text: ' write tests.', notes: [] })
  })
  it('continues a fresh session before its first reply using the configured default, with an explicit service dependency', async () => {
    const m = model('" write tests."')
    const agent = { id: request.sessionId, status: 'idle', inbox: { nextTurn: [], nextStep: [] }, options: {},
      session: { surface: { contentGeneration: 0, nodes: [] }, requestHeader: () => undefined } }
    const ctx = { ...m.ctx, logger: { info: vi.fn() }, settings: { register: () => ({ get: () => ({ enabled: true }), watch: () => () => {} }) },
      agents: { get: () => agent }, sessionProjections: { snapshot: () => ({ values: { modelSelection: { next: null } } }) },
      agentDefaultModel: { currentSelection: () => snapshot.route },
      sessionQuery: { observeSession: async () => ({ events: [], [Symbol.dispose]: () => {} }) },
      on: () => {}, effect: () => {} } as unknown as Context
    applyDraftAssistance(ctx, 'continuation')
    const api = vi.mocked(registerDesktopJsonApi).mock.calls.at(-1)![1]
    expect(draftAssistanceInject).toContain('agentDefaultModel')
    expect(await api.action(request)).toMatchObject({ text: ' write tests.', requestId: request.requestId })
    expect(m.prepareCall.mock.calls[0]![0]).toEqual(snapshot.route)
  })
  it('scales optimization budget with draft length and respects deployment cap', async () => {
    const m = model('{"optimized":"Clear draft","notes":[]}', 'stop', 2500)
    await generateDraftAssistance(m.ctx, { ...request, kind: 'optimization', draft: 'x'.repeat(3000) }, snapshot, new AbortController().signal)
    expect(m.stream.mock.calls[0]![0].maxTokens).toBe(2500)
  })
  it.each(['max-tokens', 'stop'] as const)('rejects %s output when incomplete or malformed', async finish => {
    const m = model(finish === 'stop' ? 'Here is an optimized draft' : '{"optimized":"cut off","notes":[]}', finish)
    expect((await generateDraftAssistance(m.ctx, { ...request, kind: 'optimization' }, snapshot, new AbortController().signal)).text).toBe('')
  })
})

describe('stream preview decoding and lifetime', () => {
  it('holds incomplete escapes and surrogate pairs without exposing JSON framing', () => {
    expect(optimizationPreview('{"optimized":"a\\n\\u4')).toBe('a\n')
    expect(optimizationPreview('{"optimized":"\\ud83d')).toBe('')
    expect(optimizationPreview('{"optimized":"\\ud83d\\ude00')).toBe('😀')
    expect(optimizationPreview('{"optimized":"a\\\"b\\\\c","notes":[]}')).toBe('a"b\\c')
    expect(optimizationPreview('{"notes":["x"],"optimized":"y"}')).toBe('y')
    expect(optimizationPreview('{"notes":["\\\"optimized\\\":\\\"fake"],"optimized":"real"}')).toBe('real')
  })
  it('drops progress from a physical model task after cancellation', async () => {
    let publish: ((event: DraftAssistProgress) => void) | undefined
    const pending = deferred<{ text: string; notes: string[] }>(), progress = vi.fn()
    const controller = new HostDraftAssistance({ enabled: () => true, current: () => true, snapshot: async () => snapshot,
      generate: async (_request, _snapshot, _signal, emit) => { publish = emit; return pending.promise } })
    const running = controller.request({ ...request, kind: 'optimization' }, progress)
    await vi.waitFor(() => expect(publish).toBeDefined())
    controller.cancel(request.requestId)
    publish!({ requestId: request.requestId, draftRev: request.draftRev, channel: 'text', delta: 'late' })
    await running; expect(progress).not.toHaveBeenCalled()
    pending.resolve({ text: 'late', notes: [] }); controller.dispose()
  })
})
