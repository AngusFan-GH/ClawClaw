import type { Context } from '@deepseek-ai/cordis'
import type { LlmConfigurableProvider } from '@deepseek-ai/dsh-llm'
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
  const registerAdapter = vi.fn(() => ({ replace: replaceRoutes, dispose: vi.fn() }))
  const ctx = {
    fiber: { entry: { options: { id: 'llm-pi-ai' } } },
    inject: vi.fn(), get: vi.fn(),
    on: (event: string, callback: (...args: unknown[]) => unknown) => { listeners.set(event, callback) },
    logger: { error: vi.fn() },
    llm: {
      registerAdapter,
      registerConfigurableProviders: (next: readonly LlmConfigurableProvider[]) => {
        entries = next
        return { replace: (next: readonly LlmConfigurableProvider[]) => { entries = next }, dispose: vi.fn() }
      },
      registerModelDiscovery: vi.fn(),
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
