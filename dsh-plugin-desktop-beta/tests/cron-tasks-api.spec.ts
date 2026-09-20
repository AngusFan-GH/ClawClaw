import { describe, expect, it, vi } from 'vitest'
import { createCronTasksApi, DESKTOP_CRON_TASKS_ACTION_PATH, DESKTOP_CRON_TASKS_PATH,
  openCronTaskSession, watchCronTaskSessionDisposals } from '../src/client/cron-tasks-api.ts'

const policy = { requiresHost: true, missedRuns: 'skip', interruptedRuns: 'do-not-retry', timeoutMinutes: 60 } as const
const view = { jobs: [], running: [], archivedSessionIds: [], workspaces: [{ id: 'workspace-1', title: 'Project', path: '/work/project' }],
  defaultWorkspaceId: 'workspace-1', policy }
function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } })
}

describe('desktop Cron task client API', () => {
  it('reads task, active-run, and workspace projections from the same-origin route', async () => {
    const fetcher = vi.fn(async () => response(view))
    const api = createCronTasksApi(fetcher as never)
    await expect(api.read()).resolves.toMatchObject({ workspaces: [{ id: 'workspace-1', path: '/work/project' }] })
    expect(fetcher).toHaveBeenCalledWith(DESKTOP_CRON_TASKS_PATH, expect.objectContaining({
      method: 'GET', credentials: 'same-origin', cache: 'no-store', redirect: 'error',
    }))
  })

  it('posts task actions as JSON and surfaces server validation errors', async () => {
    const fetcher = vi.fn(async (_url: string | URL, init?: RequestInit) => {
      expect(init?.headers).toMatchObject({ 'Content-Type': 'application/json' })
      return response({ error: 'Invalid Cron expression' }, 400)
    })
    const api = createCronTasksApi(fetcher as never)
    await expect(api.action({ action: 'create', input: { name: 'bad' } })).rejects.toThrow('Invalid Cron expression')
    expect(fetcher).toHaveBeenCalledWith(DESKTOP_CRON_TASKS_ACTION_PATH, expect.objectContaining({
      method: 'POST', credentials: 'same-origin', redirect: 'error',
    }))
  })

  it('rejects malformed response projections before rendering them', async () => {
    const api = createCronTasksApi(async () => response({ jobs: [], running: [], archivedSessionIds: [], workspaces: [{ id: 1 }], defaultWorkspaceId: null, policy }))
    await expect(api.read()).rejects.toThrow('Invalid Cron task workspace')
  })

  it('reconciles workspace and session projections before opening a background session', async () => {
    const calls: string[] = []
    const api = { read: vi.fn(), action: vi.fn(async () => ({
      attached: true, workspaceId: 'workspace-1', sessionId: 'cron-1', title: 'Morning report',
    })) }
    const navigation = {
      reconcileWorkspace: vi.fn(async (workspaceId: string, sessionId: string) => {
        calls.push(`workspace:${workspaceId}:${sessionId}`)
      }),
      refreshSessions: vi.fn(async () => { calls.push('sessions') }),
      renameSession: vi.fn(async (sessionId: string, title: string) => { calls.push(`rename:${sessionId}:${title}`) }),
      openSession: vi.fn((sessionId: string) => { calls.push(`open:${sessionId}`) }),
    }

    await openCronTaskSession(api, navigation, 'task-1', 'cron-1')

    expect(api.action).toHaveBeenCalledWith({ action: 'attach-session', id: 'task-1', sessionId: 'cron-1' })
    expect(calls).toEqual(['workspace:workspace-1:cron-1', 'sessions', 'rename:cron-1:Morning report', 'open:cron-1'])
  })

  it('does not navigate when the attachment response is malformed', async () => {
    const api = { read: vi.fn(), action: vi.fn(async () => ({ attached: true, sessionId: 'cron-1' })) }
    const navigation = {
      reconcileWorkspace: vi.fn(async () => {}), refreshSessions: vi.fn(async () => {}),
      renameSession: vi.fn(async () => {}), openSession: vi.fn(),
    }
    await expect(openCronTaskSession(api, navigation, 'task-1', 'cron-1')).rejects.toThrow(/attachment response/)
    expect(navigation.openSession).not.toHaveBeenCalled()
  })

  it('restores a durable Cron Session after its background Agent is disposed', async () => {
    let removed: ((sessionId: string) => void) | undefined
    const stop = vi.fn()
    const refreshSessions = vi.fn(async () => {})
    const api = { action: vi.fn(), read: vi.fn(async () => ({ ...view, jobs: [{
      id: 'task-1', name: 'Morning report', prompt: 'Report', expression: '0 9 * * *', timeZone: 'UTC',
      activeSessionId: 'cron-1', enabled: true, nextRunAt: null, history: [],
    }] })) }
    const dispose = watchCronTaskSessionDisposals(api, (listener) => { removed = listener; return stop }, refreshSessions)

    removed?.('cron-1')
    await vi.waitFor(() => { expect(refreshSessions).toHaveBeenCalledTimes(1) })

    dispose()
    expect(stop).toHaveBeenCalledTimes(1)
  })

  it('does not refresh Sessions for unrelated or archived removals', async () => {
    let removed: ((sessionId: string) => void) | undefined
    const refreshSessions = vi.fn(async () => {})
    const api = { action: vi.fn(), read: vi.fn(async () => ({ ...view, archivedSessionIds: ['cron-archived'], jobs: [{
      id: 'task-1', name: 'Morning report', prompt: 'Report', expression: '0 9 * * *', timeZone: 'UTC',
      activeSessionId: 'cron-archived', enabled: true, nextRunAt: null, history: [],
    }] })) }
    watchCronTaskSessionDisposals(api, (listener) => { removed = listener; return () => {} }, refreshSessions)

    removed?.('ordinary-session')
    removed?.('cron-archived')
    await vi.waitFor(() => { expect(api.read).toHaveBeenCalledTimes(2) })
    expect(refreshSessions).not.toHaveBeenCalled()
  })
})
