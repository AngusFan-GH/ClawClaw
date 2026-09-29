/** Durable desktop Cron task values and timezone-aware schedule validation. */

import { randomUUID } from 'node:crypto'
import { CronExpressionParser } from 'cron-parser'

export type CronTaskStatus = 'idle' | 'running' | 'completed' | 'failed' | 'cancelled' | 'skipped'

export interface CronTaskRun {
  readonly scheduledFor?: string
  readonly trigger?: 'schedule' | 'manual'
  readonly startedAt: string
  readonly finishedAt: string
  readonly status: 'completed' | 'failed' | 'cancelled' | 'skipped'
  readonly error?: string
  readonly sessionId?: string
}

export interface CronTask {
  readonly id: string
  readonly name: string
  readonly prompt: string
  readonly expression: string
  /** Exact instant for a task that disables itself after its scheduled run. */
  readonly oneTimeAt?: string | undefined
  readonly timeZone: string
  readonly workspaceId?: string | undefined
  /** Current durable conversation for this task. Archived or missing sessions are rotated on the next run. */
  readonly activeSessionId?: string | undefined
  /** Workspace identity captured with activeSessionId so default-workspace changes rotate safely. */
  readonly activeSessionWorkspaceId?: string | undefined
  readonly enabled: boolean
  readonly createdAt: string
  readonly updatedAt: string
  readonly nextRunAt: string | null
  /** A durably claimed execution. On restart it becomes a failed run instead of being replayed. */
  readonly pendingRunAt: string | null
  readonly pendingRunStartedAt?: string | undefined
  readonly lastRun?: CronTaskRun
  readonly history: readonly CronTaskRun[]
}

export interface CronTaskInput {
  readonly name: string
  readonly prompt: string
  readonly expression: string
  readonly oneTimeAt?: string | undefined
  readonly timeZone?: string
  readonly workspaceId?: string | undefined
  readonly enabled?: boolean
}

const MAX_NAME_LENGTH = 120
const MAX_PROMPT_LENGTH = 16_000
export const CRON_TASK_HISTORY_LIMIT = 20

function validateTimeZone(timeZone: string): void {
  try {
    new Intl.DateTimeFormat('en', { timeZone }).format(0)
  } catch {
    throw new TypeError(`Invalid IANA time zone: ${timeZone}`)
  }
}

/** Compute the next strict-future fire time using the requested IANA zone. */
export function nextCronTaskRun(expression: string, timeZone: string, after = Date.now()): Date {
  validateTimeZone(timeZone)
  if (!Number.isFinite(after)) throw new TypeError('Cron reference time must be finite')
  const fields = expression.trim().split(/\s+/)
  if (fields.length !== 5) throw new TypeError('Cron expression must contain five fields')
  const interval = CronExpressionParser.parse(`0 ${fields.join(' ')}`, {
    currentDate: new Date(after),
    tz: timeZone,
    strict: true,
  })
  return interval.next().toDate()
}

/** Compute the next run for either a recurring Cron task or an exact one-time task. */
export function nextTaskRun(input: Pick<CronTaskInput, 'expression' | 'timeZone' | 'oneTimeAt'>, after = Date.now()): Date {
  if (input.oneTimeAt === undefined) return nextCronTaskRun(input.expression, input.timeZone ?? 'UTC', after)
  const value = new Date(input.oneTimeAt)
  if (!Number.isFinite(value.getTime())) throw new TypeError('One-time run must be a valid date')
  if (value.getTime() <= after) throw new TypeError('One-time run must be in the future')
  return value
}

/** Validate a task input and return normalized fields. */
export function normalizeCronTaskInput(value: unknown): CronTaskInput {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Task input must be an object')
  const input = value as Record<string, unknown>
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const prompt = typeof input.prompt === 'string' ? input.prompt.trim() : ''
  const expression = typeof input.expression === 'string' ? input.expression.trim() : ''
  const oneTimeAt = typeof input.oneTimeAt === 'string' && input.oneTimeAt.trim()
    ? new Date(input.oneTimeAt).toISOString()
    : undefined
  const timeZone = typeof input.timeZone === 'string' && input.timeZone.trim()
    ? input.timeZone.trim()
    : Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC'
  const workspaceId = typeof input.workspaceId === 'string' && input.workspaceId.trim()
    ? input.workspaceId.trim()
    : undefined
  if (!name || name.length > MAX_NAME_LENGTH) throw new TypeError(`Task name must contain 1 to ${MAX_NAME_LENGTH} characters`)
  if (!prompt || prompt.length > MAX_PROMPT_LENGTH) throw new TypeError(`Task prompt must contain 1 to ${MAX_PROMPT_LENGTH} characters`)
  if (expression.length > 256) throw new TypeError('Cron expression is too long')
  if (oneTimeAt === undefined) nextCronTaskRun(expression, timeZone)
  else validateTimeZone(timeZone)
  return Object.freeze({ name, prompt, expression, oneTimeAt, timeZone, workspaceId,
    ...(typeof input.enabled === 'boolean' ? { enabled: input.enabled } : {}) })
}

/** Create a new task with its first next-run timestamp. */
export function createCronTask(input: CronTaskInput, now = Date.now()): CronTask {
  const createdAt = new Date(now).toISOString()
  const enabled = input.enabled ?? true
  const nextRunAt = enabled ? nextTaskRun(input, now).toISOString() : null
  return Object.freeze({ id: randomUUID(), name: input.name, prompt: input.prompt,
    expression: input.expression, timeZone: input.timeZone ?? 'UTC',
    ...(input.oneTimeAt === undefined ? {} : { oneTimeAt: input.oneTimeAt }),
    ...(input.workspaceId === undefined ? {} : { workspaceId: input.workspaceId }),
    enabled, createdAt, updatedAt: createdAt,
    nextRunAt,
    pendingRunAt: null,
    history: Object.freeze([]) })
}

function recoveryRun(task: CronTask, now: number, status: 'failed' | 'skipped', error: string): CronTaskRun {
  const scheduledFor = task.pendingRunAt ?? task.nextRunAt ?? new Date(now).toISOString()
  return Object.freeze({
    scheduledFor,
    trigger: 'schedule',
    startedAt: task.pendingRunStartedAt ?? scheduledFor,
    finishedAt: new Date(now).toISOString(),
    status,
    error,
  })
}

/** Rebuild the next time after boot without replaying potentially side-effecting work. */
export function rehydrateCronTask(task: CronTask, now = Date.now()): CronTask {
  const oneTimeAt = task.oneTimeAt?.trim() || undefined
  const interrupted = task.pendingRunAt !== null
  let history = task.history
  if (interrupted) {
    history = Object.freeze([recoveryRun(task, now, 'failed',
      'ClawClaw stopped before this run finished. It was not retried to avoid duplicate side effects.'), ...history]
      .slice(0, CRON_TASK_HISTORY_LIMIT))
  } else if (task.enabled && task.nextRunAt !== null && Date.parse(task.nextRunAt) <= now) {
    history = Object.freeze([recoveryRun(task, now, 'skipped',
      'The scheduled time passed while ClawClaw was not running.'), ...history].slice(0, CRON_TASK_HISTORY_LIMIT))
  }
  if (oneTimeAt !== undefined) {
    const instant = Date.parse(oneTimeAt)
    const missed = instant <= now || interrupted
    return Object.freeze({ ...task, oneTimeAt, enabled: task.enabled && !missed,
      nextRunAt: task.enabled && !missed ? new Date(instant).toISOString() : null,
      pendingRunAt: null, pendingRunStartedAt: undefined, history })
  }
  return Object.freeze({ ...task, nextRunAt: task.enabled
    ? nextCronTaskRun(task.expression, task.timeZone, now).toISOString()
    : null, pendingRunAt: null, pendingRunStartedAt: undefined, history })
}
