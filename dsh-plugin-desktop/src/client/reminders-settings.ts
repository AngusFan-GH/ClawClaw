/** Register the global Reminders page in the official Settings shell. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createDesktopRemindersApi } from './reminders-api.ts'
import { en, zh, type DesktopRemindersLocaleKey } from './reminders-locales.ts'
import { installIntegrationsStyles } from './integrations-styles.ts'
import { RemindersSettingsSection } from './RemindersSettingsSection.tsx'

export const DESKTOP_REMINDERS_LOCALE_NAMESPACE = 'desktop.reminders'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'desktop.reminders': DesktopRemindersLocaleKey } }

export function applyRemindersSettings(ctx: ClientContext): void {
  const api = createDesktopRemindersApi()
  const t = ctx.locale.bind(DESKTOP_REMINDERS_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_REMINDERS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: Reminders dictionaries')
  ctx.effect(() => installIntegrationsStyles(), 'dsh-plugin-desktop: Reminders styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'desktop-reminders', order: 25, label: () => t('nav'), locale: DESKTOP_REMINDERS_LOCALE_NAMESPACE,
    inject: () => ({ api }),
  }, RemindersSettingsSection))
}
