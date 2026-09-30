/** Expert Center: panel registration, sidebar entry, and summon flow. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type { DesktopWorkspaceSettings } from '../workspace-settings.ts'
import { createExpertsApi, type ExpertsApi } from './experts-api.ts'
import { en, zh, type ExpertsLocaleKey } from './experts-locales.ts'
import { ExpertCenterPanel, ExpertCenterPanelIcon, DESKTOP_EXPERTS_PANEL_ID, DESKTOP_EXPERTS_LOCALE_NAMESPACE } from './ExpertCenterPanel.tsx'
import { installExpertStyles } from './experts-styles.ts'

export const DESKTOP_EXPERTS_PANEL: MainPanelId = DESKTOP_EXPERTS_PANEL_ID as MainPanelId

interface ExpertCenterDeps {
  readonly api: ExpertsApi
  readonly summon: (expertId: string, prompt: string) => Promise<void>
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.experts': ExpertsLocaleKey }
}

/** Resolve the workspace a summoned Session should attach to. */
function resolveWorkspaceId(scope: ClientContext): WorkspaceId | undefined {
  const settings = scope.configForms.get<DesktopWorkspaceSettings>('desktop-default-workspace')
  const value = settings.getSnapshot().value
  if (value === undefined) return undefined
  const items = scope.workspaces.list.getSnapshot().items
  for (const candidate of [value.activeWorkspaceId, value.defaultWorkspaceId]) {
    if (candidate !== undefined && candidate !== '' && items.some(item => item.workspaceId === candidate)) {
      return candidate as WorkspaceId
    }
  }
  return undefined
}

export function applyExpertCenter(ctx: ClientContext): void {
  const api = createExpertsApi()
  ctx.effect(() => ctx.locale.register(DESKTOP_EXPERTS_LOCALE_NAMESPACE, { zh, en }),
    'dsh-plugin-desktop: expert center dictionaries')
  ctx.effect(() => installExpertStyles(), 'dsh-plugin-desktop: expert center styles')

  ctx.inject(['uiWorkspace', 'workspaces', 'sessions', 'conversation', 'configForms'], (scope: ClientContext) => {
    // Host and Client faces share Cordis declarations; keep this boundary
    // explicitly Client-shaped even in the combined Host/Client test program.
    const sessions = scope.get('sessions') as unknown as {
      refresh(): Promise<void>
      scope(id: SessionId): ClientContext | undefined
    }
    const summon = async (expertId: string, prompt: string): Promise<void> => {
      const workspaceId = resolveWorkspaceId(scope)
      const result = await api.summon(expertId, workspaceId)
      await sessions.refresh()
      const sessionId = result.sessionId as SessionId
      scope.uiWorkspace.openSession(sessionId)
      // The openSession retain materializes the session scope synchronously; the
      // input shell is created on demand and can seed the draft headlessly
      // before the composer mounts.
      const actx = sessions.scope(sessionId)
      if (actx !== undefined) {
        scope.conversation.input.for(actx as Parameters<typeof scope.conversation.input.for>[0]).setDraft(prompt)
      }
    }

    const injected = (): ExpertCenterDeps => ({ api, summon })

    scope.slots.inject('main', () => scope.slots.register({
      name: 'main', key: DESKTOP_EXPERTS_PANEL,
      locale: DESKTOP_EXPERTS_LOCALE_NAMESPACE,
      inject: injected,
    }, ExpertCenterPanel))

    scope.slots.inject('sidebar.panellist', () => scope.slots.register({
      name: 'sidebar.panellist', id: DESKTOP_EXPERTS_PANEL, order: 60,
      label: () => scope.locale.bind(DESKTOP_EXPERTS_LOCALE_NAMESPACE)('nav'),
    }, ExpertCenterPanelIcon))
  })
}
