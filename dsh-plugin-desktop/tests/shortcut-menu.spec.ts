import { describe, expect, it, vi } from 'vitest'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import {
  applyShortcutMenu,
  normalizeShortcutItems,
  openSettingsSection,
  reorderShortcutItems,
  shortcutPanelId,
} from '../src/client/shortcut-menu.tsx'
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

  it('opens a section through the Settings root store', () => {
    const openSection = vi.fn()
    const ctx = {
      slots: {
        entriesOfSlot: vi.fn(() => [{
          store: { create: () => ({ actions: { openSection } }) },
        }]),
      },
    } as unknown as ClientContext

    expect(openSettingsSection(ctx, 'desktop-skills')).toBe(true)
    expect(openSection).toHaveBeenCalledWith('desktop-skills')
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

  it('returns false while the Settings root store is unavailable', () => {
    const ctx = {
      slots: { entriesOfSlot: vi.fn(() => []) },
    } as unknown as ClientContext

    expect(openSettingsSection(ctx, 'desktop')).toBe(false)
  })

  it('registers direct panel shortcuts and redirecting Settings shortcuts', () => {
    const registrations: Array<Record<string, unknown>> = []
    const disposers: Array<ReturnType<typeof vi.fn>> = []
    const settingsListeners = new Set<() => void>()
    const sectionListeners = new Set<() => void>()
    const shortcutSettings = {
      getSnapshot: vi.fn(() => ({ value: { items: ['plugins', 'desktop-reminders', 'missing', 'desktop'] } })),
      subscribe: vi.fn((listener: () => void) => { settingsListeners.add(listener); return () => { settingsListeners.delete(listener) } }),
      set: vi.fn(),
    }
    const sections = [
      { options: { id: 'desktop', order: 100, label: 'Desktop settings' } },
      { options: { id: 'desktop-reminders', order: 50, label: 'Reminders' } },
    ]
    const panels = [{ options: { key: 'plugins' } }, { options: { key: 'desktop-automations' } }]
    const slots = {
      entries: vi.fn((name: string) => name === 'settings.section' ? sections : []),
      entriesOfSlot: vi.fn((name: string) => name === 'main' ? panels : []),
      getVersion: vi.fn(() => 1),
      subscribe: vi.fn((_name: string, listener: () => void) => { sectionListeners.add(listener); return () => { sectionListeners.delete(listener) } }),
      inject: vi.fn((_name: string, install: () => () => void) => install()),
      register: vi.fn((definition: Record<string, unknown>) => {
        registrations.push(definition)
        const dispose = vi.fn()
        disposers.push(dispose)
        if (definition.name === 'main') {
          sectionListeners.forEach(listener => { listener() })
        }
        return dispose
      }),
    }
    const cleanups: Array<() => void> = []
    const ctx = {
      configForms: { get: vi.fn(() => shortcutSettings) },
      effect: vi.fn((install: () => (() => void) | void) => {
        const dispose = install()
        if (typeof dispose === 'function') cleanups.push(dispose)
      }),
      inject: vi.fn((_services: string[], install: (scope: ClientContext) => void) => { install(ctx as unknown as ClientContext) }),
      layout: { selectPanel: vi.fn() },
      locale: {
        bind: vi.fn(() => (key: string) => ({ plugins: 'Plugins', automations: 'Automations' })[key] ?? key),
        getSnapshot: vi.fn(() => ({ revision: 1 })),
        register: vi.fn(() => vi.fn()),
        subscribe: vi.fn(() => vi.fn()),
      },
      slots,
    } as unknown as ClientContext

    applyShortcutMenu(ctx)

    expect(ctx.configForms.get).toHaveBeenCalledWith('desktop-shortcuts')
    expect(registrations).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'settings.general.item', id: 'desktop-shortcuts' }),
      expect.objectContaining({ name: 'settings.action', id: 'desktop-semantic-nav-icons' }),
      expect.objectContaining({ name: 'sidebar.panellist', id: 'plugins', order: 100, label: 'Plugins' }),
      expect.objectContaining({ name: 'main', key: shortcutPanelId('desktop-reminders') }),
      expect.objectContaining({ name: 'sidebar.panellist', id: shortcutPanelId('desktop-reminders'), order: 101, label: 'Reminders' }),
      expect.objectContaining({ name: 'main', key: shortcutPanelId('desktop') }),
      expect.objectContaining({ name: 'sidebar.panellist', id: shortcutPanelId('desktop'), order: 102, label: 'Desktop settings' }),
    ]))
    expect(registrations.some(item => item.name === 'main' && item.key === 'plugins')).toBe(false)
    expect(registrations.some(item => item.id === shortcutPanelId('missing'))).toBe(false)
    expect(registrations).toHaveLength(7)

    cleanups.reverse().forEach(dispose => { dispose() })
    expect(disposers.slice(2).every(dispose => dispose.mock.calls.length > 0)).toBe(true)
  })
})
