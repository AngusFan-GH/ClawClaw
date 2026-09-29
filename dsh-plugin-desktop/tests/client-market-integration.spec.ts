import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { applyMarketIntegration } from '../src/client/market-integration.tsx'

describe('Desktop plugin market integration', () => {
  it('moves an available market from Settings into the Plugins page for its lifetime', () => {
    const setSettingsVisible = vi.fn()
    const disposers: Array<() => void> = []
    const registrations: Array<Record<string, unknown>> = []
    const ctx = {
      market: {
        version: 1,
        setSettingsVisible,
        settingsVisible: () => false,
        render: vi.fn(),
      },
      locale: {
        register: vi.fn(),
        bind: () => (key: string) => key === 'label' ? 'Plugin Marketplace' : key,
      },
      effect: vi.fn((mount: () => void | (() => void)) => {
        const dispose = mount()
        if (typeof dispose === 'function') disposers.push(dispose)
      }),
      inject: vi.fn((_services: string[], install: (scope: ClientContext) => void) => {
        install(ctx as unknown as ClientContext)
      }),
      slots: {
        inject: vi.fn((_name: string, install: () => void) => { install() }),
        register: vi.fn((definition: Record<string, unknown>) => { registrations.push(definition) }),
      },
    } as unknown as ClientContext

    applyMarketIntegration(ctx)

    expect(setSettingsVisible).toHaveBeenCalledWith(false)
    expect(registrations).toEqual([
      expect.objectContaining({
        name: 'plugins.item', id: 'desktop-marketplace', order: 0,
        locale: 'desktop.market-integration',
      }),
    ])

    disposers.reverse().forEach(dispose => { dispose() })
    expect(setSettingsVisible).toHaveBeenLastCalledWith(true)
  })

  it('waits for the optional market service before registering the marketplace item', () => {
    const inject = vi.fn()
    const register = vi.fn()
    applyMarketIntegration({
      effect: vi.fn(), inject, slots: { register }, locale: { register: vi.fn() },
    } as unknown as ClientContext)

    expect(inject).toHaveBeenCalledWith(['market'], expect.any(Function))
    expect(register).not.toHaveBeenCalled()
  })
})
