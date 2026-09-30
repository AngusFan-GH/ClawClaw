// @vitest-environment jsdom
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { describe, expect, it, vi } from 'vitest'
import { apply } from '../src/client/index.ts'

// Keep native UI dependencies outside this browser-entry regression test.
vi.mock('../src/client/advanced-shell.ts', () => ({ applyAdvancedShell: vi.fn() }))
vi.mock('../src/client/extended-shell.ts', () => ({ applyExtendedShell: vi.fn(), applyFramedShell: vi.fn() }))
vi.mock('../src/client/desktop-settings.ts', () => ({ applyDesktopSettings: vi.fn() }))
vi.mock('../src/client/DesktopSettingsSection.tsx', () => ({ DesktopSettingsSection: vi.fn() }))
vi.mock('../src/client/DesktopTerminalSettingsAction.tsx', () => ({ DesktopTerminalSettingsAction: vi.fn() }))
vi.mock('../src/client/spiritx-onboarding.tsx', () => ({ applySpiritXOnboarding: vi.fn() }))
vi.mock('../src/client/spiritx-provider-priority.tsx', () => ({ applySpiritXProviderPriority: vi.fn() }))
vi.mock('../src/client/workspace-directory-flow.tsx', () => ({ applyWorkspaceDirectoryFlow: vi.fn() }))
vi.mock('../src/client/cron-tasks-settings.ts', () => ({ applyCronTasksSettings: vi.fn() }))
vi.mock('../src/client/reminders-settings.ts', () => ({ applyRemindersSettings: vi.fn() }))
vi.mock('../src/client/skills-settings.ts', () => ({ applySkillsSettings: vi.fn() }))
vi.mock('../src/client/experts-settings.tsx', () => ({ applyExperts: vi.fn() }))
vi.mock('../src/client/shortcut-menu.tsx', () => ({ applyShortcutMenu: vi.fn() }))
vi.mock('../src/client/plugin-manager.ts', () => ({ applyManagedPluginManager: vi.fn() }))

describe('ClawClaw product copy', () => {
  it.each([
    ['探索未至之境', 'ClawClaw，万物皆有回响', '预览版', '深度求索中...', '正在思考...'],
    ['Into the Unknown', 'ClawClaw, every thought finds an answer', 'Preview', 'Deep diving...', 'Thinking...'],
  ])('brands marker-free browser pages (%s) without native shell effects', async (hero, brandedHero, preview, thinking, brandedThinking) => {
    window.history.replaceState(null, '', '/')
    document.head.innerHTML = '<title>DSH</title><link rel="icon" href="/favicon.ico">'
    document.body.innerHTML = `<h1>${hero}</h1><span id="preview">${preview}</span>`
    const disposers: Array<() => void> = []
    const effect = vi.fn((mount: () => void | (() => void), _label: string) => {
      const dispose = mount()
      if (typeof dispose === 'function') disposers.push(dispose)
    })
    const slotInject = vi.fn()
    const inject = vi.fn()
    try {
      apply({ effect, inject, locale: { register: vi.fn() }, slots: { inject: slotInject } } as unknown as ClientContext)
      expect(document.title).toBe('ClawClaw')
      expect(document.querySelector('link[rel="icon"]')?.getAttribute('href')).toMatch(/^data:image\/png;base64,/u)
      expect(document.querySelector('h1')?.textContent).toBe(brandedHero)
      expect(document.getElementById('preview')?.style.display).toBe('none')
      expect(slotInject.mock.calls.map(([name]) => name)).toEqual(['sidebar.brand.mark', 'sidebar.brand.name'])
      expect(inject).toHaveBeenCalledWith(['market'], expect.any(Function))
      expect(effect.mock.calls.map(([, label]) => label)).toEqual([
        'dsh-plugin-desktop: ClawClaw page identity',
        'dsh-plugin-desktop: market integration dictionaries',
        'dsh-plugin-desktop: shortcut menu styles',
      ])

      const status = document.createElement('p')
      status.textContent = thinking
      document.body.append(status)
      await Promise.resolve()
      expect(status.textContent).toBe(brandedThinking)
    } finally {
      disposers.forEach(dispose => { dispose() })
      document.head.replaceChildren()
      document.body.replaceChildren()
    }
  })

})
