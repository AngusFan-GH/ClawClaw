/** Persistent completion reminders for background Cron task Sessions. */

import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

export const CRON_TASK_UNREAD_STORAGE_KEY = 'dsh.desktop.cron-tasks.unread.v1'

interface CronTaskReminderSessions {
  readonly list: ObservableSnapshot<SessionListState>
  handleSessionStatus(sessionId: SessionId, running: boolean): void
}

interface CronTaskReminderWorkspaces {
  readonly list: ObservableSnapshot<WorkspaceSnapshot>
}

interface ReminderStorage {
  getItem(key: string): string | null
  setItem(key: string, value: string): void
}

export interface CronTaskUnreadReminders {
  markUnread(sessionId: string): void
  dispose(): void
}

export interface CronTaskUnreadReminderOptions {
  readonly sessions: CronTaskReminderSessions
  readonly workspaces: CronTaskReminderWorkspaces
  readonly storage?: ReminderStorage | undefined
  readonly warn?: ((message: string, reason: unknown) => void) | undefined
}

function browserStorage(): ReminderStorage | undefined {
  return typeof localStorage === 'undefined' ? undefined : localStorage
}

function restoreUnread(storage: ReminderStorage | undefined, warn: (message: string, reason: unknown) => void): Set<string> {
  if (storage === undefined) return new Set()
  try {
    const raw = storage.getItem(CRON_TASK_UNREAD_STORAGE_KEY)
    if (raw === null) return new Set()
    const value: unknown = JSON.parse(raw)
    if (!Array.isArray(value) || value.some(item => typeof item !== 'string' || item === '')) {
      throw new TypeError('stored value must be an array of Session ids')
    }
    return new Set(value)
  } catch (reason) {
    warn('failed to restore scheduled task unread reminders:', reason)
    return new Set()
  }
}

/** Keep Cron completion reminders across the live-Agent disposal boundary and app restarts. */
export function installCronTaskUnreadReminders(options: CronTaskUnreadReminderOptions): CronTaskUnreadReminders {
  const { sessions, workspaces } = options
  const storage = options.storage ?? browserStorage()
  const warn = options.warn ?? ((message, reason) => { console.warn(message, reason) })
  const unread = restoreUnread(storage, warn)
  const armed = new Set<string>()
  let disposed = false
  let reconciling = false

  const persist = (): void => {
    if (storage === undefined) return
    try { storage.setItem(CRON_TASK_UNREAD_STORAGE_KEY, JSON.stringify([...unread].sort())) }
    catch (reason) { warn('failed to persist scheduled task unread reminders:', reason) }
  }
  const reconcile = (): void => {
    if (disposed || reconciling) return
    reconciling = true
    try {
      const snapshot = sessions.list.getSnapshot()
      const archived = new Set(workspaces.list.getSnapshot().archivedSessionIds.map(String))
      let changed = false
      for (const sessionId of unread) {
        if (sessionId === snapshot.current || archived.has(sessionId)) {
          unread.delete(sessionId)
          armed.delete(sessionId)
          changed = true
        }
      }
      if (changed) persist()
      for (const sessionId of unread) {
        const summary = snapshot.byId[sessionId as SessionId]
        if (summary === undefined || summary.running) {
          armed.delete(sessionId)
          continue
        }
        if (summary.completed || armed.has(sessionId)) continue
        armed.add(sessionId)
        // The manager owns the existing green completion reminder. A batched
        // synthetic edge restores it without introducing a second row UI.
        sessions.handleSessionStatus(sessionId as SessionId, true)
        sessions.handleSessionStatus(sessionId as SessionId, false)
      }
    } finally {
      reconciling = false
    }
  }

  const stopSessions = sessions.list.subscribe(reconcile)
  const stopWorkspaces = workspaces.list.subscribe(reconcile)
  reconcile()
  return {
    markUnread(sessionId) {
      if (disposed || sessionId === '' || sessions.list.getSnapshot().current === sessionId) return
      if (!unread.has(sessionId)) {
        unread.add(sessionId)
        persist()
      }
      armed.delete(sessionId)
      reconcile()
    },
    dispose() {
      if (disposed) return
      disposed = true
      stopWorkspaces()
      stopSessions()
      armed.clear()
    },
  }
}
