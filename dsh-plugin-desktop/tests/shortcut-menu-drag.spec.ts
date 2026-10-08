// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ShortcutSettingsRow, type ShortcutTarget } from '../src/client/shortcut-menu.tsx'

;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true

describe('Desktop shortcut drag interaction', () => {
  const roots: Array<ReturnType<typeof createRoot>> = []

  afterEach(() => {
    roots.splice(0).forEach(root => { act(() => { root.unmount() }) })
    document.body.replaceChildren()
  })

  it('uses the whole row and persists a drop at the hovered row half', () => {
    const items = ['plugins', 'desktop-automations', 'settings:clawclaw-experts']
    const settingsSnapshot = { value: { items } }
    const shortcutSettings = {
      getSnapshot: vi.fn(() => settingsSnapshot),
      subscribe: vi.fn(() => vi.fn()),
      set: vi.fn(),
    }
    const targets: readonly ShortcutTarget[] = [
      { id: 'plugins', targetId: 'plugins', label: 'Plugins', kind: 'panel' },
      { id: 'desktop-automations', targetId: 'desktop-automations', label: 'Automations', kind: 'panel' },
      { id: 'settings:clawclaw-experts', targetId: 'clawclaw-experts', label: 'Experts & Capabilities', kind: 'settings' },
    ]
    const shortcutTargets = {
      getSnapshot: () => targets,
      subscribe: () => vi.fn(),
    }
    const container = document.createElement('div')
    document.body.append(container)
    const root = createRoot(container)
    roots.push(root)

    act(() => {
      root.render(createElement(ShortcutSettingsRow, {
        t: (key: string) => key,
        shortcutSettings,
        shortcutTargets,
      } as never))
    })

    const rows = [...container.querySelectorAll<HTMLElement>('.dshShortcutSelectedRow')]
    expect(rows).toHaveLength(3)
    expect(rows.every(row => row.draggable)).toBe(true)
    expect(container.querySelector('.dshShortcutDragHandle')).toBeNull()

    const dataTransfer = { effectAllowed: 'none', dropEffect: 'none', setData: vi.fn() }
    const dispatchDrag = (row: HTMLElement, type: string, clientY: number): void => {
      const event = new MouseEvent(type, { bubbles: true, cancelable: true, clientY })
      Object.defineProperty(event, 'dataTransfer', { value: dataTransfer })
      act(() => { row.dispatchEvent(event) })
    }
    rows[2]!.getBoundingClientRect = () => ({ top: 80, height: 40 }) as DOMRect

    dispatchDrag(rows[0]!, 'dragstart', 10)
    dispatchDrag(rows[2]!, 'dragover', 110)
    expect(rows[2]?.getAttribute('data-drop-position')).toBe('after')
    dispatchDrag(rows[2]!, 'drop', 110)

    expect(shortcutSettings.set).toHaveBeenCalledWith('items', [
      'desktop-automations', 'settings:clawclaw-experts', 'plugins',
    ])
  })
})
