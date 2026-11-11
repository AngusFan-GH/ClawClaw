import { readFileSync } from 'node:fs'
import { discoverSpiritXModels } from '../src/client/spiritx-provisioning.ts'
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


function successfulStream(path: string): Response {
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
}

describe('SpiritX mixed model protocols', () => {
  it('keeps the discovered protocol through the real LLM service', async () => {
    const ctx = new Context()
    await ctx.plugin(LlmRuntime)
    try {
      ctx.llm.registerModelDiscovery('llm-pi-ai', async () => [{ id: 'GLM-5.3', api: 'openai-completions', supportsConversation: true, reasoningEfforts: { high: 'high' } }])
      await expect(ctx.llm.discoverModels('llm-pi-ai', { provider: 'spiritx' }))
        .resolves.toEqual([{ id: 'GLM-5.3', api: 'openai-completions', supportsConversation: true, reasoningEfforts: { high: 'high' } }])
    } finally { await ctx.fiber.dispose() }
  })

  it('offers model-specific efforts for the actual SpiritX model directory', async () => {
    const runtime = mount(pending)
    const listing = JSON.parse(readFileSync(new URL('./fixtures/spiritx-models.json', import.meta.url), 'utf8'))
    vi.stubGlobal('fetch', vi.fn(async () => Response.json(listing)))
    try {
      const discover = runtime.ctx.llm.registerModelDiscovery.mock.calls[0]![1]
      const result = await discoverSpiritXModels({ remote: { llm: {
        discoverModels: async () => ({ ok: true, value: await discover({ provider: 'spiritx', baseURL: pending.baseURL, api: pending.api, apiKey: 'test-key' }) }),
      } } } as never)
      expect(result.ok).toBe(true)
      if (!result.ok) throw new Error(result.error)
      const configured = mount({ ...pending, setupPending: false, models: result.value })
      const adapter = configured.registerAdapter.mock.calls[0]![1]
      const expected: Record<string, string[]> = {
        'GLM-5.3': ['low', 'high', 'max'],
        'GLM-5.3-Flash': ['low', 'high', 'max'],
        'DeepSeek-V4-Flash': ['off', 'low', 'high', 'max'],
        'DeepSeek-V4-Flash-0731': ['off', 'low', 'high', 'max'],
        'DeepSeek-V4.1-Flash': ['off', 'low', 'high', 'max'],
        'Qwen3.8-27B': ['low', 'medium', 'xhigh'],
        'Qwen3.8-Flash-Next': ['low', 'medium', 'xhigh'],
      }
      for (const [id, efforts] of Object.entries(expected)) {
        expect((await adapter.resolveModel('spiritx', id)).reasoning?.efforts.map(effort => effort.id), id).toEqual(efforts)
      }
      expect(result.value.find(model => model.id === 'gpt-image-2')?.supportsConversation).toBe(false)
      await expect(adapter.resolveModel('spiritx', 'Qwen3Guard-Gen-4B')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
    } finally { vi.unstubAllGlobals() }
  })

  it('discovers explicit thinking mappings and resolves selectable efforts', async () => {
    const runtime = mount(pending)
    const reasoningEfforts = { off: null, low: 'low', high: 'high' }
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [
      { id: 'thinking-chat', reasoningEfforts },
      { id: 'plain-chat', reasoningEfforts: false },
      { id: 'invalid-chat', reasoningEfforts: { high: null } },
    ] })))
    try {
      const discover = runtime.ctx.llm.registerModelDiscovery.mock.calls[0]![1]
      const models = await discover({ provider: 'spiritx', baseURL: pending.baseURL, api: pending.api, apiKey: 'test-key' })
      expect(models).toEqual([
        { id: 'thinking-chat', name: 'thinking-chat', reasoningEfforts },
        { id: 'plain-chat', name: 'plain-chat', reasoningEfforts: false },
        { id: 'invalid-chat', name: 'invalid-chat' },
      ])
      const configured = mount({ ...pending, setupPending: false, models })
      const adapter = configured.registerAdapter.mock.calls[0]![1]
      expect((await adapter.resolveModel('spiritx', 'thinking-chat')).reasoning?.efforts.map(effort => effort.id))
        .toEqual(['off', 'low', 'high'])
      expect((await adapter.resolveModel('spiritx', 'plain-chat')).reasoning).toBeUndefined()
    } finally { vi.unstubAllGlobals() }
  })

  it('enforces explicit purpose in the runtime independently of stale capability flags', async () => {
    const runtime = mount({ ...pending, setupPending: false, models: [
      { id: 'specialized', purpose: 'safety-classifier', supportsConversation: true },
      { id: 'manual-chat', purpose: 'conversation', supportsConversation: false },
    ] })
    const adapter = runtime.registerAdapter.mock.calls[0]![1]
    expect((await adapter.listModels('spiritx')).map(model => model.id)).toEqual(['manual-chat'])
    await expect(adapter.resolveModel('spiritx', 'specialized')).rejects.toMatchObject({ code: 'UNKNOWN_MODEL' })
  })

  it('discovers SpiritX context capacity and uses it after saving the model', async () => {
    const runtime = mount(pending)
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [
      { id: 'capacity-test', max_model_len: 1048576 },
      { id: 'explicit-capacity', context_window: 262144, max_model_len: 1048576 },
      { id: 'invalid-capacity', max_model_len: 0 },
    ] })))
    try {
      const discover = runtime.ctx.llm.registerModelDiscovery.mock.calls[0]![1]
      const models = await discover({ provider: 'spiritx', baseURL: pending.baseURL, api: pending.api, apiKey: 'test-key' })
      expect(models).toEqual([
        { id: 'capacity-test', name: 'capacity-test', contextWindow: 1048576 },
        { id: 'explicit-capacity', name: 'explicit-capacity', contextWindow: 262144 },
        { id: 'invalid-capacity', name: 'invalid-capacity' },
      ])
      runtime.change({ ...pending, setupPending: false, models: [models[0]!] })
      const adapter = runtime.registerAdapter.mock.calls[0]![1]
      expect((await adapter.resolveModel('spiritx', 'capacity-test')).context?.contextWindow).toBe(1048576)
    } finally { vi.unstubAllGlobals() }
  })

  it.each([
    { api: 'openai-completions', defaultLevel: 'high', off: undefined, selected: undefined, wire: 'high' },
    { api: 'openai-responses', defaultLevel: 'high', off: undefined, selected: undefined, wire: 'high' },
    { api: 'openai-responses', defaultLevel: null, off: undefined, selected: undefined, wire: undefined },
    { api: 'openai-completions', defaultLevel: null, off: 'omit', selected: 'off', wire: undefined },
    { api: 'openai-completions', defaultLevel: null, off: undefined, selected: 'off', wire: undefined },
    { api: 'openai-responses', defaultLevel: null, off: 'value', selected: 'off', wire: 'none' },
    { api: 'openai-completions', defaultLevel: null, off: 'qwen-toggle', selected: 'off', wire: undefined },
    { api: 'openai-completions', defaultLevel: null, off: 'deepseek-toggle', selected: 'off', wire: undefined },
  ])('applies model defaults and explicit Off behavior on $api ($off)', async ({ api, defaultLevel, off, selected, wire }) => {
    const runtime = mount({ ...pending, setupPending: false, reasoning: 'high', models: [{
      id: 'configured-chat', api, reasoningMode: 'custom', defaultReasoningEffort: defaultLevel,
      reasoningEfforts: { off: off === 'value' ? 'none' : null, high: 'high' },
      ...off === undefined ? {} : { reasoningOff: off },
    }] })
    const bodies: Array<{ reasoning_effort?: unknown; reasoning?: { effort?: unknown }; chat_template_kwargs?: { enable_thinking?: unknown }; thinking?: { type?: unknown } }> = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)))
      return successfulStream(new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url).pathname)
    }))
    try {
      const adapter = runtime.registerAdapter.mock.calls[0]![1]
      const info = await adapter.resolveModel('spiritx', 'configured-chat')
      expect(info.reasoning?.defaultEffort).toBe(defaultLevel ?? undefined)
      const prepared = await adapter.prepareCall('spiritx', 'configured-chat')
      const effort = selected === undefined ? undefined : info.reasoning!.efforts.find(effort => effort.id === selected)!.id
      const chunks = []
      for await (const chunk of prepared.stream({ provider: 'spiritx', model: 'configured-chat', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }], ...effort === undefined ? {} : { reasoningEffort: effort } })) chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      expect(api === 'openai-completions' ? bodies[0]?.reasoning_effort : bodies[0]?.reasoning?.effort).toBe(wire)
      if (off === 'qwen-toggle') expect(bodies[0]?.chat_template_kwargs?.enable_thinking).toBe(false)
      if (off === 'deepseek-toggle') expect(bodies[0]?.thinking?.type).toBe('disabled')
    } finally { vi.unstubAllGlobals() }
  })

  it('ignores a retained session effort after reasoning has been disabled', async () => {
    const route = { ...pending, setupPending: false, models: [{ id: 'chat', reasoningMode: 'custom', reasoningEfforts: { high: 'high' } }] }
    const runtime = mount(route)
    const adapter = runtime.registerAdapter.mock.calls[0]![1]
    const retained = (await adapter.resolveModel('spiritx', 'chat')).reasoning!.efforts[0]!.id
    runtime.change({ ...route, models: [{ id: 'chat', reasoningMode: 'disabled', reasoningEfforts: false, defaultReasoningEffort: null }] })
    let sent: { reasoning?: { effort?: unknown } } | undefined
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body))
      return successfulStream('/v1/responses')
    }))
    try {
      const prepared = await adapter.prepareCall('spiritx', 'chat')
      expect(prepared.model.reasoning).toBeUndefined()
      const chunks = []
      for await (const chunk of prepared.stream({ provider: 'spiritx', model: 'chat', reasoningEffort: retained, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }] })) chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      expect(sent?.reasoning?.effort).toBeUndefined()
    } finally { vi.unstubAllGlobals() }
  })

  it('uses the shared Qwen default for a generic custom API provider', async () => {
    const runtime = mount({ ...pending, setupPending: false, models: [{ id: 'Qwen3.8-27B' }] }, 'custom-api')
    const adapter = runtime.registerAdapter.mock.calls[0]![1]
    const model = await adapter.resolveModel('custom-api', 'Qwen3.8-27B')
    expect(model.reasoning?.efforts.map(effort => effort.id)).toEqual(['low', 'medium', 'xhigh'])
    expect(model.reasoning?.defaultEffort).toBe('xhigh')
  })

  it('rejects unsupported per-model defaults and protocol-incompatible toggles', () => {
    const invalid = mount({ ...pending, setupPending: false, models: [{ id: 'chat', reasoningEfforts: { low: 'low' }, defaultReasoningEffort: 'high' }] })
    expect(invalid.spiritx()?.error).toContain('default reasoning level')
    const toggle = mount({ ...pending, setupPending: false, models: [{ id: 'chat', api: 'openai-responses', reasoningEfforts: { off: null, high: 'high' }, reasoningOff: 'qwen-toggle' }] })
    expect(toggle.spiritx()?.error).toContain('thinking toggles require')
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
          { id: 'chat-only', name: 'chat-only', api: 'openai-completions', supportsConversation: true, supportedEndpointPaths: ['/v1/chat/completions'] },
          { id: 'both', name: 'both', api: 'openai-responses', supportsConversation: true, supportedEndpointPaths: ['/v1/chat/completions', '/v1/responses'] },
          { id: 'messages-only', name: 'messages-only', api: 'anthropic-messages', supportsConversation: true, supportedEndpointPaths: ['/v1/messages'] },
          { id: 'unspecified', name: 'unspecified' },
          { id: 'canvas-v99', name: 'canvas-v99', supportsConversation: false, modelType: 'TextToImage', supportedEndpointPaths: ['/v1/images/generations'] },
          { id: 'audio-v99', name: 'audio-v99', supportsConversation: false, modelType: 'TextToSpeech' },
          { id: 'future-v99', name: 'future-v99', modelType: 'FutureModelType' },
        ])
    } finally { vi.unstubAllGlobals() }
  })

  it('sends GLM to chat/completions while GPT stays on responses in the same adapter', async () => {
    const runtime = mount({ ...pending, models: [
      { id: 'GLM-5.3', api: 'openai-completions', reasoningEfforts: { high: 'high' } },
      { id: 'gpt-6.1-sol', reasoningEfforts: { high: 'high' } },
    ] })
    const paths: string[] = []
    const bodies: Record<string, unknown>[] = []
    vi.stubGlobal('fetch', vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      bodies.push(JSON.parse(String(init?.body)) as Record<string, unknown>)
      const path = new URL(typeof input === 'string' ? input : input instanceof URL ? input : input.url).pathname
      paths.push(path)
      return successfulStream(path)
    }))
    try {
      const adapter = runtime.registerAdapter.mock.calls[0]![1]
      for (const model of ['GLM-5.3', 'gpt-6.1-sol']) {
        const reasoningEffort = (await adapter.resolveModel('spiritx', model)).reasoning!.efforts.find(effort => effort.id === 'high')!.id
        const prepared = await adapter.prepareCall('spiritx', model)
        const chunks = []
        for await (const chunk of prepared.stream({ provider: 'spiritx', model, reasoningEffort, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }] })) chunks.push(chunk)
        expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      }
      expect(bodies[0]?.reasoning_effort).toBe('high')
      expect(bodies[1]?.reasoning).toMatchObject({ effort: 'high' })
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

describe('model-specific reasoning parameters', () => {
  it.each([
    { name: 'literal ultra', efforts: { ultra: 'ultra' }, mappings: undefined, expected: { reasoning: { effort: 'ultra' } }, label: 'ultra' },
    { name: 'model-specific API value', efforts: { ultra: 'max' }, mappings: undefined, expected: { reasoning: { effort: 'max' } }, label: 'ultra' },
    { name: 'numeric effort', efforts: { ultra: 'ultra' }, mappings: { ultra: { kind: 'number', path: 'reasoning.effort', value: 75, min: 1, max: 100, step: 1 } }, expected: { reasoning: { effort: 75 } }, label: 'ultra' },
    { name: 'token budget', efforts: { ultra: 'ultra' }, mappings: { ultra: { kind: 'budget', path: 'thinking.budget_tokens', value: 2048 } }, expected: { thinking: { budget_tokens: 2048 } }, label: 'ultra' },
    { name: 'toggle', efforts: { ultra: 'ultra' }, mappings: { ultra: { kind: 'toggle', path: 'chat_template_kwargs.enable_thinking', value: true } }, expected: { chat_template_kwargs: { enable_thinking: true } }, label: 'ultra' },
    { name: 'compound parameters', efforts: { ultra: 'ultra' }, mappings: { ultra: { kind: 'parameters', body: { reasoning: { effort: 'max' }, task_mode: 'delegate' } } }, expected: { reasoning: { effort: 'max' }, task_mode: 'delegate' }, label: 'ultra' },
  ])('sends $name without SDK clamping', async ({ efforts, mappings, expected, label }) => {
    const runtime = mount({ ...pending, setupPending: false, models: [{ id: 'chat', reasoningMode: 'custom', reasoningEfforts: efforts, reasoningMappings: mappings, defaultReasoningEffort: 'ultra' }] })
    expect(runtime.spiritx()?.error).toBeUndefined()
    const adapter = runtime.registerAdapter.mock.calls[0]![1]
    const prepared = await adapter.prepareCall('spiritx', 'chat')
    expect(prepared.model.reasoning?.defaultEffort).toBe('ultra')
    expect(prepared.model.reasoning?.efforts[0]?.name).toBe(label)
    let sent: unknown
    vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
      sent = JSON.parse(String(init?.body))
      return successfulStream('/v1/responses')
    }))
    try {
      const chunks = []
      for await (const chunk of prepared.stream({ provider: 'spiritx', model: 'chat', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }] })) chunks.push(chunk)
      expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
      expect(sent).toMatchObject(expected)
    } finally { vi.unstubAllGlobals() }
  })

  it('rejects invalid numeric values, unsupported mapping kinds and payload routing overrides', () => {
    for (const mappings of [
      { ultra: { kind: 'number', path: 'reasoning.effort', value: 101, min: 1, max: 100 } },
      { ultra: { kind: 'fallback', target: 'missing' } },
      { ultra: { kind: 'parameters', body: { model: 'wrong' } } },
      { ultra: { kind: 'toggle', path: '__proto__.polluted', value: true } },
    ]) {
      const runtime = mount({ ...pending, setupPending: false, models: [{ id: 'chat', reasoningEfforts: { ultra: 'ultra', max: 'max' }, reasoningMappings: mappings }] })
      expect(runtime.spiritx()?.error).toContain('invalid reasoning configuration')
    }
  })

  it('preserves advertised dynamic reasoning metadata through discovery', async () => {
    const runtime = mount(pending)
    const callback = runtime.ctx.llm.registerModelDiscovery.mock.calls[0]![1]
    vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [
      { id: 'router-chat', reasoning: { supported_efforts: ['low', 'ultra'], default_effort: 'ultra' } },
      { id: 'custom-chat', reasoningEfforts: { ultra: 'ultra' }, reasoningMappings: { ultra: { kind: 'number', path: 'reasoning.effort', value: 99, max: 100 } }, defaultReasoningEffort: 'ultra' },
    ] })))
    try {
      const models = await callback({ provider: 'spiritx', baseURL: pending.baseURL, api: pending.api, apiKey: 'test-key' })
      expect(models[0]).toMatchObject({ reasoningEfforts: { low: 'low', ultra: 'ultra' }, defaultReasoningEffort: 'ultra' })
      expect(models[1]).toMatchObject({ reasoningMappings: { ultra: { kind: 'number', value: 99 } }, defaultReasoningEffort: 'ultra' })
    } finally { vi.unstubAllGlobals() }
  })
})

it.each([
  { kind: 'parameters', body: { generationConfig: { thinkingConfig: { thinkingBudget: 2048, includeThoughts: true } } } },
  { kind: 'budget', path: 'generationConfig.thinkingConfig.thinkingBudget', value: 2048 },
])('sends Gemini reasoning parameters in its actual request body ($kind)', async mapping => {
  const runtime = mount({ apiKeyEnv: 'TEST_KEY', models: [{ id: 'gemini-2.5-flash', reasoningMode: 'custom', reasoningEfforts: { deep: 'deep' }, defaultReasoningEffort: 'deep', reasoningMappings: { deep: mapping } }] }, 'google')
  expect(runtime.spiritx()?.error).toBeUndefined()
  const adapter = runtime.registerAdapter.mock.calls[0]![1]
  const prepared = await adapter.prepareCall('google', 'gemini-2.5-flash')
  let sent: unknown
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return new Response(`data: ${JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text: 'OK' }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1, totalTokenCount: 2 } })}\n\n`, { headers: { 'content-type': 'text/event-stream' } })
  }))
  try {
    const chunks = []
    for await (const chunk of prepared.stream({ provider: 'google', model: 'gemini-2.5-flash', messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }] })) chunks.push(chunk)
    expect(chunks.at(-1)).toMatchObject({ type: 'finish', reason: { kind: 'stop' } })
    expect(sent).toMatchObject({ generationConfig: { thinkingConfig: { thinkingBudget: 2048 } } })
  } finally { vi.unstubAllGlobals() }
})

it('normalizes a discovered none default and retains an explicit provider-default choice', async () => {
  const runtime = mount(pending)
  const callback = runtime.ctx.llm.registerModelDiscovery.mock.calls[0]![1]
  vi.stubGlobal('fetch', vi.fn(async () => Response.json({ data: [
    { id: 'router-off', reasoning: { supported_efforts: ['none', 'high'], default_effort: 'none' } },
    { id: 'router-provider-default', defaultReasoningEffort: null, reasoning: { supported_efforts: ['none', 'high'], default_effort: 'high' } },
  ] })))
  try {
    const models = await callback({ provider: 'spiritx', baseURL: pending.baseURL, api: pending.api, apiKey: 'test-key' })
    expect(models[0]).toMatchObject({ reasoningEfforts: { off: 'none', high: 'high' }, defaultReasoningEffort: 'off' })
    expect(models[1]).toMatchObject({ defaultReasoningEffort: null })
  } finally { vi.unstubAllGlobals() }
})

it('automatically uses the DeepSeek Chat Completions thinking toggle for Off', async () => {
  const runtime = mount({ ...pending, setupPending: false, models: [{ id: 'DeepSeek-V4-Flash', api: 'openai-completions', reasoningMode: 'auto' }] })
  const adapter = runtime.registerAdapter.mock.calls[0]![1]
  const prepared = await adapter.prepareCall('spiritx', 'DeepSeek-V4-Flash')
  const off = prepared.model.reasoning!.efforts.find(option => option.id === 'off')!.id
  let sent: unknown
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return successfulStream('/v1/chat/completions')
  }))
  try {
    for await (const _chunk of prepared.stream({ provider: 'spiritx', model: 'DeepSeek-V4-Flash', reasoningEffort: off, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }] })) {}
    expect(sent).toMatchObject({ thinking: { type: 'disabled' } })
    expect(sent).not.toHaveProperty('reasoning_effort')
  } finally { vi.unstubAllGlobals() }
})

it.each([
  { id: 'GLM-5.3-Flash', encrypted: false },
  { id: 'other-chat', encrypted: true },
])('retains protocol-supported reasoning inclusion for $id', async ({ id, encrypted }) => {
  const runtime = mount({ ...pending, setupPending: false, models: [{ id, reasoningEfforts: { low: 'low' } }] })
  const prepared = await runtime.registerAdapter.mock.calls[0]![1].prepareCall('spiritx', id)
  const low = prepared.model.reasoning!.efforts.find(option => option.id === 'low')!.id
  let sent: { include?: string[] } | undefined
  vi.stubGlobal('fetch', vi.fn(async (_input: unknown, init?: RequestInit) => {
    sent = JSON.parse(String(init?.body))
    return successfulStream('/v1/responses')
  }))
  try {
    for await (const _chunk of prepared.stream({ provider: 'spiritx', model: id, reasoningEffort: low, messages: [{ role: 'user', content: [{ type: 'text', text: 'Reply OK' }] }] })) {}
    expect(sent?.include?.includes('reasoning.encrypted_content') ?? false).toBe(encrypted)
  } finally { vi.unstubAllGlobals() }
})
