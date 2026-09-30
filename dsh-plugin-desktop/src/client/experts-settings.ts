/** Mount the expert center: one navigation entry, one panel, and two conversation surfaces. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { IWorkspaces } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from '@deepseek-ai/dsh-client-ui-workspace/client'
import { createExpertCenterApi } from './experts-api.ts'
import { ExpertCenter } from './experts-center.ts'
import { ExpertSessionBadge, ExpertConversationPrefill } from './expert-conversation.tsx'
import { ExpertsPanel, ExpertsPanelIcon } from './ExpertsPanel.tsx'
import { DESKTOP_EXPERTS_LOCALE_NAMESPACE, en, zh, type DesktopExpertsLocaleKey } from './experts-locales.ts'
import { installExpertStyles } from './experts-styles.ts'
import { installIntegrationsStyles } from './integrations-styles.ts'

export const DESKTOP_EXPERTS_PANEL_ID = 'desktop-experts' as MainPanelId
/** Places the entry ahead of user-pinned shortcut entries, which start at 100. */
export const DESKTOP_EXPERTS_PANEL_ORDER = 90

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.experts': DesktopExpertsLocaleKey }
}

/** Wait until a Host-created Session is addressable by the Client catalog. */
export function awaitSessionAddressable(
  sessions: Pick<ISessions, 'list'> | undefined,
  sessionId: string,
  timeoutMs = 10_000,
): Promise<boolean> {
  if (sessions === undefined) return Promise.resolve(false)
  const list = sessions.list
  if (list.getSnapshot().byId[sessionId as SessionId] !== undefined) return Promise.resolve(true)
  return new Promise<boolean>((resolve) => {
    let settled = false
    let unsubscribe: () => void = () => {}
    let timer: ReturnType<typeof setTimeout> | undefined
    const finish = (value: boolean): void => {
      if (settled) return
      settled = true
      if (timer !== undefined) clearTimeout(timer)
      unsubscribe()
      resolve(value)
    }
    timer = setTimeout(() => { finish(false) }, timeoutMs)
    unsubscribe = list.subscribe(() => {
      if (list.getSnapshot().byId[sessionId as SessionId] !== undefined) finish(true)
    })
  })
}

/** Workspace a summoned Session attaches to: the current Session's, else the first known one. */
export function resolveSummonWorkspaceId(
  sessions: Pick<ISessions, 'list'> | undefined,
  workspaces: Pick<IWorkspaces, 'list'> | undefined,
): string | undefined {
  const sessionList = sessions?.list.getSnapshot()
  const workspaceList = workspaces?.list.getSnapshot()
  if (sessionList === undefined || workspaceList === undefined || workspaceList.phase !== 'ready') return undefined
  const current = sessionList.ids.find(id => (sessionList.byId[id]?.retainedBy.mainView ?? 0) > 0)
  const own = current === undefined
    ? undefined
    : workspaceList.items.find(item => item.sessionIds.includes(current))?.workspaceId
  const target = own ?? workspaceList.items[0]?.workspaceId
  return target === undefined ? undefined : target
}

export function applyExperts(ctx: ClientContext): void {
  const api = createExpertCenterApi()
  const t = ctx.locale.bind(DESKTOP_EXPERTS_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_EXPERTS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: expert center dictionaries')
  ctx.effect(() => installIntegrationsStyles(), 'dsh-plugin-desktop: integrations styles')
  ctx.effect(() => installExpertStyles(), 'dsh-plugin-desktop: expert center styles')
  ctx.inject(['slots', 'sessions', 'workspaces', 'uiWorkspace', 'connection'], scope => {
    const sessions = scope.get('sessions') as unknown as ISessions
    const workspaces = scope.get('workspaces') as unknown as IWorkspaces
    const center = new ExpertCenter({
      api,
      openSession: sessionId => { scope.uiWorkspace.openSession(sessionId as SessionId) },
      resolveWorkspaceId: () => resolveSummonWorkspaceId(sessions, workspaces),
      awaitSession: sessionId => awaitSessionAddressable(sessions, sessionId),
      warn: (message, reason) => { console.warn(message, reason) },
    })
    scope.effect(() => () => { center.dispose() }, 'dsh-plugin-desktop: expert center lifetime')
    scope.on('connection/reset', () => { void center.refresh() })
    void center.start()
    scope.slots.inject('main', () => scope.slots.register({
      name: 'main', key: DESKTOP_EXPERTS_PANEL_ID, locale: DESKTOP_EXPERTS_LOCALE_NAMESPACE,
      inject: () => ({ center }),
    }, ExpertsPanel))
    scope.slots.inject('sidebar.panellist', () => scope.slots.register({
      name: 'sidebar.panellist', id: DESKTOP_EXPERTS_PANEL_ID, order: DESKTOP_EXPERTS_PANEL_ORDER,
      label: () => t('nav'), locale: DESKTOP_EXPERTS_LOCALE_NAMESPACE,
    }, ExpertsPanelIcon))
    scope.slots.inject('conversation.session.header.actions', () => scope.slots.register({
      name: 'conversation.session.header.actions', id: 'desktop-expert', order: 5,
      locale: DESKTOP_EXPERTS_LOCALE_NAMESPACE,
      inject: () => ({ center }),
    }, ExpertSessionBadge))
    scope.slots.inject('conversation.input.left', () => scope.slots.register({
      name: 'conversation.input.left', id: 'desktop-expert-prefill', order: 40,
      inject: () => ({ center }),
    }, ExpertConversationPrefill))
  })
}
