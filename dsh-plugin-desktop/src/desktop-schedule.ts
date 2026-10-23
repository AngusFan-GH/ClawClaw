/** Official Schedule timer with Desktop ownership, durable admission and legacy history. */
import { createHash, randomUUID } from 'node:crypto'
import { mkdir, open, readFile, unlink } from 'node:fs/promises'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import { SessionId } from '@deepseek-ai/dsh-session'
import ScheduleService, { scheduleDomain, ScheduleId, canonicalizeCronExpression, decodeScheduleRecord, createCronScheduleRecord } from '@deepseek-ai/dsh-schedule'
import type { ScheduleRecord } from '@deepseek-ai/dsh-schedule'
import { defineDomain } from '@deepseek-ai/dsh-storage-domain'
import type { DomainGlobalSpec } from '@deepseek-ai/dsh-storage-domain'
import type { ContextFormed } from '@deepseek-ai/dsh-llm'
import { z } from 'zod'
import type { CronTaskController, CronTasksSettingsScope } from './cron-tasks.ts'
import { rehydrateCronTask, nextCronTaskRun } from './cron-task-domain.ts'
import type { CronTask } from './cron-task-domain.ts'

interface Registry {
  version: 1
  migrated: boolean
  sourceHash: string
  originalJobs: CronTask[]
  jobs: CronTask[]
  archivedJobs: CronTask[]
  reservedSessionIds: string[]
}
declare module '@deepseek-ai/dsh-llm' {
  interface MessageSourceMap { schedule: { kind: 'schedule' } & ContextFormed }
}
const runSchema = z.object({ scheduledFor: z.string().optional(), trigger: z.enum(['schedule', 'manual']).optional(),
  startedAt: z.string(), finishedAt: z.string(), status: z.enum(['completed', 'failed', 'cancelled', 'skipped']),
  error: z.string().optional(), sessionId: z.string().optional() }).passthrough()
// Unlike configuration schemas, a durable decoder must never materialize optional objects as {}.
const jobSchema = z.object({ id: z.string().min(1), name: z.string().min(1), prompt: z.string().min(1),
  expression: z.string(), timeZone: z.string(), oneTimeAt: z.string().optional(), workspaceId: z.string().optional(),
  activeSessionId: z.string().optional(), activeSessionWorkspaceId: z.string().optional(), enabled: z.boolean(),
  createdAt: z.string(), updatedAt: z.string(), nextRunAt: z.string().nullable(), pendingRunAt: z.string().nullable(),
  pendingRunStartedAt: z.string().optional(), lastClaimedAt: z.string().optional(), lastClaimedMessageId: z.string().optional(),
  lastRun: z.preprocess(value => value !== null && typeof value === 'object'
    && Object.values(value).every(item => item === undefined) ? undefined : value, runSchema.optional()),
  history: z.array(runSchema) }).passthrough()
const jobsSchema = z.array(jobSchema)
const registrySchema = z.object({ version: z.literal(1), migrated: z.boolean(), sourceHash: z.string(),
  originalJobs: jobsSchema, jobs: jobsSchema, archivedJobs: jobsSchema, reservedSessionIds: z.array(z.string()) }).strict()

/** Parse only the pinned upstream's explicit JSON envelope, never task instructions. */
export function scheduleOccurrence(text: string): { id: string; at: string } | undefined {
  if (text.startsWith('[SCHEDULE REMINDER BATCH]\n')) {
    const line = text.split('\n').find(line => line.startsWith('reminders_json: '))
    const batch: unknown = line === undefined ? undefined : JSON.parse(line.slice('reminders_json: '.length))
    if (!Array.isArray(batch) || batch.length !== 1) return undefined
    const item = batch[0] as Record<string, unknown>
    return typeof item.schedule_id === 'string' && typeof item.occurrence_at === 'string'
      ? { id: item.schedule_id, at: item.occurrence_at } : undefined
  }
  if (!text.startsWith('[SCHEDULE REMINDER]\n')) return undefined
  const lines = text.split('\n')
  const id = lines.find(line => line.startsWith('schedule_id_json: '))
  const at = lines.find(line => line.startsWith('occurrence_at: '))
  const value: unknown = id === undefined ? undefined : JSON.parse(id.slice('schedule_id_json: '.length))
  return typeof value === 'string' && at !== undefined ? { id: value, at: at.slice('occurrence_at: '.length) } : undefined
}

/** Construct a schema-checked official record without moving the committed target. */
export function officialRecord(task: CronTask, now: number): ScheduleRecord {
  const scheduledAt = task.oneTimeAt ?? task.nextRunAt ?? new Date(now).toISOString()
  return decodeScheduleRecord(task.oneTimeAt === undefined
    ? { id: task.id, kind: 'cron', title: task.name, prompt: task.prompt,
      expression: canonicalizeCronExpression(task.expression), timeZone: task.timeZone, scheduledAt }
    : { id: task.id, kind: 'at', title: task.name, prompt: task.prompt, scheduledAt })
}

/** Refuse incompatible dialects or observed timing differences rather than silently changing rules. */
export function validateScheduleRule(task: CronTask, now: number): void {
  officialRecord(task, now)
  if (task.oneTimeAt !== undefined) return
  let cursor = now
  for (let index = 0; index < 8; index++) {
    const legacy = nextCronTaskRun(task.expression, task.timeZone, cursor).toISOString()
    const official = createCronScheduleRecord(ScheduleId(task.id), task.prompt,
      { expression: task.expression, time_zone: task.timeZone }, cursor, task.name).scheduledAt
    if (legacy !== official) throw new Error(`Task ${task.id}: Cron timing changes under Schedule; migration refused`)
    cursor = Date.parse(legacy)
  }
}

/** One process may own a Profile's automation scheduler; damaged leases fail closed. */
export async function acquireScheduleLease(directory: string): Promise<() => Promise<void>> {
  const path = join(directory, 'desktop-schedule.lock')
  const token = randomUUID()
  const record = JSON.stringify({ pid: process.pid, token })
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const file = await open(path, 'wx', 0o600)
      try { await file.writeFile(record); await file.sync() } finally { await file.close() }
      return async () => {
        if ((await readFile(path, 'utf8')) === record) await unlink(path)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      // Serialize stale-owner removal: two recovering Hosts must not unlink a successor's lease.
      const recoveryPath = `${path}.recovery`
      const recovery = await open(recoveryPath, 'wx', 0o600)
      try {
        const previous = JSON.parse(await readFile(path, 'utf8')) as { pid?: number; token?: string }
        if (!Number.isSafeInteger(previous.pid) || previous.pid! <= 0 || !previous.token) throw new Error('Invalid Desktop Schedule ownership lease')
        try { process.kill(previous.pid!, 0); throw new Error('Desktop Schedule is already owned by a live Host') }
        catch (cause) { if ((cause as NodeJS.ErrnoException).code !== 'ESRCH') throw cause }
        await unlink(path)
      } finally { await recovery.close(); await unlink(recoveryPath) }
    }
  }
  throw new Error('Could not acquire Desktop Schedule ownership')
}

export async function startDesktopSchedule(
  ctx: Context,
  legacy: CronTasksSettingsScope,
  createController: (store: CronTasksSettingsScope) => CronTaskController,
): Promise<{ controller: CronTaskController; sync(): Promise<void> }> {
  const startedAt = Date.now()
  const profileDir = ctx.profileContext.dir
  const scope = createHash('sha256').update(profileDir).digest('hex').slice(0, 20)
  const releaseLease = await acquireScheduleLease(profileDir)
  ctx.effect(() => releaseLease, 'Desktop Schedule exclusive Profile ownership')
  const spec = defineDomain({ name: `desktop_schedule_registry_${scope}`, version: 1,
    // Both packages use Zod 4; bridge their independently pinned declaration versions.
    global: { schema: registrySchema as unknown as DomainGlobalSpec<Registry>['schema'], initial: { version: 1, migrated: false, sourceHash: '',
      originalJobs: [], jobs: [], archivedJobs: [], reservedSessionIds: [] } as Registry }, tables: {} })
  const coreSpec = { ...scheduleDomain, name: `desktop_schedule_core_${scope}` }
  const domain = await ctx.storageDomain.open(spec)
  ctx.effect(() => () => domain.close(), 'Desktop Schedule registry')
  const current = (): Registry => domain.global.get()
  const replaceJobs = async (jobs: CronTask[]): Promise<void> => {
    for (const job of jobs) {
      validateScheduleRule(job, Date.now())
      const id = job.workspaceId ?? job.activeSessionWorkspaceId
      if ((id === undefined ? ctx.workspaceRegistry.list()[0] : ctx.workspaceRegistry.get(id as never)) === undefined) {
        throw new Error(`Task ${job.id}: Workspace is unavailable`)
      }
      if (job.enabled && job.activeSessionId !== undefined
        && ctx.workspaceRegistry.archivedSessionIds.includes(SessionId(job.activeSessionId))) {
        throw new Error(`Task ${job.id}: unarchive its Session before enabling the task`)
      }
    }
    const previous = current()
    const removed = previous.jobs.filter(job => !jobs.some(next => next.id === job.id))
    await domain.global.set({ ...previous, jobs, archivedJobs: [...previous.archivedJobs, ...removed] })
  }
  if (!current().migrated) {
    const originalJobs = structuredClone(legacy.get().jobs)
    if (new Set(originalJobs.map(job => job.id)).size !== originalJobs.length) throw new Error('Duplicate legacy task ids; migration refused')
    const sourceHash = createHash('sha256').update(JSON.stringify(originalJobs)).digest('hex')
    const backupDirectory = join(profileDir, 'migration-backups')
    await mkdir(backupDirectory, { recursive: true, mode: 0o700 })
    const backupPath = join(backupDirectory, `desktop-schedule-v1-${sourceHash}.json`)
    const backup = JSON.stringify({ version: 1, sourceHash, originalJobs }, null, 2)
    try {
      const file = await open(backupPath, 'wx', 0o600)
      try { await file.writeFile(backup); await file.sync() } finally { await file.close() }
    }
    catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST' || await readFile(backupPath, 'utf8') !== backup) throw error
    }
    // Validate every rule before publishing ownership. Never partially import a task list.
    for (const job of originalJobs) validateScheduleRule(job, startedAt)
    await domain.global.set({ version: 1, migrated: true, sourceHash, originalJobs,
      jobs: originalJobs.map(job => rehydrateCronTask(job, startedAt, Infinity)), archivedJobs: [], reservedSessionIds: [] })
  } else {
    await replaceJobs(current().jobs.map(job => rehydrateCronTask(job, startedAt, Infinity)))
  }
  const store: CronTasksSettingsScope = { durableSchedule: true,
    archivedJobs: () => current().archivedJobs,
    get: () => ({ jobs: current().jobs }), replace: async value => { await replaceJobs((value as { jobs: CronTask[] }).jobs) } }
  const controller = createController(store)
  let core: Context['fiber'] | undefined
  let chain: Promise<void> = Promise.resolve()
  let stopping = false
  const allowed = new Map<string, { agent: object; turn: number }>()
  const manualAdmissions = new Set<string>()
  ctx.on('agent/pre-step', async ({ agent, turn, signal, messages }, next) => {
    const decision = await next()
    if (decision.kind === 'reject') return decision
    const accepted = []
    for (const message of decision.messages) {
      if (message.source?.kind === 'desktop-automation') {
        const previous = allowed.get(String(message.id))
        if (previous?.agent === agent && previous.turn === turn) { accepted.push(message); continue }
        if (!manualAdmissions.has(String(message.id))
          && controller.manualMessageAllowed(message.source.taskId, String(message.id), String(agent.id))) {
          manualAdmissions.add(String(message.id)); allowed.set(String(message.id), { agent, turn }); accepted.push(message)
        }
        continue
      }
      if (message.source?.kind !== 'schedule') { accepted.push(message); continue }
      const previous = allowed.get(String(message.id))
      if (previous?.agent === agent && previous.turn === turn) { accepted.push(message); continue }
      let occurrence: ReturnType<typeof scheduleOccurrence>
      try { occurrence = scheduleOccurrence(message.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')) }
      catch { occurrence = undefined }
      if (signal.aborted || occurrence === undefined || !Number.isFinite(Date.parse(occurrence.at))
        || Date.parse(occurrence.at) <= startedAt) continue
      if (await controller.admitScheduled(occurrence.id, occurrence.at, String(message.id), agent)) {
        allowed.set(String(message.id), { agent, turn }); accepted.push(message)
      }
    }
    // Other listeners may add clock/model notices. They must not turn a rejected
    // old automation message into an otherwise empty model request.
    if (messages.length > 0 && messages.every(message => message.source?.kind === 'schedule'
      || message.source?.kind === 'desktop-automation')
      && !accepted.some(message => messages.some(original => original.id === message.id))) return { kind: 'reject' }
    return { ...decision, messages: accepted }
  }, { global: true, prepend: true })
  ctx.on('agent/turn-stopping', ({ agent, turn }) => {
    for (const [id, owner] of allowed) if (owner.agent === agent && owner.turn === turn) allowed.delete(id)
  }, { global: true })
  ctx.on('workspace/session-stop', async ({ sessionId }) => {
    await controller.stopForSessionArchive(String(sessionId))
  }, { global: true, prepend: true })

  const ensureBindings = async (): Promise<void> => {
    for (const original of current().jobs) {
      let task = current().jobs.find(job => job.id === original.id)!
      const workspaceId = task.workspaceId ?? task.activeSessionWorkspaceId
      const workspace = workspaceId === undefined ? ctx.workspaceRegistry.list()[0] : ctx.workspaceRegistry.get(workspaceId as never)
      if (workspace === undefined) throw new Error(`Schedule task ${task.id}: original Workspace is unavailable`)
      if (task.activeSessionId === undefined) {
        const id = `cron-${randomUUID()}`
        task = { ...task, workspaceId: String(workspace.id), activeSessionId: id, activeSessionWorkspaceId: String(workspace.id) }
        await domain.global.set({ ...current(), jobs: current().jobs.map(job => job.id === task.id ? task : job),
          reservedSessionIds: [...current().reservedSessionIds, id] })
      } else if (task.workspaceId === undefined) {
        task = { ...task, workspaceId: String(workspace.id) }
        await replaceJobs(current().jobs.map(job => job.id === task.id ? task : job))
      }
      const id = SessionId(task.activeSessionId!)
      try {
        using observation = await ctx.sessionQuery.observeSession(id)
        if (observation.header.cwd !== workspace.path) throw new Error(`Schedule task ${task.id}: Session Workspace differs; migration refused`)
      } catch (error) {
        if (!current().reservedSessionIds.includes(String(id))
          || (error as { code?: string }).code !== 'SESSION_QUERY_SESSION_NOT_FOUND') throw error
        const model = ctx.agentDefaultModel.currentSelection()
        const handle = await ctx.desktopCronAgentHost.create({ sessionId: id, meta: { cwd: workspace.path },
          agentOptions: { provider: model.provider, model: model.model },
          setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx) } })
        await ctx.workspaceRegistry.get(workspace.id)!.attachSession(id)
        await ctx.sessions.flush(handle.agent.session)
      }
    }
    const ids = current().jobs.map(job => job.activeSessionId)
    if (new Set(ids).size !== ids.length) throw new Error('Multiple Desktop tasks share one Session; migration refused')
  }
  const sync = (): Promise<void> => {
    const run = chain.then(async () => {
      if (stopping) throw new Error('Desktop Schedule is stopping')
      await core?.dispose(); core = undefined
      await ensureBindings()
      const tasks = await ctx.storageDomain.open(coreSpec)
      try {
        const table = tasks.table('tasks')
        const jobs = current().jobs
        for (const [id] of table.entries()) if (!jobs.some(job => job.id === String(id))) await table.delete(id)
        for (const job of jobs) {
          const record = officialRecord(job, Date.now())
          const previous = table.get(ScheduleId(job.id))
          await table.put(ScheduleId(job.id), { ...previous, sessionId: SessionId(job.activeSessionId!), record,
            status: job.enabled && job.nextRunAt !== null ? 'active' : 'inactive' })
        }
      } finally { await tasks.close() }
      // Only storage routing is adapted. Timing, wakeups, queueing and receipts are upstream's service.
      class DesktopScheduleCore extends ScheduleService {
        override async create(..._args: Parameters<ScheduleService['create']>): ReturnType<ScheduleService['create']> {
          throw new Error('Use the Desktop Automations API to preserve execution history and ownership')
        }
        override async update(..._args: Parameters<ScheduleService['update']>): ReturnType<ScheduleService['update']> {
          throw new Error('Use the Desktop Automations API to preserve execution history and ownership')
        }
        override async delete(..._args: Parameters<ScheduleService['delete']>): ReturnType<ScheduleService['delete']> {
          throw new Error('Use the Desktop Automations API to preserve execution history and ownership')
        }
        constructor(owner: Context) {
          const storageDomain = { open: async () => await ctx.storageDomain.open(coreSpec) }
          const facade = new Proxy(owner, { get(target, key, receiver) {
            return key === 'storageDomain' ? storageDomain : Reflect.get(target, key, receiver)
          } })
          super(facade, {})
        }
      }
      core = await ctx.plugin(DesktopScheduleCore, {})
    })
    chain = run.catch(() => {})
    return run
  }
  ctx.effect(() => async () => {
    stopping = true; controller.dispose(); await chain; await core?.dispose()
  }, 'Desktop Schedule core lifecycle')
  await sync()
  return { controller, sync }
}
