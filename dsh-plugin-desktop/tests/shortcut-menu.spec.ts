import { describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  applyShortcutMenu,
  normalizeShortcutItems,
  reorderShortcutItems,
  shortcutPanelId,
} from '../src/client/shortcut-menu.tsx'
import { SlotCore } from '@deepseek-ai/dsh-client-ui-slots'
import { ShortcutSettingsPanel } from '../src/client/shortcut-menu.tsx'
import { registerEntryProjection, ShortcutSettingsShell } from '../src/client/shortcut-presentation.tsx'
import { DesktopShortcutSettingsSchema } from '../src/shortcut-menu.ts'

describe('Desktop sidebar shortcuts', () => {
  it('uses panel and Settings targets as defaults and filters stale or duplicate entries', () => {
    const targets = [
      { id: 'plugins', targetId: 'plugins', label: 'Plugins', kind: 'panel' as const },
      { id: 'desktop-automations', targetId: 'desktop-automations', label: 'Automations', kind: 'panel' as const },
      { id: 'settings:plugins', targetId: 'plugins', label: 'Built-in plugins', kind: 'settings' as const },
      { id: 'settings:clawclaw-experts', targetId: 'clawclaw-experts', label: 'Experts & Capabilities', kind: 'settings' as const },
      { id: 'settings:desktop-reminders', targetId: 'desktop-reminders', label: 'Reminders', kind: 'settings' as const },
      { id: 'settings:desktop', targetId: 'desktop', label: 'Desktop', kind: 'settings' as const },
    ]

    expect(DesktopShortcutSettingsSchema({} as { items: string[] })).toEqual({
      items: ['plugins', 'desktop-automations', 'desktop-skills', 'desktop-reminders'],
    })
    expect(normalizeShortcutItems(undefined, targets)).toEqual([
      'plugins', 'desktop-automations', 'settings:clawclaw-experts', 'settings:desktop-reminders',
    ])
    expect(normalizeShortcutItems([
      'desktop-skills', 'desktop-cron-tasks', 'desktop-reminders',
    ], targets)).toEqual(['plugins', 'desktop-automations', 'settings:clawclaw-experts', 'settings:desktop-reminders'])
    expect(normalizeShortcutItems([
      'desktop-reminders', 'desktop-cron-tasks',
    ], targets)).toEqual(['settings:desktop-reminders', 'desktop-automations'])
    expect(normalizeShortcutItems([
      'desktop-reminders', 'missing', 'desktop-reminders', 'desktop-skills', 'desktop', 'extra',
    ], targets)).toEqual(['settings:desktop-reminders', 'settings:clawclaw-experts', 'settings:desktop'])
    expect(normalizeShortcutItems(['plugins', 'settings:plugins'], targets))
      .toEqual(['plugins', 'settings:plugins'])
  })

  it('reorders pinned shortcuts at the requested drop edge', () => {
    const items = ['plugins', 'desktop-automations', 'settings:desktop-skills', 'settings:desktop-reminders']

    expect(reorderShortcutItems(items, 'plugins', 'settings:desktop-skills', 'after')).toEqual([
      'desktop-automations', 'settings:desktop-skills', 'plugins', 'settings:desktop-reminders',
    ])
    expect(reorderShortcutItems(items, 'settings:desktop-reminders', 'desktop-automations', 'before')).toEqual([
      'plugins', 'settings:desktop-reminders', 'desktop-automations', 'settings:desktop-skills',
    ])
    expect(reorderShortcutItems(items, 'plugins', 'plugins', 'before')).toBe(items)
    expect(reorderShortcutItems(items, 'missing', 'plugins', 'before')).toBe(items)
  })

})

function harness() {
  const core = new SlotCore()
  const cleanups: Array<() => void> = []
  const register = (options: Record<string, unknown>, component: unknown = () => null) => core.register(options as never, component as never)
  register({ name: 'root', children: {
    main: { kind: 'keyed', scope: 'root' },
    'sidebar.settings': { kind: 'single', scope: 'root' },
    'sidebar.panellist': { kind: 'list', scope: 'root' },
  } })
  const Shell = () => null
  register({ name: 'sidebar.settings', children: {
    'settings.section': { kind: 'list', scope: 'root' },
    'settings.action': { kind: 'list', scope: 'root' },
  } }, Shell)
  const Section = () => null
  const actions = { save: vi.fn() }
  const store = { create: () => ({ actions }) }
  register({ name: 'settings.section', id: 'general', label: 'General', locale: 'settings', store,
    inject: () => ({ marker: 'general' }), children: { 'settings.general.item': { kind: 'list', scope: 'root' } },
  }, Section)
  register({ name: 'settings.section', id: 'desktop-reminders', label: 'Reminders', order: 50 }, Section)
  register({ name: 'main', key: 'plugins', children: { 'plugins.item': { kind: 'list', scope: 'root' } } })
  register({ name: 'plugins.item', id: 'feature' })
  const removeAutomation = register({ name: 'main', key: 'desktop-automations' })
  let snapshot = { value: { items: ['plugins', 'settings:general'] } }
  const listeners = new Set<() => void>()
  const shortcutSettings = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } },
    set: vi.fn(),
  }
  const ctx = {
    slots: {
      register,
      entries: (name: string) => core.entries(name),
      entriesOfSlot: (name: string) => core.entriesOfSlot(name),
      getVersion: (name: string) => core.getVersion(name),
      subscribe: (name: string, listener: () => void) => core.subscribe(name, listener),
      inject: (_name: string, install: () => (() => void) | Iterable<() => void>) => {
        const result = install()
        if (typeof result === 'function') return result
        const disposers = [...result]
        return () => { disposers.reverse().forEach(dispose => { dispose() }) }
      },
    },
    configForms: { get: () => shortcutSettings },
    effect: (install: () => (() => void) | void) => { const cleanup = install(); if (cleanup) cleanups.push(cleanup); return cleanup },
    inject: (_names: string[], install: (scope: ClientContext) => void) => install(ctx as unknown as ClientContext),
    layout: { selectPanel: vi.fn() },
    locale: { bind: () => (key: string) => key, getSnapshot: () => ({ revision: 1 }), register: () => () => {}, subscribe: () => () => {} },
  } as unknown as ClientContext
  applyShortcutMenu(ctx)
  return { core, ctx, Section, store, removeAutomation,
    update: (items: string[]) => { snapshot = { value: { items } }; listeners.forEach(listener => { listener() }) },
    dispose: () => { cleanups.reverse().forEach(cleanup => { cleanup() }) },
  }
}

describe('shortcut presentation lifecycle', () => {
  it('shares feature state in real pages and adds native panels to the modal', async () => {
    const h = harness()
    await Promise.resolve()
    const page = h.core.entriesOfSlot('main').find(entry => entry.options.key === shortcutPanelId('general'))!
    expect(page.component).toBe(ShortcutSettingsPanel)
    expect(page.locale).toBe('settings')
    expect(page.store).toBe(h.store)
    expect(page.inject?.()).toMatchObject({ sectionComponent: h.Section, marker: 'general' })
    expect(h.core.entriesOfSlot('sidebar.settings')[0]?.component).toBe(ShortcutSettingsShell)
    expect(h.core.entriesOfSlot('settings.section').map(entry => entry.options.id)).toEqual([
      'general', 'desktop-reminders', 'desktop-panel:plugins', 'desktop-panel:desktop-automations',
    ])
    expect(h.core.entriesOfSlot('sidebar.panellist').map(entry => entry.options.id)).toEqual(['plugins', shortcutPanelId('general')])

    h.update(['plugins', 'settings:general', 'settings:desktop-reminders'])
    expect(h.core.entriesOfSlot('main').find(entry => entry.options.key === shortcutPanelId('general'))).toBe(page)
    h.update([])
    await Promise.resolve()
    expect(h.core.entriesOfSlot('main').some(entry => entry.options.key === shortcutPanelId('general'))).toBe(false)
    expect(h.core.entriesOfSlot('settings.general.item').some(entry => entry.options.id === 'desktop-shortcuts')).toBe(true)
    expect(h.core.entriesOfSlot('plugins.item')).toHaveLength(1)
    h.update(['settings:general'])
    expect(h.core.entriesOfSlot('settings.general.item')).toHaveLength(1)
    h.dispose()
    expect(h.core.entriesOfSlot('plugins.item')).toHaveLength(1)
    expect(h.core.entriesOfSlot('settings.general.item')).toHaveLength(1)
    expect(h.core.entriesOfSlot('sidebar.settings')[0]?.component).not.toBe(ShortcutSettingsShell)
  })

  it('removes stale adapters when a feature unloads', async () => {
    const h = harness()
    h.update(['desktop-automations'])
    h.removeAutomation()
    await vi.waitFor(() => {
      expect(h.core.entriesOfSlot('settings.section').some(entry => entry.options.id === 'desktop-panel:desktop-automations')).toBe(false)
      expect(h.core.entriesOfSlot('sidebar.panellist')).toHaveLength(0)
    })
    h.dispose()
  })
})

describe('presentation alias fiber ownership', () => {
  it('keeps source children when a dynamically added alias unloads with its fiber', async () => {
    const ctx = new Context()
    const core = new SlotCore()
    const register = (options: Record<string, unknown>, component: unknown = () => null) => core.register(options as never, component as never)
    const disposeRoot = register({ name: 'root', children: {
      main: { kind: 'keyed', scope: 'root' },
      'settings.section': { kind: 'list', scope: 'root' },
    } })
    register({ name: 'settings.section', id: 'general', label: 'General', children: {
      'settings.general.item': { kind: 'list', scope: 'root' },
    } })
    register({ name: 'settings.general.item', id: 'child' })
    let scope: ClientContext = ctx
    const fiber = ctx.plugin({ apply: (child: ClientContext) => {
      scope = child.extend({ slots: {
        // SlotRegistry's register method also owns an automatic Cordis effect.
        register: (options: Record<string, unknown>, component: unknown) => child.effect(() => register(options, component)),
        entries: (name: string) => core.entries(name),
        inject: (_name: string, install: () => (() => void) | Iterable<() => void>) => child.effect(install),
      } as unknown as ClientContext['slots'] })
    } })
    await fiber
    // Mimic a pin change after startup, outside the initial effect execution.
    registerEntryProjection(scope, core.entriesOfSlot('settings.section')[0]!, { name: 'main', key: 'desktop-shortcut:general' })
    expect(core.entriesOfSlot('main')).toHaveLength(1)
    await fiber.dispose()
    expect(core.entriesOfSlot('main')).toHaveLength(0)
    expect(core.entriesOfSlot('settings.general.item')).toHaveLength(1)
    disposeRoot()
  })
})
