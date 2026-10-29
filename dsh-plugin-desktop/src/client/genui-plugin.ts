import type { Context } from '@deepseek-ai/cordis'
import { applyDesktopGenui } from './genui.tsx'
import { applyGenuiSettings } from './genui-settings.tsx'

/** Desktop-owned Client child plugin; intentionally shipped in the desktop package. */
export const name = 'desktop-genui-client'
export const inject = ['slots', 'configForms', 'locale', 'uiConversation', 'sessions']
export function apply(ctx: Context): void {
  applyDesktopGenui(ctx)
  applyGenuiSettings(ctx)
}
