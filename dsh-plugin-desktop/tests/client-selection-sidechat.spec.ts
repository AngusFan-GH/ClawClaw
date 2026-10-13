// @vitest-environment jsdom
import type { Context } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { applySelectionSideChat, startSelectionSideChat } from '../src/client/selection-sidechat.tsx'

describe('selection side chat client', () => {
  it('registers a native right-sidebar tab body and title', () => {
    const registerTab = vi.fn(() => () => undefined)
    const registerSlot = vi.fn(() => () => undefined)
    const injectSlot = vi.fn((_name: string, install: () => unknown) => install())
    const effect = vi.fn((install: () => unknown) => install())
    const ctx = {
      effect,
      inject: vi.fn((_faces: readonly string[], install: (scope: Context) => unknown) => install(ctx as unknown as Context)),
      sidebarRight: { openTab: vi.fn() },
      sidebarRightTabs: { register: registerTab },
      slots: { inject: injectSlot, register: registerSlot },
    } as unknown as Context

    applySelectionSideChat(ctx)

    expect(registerTab).toHaveBeenCalledWith(expect.objectContaining({ id: 'desktop-selection-sidechat', kind: 'desktop-selection-sidechat', keepMounted: true }))
    expect(injectSlot).toHaveBeenCalledWith('sidebar.right.pane.tab', expect.any(Function))
    expect(injectSlot).toHaveBeenCalledWith('sidebar.right.pane.tab.title', expect.any(Function))
    expect(registerSlot).toHaveBeenCalledWith(expect.objectContaining({ name: 'sidebar.right.pane.tab', key: 'desktop-selection-sidechat' }), expect.any(Function))
    expect(registerSlot).toHaveBeenCalledWith(expect.objectContaining({ name: 'sidebar.right.pane.tab.title', key: 'desktop-selection-sidechat' }), expect.any(Function))
  })

  it('opens the side chat without touching the main composer', () => {
    const openTab = vi.fn()
    startSelectionSideChat({ sidebarRight: { openTab } } as unknown as Context, 'session-1', {
      text: 'selected text', left: 10, top: 20, bottom: 30,
    })
    expect(openTab).toHaveBeenCalledWith('desktop-selection-sidechat')
  })
})
