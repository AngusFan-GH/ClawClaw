import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import {
  discoverSpiritXModels,
  firstLanguageModel,
  hasUsableSpiritXProfile,
  loadSpiritXProfile,
  provisionSpiritX,
  saveSpiritXModels,
  syncSpiritXModelProtocols,
} from '../src/client/spiritx-provisioning.ts'

describe('SpiritX provisioning', () => {
  const writableCredential = () => ({
    describe: vi.fn(async () => ({
      ok: true, value: { SPIRITX_API_KEY: { configured: false, writable: true } },
    })),
  })

  it('declares the settings remote required by every save path', () => {
    const entry = readFileSync(new URL('../src/client/index.ts', import.meta.url), 'utf8')
    const topLevelInject = entry.match(/export const inject = \[([\s\S]*?)\]/)?.[1]

    expect(topLevelInject).toContain("'remote.settings'")
  })

  it('uses the first returned language model', () => {
    expect(firstLanguageModel([
      { id: 'gpt-image-2', name: 'GPT Image 2' },
      { id: 'chat-primary', name: 'Chat Primary' },
      { id: 'chat-secondary', name: 'Chat Secondary' },
    ])?.id).toBe('chat-primary')
  })

  it('uses advertised capabilities for unfamiliar model names and vision models', () => {
    expect(firstLanguageModel([
      { id: 'canvas-v99', supportsConversation: false },
      { id: 'image-understanding-v99', supportsConversation: true },
    ])?.id).toBe('image-understanding-v99')
  })

  it('excludes known media models from discovery and rejects them in edited chat catalogs', async () => {
    const ctx = { remote: { llm: { discoverModels: vi.fn(async () => ({ ok: true, value: [
      { id: 'canvas-v99', supportsConversation: false },
      { id: 'vision-v99', supportsConversation: true, api: 'openai-responses' },
    ] })) }, settings: { mutate: vi.fn() } } } as never
    await expect(discoverSpiritXModels(ctx)).resolves.toEqual({ ok: true, value: [
      { id: 'vision-v99', supportsConversation: true, api: 'openai-responses' },
    ] })
    await expect(saveSpiritXModels(ctx, [
      { id: 'chat' }, { id: 'canvas-v99', supportsConversation: false },
    ])).resolves.toContain('不能包含非对话模型')
  })

  it('does not invent a default when only non-language models are returned', () => {
    expect(firstLanguageModel([
      { id: 'text-embedding-3-large' },
      { id: 'audio-transcription-1' },
    ])).toBeUndefined()
  })

  it('validates before storing and selects the first returned language model', async () => {
    const discoverModels = vi.fn(async () => ({ ok: true, value: [
      { id: 'gpt-image-2' },
      { id: 'chat-first', api: 'openai-completions', name: 'Chat First', contextWindow: 16_384 },
      { id: 'chat-second', api: 'openai-responses' },
    ] }))
    const set = vi.fn(async () => ({ ok: true, value: undefined }))
    const mutate = vi.fn(async () => ({ ok: true, value: {} }))
    const ensure = vi.fn(async () => {})
    const ctx = {
      remote: { llm: { discoverModels }, credentials: { ...writableCredential(), set }, settings: { mutate } },
      configForms: { describe: () => ({ ensure, getSnapshot: () => ({ view: { namespaces: [
        { ns: 'llm-pi-ai', revision: 2 }, { ns: 'agent-default-model', revision: 7 },
      ] } }) }) },
    } as never

    await expect(provisionSpiritX(ctx, '  secret  ')).resolves.toBeUndefined()
    expect(discoverModels).toHaveBeenCalledWith('llm-pi-ai', expect.objectContaining({ apiKey: 'secret' }))
    expect(mutate).toHaveBeenNthCalledWith(1, 'llm-pi-ai', [{
      op: 'set', path: ['providers', 'spiritx'], value: expect.objectContaining({
        setupPending: false,
        models: [
          { id: 'chat-first', api: 'openai-completions', name: 'Chat First', contextWindow: 16_384 },
          { id: 'chat-second', api: 'openai-responses', name: 'chat-second' },
        ],
      }),
    }], 2)
    expect(mutate).toHaveBeenNthCalledWith(2, 'agent-default-model', [
      { op: 'set', path: ['provider'], value: 'spiritx' },
      { op: 'set', path: ['model'], value: 'chat-first' },
      { op: 'unset', path: ['reasoningEffort'] },
    ], 7)
    expect(set).toHaveBeenCalledWith('SPIRITX_API_KEY', 'secret')
    expect(mutate.mock.invocationCallOrder[1]).toBeLessThan(set.mock.invocationCallOrder[0]!)
  })

  it('does not store the key when either settings write fails', async () => {
    const set = vi.fn()
    const mutate = vi.fn()
      .mockResolvedValueOnce({ ok: true, value: {} })
      .mockResolvedValueOnce({ ok: false, error: { message: 'default conflict' } })
    const ctx = {
      remote: {
        llm: { discoverModels: vi.fn(async () => ({ ok: true, value: [{ id: 'chat-first' }] })) },
        credentials: { ...writableCredential(), set }, settings: { mutate },
      },
      configForms: { describe: () => ({
        ensure: vi.fn(async () => {}),
        getSnapshot: () => ({ view: { namespaces: [
          { ns: 'llm-pi-ai', revision: 2 }, { ns: 'agent-default-model', revision: 7 },
        ] } }),
      }) },
    } as never

    await expect(provisionSpiritX(ctx, 'secret')).resolves.toBe('default conflict')
    expect(set).not.toHaveBeenCalled()
  })

  it('does not store a rejected key or change settings', async () => {
    const set = vi.fn()
    const mutate = vi.fn()
    const ctx = {
      remote: {
        llm: { discoverModels: vi.fn(async () => ({ ok: false, error: { message: 'unauthorized' } })) },
        credentials: { ...writableCredential(), set }, settings: { mutate },
      },
    } as never
    await expect(provisionSpiritX(ctx, 'wrong')).resolves.toBe('unauthorized')
    expect(set).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('rejects a read-only launch credential before discovery or settings changes', async () => {
    const discoverModels = vi.fn()
    const mutate = vi.fn()
    const set = vi.fn()
    const ctx = {
      remote: {
        llm: { discoverModels },
        credentials: {
          describe: vi.fn(async () => ({
            ok: true, value: { SPIRITX_API_KEY: { configured: true, writable: false } },
          })),
          set,
        },
        settings: { mutate },
      },
    } as never

    await expect(provisionSpiritX(ctx, 'replacement')).resolves.toContain('系统环境变量 SPIRITX_API_KEY')
    expect(discoverModels).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
    expect(set).not.toHaveBeenCalled()
  })

  it('uses the stored credential for refresh and passes a typed replacement key explicitly', async () => {
    const discoverModels = vi.fn(async () => ({ ok: true, value: [{ id: 'chat-first' }] }))
    const ctx = { remote: { llm: { discoverModels } } } as never

    await expect(discoverSpiritXModels(ctx)).resolves.toEqual({
      ok: true, value: [{ id: 'chat-first' }],
    })
    await expect(discoverSpiritXModels(ctx, ' replacement ')).resolves.toMatchObject({ ok: true })

    expect(discoverModels).toHaveBeenNthCalledWith(1, 'llm-pi-ai', {
      provider: 'spiritx', baseURL: 'https://ai.xzinfra.com/spiritx-api/v1', api: 'openai-responses',
    })
    expect(discoverModels).toHaveBeenNthCalledWith(2, 'llm-pi-ai', expect.objectContaining({
      provider: 'spiritx', apiKey: 'replacement', api: 'openai-responses',
    }))
  })

  it('loads the effective SpiritX endpoint and model catalog', async () => {
    const ensure = vi.fn(async () => {})
    const ctx = { configForms: { describe: () => ({
      ensure,
      getSnapshot: () => ({ view: { namespaces: [{
        ns: 'llm-pi-ai', revision: 2, value: { providers: { spiritx: {
          baseURL: 'https://example.test/v1',
          models: [{ id: 'chat-first', api: 'openai-completions', name: 'Chat First', contextWindow: 8192, input: ['text'] }],
        } } },
      }] } }),
    }) } } as never

    await expect(loadSpiritXProfile(ctx)).resolves.toEqual({ ok: true, value: {
      baseURL: 'https://example.test/v1',
      models: [{ id: 'chat-first', api: 'openai-completions', name: 'Chat First', contextWindow: 8192, input: ['text'] }],
    } })
    expect(ensure).toHaveBeenCalledOnce()
  })

  it('does not treat a stored key as a usable model profile', async () => {
    const snapshots = [
      { ns: 'llm-pi-ai', revision: 2, value: { providers: {} } },
      { ns: 'llm-pi-ai', revision: 3, value: { providers: { spiritx: {
        apiKeyEnv: 'SPIRITX_API_KEY', api: 'openai-responses', baseURL: 'https://ai.xzinfra.com/spiritx-api/v1',
        models: [{ id: 'chat-first' }],
      } } } },
    ]
    const current = { value: snapshots[0] }
    const ctx = { configForms: { describe: () => ({
      ensure: vi.fn(async () => {}),
      getSnapshot: () => ({ view: { namespaces: [current.value] } }),
    }) } } as never

    await expect(hasUsableSpiritXProfile(ctx)).resolves.toBe(false)
    current.value = snapshots[1]!
    await expect(hasUsableSpiritXProfile(ctx)).resolves.toBe(true)
  })

  it('preserves edited models while validating and replacing the key', async () => {
    const mutate = vi.fn(async () => ({ ok: true, value: {} }))
    const set = vi.fn(async () => ({ ok: true, value: undefined }))
    const ctx = {
      remote: {
        llm: { discoverModels: vi.fn(async () => ({ ok: true, value: [{ id: 'edited-chat', api: 'openai-completions' }] })) },
        credentials: { ...writableCredential(), set }, settings: { mutate },
      },
      configForms: { describe: () => ({
        ensure: vi.fn(async () => {}),
        getSnapshot: () => ({ view: { namespaces: [
          { ns: 'llm-pi-ai', revision: 2 }, { ns: 'agent-default-model', revision: 7 },
        ] } }),
      }) },
    } as never

    await expect(provisionSpiritX(ctx, 'new-secret', [
      { id: ' edited-chat ', api: 'openai-responses', name: 'Edited Chat' },
    ])).resolves.toBeUndefined()
    expect(mutate).toHaveBeenNthCalledWith(1, 'llm-pi-ai', [expect.objectContaining({
      value: expect.objectContaining({ models: [{ id: 'edited-chat', api: 'openai-completions', name: 'Edited Chat' }] }),
    })], 2)
    expect(mutate).toHaveBeenNthCalledWith(2, 'agent-default-model', expect.arrayContaining([
      { op: 'set', path: ['model'], value: 'edited-chat' },
    ]), 7)
  })

  it('saves model-only edits and repairs a stale SpiritX default', async () => {
    const mutate = vi.fn(async () => ({ ok: true, value: {} }))
    const ctx = {
      remote: { settings: { mutate } },
      configForms: { describe: () => ({
        ensure: vi.fn(async () => {}),
        getSnapshot: () => ({ view: { namespaces: [
          { ns: 'llm-pi-ai', revision: 4, value: {} },
          { ns: 'agent-default-model', revision: 8, value: { provider: 'spiritx', model: 'removed' } },
        ] } }),
      }) },
    } as never

    await expect(saveSpiritXModels(ctx, [
      { id: 'chat-first', api: 'openai-completions', name: 'Chat First' }, { id: 'chat-second' },
    ])).resolves.toBeUndefined()
    expect(mutate).toHaveBeenNthCalledWith(1, 'llm-pi-ai', [{
      op: 'set', path: ['providers', 'spiritx', 'models'], value: [
        { id: 'chat-first', api: 'openai-completions', name: 'Chat First' }, { id: 'chat-second' },
      ],
    }], 4)
    expect(mutate).toHaveBeenNthCalledWith(2, 'agent-default-model', [
      { op: 'set', path: ['provider'], value: 'spiritx' },
      { op: 'set', path: ['model'], value: 'chat-first' },
      { op: 'unset', path: ['reasoningEffort'] },
    ], 8)
  })

  it('rejects an empty model catalog before changing persisted settings', async () => {
    const mutate = vi.fn()
    const ctx = { remote: { settings: { mutate } } } as never

    await expect(saveSpiritXModels(ctx, [])).resolves.toContain('至少需要一个')
    expect(mutate).not.toHaveBeenCalled()
  })
})


describe('SpiritX legacy protocol sync', () => {
  function fixture(baseURL = 'https://ai.xzinfra.com/spiritx-api/v1', ok = true) {
    const mutate = vi.fn(async () => ({ ok: true, value: {} }))
    const discoverModels = vi.fn(async () => ok ? { ok: true, value: [
      { id: 'GLM-5.3', api: 'openai-completions' },
      { id: 'gpt-6.1-sol', api: 'openai-responses' },
      { id: 'explicit', api: 'openai-completions' },
    ] } : { ok: false, error: { message: 'offline' } })
    const ctx = {
      remote: { llm: { discoverModels }, settings: { mutate } },
      configForms: { describe: () => ({ ensure: async () => {}, getSnapshot: () => ({ view: { namespaces: [{
        ns: 'llm-pi-ai', revision: 12, value: { providers: { spiritx: {
          api: 'openai-responses', apiKeyEnv: 'SPIRITX_API_KEY', baseURL,
          models: [{ id: 'GLM-5.3', name: 'Custom GLM', maxTokens: 1234 }, { id: 'gpt-6.1-sol' },
            { id: 'explicit', api: 'anthropic-messages' }, { id: 'unknown' }],
        } } },
      }] } }) }) },
    } as never
    return { ctx, mutate, discoverModels }
  }

  it('refreshes changed protocols from live metadata without changing catalogs or defaults', async () => {
    const { ctx, mutate } = fixture()
    await syncSpiritXModelProtocols(ctx)
    expect(mutate).toHaveBeenCalledExactlyOnceWith('llm-pi-ai', [
      { op: 'set', path: ['providers', 'spiritx', 'models', '0', 'api'], value: 'openai-completions' },
      { op: 'set', path: ['providers', 'spiritx', 'models', '1', 'api'], value: 'openai-responses' },
      { op: 'set', path: ['providers', 'spiritx', 'models', '2', 'api'], value: 'openai-completions' },
    ], 12)
  })

  it('leaves custom endpoints alone', async () => {
    const { ctx, mutate, discoverModels } = fixture('https://custom.example/v1')
    await syncSpiritXModelProtocols(ctx)
    expect(discoverModels).not.toHaveBeenCalled()
    expect(mutate).not.toHaveBeenCalled()
  })

  it('preserves working configuration when discovery is unavailable', async () => {
    const { ctx, mutate } = fixture(undefined, false)
    await syncSpiritXModelProtocols(ctx)
    expect(mutate).not.toHaveBeenCalled()
  })
})


describe('SpiritX non-conversation migration', () => {
  it('disables a legacy image entry and repairs an image default without deleting model configuration', async () => {
    const mutate = vi.fn(async () => ({ ok: true, value: {} }))
    const ctx = {
      remote: { settings: { mutate }, llm: { discoverModels: vi.fn(async () => ({ ok: true, value: [
        { id: 'canvas-v99', supportsConversation: false },
        { id: 'chat-v99', supportsConversation: true, api: 'openai-responses' },
      ] })) } },
      configForms: { describe: () => ({ ensure: async () => {}, getSnapshot: () => ({ view: { namespaces: [
        { ns: 'llm-pi-ai', revision: 12, value: { providers: { spiritx: {
          baseURL: 'https://ai.xzinfra.com/spiritx-api/v1', api: 'openai-responses', apiKeyEnv: 'SPIRITX_API_KEY',
          models: [{ id: 'canvas-v99' }, { id: 'chat-v99', api: 'openai-responses' }],
        } } } },
        { ns: 'agent-default-model', revision: 3, value: { provider: 'spiritx', model: 'canvas-v99' } },
      ] } }) }) },
    } as never
    await syncSpiritXModelProtocols(ctx)
    expect(mutate).toHaveBeenNthCalledWith(1, 'llm-pi-ai', [
      { op: 'set', path: ['providers', 'spiritx', 'models', '0', 'supportsConversation'], value: false },
      { op: 'set', path: ['providers', 'spiritx', 'models', '1', 'supportsConversation'], value: true },
    ], 12)
    expect(mutate).toHaveBeenNthCalledWith(2, 'agent-default-model', [
      { op: 'set', path: ['provider'], value: 'spiritx' },
      { op: 'set', path: ['model'], value: 'chat-v99' },
      { op: 'unset', path: ['reasoningEffort'] },
    ], 3)
  })
})
