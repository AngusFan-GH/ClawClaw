// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { describe, expect, it, vi } from 'vitest'
import { ShortcutSettingsShell } from '../src/client/shortcut-presentation.tsx'
import { ShortcutSettingsPanel, type ShortcutTarget } from '../src/client/shortcut-menu.tsx'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

const targets: readonly ShortcutTarget[] = [
  { id: 'plugins', targetId: 'plugins', label: 'Plugins', kind: 'panel' },
  { id: 'desktop-automations', targetId: 'desktop-automations', label: 'Automations', kind: 'panel' },
  { id: 'settings:general', targetId: 'general', label: 'General', kind: 'settings' },
  { id: 'settings:models', targetId: 'models', label: 'Models', kind: 'settings' },
]

describe('shortcut hosts', () => {
  it('filters pinned entries before modal selection and restores them when unpinned', () => {
    const rows = [
      { id: 'general', label: 'General', order: 0 },
      { id: 'models', label: 'Models', order: 1 },
      { id: 'desktop-panel:plugins', label: 'Plugins', order: 1000 },
      { id: 'desktop-panel:desktop-automations', label: 'Automations', order: 1001 },
    ]
    let snapshot = { value: { items: ['plugins', 'settings:general'] } }
    const listeners = new Set<() => void>()
    const settings = { getSnapshot: () => snapshot, subscribe: (listener: () => void) => {
      listeners.add(listener); return () => { listeners.delete(listener) }
    } }
    type Rows = typeof rows
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    // The upstream shell selects the first visible row if its active id vanished.
    const Shell = ({ useSections }: { useSections: (select: (value: Rows) => Rows) => Rows }) => {
      const visible = useSections(rows => rows)
      return createElement('div', { role: 'dialog' },
        ...visible.map(row => createElement('button', { key: row.id }, row.label)),
        createElement('article', {}, visible.find(row => row.id === 'general')?.label ?? visible[0]?.label))
    }
    act(() => { root.render(createElement(ShortcutSettingsShell, {
      sectionComponent: Shell,
      useSections: (selector: (value: Rows) => unknown) => selector(rows),
      shortcutSettings: settings,
      shortcutTargets: { getSnapshot: () => targets, subscribe: () => () => {} },
    } as never)) })
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['Models', 'Automations'])
    expect(host.querySelector('article')?.textContent).toBe('Models')
    act(() => { snapshot = { value: { items: ['desktop-automations'] } }; listeners.forEach(listener => { listener() }) })
    expect([...host.querySelectorAll('button')].map(button => button.textContent)).toEqual(['General', 'Models', 'Plugins'])
    act(() => { root.unmount() })
    expect(listeners.size).toBe(0)
    host.remove()
  })

  it('renders the original section inline with its runtime props and page close action', () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const close = vi.fn()
    const Section = ({ marker, close }: { marker: string; close: () => void }) => createElement('button', { onClick: close }, marker)
    act(() => { root.render(createElement(ShortcutSettingsPanel, {
      sectionComponent: Section, returnToConversation: close, marker: 'feature state',
    } as never)) })
    expect(host.querySelector('main')?.textContent).toBe('feature state')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    act(() => { host.querySelector('button')!.click() })
    expect(close).toHaveBeenCalledOnce()
    act(() => { root.unmount() })
    host.remove()
  })
})
