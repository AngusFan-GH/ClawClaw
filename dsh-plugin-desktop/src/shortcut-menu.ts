/** Durable preference storage for configurable Desktop sidebar shortcuts. */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'

export const name = 'desktop-shortcuts'
export const inject = ['settings']
export const DESKTOP_SHORTCUTS_SETTINGS_NAMESPACE = 'dsh-desktop-shortcuts'

export interface DesktopShortcutSettings { items: string[] }

export const DesktopShortcutSettingsSchema: z<DesktopShortcutSettings> = z.object({
  items: z.array(z.string()).default(['plugins', 'desktop-automations', 'settings:clawclaw-experts']),
})

export function apply(ctx: Context): void {
  ctx.settings.register(DESKTOP_SHORTCUTS_SETTINGS_NAMESPACE, DesktopShortcutSettingsSchema, { applies: 'live' })
}
