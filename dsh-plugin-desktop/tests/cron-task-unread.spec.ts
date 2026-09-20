import { describe, expect, it, vi } from 'vitest'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { CRON_TASK_UNREAD_STORAGE_KEY, installCronTaskUnreadReminders } from '../src/client/cron-task-unread.ts'

function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
  }
}

function memoryStorage(initial?: readonly string[]) {
  const values = new Map<string, string>()
  if (initial !== undefined) values.set(CRON_TASK_UNREAD_STORAGE_KEY, JSON.stringify(initial))
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: vi.fn((key: string, value: string) => { values.set(key, value) }),
    read: () => JSON.parse(values.get(CRON_TASK_UNREAD_STORAGE_KEY) ?? '[]') as string[],
  }
}

function sessionState(current?: string, completed = false) {
  const id = SessionId('cron-1')
  return {
    ids: [id], byId: { [id]: { id, displayTitle: 'Report', running: false, completed, blank: false, updatedAt: 1 } },
    current: current === undefined ? undefined : SessionId(current), phase: 'ready' as const,
    subagentsByParent: {}, jobsBySession: {}, currentAddress: undefined,
  }
}

function workspaceState(archivedSessionIds: readonly string[] = []) {
  return { items: [], archivedSessionIds: archivedSessionIds.map(SessionId), state: 'idle' as const,
    phase: 'ready' as const, error: null }
}

describe('Cron task unread reminders', () => {
  it('persists and re-arms the existing completion reminder after Session recovery', () => {
    const sessionsList = source(sessionState())
    const workspacesList = source(workspaceState())
    const storage = memoryStorage()
    const handleSessionStatus = vi.fn()
    const reminders = installCronTaskUnreadReminders({
      sessions: { list: sessionsList, handleSessionStatus }, workspaces: { list: workspacesList }, storage,
    })

    reminders.markUnread('cron-1')

    expect(storage.read()).toEqual(['cron-1'])
    expect(handleSessionStatus.mock.calls).toEqual([
      [SessionId('cron-1'), true], [SessionId('cron-1'), false],
    ])
  })

  it('restores persisted reminders after restart and clears them when opened', () => {
    const sessionsList = source(sessionState())
    const storage = memoryStorage(['cron-1'])
    const handleSessionStatus = vi.fn()
    installCronTaskUnreadReminders({
      sessions: { list: sessionsList, handleSessionStatus }, workspaces: { list: source(workspaceState()) }, storage,
    })
    expect(handleSessionStatus).toHaveBeenCalledTimes(2)

    sessionsList.set(sessionState('cron-1', true))

    expect(storage.read()).toEqual([])
  })

  it('does not mark the visible Session and removes archived reminders', () => {
    const sessionsList = source(sessionState('cron-1'))
    const workspacesList = source(workspaceState())
    const storage = memoryStorage()
    const handleSessionStatus = vi.fn()
    const reminders = installCronTaskUnreadReminders({
      sessions: { list: sessionsList, handleSessionStatus }, workspaces: { list: workspacesList }, storage,
    })
    reminders.markUnread('cron-1')
    expect(storage.read()).toEqual([])

    sessionsList.set(sessionState())
    reminders.markUnread('cron-1')
    workspacesList.set(workspaceState(['cron-1']))
    expect(storage.read()).toEqual([])
  })
})
