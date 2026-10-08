/** Register the independent Skills page in the official Settings shell. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { createDesktopSkillsApi } from './skills-api.ts'
import { en, zh, type DesktopSkillsLocaleKey } from './skills-locales.ts'
import { installIntegrationsStyles } from './integrations-styles.ts'
import { SkillsSettingsSection } from './SkillsSettingsSection.tsx'
import { applyConversationSkills } from './conversation-skills.ts'

export const DESKTOP_SKILLS_LOCALE_NAMESPACE = 'desktop.skills'
declare module '@deepseek-ai/dsh-client-ui-slots' { interface LocaleNamespaceMap { 'desktop.skills': DesktopSkillsLocaleKey } }

export function applySkillsSettings(ctx: ClientContext, options: { readonly registerSection?: boolean } = {}): void {
  const api = createDesktopSkillsApi()
  const t = ctx.locale.bind(DESKTOP_SKILLS_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_SKILLS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: Skills dictionaries')
  ctx.effect(() => installIntegrationsStyles(), 'dsh-plugin-desktop: Skills styles')
  applyConversationSkills(ctx)
  if (options.registerSection !== false) ctx.slots.inject('settings.section', () => ctx.slots.register({
    name: 'settings.section', id: 'desktop-skills', order: 30,
    label: () => t('nav'), locale: DESKTOP_SKILLS_LOCALE_NAMESPACE, inject: () => {
      const sessionList = (ctx.get('sessions') as unknown as ISessions | undefined)?.list.getSnapshot()
      const current = sessionList?.ids.find(id => (sessionList.byId[id]?.retainedBy.mainView ?? 0) > 0)
      return { api, ...(current === undefined ? {} : { initialSessionId: current as string }) }
    },
  }, SkillsSettingsSection))
}
