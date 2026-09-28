import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { whenPluginManagerReady, withoutSidebarPanelRegistration } from '../src/client/plugin-manager-context.ts'

describe('managed Plugins panel', () => {
  it('waits for the Desktop-owned layout without making it a static dependency', () => {
    const inject = vi.fn()
    const ctx = { inject } as unknown as ClientContext
    const install = vi.fn()

    whenPluginManagerReady(ctx, install)

    expect(inject).toHaveBeenCalledWith([
      'layout',
      'remote.pluginManager',
      'remote.pluginInventory',
      'remote.pluginRegistryProbe',
    ], install)
  })

  it('suppresses only the upstream fixed sidebar registration', () => {
    const dispose = vi.fn()
    const inject = vi.fn(() => dispose)
    const ctx = { slots: { inject } } as unknown as ClientContext
    const managed = withoutSidebarPanelRegistration(ctx)
    const setup = vi.fn()

    expect(managed.slots.inject('sidebar.panellist', setup)).toBeTypeOf('function')
    expect(inject).not.toHaveBeenCalled()
    expect(setup).not.toHaveBeenCalled()

    expect(managed.slots.inject('main', setup)).toBe(dispose)
    expect(inject).toHaveBeenCalledWith('main', setup)
  })
})
