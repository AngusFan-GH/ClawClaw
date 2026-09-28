// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import {
  IconAgentPresetOutlineMedium,
  IconClockOutlineRegular,
  IconDataOutlineMedium,
  IconListPenOutlineMedium,
  IconPersonalizationOutlineMedium,
  IconPluginPinwheelOutlineRegular,
  IconSettingsOutlineMedium,
  IconSkillOutlineMedium,
} from '@deepseek-ai/dsh-client-ui-primitives'
import { Cable, MessageCirclePlus, MonitorCog } from 'lucide-react'
import { afterEach, describe, expect, it } from 'vitest'
import { DesktopFeatureIcon } from '../src/client/desktop-feature-icon.tsx'
import { SettingsNavIconBridge, type ShortcutTarget } from '../src/client/shortcut-menu.tsx'

const roots: Root[] = []

afterEach(async () => {
  await act(async () => { roots.splice(0).forEach(root => { root.unmount() }) })
  document.body.replaceChildren()
})

describe('Desktop navigation icons', () => {
  it.each([
    ['plugins', 'panel', IconPluginPinwheelOutlineRegular],
    ['desktop-automations', 'panel', IconClockOutlineRegular],
    ['general', 'settings', IconSettingsOutlineMedium],
    ['models', 'settings', IconDataOutlineMedium],
    ['plugins', 'settings', IconPersonalizationOutlineMedium],
    ['agent-presets', 'settings', IconAgentPresetOutlineMedium],
    ['desktop-reminders', 'settings', IconListPenOutlineMedium],
    ['desktop-skills', 'settings', IconSkillOutlineMedium],
    ['desktop-mcp', 'settings', Cable],
    ['desktop', 'settings', MonitorCog],
    ['clawclaw-channels', 'settings', MessageCirclePlus],
  ] as const)('maps %s (%s) to its semantic glyph', (featureId, kind, expected) => {
    expect(DesktopFeatureIcon({ featureId, kind }).type).toBe(expected)
  })

  it('projects the same semantic icons into the rc.2 Settings navigation', async () => {
    const dialog = document.createElement('div')
    dialog.dataset.shortcutModal = 'settings'
    dialog.innerHTML = '<nav><button><svg class="navIcon"></svg><span>Reminders</span></button><button><svg class="navIcon"></svg><span>MCP</span></button></nav>'
    const host = document.createElement('div')
    dialog.append(host)
    document.body.append(dialog)
    const targets: readonly ShortcutTarget[] = [
      { id: 'settings:desktop-reminders', targetId: 'desktop-reminders', label: 'Reminders', kind: 'settings' },
      { id: 'settings:desktop-mcp', targetId: 'desktop-mcp', label: 'MCP', kind: 'settings' },
    ]
    const source = { getSnapshot: () => targets, subscribe: () => () => {} }
    const root = createRoot(host)
    roots.push(root)

    await act(async () => { root.render(createElement(SettingsNavIconBridge, { shortcutTargets: source })) })

    expect(dialog.querySelector('[data-desktop-settings-icon="desktop-reminders"] svg')).not.toBeNull()
    expect(dialog.querySelector('[data-desktop-settings-icon="desktop-mcp"] .lucide-cable')).not.toBeNull()
    expect([...dialog.querySelectorAll<HTMLButtonElement>('nav button')]
      .every(button => button.querySelector<SVGElement>(':scope > svg')?.style.display === 'none')).toBe(true)
  })
})
