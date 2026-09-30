/** Register the Expert Center main panel and its sidebar entry. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { ExpertsPanel, type ExpertsPanelInjected } from './ExpertsPanel.tsx'
import { createDesktopExpertsApi } from './experts-api.ts'
import { summonExpert } from './experts-summon.ts'
import { en, zh, type ExpertsLocaleKey } from './experts-locales.ts'
import { installIntegrationsStyles } from './integrations-styles.ts'
import { DesktopFeatureIcon } from './desktop-feature-icon.tsx'

export const DESKTOP_EXPERTS_LOCALE_NAMESPACE = 'desktop.experts'
export const DESKTOP_EXPERTS_PANEL_ID = 'desktop-experts' as MainPanelId

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.experts': ExpertsLocaleKey }
}

function ExpertsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): JSX.Element {
  return <DesktopFeatureIcon featureId="desktop-experts" kind="panel" size={size} />
}

export function applyExperts(ctx: ClientContext): void {
  const t = ctx.locale.bind(DESKTOP_EXPERTS_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_EXPERTS_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: Experts dictionaries')
  ctx.effect(() => installIntegrationsStyles(), 'dsh-plugin-desktop: Experts styles')

  ctx.inject(['uiWorkspace', 'workspaces', 'sessions'], (scope: ClientContext) => {
    const api = createDesktopExpertsApi()
    const summon = async (expertId: string, prompt: string): Promise<void> => {
      await summonExpert(api, {
        // The Host already attached the Session; this no-op move returns the
        // fresh Workspace row and merges it into the client snapshot.
        reconcileWorkspace: async (workspaceId: string, sessionId: string) => {
          await scope.workspaces.insertSessionBefore(
            workspaceId as WorkspaceId,
            sessionId as SessionId,
            sessionId as SessionId,
          )
        },
        refreshSessions: () => (scope.get('sessions') as unknown as ISessions).refresh(),
        openSession: sessionId => { scope.uiWorkspace.openSession(sessionId as SessionId) },
      }, expertId, prompt)
    }
    const injected: ExpertsPanelInjected = { api, summon }

    scope.slots.inject('main', () => scope.slots.register({
      name: 'main', key: DESKTOP_EXPERTS_PANEL_ID,
      locale: DESKTOP_EXPERTS_LOCALE_NAMESPACE,
      inject: () => injected,
    }, ExpertsPanel))

    scope.slots.inject('sidebar.panellist', () => scope.slots.register({
      name: 'sidebar.panellist',
      id: DESKTOP_EXPERTS_PANEL_ID,
      order: 15,
      label: () => t('nav'),
      locale: DESKTOP_EXPERTS_LOCALE_NAMESPACE,
    }, ExpertsPanelIcon))
  })
}
