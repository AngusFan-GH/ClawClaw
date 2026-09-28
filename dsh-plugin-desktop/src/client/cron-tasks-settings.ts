import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { MainPanelId } from '@deepseek-ai/dsh-client-ui-layout/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar/client'
import type {} from './workspace-client-contract.ts'
import { AutomationPanel } from './AutomationPanel.tsx'
import { installCronTaskSessionIcons } from './cron-task-session-icon.ts'
import { installCronTaskUnreadReminders } from './cron-task-unread.ts'
import { createCronTasksApi, openCronTaskSession, watchCronTaskSessionDisposals } from './cron-tasks-api.ts'
import { en, zh, type CronTasksLocaleKey } from './cron-tasks-locales.ts'
import { installIntegrationsStyles } from './integrations-styles.ts'

export const DESKTOP_CRON_TASKS_LOCALE_NAMESPACE = 'desktop.cron-tasks'
export const DESKTOP_AUTOMATION_PANEL_ID = 'desktop-automations' as MainPanelId
interface ClientSessionsNavigation {
  refresh(): Promise<void>
  binding(sessionId: SessionId): { session: { rename(title: string): Promise<{
    ok: boolean
    error?: { message: string }
  }> } } | undefined
}
interface ClientCronSessions extends ClientSessionsNavigation {
  readonly list: ObservableSnapshot<SessionListState>
  handleSessionStatus(sessionId: SessionId, running: boolean): void
}
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.cron-tasks': CronTasksLocaleKey }
}
export function applyCronTasksSettings(ctx: ClientContext): void {
  const api = createCronTasksApi()
  const t = ctx.locale.bind(DESKTOP_CRON_TASKS_LOCALE_NAMESPACE)
  ctx.effect(() => ctx.locale.register(DESKTOP_CRON_TASKS_LOCALE_NAMESPACE, { zh, en }), 'dsh-plugin-desktop: Cron task dictionaries')
  ctx.effect(() => installIntegrationsStyles(), 'dsh-plugin-desktop: Cron task styles')
  ctx.inject(['sessions', 'workspaces'], (scope: ClientContext) => {
    scope.effect(() => {
      const sessions = scope.get('sessions') as unknown as ClientCronSessions
      const reminders = installCronTaskUnreadReminders({ sessions, workspaces: scope.workspaces })
      const stopIcons = installCronTaskSessionIcons({ sessions, label: t('sessionConversation') })
      const stop = watchCronTaskSessionDisposals(
        api,
        listener => scope.remote.$on('api-session/removed', sessionId => { listener(String(sessionId)) }),
        () => sessions.refresh(),
        sessionId => { reminders.markUnread(sessionId) },
      )
      return () => {
        stop()
        stopIcons()
        reminders.dispose()
      }
    }, 'dsh-plugin-desktop: reconcile disposed Cron task Sessions')
  })
  ctx.inject(['uiWorkspace', 'workspaces'], (scope: ClientContext) => {
    const injectPanel = () => ({ api,
        localeId: () => scope.locale.getSnapshot().active,
        openSession: async (taskId: string, sessionId: string) => {
          await openCronTaskSession(api, {
            reconcileWorkspace: async (workspaceId, attachedSessionId) => {
              await scope.workspaces.insertSessionBefore(
                workspaceId as WorkspaceId,
                attachedSessionId as SessionId,
                attachedSessionId as SessionId,
              )
            },
            refreshSessions: () => (scope.get('sessions') as unknown as ClientSessionsNavigation).refresh(),
            renameSession: async (attachedSessionId, title) => {
              const sessions = scope.get('sessions') as unknown as ClientSessionsNavigation
              const session = sessions.binding(attachedSessionId as SessionId)?.session
              if (session === undefined) throw new Error(`Unknown scheduled Session: ${attachedSessionId}`)
              const result = await session.rename(title)
              if (!result.ok) throw new Error(result.error?.message ?? 'Failed to name scheduled Session')
            },
            openSession: attachedSessionId => { scope.uiWorkspace.openSession(attachedSessionId as SessionId) },
          }, taskId, sessionId)
        },
      })
    scope.slots.inject('main', () => scope.slots.register({
      name: 'main', key: DESKTOP_AUTOMATION_PANEL_ID,
      locale: DESKTOP_CRON_TASKS_LOCALE_NAMESPACE,
      inject: injectPanel,
    }, AutomationPanel))
  })
}
