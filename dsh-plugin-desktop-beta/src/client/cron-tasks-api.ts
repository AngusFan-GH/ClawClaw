/** Same-origin client for the Desktop Cron task registry. */

import { DESKTOP_CRON_TASKS_ACTION_PATH, DESKTOP_CRON_TASKS_PATH } from '../cron-tasks-contract.ts'
export { DESKTOP_CRON_TASKS_ACTION_PATH, DESKTOP_CRON_TASKS_PATH } from '../cron-tasks-contract.ts'

export interface CronTaskRunView {
  readonly scheduledFor?: string
  readonly trigger?: 'schedule' | 'manual'
  readonly startedAt: string
  readonly finishedAt: string
  readonly status: 'completed' | 'failed' | 'cancelled' | 'skipped'
  readonly error?: string
  readonly sessionId?: string
}
export interface CronTaskView {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly expression: string
  readonly oneTimeAt?: string
  readonly timeZone: string
  readonly workspaceId?: string
  readonly activeSessionId?: string
  readonly enabled: boolean
  readonly nextRunAt: string | null
  readonly lastRun?: CronTaskRunView
  readonly history: readonly CronTaskRunView[]
}
export interface CronTaskInputView {
  readonly name: string
  readonly prompt: string
  readonly expression: string
  readonly oneTimeAt?: string
  readonly timeZone: string
  readonly workspaceId?: string
  readonly enabled?: boolean
}
export interface CronTaskWorkspaceView { readonly id: string; readonly title: string; readonly path: string }
export interface CronTaskPolicyView {
  readonly requiresHost: true
  readonly missedRuns: 'skip'
  readonly interruptedRuns: 'do-not-retry'
  readonly timeoutMinutes: number
}
export interface CronTasksView {
  readonly jobs: readonly CronTaskView[]
  readonly running: readonly string[]
  readonly archivedSessionIds: readonly string[]
  readonly workspaces: readonly CronTaskWorkspaceView[]
  readonly defaultWorkspaceId: string | null
  readonly policy: CronTaskPolicyView
}
export interface CronTasksApi {
  read(): Promise<CronTasksView>
  action(value: object): Promise<unknown>
}
export interface CronSessionNavigation {
  reconcileWorkspace(workspaceId: string, sessionId: string): Promise<void>
  refreshSessions(): Promise<void>
  renameSession(sessionId: string, title: string): Promise<void>
  openSession(sessionId: string): void
}
type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
async function responseJson(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('Cron task response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}
function parseView(value: unknown): CronTasksView {
  if (!isRecord(value) || !Array.isArray(value.jobs) || !Array.isArray(value.running) || !Array.isArray(value.archivedSessionIds)
    || !Array.isArray(value.workspaces)
    || !(value.defaultWorkspaceId === null || typeof value.defaultWorkspaceId === 'string') || !isRecord(value.policy)
    || value.policy.requiresHost !== true || value.policy.missedRuns !== 'skip' || value.policy.interruptedRuns !== 'do-not-retry'
    || typeof value.policy.timeoutMinutes !== 'number') throw new Error('Invalid Cron task response')
  const jobs = value.jobs.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.name !== 'string'
      || typeof item.prompt !== 'string' || typeof item.expression !== 'string' || typeof item.timeZone !== 'string'
      || typeof item.enabled !== 'boolean' || !(item.nextRunAt === null || typeof item.nextRunAt === 'string')
      || !Array.isArray(item.history)) throw new Error('Invalid Cron task row')
    return item as unknown as CronTaskView
  })
  if (value.running.some(id => typeof id !== 'string')) throw new Error('Invalid running Cron task ids')
  if (value.archivedSessionIds.some(id => typeof id !== 'string')) throw new Error('Invalid archived Cron session ids')
  const workspaces = value.workspaces.map(item => {
    if (!isRecord(item) || typeof item.id !== 'string' || typeof item.title !== 'string' || typeof item.path !== 'string') throw new Error('Invalid Cron task workspace')
    return Object.freeze({ id: item.id, title: item.title, path: item.path })
  })
  return Object.freeze({ jobs: Object.freeze(jobs), running: Object.freeze(value.running as string[]),
    archivedSessionIds: Object.freeze(value.archivedSessionIds as string[]), workspaces: Object.freeze(workspaces),
    defaultWorkspaceId: value.defaultWorkspaceId, policy: Object.freeze(value.policy as unknown as CronTaskPolicyView) })
}
export function createCronTasksApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): CronTasksApi {
  const post = async (value: object): Promise<unknown> => responseJson(await fetcher(DESKTOP_CRON_TASKS_ACTION_PATH, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(value),
  }))
  return Object.freeze({
    async read() {
      return parseView(await responseJson(await fetcher(DESKTOP_CRON_TASKS_PATH, {
        method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' },
      })))
    },
    action: post,
  })
}

/** Reconcile both client projections before selecting a Host-created background session. */
export async function openCronTaskSession(
  api: CronTasksApi,
  navigation: CronSessionNavigation,
  taskId: string,
  sessionId: string,
): Promise<void> {
  const attached = await api.action({ action: 'attach-session', id: taskId, sessionId })
  if (!isRecord(attached) || attached.attached !== true || attached.sessionId !== sessionId
    || typeof attached.workspaceId !== 'string' || attached.workspaceId === ''
    || typeof attached.title !== 'string' || attached.title === '') {
    throw new Error('Invalid Cron session attachment response')
  }
  await navigation.reconcileWorkspace(attached.workspaceId, sessionId)
  await navigation.refreshSessions()
  await navigation.renameSession(sessionId, attached.title)
  navigation.openSession(sessionId)
}
