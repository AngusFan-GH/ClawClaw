/** Desktop-owned durable Cron tasks, isolated Agent runs, and same-origin API. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import { createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { deepEqualJson } from '@deepseek-ai/dsh-settings'
import { defineTool } from '@deepseek-ai/dsh-tools'
import z from '@deepseek-ai/schemastery'
import type {} from '@deepseek-ai/dsh-agent-default-model'
import type {} from '@deepseek-ai/dsh-session-title'
import type { DesktopRuntime } from './runtime.ts'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import { maskSecrets } from './mask-secrets.ts'
import { DESKTOP_CRON_TASKS_ACTION_PATH, DESKTOP_CRON_TASKS_PATH } from './cron-tasks-contract.ts'
import { CRON_TASK_HISTORY_LIMIT, createCronTask, nextCronTaskRun, nextTaskRun, normalizeCronTaskInput, rehydrateCronTask } from './cron-task-domain.ts'
import type { CronTask, CronTaskRun } from './cron-task-domain.ts'
import { cronSessionTitle } from './cron-session-title.ts'
import { DESKTOP_WORKSPACE_SETTINGS_NAMESPACE } from './workspace-settings.ts'
import type { DesktopCronInterruptionState } from './interruption-inspection.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopCronAgentHost: DesktopCronAgentHost
    desktopCronTasksController: CronTaskController
  }
}

export const name = 'desktop-cron-tasks'
export const inject = ['settings', 'agents', 'sessions', 'sessionTitle', 'agentDefaultModel', 'workspaceRegistry', 'tools', 'desktopCronAgentHost']

export const DESKTOP_CRON_TASKS_SETTINGS_NAMESPACE = 'dsh-desktop-cron-tasks'

const MAX_TIMER_DELAY_MS = 2_147_000_000
const RUN_TIMEOUT_MS = 60 * 60 * 1_000
const CRON_TASK_MANAGEMENT_TOOLS = [
  'cron_task_create', 'cron_task_list', 'cron_task_update', 'cron_task_delete', 'cron_task_run',
] as const
export const CRON_EXECUTION_POLICY = [
  'You are executing an existing ClawClaw automation, not configuring an automation.',
  'Perform the scheduled task now. Do not create, inspect, update, delete, run, or describe scheduled tasks.',
  'ClawClaw records run history automatically; ignore any request in the task text to record or manage automation history.',
  'Return only the actual result of the requested work.',
].join('\n')

interface CronTasksSettings { jobs: CronTask[] }
interface CronTasksSettingsScope {
  get(): CronTasksSettings
  watch?(callback: (next: CronTasksSettings, previous: CronTasksSettings) => void | Promise<void>): () => void
  replace(section: object): Promise<void>
}

const CronTaskRunSchema = z.object({
  scheduledFor: z.string(), trigger: z.union(['schedule', 'manual'] as const),
  startedAt: z.string(), finishedAt: z.string(), status: z.union(['completed', 'failed', 'cancelled', 'skipped'] as const),
  error: z.string(), sessionId: z.string(),
})

export const CronTasksSettingsSchema = z.object({
  jobs: z.array(z.object({
    id: z.string(), name: z.string(), prompt: z.string(), expression: z.string(), oneTimeAt: z.string(), timeZone: z.string(),
    workspaceId: z.string(), activeSessionId: z.string(), activeSessionWorkspaceId: z.string(), enabled: z.boolean(), createdAt: z.string(), updatedAt: z.string(),
    nextRunAt: z.union([z.string(), z.const(null)]), pendingRunAt: z.union([z.string(), z.const(null)]).default(null),
    pendingRunStartedAt: z.string(), lastRun: CronTaskRunSchema,
    history: z.array(CronTaskRunSchema).default([]),
  })).default([]),
}) as unknown as z<CronTasksSettings>

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function safeError(value: unknown): string {
  return maskSecrets(value instanceof Error ? value.message : String(value)).slice(0, 1_000)
}

function throwIfAborted(signal?: AbortSignal): void {
  if (signal?.aborted === true) throw signal.reason
}

/** Keep task-management intent out of both the visible prompt and tool surface. */
function installCronExecutionScope(agentCtx: Context): () => void {
  const liftTools = agentCtx.tools.restrict({ deny: [...CRON_TASK_MANAGEMENT_TOOLS] })
  const liftPrompt = agentCtx.systemPrompt.section({
    name: 'desktop-cron-execution-policy',
    order: agentCtx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 1,
    text: CRON_EXECUTION_POLICY,
  })
  return () => { liftPrompt(); liftTools() }
}

function archivedSessionIds(runtime: CronRuntime): readonly SessionId[] {
  return (runtime.workspaceRegistry as Context['workspaceRegistry'] & { archivedSessionIds?: readonly SessionId[] })
    .archivedSessionIds ?? []
}

function isArchived(runtime: CronRuntime, sessionId: string): boolean {
  return archivedSessionIds(runtime).includes(SessionId(sessionId))
}

type LiveAgent = NonNullable<ReturnType<Context['agents']['get']>>

/** Agent operations bound to the stable Desktop Host instead of this reloadable Settings plugin. */
export interface DesktopCronAgentHost {
  get(sessionId: SessionId): ReturnType<Context['agents']['get']>
  create(options: Parameters<Context['agents']['create']>[0]): ReturnType<Context['agents']['create']>
  resume(options: Parameters<Context['agents']['resume']>[0]): ReturnType<Context['agents']['resume']>
}

async function waitForIdle(agent: LiveAgent, signal?: AbortSignal): Promise<void> {
  throwIfAborted(signal)
  if (signal === undefined) return await agent.whenIdle()
  await new Promise<void>((resolve, reject) => {
    const aborted = (): void => { reject(signal.reason) }
    signal.addEventListener('abort', aborted, { once: true })
    void agent.whenIdle().then(resolve, reject).finally(() => { signal.removeEventListener('abort', aborted) })
  })
}

async function admitFollowup(
  agent: LiveAgent,
  message: ReturnType<typeof createUserMessage>,
  signal?: AbortSignal,
): Promise<void> {
  while (true) {
    throwIfAborted(signal)
    try {
      await agent.runMaintenance(async () => {
        throwIfAborted(signal)
        agent.followup(message)
      })
      return
    } catch (error) {
      if (!(error instanceof Error) || !error.message.endsWith('already has active work')) throw error
      await waitForIdle(agent, signal)
    }
  }
}

type CronRuntime = {
  readonly agents: Context['agents']
  readonly agentHost?: DesktopCronAgentHost
  readonly sessions: Context['sessions']
  readonly sessionTitle: Context['sessionTitle']
  readonly agentDefaultModel: Context['agentDefaultModel']
  readonly workspaceRegistry: Context['workspaceRegistry']
  readonly desktopRuntime?: DesktopRuntime
  readonly defaultWorkspaceId?: () => string | undefined
}

/** Execute one task in its durable conversation, resuming it when it is not already live. */
export async function runCronTask(
  runtime: CronRuntime,
  task: CronTask,
  signal?: AbortSignal,
  onSessionResolved?: (sessionId: string, workspaceId: string) => Promise<void>,
): Promise<string> {
  throwIfAborted(signal)
  const workspaceId = task.workspaceId ?? runtime.defaultWorkspaceId?.()
  const workspace = workspaceId === undefined
    ? runtime.workspaceRegistry.list()[0]
    : runtime.workspaceRegistry.get(workspaceId as never)
  if (workspace === undefined) throw new Error('The selected Workspace no longer exists')
  const selection = runtime.agentDefaultModel.currentSelection()
  const reusableId = task.activeSessionId !== undefined
    && task.activeSessionWorkspaceId === String(workspace.id)
    && !isArchived(runtime, task.activeSessionId)
    ? SessionId(task.activeSessionId)
    : undefined
  const agents = runtime.agentHost ?? runtime.agents
  let handle: Awaited<ReturnType<CronRuntime['agents']['create']>> | undefined
  let releaseExecutionScope = (): void => {}
  let agent = reusableId === undefined ? undefined : agents.get(reusableId)
  const configureExecutionScope = (agentCtx: Context): void => {
    releaseExecutionScope = installCronExecutionScope(agentCtx)
  }
  if (agent === undefined) {
    if (reusableId === undefined) {
      const sessionId = SessionId(`cron-${randomUUID()}`)
      handle = await agents.create({ sessionId, meta: { cwd: workspace.path },
        agentOptions: { provider: selection.provider, model: selection.model }, setup: configureExecutionScope,
        ...(signal === undefined ? {} : { signal }) })
    } else {
      try {
        handle = await agents.resume({ resumeSessionId: reusableId,
          agentOptions: { provider: selection.provider, model: selection.model }, setup: configureExecutionScope,
          ...(signal === undefined ? {} : { signal }) })
      } catch (error) {
        if (!(error instanceof Error) || error.name !== 'SessionPersistenceNotFoundError') throw error
        const sessionId = SessionId(`cron-${randomUUID()}`)
        handle = await agents.create({ sessionId, meta: { cwd: workspace.path },
          agentOptions: { provider: selection.provider, model: selection.model }, setup: configureExecutionScope,
          ...(signal === undefined ? {} : { signal }) })
      }
    }
    agent = handle.agent
  }
  const sessionId = agent.id
  if (handle === undefined) {
    const agentCtx = (agent as LiveAgent & { readonly ctx?: Context }).ctx
    releaseExecutionScope = agentCtx === undefined ? () => {} : installCronExecutionScope(agentCtx)
  }
  const cancel = (): void => { agent.cancel({ kind: 'hook', reason: 'scheduled task cancelled' }, { keepInbox: true }) }
  try {
    throwIfAborted(signal)
    runtime.sessionTitle.rename(agent.session, cronSessionTitle(task.name))
    await workspace.attachSession(sessionId)
    await onSessionResolved?.(String(sessionId), String(workspace.id))
    const message = createUserMessage({
      content: [{ type: 'text', text: task.prompt }],
      source: { kind: 'user' },
    })
    if (handle === undefined) await admitFollowup(agent, message, signal)
    else agent.followup(message)
    signal?.addEventListener('abort', cancel, { once: true })
    await waitForIdle(agent, signal)
    throwIfAborted(signal)
    await runtime.sessions.flush(agent.session)
    const end = [...agent.session.ownEvents()].reverse().find(event => event.type === 'turn/end')
    if (end?.type === 'turn/end' && (end.data.reason.kind === 'error' || end.data.reason.kind === 'max-tokens')) {
      throw new Error(end.data.reason.kind === 'error' ? end.data.reason.error.message : 'Agent reached the output token limit')
    }
    return String(sessionId)
  } finally {
    signal?.removeEventListener('abort', cancel)
    releaseExecutionScope()
    // Keep the Agent alive under desktopCronAgentHost. Disposing its handle
    // emits session/disposed, making the sidebar remove the conversation until
    // the persisted projection discovers and adds the same session again.
  }
}

/** Serialized settings-backed task registry with a single earliest-deadline timer. */
export class CronTaskController {
  private jobs: CronTask[]
  private timer: ReturnType<typeof setTimeout> | undefined
  private disposed = false
  private queue: Promise<void> = Promise.resolve()
  private readonly running = new Set<string>()
  private readonly activeAbort = new Map<string, AbortController>()
  private readonly activePromises = new Set<Promise<object>>()
  private readonly activeByTask = new Map<string, Promise<object>>()
  private readonly persistRehydratedJobs: boolean

  constructor(
    private readonly runtime: CronRuntime,
    private readonly settings: CronTasksSettingsScope,
    private readonly now: () => number = Date.now,
    private readonly execute: (task: CronTask, signal?: AbortSignal, onSessionResolved?: (sessionId: string, workspaceId: string) => Promise<void>) => Promise<string>
      = (task, signal, onSessionResolved) => runCronTask(runtime, task, signal, onSessionResolved),
    private readonly runTimeoutMs = RUN_TIMEOUT_MS,
  ) {
    const storedJobs = settings.get().jobs
    this.jobs = storedJobs.map(job => rehydrateCronTask(job, now()))
    this.persistRehydratedJobs = !deepEqualJson(storedJobs, this.jobs)
  }

  start(): void {
    void this.serialized(async () => {
      this.refreshFromSettings()
      if (this.persistRehydratedJobs) await this.settings.replace({ jobs: this.jobs })
      this.arm()
    })
  }

  syncFromSettings(next: CronTasksSettings): void {
    if (this.disposed) return
    void this.serialized(async () => { this.replaceFromSettings(next) })
  }

  dispose(): void {
    this.disposed = true
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    for (const controller of this.activeAbort.values()) controller.abort(new Error('ClawClaw is shutting down'))
    // ConfigEditor reconciles this plugin while settings.replace() is still
    // awaiting the reload. Waiting for the queue here would wait on that same
    // settings.replace() and deadlock every create/update/delete. In-flight
    // operations retain their own promises and observe disposed/abort state.
  }

  async read(): Promise<object> {
    await this.queue
    this.refreshFromSettings()
    return { jobs: this.jobs, running: [...this.running], archivedSessionIds: archivedSessionIds(this.runtime).map(String),
      defaultWorkspaceId: this.runtime.defaultWorkspaceId?.() ?? null,
      policy: { requiresHost: true, missedRuns: 'skip', interruptedRuns: 'do-not-retry', timeoutMinutes: Math.round(this.runTimeoutMs / 60_000) },
      workspaces: this.runtime.workspaceRegistry.list().map(workspace => ({ id: String(workspace.id), title: workspace.title, path: workspace.path })) }
  }

  /** Stable process-lifetime facts consumed by pre-quit inspection. */
  async interruptionState(): Promise<DesktopCronInterruptionState> {
    await this.queue
    return Object.freeze({
      running: this.running.size,
      scheduled: this.jobs.filter(job => job.enabled && job.nextRunAt !== null).length,
    })
  }

  async action(value: unknown): Promise<object> {
    if (this.disposed) throw new Error('Cron task scheduler is stopping')
    if (!isRecord(value) || typeof value.action !== 'string') throw new TypeError('Invalid Cron task action')
    if (value.action === 'create') return await this.create(value.input)
    if (value.action === 'update') return await this.update(value.id, value.input)
    if (value.action === 'delete') return await this.delete(value.id)
    if (value.action === 'toggle') return await this.toggle(value.id, value.enabled)
    if (value.action === 'run') return await this.run(value.id, false)
    if (value.action === 'cancel') return this.cancel(value.id)
    if (value.action === 'attach-session') return await this.attachSession(value.id, value.sessionId)
    if (value.action === 'preview') return this.preview(value.input)
    throw new TypeError('Unsupported Cron task action')
  }

  /** A compact model-facing view of the same registry used by the settings UI. */
  async listForModel(): Promise<readonly object[]> {
    const view = await this.read() as { readonly jobs: readonly CronTask[] }
    return view.jobs.map(({ id, name, prompt, expression, oneTimeAt, timeZone, workspaceId, enabled, nextRunAt, lastRun }) => ({
      id, name, prompt, expression, ...(oneTimeAt === undefined ? {} : { oneTimeAt }), timeZone, ...(workspaceId === undefined ? {} : { workspaceId }),
      enabled, nextRunAt, ...(lastRun === undefined ? {} : { lastRun }),
    }))
  }

  /** Merge optional model edits against the current persisted task. */
  async updateFromModel(id: string, patch: Record<string, unknown>): Promise<CronTask> {
    const task = this.jobs.find(item => item.id === id)
    if (task === undefined) throw new TypeError('Cron task not found')
    const input = {
      name: patch.name ?? task.name,
      prompt: patch.prompt ?? task.prompt,
      expression: patch.expression ?? task.expression,
      oneTimeAt: patch.one_time_at ?? task.oneTimeAt,
      timeZone: patch.time_zone ?? task.timeZone,
      workspaceId: patch.workspace_id ?? task.workspaceId,
      enabled: patch.enabled ?? task.enabled,
    }
    return await this.action({ action: 'update', id, input }) as CronTask
  }

  private async serialized<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.queue
    let release!: () => void
    this.queue = new Promise<void>(resolve => { release = resolve })
    await previous
    try { return await operation() } finally { release() }
  }

  private async commit(jobs: CronTask[]): Promise<void> {
    await this.settings.replace({ jobs })
    this.jobs = jobs
    this.arm()
  }

  private async create(raw: unknown): Promise<CronTask> {
    const input = normalizeCronTaskInput(raw)
    return await this.serialized(async () => {
      this.assertRegistryMutable()
      this.refreshFromSettings()
      const task = createCronTask(input, this.now())
      await this.commit([...this.jobs, task])
      return task
    })
  }

  private async update(id: unknown, raw: unknown): Promise<CronTask> {
    if (typeof id !== 'string' || !id) throw new TypeError('Task id is required')
    const input = normalizeCronTaskInput(raw)
    return await this.serialized(async () => {
      this.assertRegistryMutable()
      const current = this.requireTask(id)
      const updatedAt = new Date(this.now()).toISOString()
      const workspaceChanged = input.workspaceId !== current.workspaceId
      const next: CronTask = Object.freeze({ ...current, ...input, id, updatedAt,
        ...(workspaceChanged ? { activeSessionId: undefined, activeSessionWorkspaceId: undefined } : {}),
        nextRunAt: (input.enabled ?? current.enabled)
          ? nextTaskRun(input, this.now()).toISOString()
          : null })
      await this.commit(this.jobs.map(job => job.id === id ? next : job))
      return next
    })
  }

  private async delete(id: unknown): Promise<object> {
    if (typeof id !== 'string' || !id) throw new TypeError('Task id is required')
    return await this.serialized(async () => {
      this.assertRegistryMutable()
      if (!this.jobs.some(job => job.id === id)) throw new TypeError('Cron task not found')
      await this.commit(this.jobs.filter(job => job.id !== id))
      return { id, deleted: true }
    })
  }

  private async toggle(id: unknown, enabled: unknown): Promise<CronTask> {
    if (typeof id !== 'string' || !id || typeof enabled !== 'boolean') throw new TypeError('Task id and enabled state are required')
    return await this.serialized(async () => {
      this.assertRegistryMutable()
      const current = this.requireTask(id)
      const updatedAt = new Date(this.now()).toISOString()
      const next: CronTask = Object.freeze({ ...current, enabled, updatedAt,
        nextRunAt: enabled ? nextTaskRun(current, this.now()).toISOString() : null })
      await this.commit(this.jobs.map(job => job.id === id ? next : job))
      return next
    })
  }

  private requireTask(id: string): CronTask {
    this.refreshFromSettings()
    const task = this.jobs.find(job => job.id === id)
    if (task === undefined) throw new TypeError('Cron task not found')
    return task
  }

  private assertRegistryMutable(): void {
    if (this.activePromises.size > 0 || this.running.size > 0) {
      throw new TypeError('Wait for the active Cron task run to finish before changing scheduled tasks')
    }
  }

  private refreshFromSettings(): void {
    this.replaceFromSettings(this.settings.get())
  }

  private replaceFromSettings(settings: CronTasksSettings): void {
    const jobs = settings.jobs.map(job => {
      // A live run deliberately keeps its claimed state in memory until the
      // Agent finishes. Persisting that claim through Settings would reload
      // this plugin and abort the very run that initiated the write. Reads and
      // watcher callbacks must therefore not replace a running task with its
      // pre-run persisted snapshot.
      if (this.running.has(job.id)) return this.jobs.find(current => current.id === job.id) ?? job
      return rehydrateCronTask(job, this.now())
    })
    if (deepEqualJson(jobs, this.jobs)) return
    this.jobs = jobs
    this.arm()
  }

  private run(id: unknown, scheduled: boolean): Promise<object> {
    if (this.activePromises.size > 0) return Promise.reject(new TypeError(
      typeof id === 'string' && this.activeByTask.has(id) ? 'Cron task is already running' : 'Another Cron task is already running',
    ))
    const operation = this.runOwned(id, scheduled)
    this.activePromises.add(operation)
    if (typeof id === 'string') this.activeByTask.set(id, operation)
    void operation.finally(() => {
      this.activePromises.delete(operation)
      if (typeof id === 'string' && this.activeByTask.get(id) === operation) this.activeByTask.delete(id)
    }).catch(() => {})
    return operation
  }

  private async cancel(id: unknown): Promise<object> {
    if (typeof id !== 'string' || !id) throw new TypeError('Task id is required')
    const controller = this.activeAbort.get(id)
    const operation = this.activeByTask.get(id)
    if (controller === undefined || operation === undefined) throw new TypeError('Cron task is not running')
    controller.abort(new Error('Cancelled by user'))
    await operation
    return { id, cancelling: true }
  }

  private async attachSession(id: unknown, sessionId: unknown): Promise<object> {
    if (typeof id !== 'string' || !id || typeof sessionId !== 'string' || !sessionId) {
      throw new TypeError('Task id and session id are required')
    }
    const task = this.requireTask(id)
    if (task.activeSessionId !== sessionId && !task.history.some(run => run.sessionId === sessionId)) {
      throw new TypeError('Session is not part of this Cron task history')
    }
    if (isArchived(this.runtime, sessionId)) throw new TypeError('This scheduled task session is archived')
    const workspaceId = task.workspaceId ?? this.runtime.defaultWorkspaceId?.()
    const workspace = workspaceId === undefined
      ? this.runtime.workspaceRegistry.list()[0]
      : this.runtime.workspaceRegistry.get(workspaceId as never)
    if (workspace === undefined) throw new Error('The selected Workspace no longer exists')
    await workspace.attachSession(SessionId(sessionId))
    return { id, sessionId, workspaceId: String(workspace.id), title: task.name, attached: true }
  }

  private async runOwned(id: unknown, scheduled: boolean): Promise<object> {
    if (typeof id !== 'string' || !id) throw new TypeError('Task id is required')
    const task = await this.serialized(async () => {
      if (this.disposed) throw new Error('Cron task scheduler is stopping')
      const current = this.requireTask(id)
      if (this.running.has(id)) throw new TypeError('Cron task is already running')
      if (!scheduled && !current.enabled) throw new TypeError('Enable the Cron task before running it')
      const pendingRunAt = current.pendingRunAt ?? current.nextRunAt ?? new Date(this.now()).toISOString()
      const nextRunAt = scheduled && current.enabled
        ? current.oneTimeAt === undefined ? nextCronTaskRun(current.expression, current.timeZone, this.now()).toISOString() : null
        : current.nextRunAt
      const claimed = Object.freeze({ ...current, pendingRunAt, pendingRunStartedAt: new Date(this.now()).toISOString(), nextRunAt })
      this.running.add(id)
      this.jobs = this.jobs.map(job => job.id === id ? claimed : job)
      this.arm()
      return claimed
    })
    const startedAt = new Date(this.now()).toISOString()
    const abort = new AbortController()
    this.activeAbort.set(id, abort)
    if (this.disposed) abort.abort(new Error('ClawClaw is shutting down'))
    let timedOut = false
    const timeout = setTimeout(() => {
      timedOut = true
      abort.abort(new Error(`Scheduled task exceeded its ${String(Math.round(this.runTimeoutMs / 60_000))} minute time limit`))
    }, this.runTimeoutMs)
    let run: CronTaskRun
    let resolvedSessionId: string | undefined
    try {
      const sessionId = await this.execute(task, abort.signal, async (sessionIdForRun, workspaceIdForRun) => {
        resolvedSessionId = sessionIdForRun
        const current = this.jobs.find(job => job.id === id)
        if (current !== undefined) this.jobs = this.jobs.map(job => job.id === id
          ? Object.freeze({ ...job, activeSessionId: sessionIdForRun, activeSessionWorkspaceId: workspaceIdForRun })
          : job)
      })
      run = { scheduledFor: task.pendingRunAt ?? startedAt, trigger: scheduled ? 'schedule' : 'manual',
        startedAt, finishedAt: new Date(this.now()).toISOString(), status: 'completed', sessionId }
      this.runtime.desktopRuntime?.notifyAttention({ title: 'Scheduled task completed', body: 'A scheduled task has finished.' })
    } catch (error) {
      const cancelled = abort.signal.aborted && !timedOut
      run = { scheduledFor: task.pendingRunAt ?? startedAt, trigger: scheduled ? 'schedule' : 'manual',
        startedAt, finishedAt: new Date(this.now()).toISOString(), status: cancelled ? 'cancelled' : 'failed', error: safeError(error),
        ...(resolvedSessionId === undefined ? {} : { sessionId: resolvedSessionId }) }
      this.runtime.desktopRuntime?.notifyAttention({ title: cancelled ? 'Scheduled task cancelled' : 'Scheduled task failed',
        body: cancelled ? 'A scheduled task was cancelled.' : 'A scheduled task failed. Open ClawClaw for details.' })
    } finally {
      clearTimeout(timeout)
      this.activeAbort.delete(id)
    }
    try {
      return await this.serialized(async () => {
        const current = this.jobs.find(job => job.id === id)
        if (current !== undefined) {
          const enabled = scheduled && current.oneTimeAt !== undefined ? false : current.enabled
          const nextRunAt = enabled
            ? current.nextRunAt !== null && Date.parse(current.nextRunAt) > this.now()
              ? current.nextRunAt
              : nextCronTaskRun(current.expression, current.timeZone, this.now()).toISOString()
            : null
          const updated: CronTask = Object.freeze({ ...current, enabled, lastRun: run,
            ...(run.sessionId === undefined ? {} : { activeSessionId: run.sessionId }),
            nextRunAt, pendingRunAt: null, pendingRunStartedAt: undefined })
          await this.commit(this.jobs.map(job => job.id === id
            ? Object.freeze({ ...updated, history: [run, ...current.history].slice(0, CRON_TASK_HISTORY_LIMIT) })
            : job))
        }
        return { id, run }
      })
    } finally {
      this.running.delete(id)
    }
  }

  private preview(raw: unknown): object {
    const input = normalizeCronTaskInput(raw)
    if (input.oneTimeAt !== undefined) return { occurrences: [nextTaskRun(input, this.now()).toISOString()] }
    const occurrences: string[] = []
    let cursor = this.now()
    for (let index = 0; index < 3; index += 1) {
      const next = nextCronTaskRun(input.expression, input.timeZone ?? 'UTC', cursor)
      occurrences.push(next.toISOString())
      cursor = next.getTime()
    }
    return { occurrences }
  }

  private arm(): void {
    if (this.disposed) return
    if (this.timer !== undefined) clearTimeout(this.timer)
    this.timer = undefined
    const nextAt = this.jobs.filter(job => job.enabled && job.nextRunAt !== null)
      .reduce<number | undefined>((earliest, job) => {
        const time = Date.parse(job.nextRunAt as string)
        return Number.isFinite(time) && (earliest === undefined || time < earliest) ? time : earliest
      }, undefined)
    if (nextAt === undefined) return
    this.timer = setTimeout(() => {
      this.timer = undefined
      void this.fireDue()
    }, Math.max(0, Math.min(nextAt - this.now(), MAX_TIMER_DELAY_MS)))
  }

  private async fireDue(): Promise<void> {
    const due = this.jobs.filter(job => job.enabled && job.nextRunAt !== null && Date.parse(job.nextRunAt) <= this.now())
    for (const task of due) {
      if (this.jobs.some(job => job.id === task.id && job.enabled)) void this.run(task.id, true).catch(() => {})
    }
    this.arm()
  }
}

/**
 * Mount the stable Desktop HTTP facade for the reloadable Cron controller.
 * The owner context must outlive the editable Cron plugin entry; each request
 * resolves the current service instance so a Settings reconciliation cannot
 * take the routes down with the controller it replaces.
 */
export function registerCronTasksJsonApi(ctx: Context): void {
  ctx.provide('desktopCronAgentHost', {
    get: sessionId => ctx.agents.get(sessionId),
    create: options => ctx.agents.create(options),
    resume: options => ctx.agents.resume(options),
  })
  const current = (): CronTaskController => {
    const controller = ctx.get('desktopCronTasksController')
    if (controller === undefined) throw new Error('Cron task service is temporarily unavailable')
    return controller
  }
  registerDesktopJsonApi(ctx, { label: 'Cron tasks', readPath: DESKTOP_CRON_TASKS_PATH,
    actionPath: DESKTOP_CRON_TASKS_ACTION_PATH, read: () => current().read(), action: value => current().action(value) })
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register(DESKTOP_CRON_TASKS_SETTINGS_NAMESPACE, CronTasksSettingsSchema,
    { applies: 'live' })
  const runtime: CronRuntime = { agents: ctx.agents, sessions: ctx.sessions, sessionTitle: ctx.sessionTitle,
    agentHost: ctx.desktopCronAgentHost,
    agentDefaultModel: ctx.agentDefaultModel, workspaceRegistry: ctx.workspaceRegistry,
    defaultWorkspaceId: () => {
      const descriptor = ctx.settings.describe().find(item => String(item.ns) === DESKTOP_WORKSPACE_SETTINGS_NAMESPACE)
      const value = descriptor?.value as { readonly defaultWorkspaceId?: unknown } | undefined
      return typeof value?.defaultWorkspaceId === 'string' && value.defaultWorkspaceId !== '' ? value.defaultWorkspaceId : undefined
    },
    ...(ctx.get('desktopRuntime') === undefined ? {} : { desktopRuntime: ctx.get('desktopRuntime') as DesktopRuntime }) }
  const controller = new CronTaskController(runtime, settings)
  ctx.provide('desktopCronTasksController', controller)
  const stopSettings = settings.watch?.(next => { controller.syncFromSettings(next) }) ?? (() => {})
  controller.start()
  const toolDisposers = [
    ctx.tools.register(defineTool({
      name: 'cron_task_create',
      description: 'Create a persistent desktop scheduled task that appears in ClawClaw Automations. Supports recurring Cron schedules and exact one-time runs.',
      parameters: {
        name: { type: 'string', required: true, description: 'Short task name.' },
        prompt: { type: 'string', required: true, description: 'The actual work and result to produce on each occurrence. Do not mention creating, managing, describing, or recording the automation itself; run history is automatic.' },
        expression: { type: 'string', required: true, description: 'Five-field cron expression, for example 0 9 * * 1-5.' },
        one_time_at: { type: 'string', description: 'Optional ISO 8601 instant for a one-time task. The task disables itself after this scheduled run.' },
        time_zone: { type: 'string', description: 'IANA timezone, for example Asia/Shanghai.' },
        workspace_id: { type: 'string', description: 'Optional workspace id; defaults to the current default workspace.' },
      },
      output: { schema: { type: 'string' as const }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
      async execute(args, exec) {
        if (exec.signal.aborted) throw exec.signal.reason
        const task = await controller.action({ action: 'create', input: {
          name: args.name, prompt: args.prompt, expression: args.expression,
          ...(args.one_time_at === undefined ? {} : { oneTimeAt: args.one_time_at }),
          ...(args.time_zone === undefined ? {} : { timeZone: args.time_zone }),
          ...(args.workspace_id === undefined ? {} : { workspaceId: args.workspace_id }),
        } })
        return JSON.stringify(task)
      },
      presentCall: args => ({ card: 'generic', title: 'Create scheduled task', kind: 'other', rawInput: args }),
    })),
    ctx.tools.register(defineTool({
      name: 'cron_task_list',
      description: 'List persistent desktop scheduled tasks managed by ClawClaw Automations.',
      parameters: {},
      output: { schema: { type: 'string' as const }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
      async execute(_args, exec) {
        if (exec.signal.aborted) throw exec.signal.reason
        return JSON.stringify(await controller.listForModel())
      },
      presentCall: () => ({ card: 'generic', title: 'List scheduled tasks', kind: 'read' }),
    })),
    ctx.tools.register(defineTool({
      name: 'cron_task_update',
      description: 'Update selected fields of a persistent desktop scheduled task by exact task id. Use cron_task_list first when the id is unknown.',
      parameters: {
        id: { type: 'string', required: true },
        name: { type: 'string' }, prompt: { type: 'string' }, expression: { type: 'string' },
        one_time_at: { type: 'string' }, time_zone: { type: 'string' }, workspace_id: { type: 'string' }, enabled: { type: 'boolean' },
      },
      output: { schema: { type: 'string' as const }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
      async execute(args, exec) {
        if (exec.signal.aborted) throw exec.signal.reason
        const task = await controller.updateFromModel(args.id, args)
        return JSON.stringify(task)
      },
      presentCall: args => ({ card: 'generic', title: 'Update scheduled task', kind: 'other', rawInput: args }),
    })),
    ctx.tools.register(defineTool({
      name: 'cron_task_delete',
      description: 'Delete a persistent desktop scheduled task by exact task id. Use cron_task_list first when the id is unknown.',
      parameters: { id: { type: 'string', required: true } },
      output: { schema: { type: 'string' as const }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
      async execute(args, exec) {
        if (exec.signal.aborted) throw exec.signal.reason
        return JSON.stringify(await controller.action({ action: 'delete', id: args.id }))
      },
      presentCall: args => ({ card: 'generic', title: 'Delete scheduled task', kind: 'other', rawInput: args }),
    })),
    ctx.tools.register(defineTool({
      name: 'cron_task_run',
      description: 'Run an enabled persistent desktop scheduled task now. The run appears in its settings-page history.',
      parameters: { id: { type: 'string', required: true } },
      output: { schema: { type: 'string' as const }, render: (_args, value) => [{ type: 'text' as const, text: value }] },
      async execute(args, exec) {
        if (exec.signal.aborted) throw exec.signal.reason
        return JSON.stringify(await controller.action({ action: 'run', id: args.id }))
      },
      presentCall: args => ({ card: 'generic', title: 'Run scheduled task', kind: 'other', rawInput: args }),
    })),
  ]
  ctx.effect(() => () => {
    stopSettings()
    for (const dispose of toolDisposers) dispose()
    controller.dispose()
  }, 'dsh-plugin-desktop: Cron task scheduler')
}
