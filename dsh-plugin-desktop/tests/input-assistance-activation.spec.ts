import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import type { ConfigureCall, GenerateOptions } from '@deepseek-ai/dsh-llm'
import { waitForInputAgent } from '../src/input-assistance-call.ts'
import { apply as applySuggestions } from '../src/input-suggestions.ts'
import { applyDraftAssistance } from '../src/input-assistance.ts'
import { AUTOMATIC_ASSIST_TIMEOUT_MS } from '../src/input-assistance-contract.ts'
import { registerDesktopJsonApi } from '../src/desktop-json-api.ts'
vi.mock('../src/desktop-json-api.ts', () => ({ registerDesktopJsonApi: vi.fn() }))

afterEach(() => vi.useRealTimers())
function fixture(options: { noRoute?: boolean } = {}) {
  let active: Agent | undefined
  const listeners = new Map<string, Set<(payload: any) => void>>()
  const stops: Array<() => void> = []
  const route = { provider: 'configured', model: 'existing' }
  const events: any[] = [
    { type: 'user/message', seq: 0, data: { role: 'user', source: { kind: 'user' }, content: [{ type: 'text', text: '检查这个功能。' }] } },
    { type: 'assistant/message', seq: 1, data: { turn: 1, message: { role: 'assistant', content: [{ type: 'text', text: '已完成检查。' }] } } },
    { type: 'turn/end', seq: 2, data: { turn: 1, reason: { kind: 'completed' } } },
  ]
  const agent = { id: SessionId('cold'), status: 'idle', options: route, inbox: { nextTurn: [], nextStep: [] },
    session: { surface: { nodes: [0, 1], contentGeneration: 0 }, requestHeader: () => ({ config: route }) } } as unknown as Agent
  const observeSession = vi.fn(async () => ({ events, [Symbol.dispose]: () => {} }))
  const stream = vi.fn(async function* (options: GenerateOptions) {
    const text = options.system?.startsWith('Edit the draft') ? { optimized: '请补充回归测试。', notes: [] }
      : options.system?.startsWith('Continue the human draft') ? { continuation: '边界条件测试。' } : { suggestion: '请补充回归测试。' }
    yield { type: 'text-delta' as const, index: 0, text: JSON.stringify(text) }
    yield { type: 'finish' as const, reason: { kind: 'stop' as const } }
  })
  const prepareCall = vi.fn(async (config: object, _signal: AbortSignal, configure: ConfigureCall) => ({
    config: { ...config, ...configure({}, { provider: route.provider, id: route.model, name: route.model }) }, stream,
  }))
  const ctx = {
    agents: { get: () => active },
    logger: { info: vi.fn() },
    settings: { register: () => ({ get: () => ({ enabled: true }), watch: () => () => {} }) },
    sessionProjections: { snapshot: () => ({ values: { modelSelection: { next: options.noRoute ? null : route } } }) },
    sessionQuery: { observeSession }, agentDefaultModel: { currentSelection: () => route }, llm: { prepareCall },
    on: (name: string, callback: (payload: any) => void) => {
      if (!listeners.has(name)) listeners.set(name, new Set())
      listeners.get(name)!.add(callback)
      return () => listeners.get(name)!.delete(callback)
    },
    effect: (mount: () => (() => void) | void) => { const stop = mount(); if (stop) stops.push(stop) },
  } as unknown as Context
  if (options.noRoute) {
    Object.assign(agent, { options: {} })
    Object.assign(agent.session, { requestHeader: () => undefined })
  }
  return { ctx, events, agent, stream, observeSession,
    get waiting() { return listeners.get('agent/created')?.size ?? 0 },
    activate() { active = agent; [...listeners.get('agent/created') ?? []].forEach(listener => listener({ agent })) },
    unrelated() { [...listeners.get('agent/created') ?? []].forEach(listener => listener({ agent: { id: 'other' } })) },
    dispose() { stops.reverse().forEach(stop => stop()) },
  }
}

describe('read-only history activation race', () => {
  it.each(['suggestion', 'continuation', 'optimization'] as const)('waits for an existing background activation before %s generation', async kind => {
    vi.useFakeTimers(); const f = fixture()
    if (kind === 'suggestion') applySuggestions(f.ctx)
    else applyDraftAssistance(f.ctx, kind)
    const api = vi.mocked(registerDesktopJsonApi).mock.calls.at(-1)![1]
    const result = api.action(kind === 'suggestion' ? { sessionId: 'cold', requestId: 'r1', endSeq: 2 }
      : { sessionId: 'cold', requestId: 'r1', kind, draft: '请为这个功能补充', draftRev: 1 })
    await vi.advanceTimersByTimeAsync(700)
    expect(f.waiting).toBe(1); expect(f.observeSession).not.toHaveBeenCalled(); expect(f.stream).not.toHaveBeenCalled()
    f.unrelated(); expect(f.waiting).toBe(1)
    f.activate(); expect(await result).toMatchObject({ text: kind === 'continuation' ? '边界条件测试。' : '请补充回归测试。' })
    expect(f.observeSession).toHaveBeenCalledOnce(); expect(f.stream).toHaveBeenCalledOnce(); expect(f.waiting).toBe(0)
    f.dispose(); expect(vi.getTimerCount()).toBe(0)
  })
  it('releases the activation listener on timeout without starting or resuming an Agent', async () => {
    vi.useFakeTimers(); const f = fixture(); applySuggestions(f.ctx)
    const api = vi.mocked(registerDesktopJsonApi).mock.calls.at(-1)![1]
    const result = api.action({ sessionId: 'cold', requestId: 'r1', endSeq: 2 })
    await vi.advanceTimersByTimeAsync(AUTOMATIC_ASSIST_TIMEOUT_MS)
    expect(await result).toMatchObject({ text: '' }); expect(f.waiting).toBe(0); expect(f.stream).not.toHaveBeenCalled()
    f.dispose()
  })
  it('releases the listener when cancellation precedes activation', async () => {
    const f = fixture(); const abort = new AbortController()
    const result = waitForInputAgent(f.ctx, SessionId('cold'), abort.signal)
    abort.abort(); expect(await result).toBeUndefined(); expect(f.waiting).toBe(0)
  })
  it('closes the race when activation completes while the listener is being registered', async () => {
    const f = fixture()
    vi.spyOn(f.ctx.agents, 'get').mockReturnValueOnce(undefined).mockReturnValue(f.agent)
    expect(await waitForInputAgent(f.ctx, SessionId('cold'), new AbortController().signal)).toBe(f.agent)
    expect(f.waiting).toBe(0)
  })
  it('uses the configured default for legacy completed history without a model route', async () => {
    const f = fixture({ noRoute: true }); f.activate(); applySuggestions(f.ctx)
    const api = vi.mocked(registerDesktopJsonApi).mock.calls.at(-1)![1]
    expect(await api.action({ sessionId: 'cold', requestId: 'r1', endSeq: 2 })).toMatchObject({ text: '请补充回归测试。' })
    expect(f.stream.mock.calls[0]![0].provider).toBe('configured'); f.dispose()
  })
  it('uses the current selected route for completed history without treating a model selection as new conversation content', async () => {
    const f = fixture(); f.activate()
    f.events.push({ type: 'model/selection', seq: 3, data: { provider: 'configured', model: 'existing' } })
    applySuggestions(f.ctx)
    const api = vi.mocked(registerDesktopJsonApi).mock.calls.at(-1)![1]
    expect(await api.action({ sessionId: 'cold', requestId: 'r1', endSeq: 2 })).toMatchObject({ text: '请补充回归测试。' })
    expect(f.stream).toHaveBeenCalledOnce(); f.dispose()
  })
})
