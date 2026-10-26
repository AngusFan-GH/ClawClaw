import { Context } from '@deepseek-ai/cordis'
import LlmRuntime, { type LlmConfigurableProvider, type LlmModelDiscoveryRequest, type LlmDiscoveredModel } from '@deepseek-ai/dsh-llm'
import * as PiAi from '@deepseek-ai/dsh-llm-pi-ai'
import { describe, expect, it, vi } from 'vitest'

const pending = {
  displayName: 'SpiritX', apiKeyEnv: 'SPIRITX_API_KEY', api: 'openai-responses',
  baseURL: 'https://ai.xzinfra.com/spiritx-api/v1', models: [], setupPending: true,
}

/** Exercise the installed runtime, including its real schema and volatile updates. */
function mount(route: Record<string, unknown>, provider = 'spiritx') {
  let current = PiAi.Config({ providers: { [provider]: route } } as never).providers.get()
  let entries: readonly LlmConfigurableProvider[] = []
  const listeners = new Map<string, (...args: unknown[]) => unknown>()
  const replaceRoutes = vi.fn()
  const registerAdapter = vi.fn((_routes: readonly string[], _adapter: PiAi.PiAiAdapter) => ({ replace: replaceRoutes, dispose: vi.fn() }))
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    inject: vi.fn(), get: vi.fn((name: string) => name === 'credentials' ? { resolve: async () => ({ value: 'test-key' }), readRecord: async () => undefined } : undefined),
    on: (event: string, callback: (...args: unknown[]) => unknown) => { listeners.set(event, callback) },
    logger: { error: vi.fn() },
    llm: {
      registerAdapter,
      registerConfigurableProviders: (next: readonly LlmConfigurableProvider[]) => {
        entries = next
        return { replace: (next: readonly LlmConfigurableProvider[]) => { entries = next }, dispose: vi.fn() }
      },
      registerModelDiscovery: vi.fn((_ns: string, _discover: (request: LlmModelDiscoveryRequest) => Promise<LlmDiscoveredModel[]>) => {}),
    },
  }
  PiAi.apply(ctx as unknown as Context, { providers: { get: () => current } } as PiAi.Config)
  return {
    ctx, registerAdapter, replaceRoutes,
    spiritx: () => entries.find(entry => entry.provider === 'spiritx'),
    change: (route: Record<string, unknown>) => {
      current = PiAi.Config({ providers: { [provider]: route } } as never).providers.get()
      listeners.get('loader/volatile-update')?.()
    },
  }
}

describe('SpiritX first-install runtime', () => {
  it('preserves normal catalog-provider registration', () => {
    const runtime = mount({ apiKeyEnv: 'OPENAI_API_KEY' }, 'openai')
    expect(runtime.registerAdapter).toHaveBeenCalledWith(['openai'], expect.anything())
    expect(runtime.ctx.logger.error).not.toHaveBeenCalled()
  })
  it('keeps an empty setup route discoverable without an error or inference adapter', () => {
    const runtime = mount(pending)
    expect(runtime.spiritx()).toMatchObject({ provider: 'spiritx', settingsNs: 'llm-pi-ai' })
    expect(runtime.spiritx()?.error).toBeUndefined()
    expect(runtime.registerAdapter).not.toHaveBeenCalled()
    expect(runtime.ctx.llm.registerModelDiscovery).toHaveBeenCalledWith('llm-pi-ai', expect.any(Function))
  })

  it('activates real models without restarting and returns to pending when setup is cleared', () => {
    const runtime = mount(pending)
    runtime.change({ ...pending, setupPending: false, models: [{ id: 'real-chat-model' }] })
    expect(runtime.registerAdapter).toHaveBeenCalledWith(['spiritx'], expect.anything())
    expect(runtime.spiritx()?.error).toBeUndefined()
    runtime.change(pending)
    expect(runtime.replaceRoutes).toHaveBeenLastCalledWith([])
    expect(runtime.spiritx()?.error).toBeUndefined()
    expect(runtime.ctx.logger.error).not.toHaveBeenCalled()
  })

  it('does not let a stale pending flag disable a populated model catalog', () => {
    const runtime = mount({ ...pending, models: [{ id: 'saved-chat-model' }] })
    expect(runtime.registerAdapter).toHaveBeenCalledWith(['spiritx'], expect.anything())
    expect(runtime.spiritx()?.error).toBeUndefined()
  })

  it('retains genuine empty-catalog and model validation errors', () => {
    const runtime = mount({ ...pending, setupPending: false })
    expect(runtime.spiritx()?.error).toContain('resolves no models')
    runtime.change({ ...pending, models: [{ id: '' }] })
    expect(runtime.spiritx()?.error).toBeDefined()
    runtime.change({ ...pending, modelOverrides: { nonexistent: { maxTokens: 100 } } })
    expect(runtime.spiritx()?.error).toBeDefined()
  })
})


describe('SpiritX mixed model protocols', () => {
  it('keeps the discovered protocol through the real LLM service', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    try {
      ctx.llm.registerModelDiscovery('llm-pi-ai', async () => [{ id: 'GLM-5.3', api: 'openai-completions', supportsConversation: true }])
      await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'spiritx' }))
        .resolves.toEqual([{ id: 'GLM-5.3', api: 'openai-completions', supportsConversation: true }])
    } finally { await ctx.fiber.dispose() }
  })

  it('selects protocols from advertised endpoints without guessing from model names', async () => {
    const runtime = mount(pending)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [
      { id: 'chat-only', supportedEndpointPaths: ['/v1/chat/completions'] },
      { id: 'both', supportedEndpointPaths: ['/v1/chat/completions', '/v1/responses'] },
      { id: 'messages-only', supportedEndpointPaths: ['/v1/messages'] },
      { id: 'unspecified' },
      { id: 'canvas-v99', type_code: 'TextToImage', supportedEndpointPaths: ['/v1/images/generations'] },
      { id: 'audio-v99', type_code: 'TextToSpeech' },
      { id: 'future-v99', type_code: 'FutureModelType' },
    ] })))
    try {
      const discover = runtime.ctx.llm.registerModelDiscovery.mock.calls[0]![1]
      await expect(discover({ provider: 'spiritx', baseURL: pending.baseURL, api: pending.api, apiKey: 'test-key' }))
        .resolves.toEqual([
          { id: 'chat-only', name: 'chat-only', api: 'openai-completions', supportsConversation: true },
          { id: 'both', name: 'both', api: 'openai-responses', supportsConversation: true },
          { id: 'messages-only', name: 'messages-only', api: 'anthropic-messages', supportsConversation: true },
          { id: 'unspecified', name: 'unspecified' },
          { id: 'canvas-v99', name: 'canvas-v99', supportsConversation: false },
          { id: 'audio-v99', name: 'audio-v99', supportsConversation: false },
          { id: 'future-v99', name: 'future-v99' },
        ])
    } finally { vi.unstubAllGlobals() }
  })

  it('sends GLM to chat/completions while GPT stays on responses in the same adapter', async () => {
    const runtime = mount({ ...pending, models: [
      { id: 'GLM-5.3', api: 'openai-completions' },
      { id: 'gpt-6.1-sol' },
    ] })
    const paths: string[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request) => {
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url).pathname
      paths.push(path)
      const message = { id: 'msg-test', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }
      const events = path.endsWith('/chat/completions')
        ? [{ id: 'chat-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: { role: 'assistant', content: 'OK' }, finish_reason: null }] },
          { id: 'chat-test', object: 'chat.completion.chunk', choices: [{ index: 0, delta: {}, finish_reason: 'stop' }] }]
        : [{ type: 'response.created', response: { id: 'resp-test', output: [] } },
          { type: 'response.output_item.added', output_index: 0, item: { ...message, content: [] } },
          { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
          { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'OK' },
          { type: 'response.output_item.done', output_index: 0, item: message },
          { type: 'response.completed', response: { id: 'resp-test', status: 'completed', output: [message], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } }]
      return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
        headers: { 'content-type': 'text/event-stream' },
      })
    }))
    try {
      const adapter = runtime.registerAdapter.mock.calls[0]![1]
      for (const model of ['GLM-5.3', 'gpt-6.1-sol']) {
        const prepared = await adapter.prepareCall('spiritx', model)
        const chunks = []
        for await (const chunk of prepared.stream({ provider: 'spiritx', model, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }] })) chunks.push(chunk)
        expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      }
      expect(paths).toEqual(['/spiritx-api/v1/chat/completions', '/spiritx-api/v1/responses'])
    } finally { vi.unstubAllGlobals() }
  })
})


it('does not advertise or dispatch known non-conversation models through the real adapter', async () => {
  const runtime = mount({ ...pending, models: [
    { id: 'canvas-v99', supportsConversation: false },
    { id: 'vision-v99', supportsConversation: true },
  ] })
  const adapter = runtime.registerAdapter.mock.calls[0]![1]
  expect((await adapter.listModels('spiritx')).map(model => model.id)).toEqual(['vision-v99'])
  expect(() => adapter.prepareCall('spiritx', 'canvas-v99')).toThrow()
})

function responseEvents(failure?: string): Response {
  const item = { id: 'msg-budget', type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: 'OK', annotations: [] }] }
  const events = [
    { type: 'response.created', response: { id: 'resp-budget', output: [] } },
    { type: 'response.output_item.added', output_index: 0, item: { ...item, content: [] } },
    { type: 'response.content_part.added', output_index: 0, content_index: 0, part: { type: 'output_text', text: '', annotations: [] } },
    { type: 'response.output_text.delta', output_index: 0, content_index: 0, delta: 'OK' },
    ...failure === undefined ? [
      { type: 'response.output_item.done', output_index: 0, item },
      { type: 'response.completed', response: { id: 'resp-budget', status: 'completed', output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } } },
    ] : [{ type: 'error', code: 'context_length_exceeded', message: failure }],
  ]
  return new Response(events.map(event => `data: ${JSON.stringify(event)}\n\n`).join('') + 'data: [DONE]\n\n', {
    headers: { 'content-type': 'text/event-stream' },
  })
}

const smallerContext = "This model's maximum context length is 32768 tokens. However, you requested 32768 output tokens and your prompt contains 32765 characters."

describe('gateway context capacity correction', () => {
  it('learns a server-reported capacity, recalculates the output budget, and scopes the learned bound to the model and config', async () => {
    const route = { ...pending, models: [{ id: 'bounded-chat' }, { id: 'other-chat' }] }
    const runtime = mount(route)
    const requests: Array<{ model: string; max_output_tokens: number }> = []
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      requests.push(JSON.parse(String(init?.body)))
      return requests.length === 1
        ? Response.json({ message: smallerContext, type: 'BadRequestError', code: 400 }, { status: 400 })
        : responseEvents()
    }))
    try {
      const adapter = runtime.registerAdapter.mock.calls[0]![1]
      const options = { provider: 'spiritx', model: 'bounded-chat', messages: [{ role: 'user' as const, content: [{ type: 'text' as const, text: 'x'.repeat(32765) }] }] }
      for (let call = 0; call < 2; call++) {
        const chunks = []
        for await (const chunk of adapter.stream(options)) chunks.push(chunk)
        expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
        expect(chunks.filter(chunk => chunk.type === 'text-delta')).toHaveLength(1)
      }
      expect(requests).toHaveLength(3)
      expect(requests[0]!.max_output_tokens).toBe(32768)
      expect(requests[1]!.max_output_tokens).toBeGreaterThan(0)
      expect(requests[1]!.max_output_tokens).toBeLessThan(32768 - Math.ceil(32765 / 3.5))
      expect(requests[2]!.max_output_tokens).toBe(requests[1]!.max_output_tokens)
      expect((await adapter.resolveModel('spiritx', 'bounded-chat')).context?.contextWindow).toBe(32768)
      expect((await adapter.resolveModel('spiritx', 'other-chat')).context?.contextWindow).toBe(262144)
      runtime.change(route)
      expect((await adapter.resolveModel('spiritx', 'bounded-chat')).context?.contextWindow).toBe(262144)
    } finally { vi.unstubAllGlobals() }
  })

  it('bounds correction to one retry when the input still does not fit', async () => {
    const runtime = mount({ ...pending, models: [{ id: 'bounded-chat' }] })
    const fetch = vi.fn(async () => Response.json({ message: smallerContext, code: 400 }, { status: 400 }))
    vi.stubGlobal('fetch', fetch)
    try {
      const adapter = runtime.registerAdapter.mock.calls[0]![1]
      const chunks = []
      for await (const chunk of adapter.stream({ provider: 'spiritx', model: 'bounded-chat', messages: [] })) chunks.push(chunk)
      expect(fetch).toHaveBeenCalledTimes(2)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error', failure: { code: 'CONTEXT_WINDOW_EXCEEDED' } } })
    } finally { vi.unstubAllGlobals() }
  })

  it('does not repeat a request after partial output', async () => {
    const runtime = mount({ ...pending, models: [{ id: 'bounded-chat' }] })
    const fetch = vi.fn(async () => responseEvents(smallerContext))
    vi.stubGlobal('fetch', fetch)
    try {
      const adapter = runtime.registerAdapter.mock.calls[0]![1]
      const chunks = []
      for await (const chunk of adapter.stream({ provider: 'spiritx', model: 'bounded-chat', messages: [] })) chunks.push(chunk)
      expect(fetch).toHaveBeenCalledOnce()
      expect(chunks.some(chunk => chunk.type === 'text-delta')).toBe(true)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'error' } })
    } finally { vi.unstubAllGlobals() }
  })
})
