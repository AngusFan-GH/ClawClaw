/** Register the independent Skills page in the official Settings shell. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import { createDesktopSkillsApi } from './skills-api.ts'
import { en, zh, type DesktopSkillsLocaleKey } from './skills-locales.ts'
import { installIntegrationsStyles } from './integrations-styles.ts'
import { SkillsSettingsSection } from './SkillsSettingsSection.tsx'

export const DESKTOP_SKILLS_LOCALE_NAMESPACE = 'desktop.skills'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'desktop.skills': DesktopSkillsLocaleKey } }

export function applySkillsSettings(ctx: ClientContext): void {
  const api = createDesktopSkillsApi()
  const t = ctx.locale.bind(DESKTOP_SKILLS_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_SKILLS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: Skills dictionaries')
  ctx.effect(() => installIntegrationsStyles(), 'dsh-plugin-desktop: Skills styles')
  ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'desktop-skills', order: 90,
    label: () => t('nav'), locale: DESKTOP_SKILLS_LOCALE_NAMESPACE, inject: () => ({ api }),
  }, SkillsSettingsSection))
}
