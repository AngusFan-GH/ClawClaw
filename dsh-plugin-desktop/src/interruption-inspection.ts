/** Read-only Host snapshot used before an operation stops the Desktop process. */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-jobs'
import type {} from './cron-tasks.ts'

/** Counts only; never expose live Cordis objects across the Host RPC boundary. */
export interface DesktopInterruptionSnapshot {
  readonly activeAgents: number
  readonly queuedMessages: number
  readonly activeJobs: number
  readonly runningCronTasks: number
  readonly scheduledCronTasks: number
}

export interface DesktopCronInterruptionState {
  readonly running: number
  readonly scheduled: number
}

export const EMPTY_DESKTOP_INTERRUPTION_SNAPSHOT: DesktopInterruptionSnapshot = Object.freeze({
  activeAgents: 0,
  queuedMessages: 0,
  activeJobs: 0,
  runningCronTasks: 0,
  scheduledCronTasks: 0,
})

/** Validate the private-RPC payload before it can authorize a silent quit. */
export function parseDesktopInterruptionSnapshot(value: unknown): DesktopInterruptionSnapshot {
  if (value === null || typeof value !== 'object') throw new TypeError('Invalid interruption snapshot')
  const candidate = value as Record<string, unknown>
  const keys = ['activeAgents', 'queuedMessages', 'activeJobs', 'runningCronTasks', 'scheduledCronTasks'] as const
  for (const key of keys) {
    if (!Number.isSafeInteger(candidate[key]) || (candidate[key] as number) < 0) {
      throw new TypeError('Invalid interruption snapshot')
    }
  }
  return Object.freeze({
    activeAgents: candidate.activeAgents as number,
    queuedMessages: candidate.queuedMessages as number,
    activeJobs: candidate.activeJobs as number,
    runningCronTasks: candidate.runningCronTasks as number,
    scheduledCronTasks: candidate.scheduledCronTasks as number,
  })
}

/** Whether stopping now can interrupt work already admitted by the Host. */
export function hasDesktopActiveInterruptions(snapshot: DesktopInterruptionSnapshot): boolean {
  return snapshot.activeAgents > 0 || snapshot.queuedMessages > 0
    || snapshot.activeJobs > 0 || snapshot.runningCronTasks > 0
}

/** Whether stopping now disables work that is armed for a future time. */
export function hasDesktopScheduledInterruptions(snapshot: DesktopInterruptionSnapshot): boolean {
  return snapshot.scheduledCronTasks > 0
}

/** Inspect the public DSH registries plus the optional ClawClaw Cron service. */
export async function inspectDesktopInterruptions(ctx: Context): Promise<DesktopInterruptionSnapshot> {
  const agents = ctx.get('agents')
  const jobs = ctx.get('jobs')
  if (agents === undefined || jobs === undefined) {
    throw new Error('dsh-plugin-desktop: interruption services are unavailable')
  }
  const liveAgents = agents.list()
  const activeAgents = liveAgents.filter(agent => agent.status === 'running').length
  const queuedMessages = liveAgents.reduce(
    (count, agent) => count + agent.inbox.nextTurn.length + agent.inbox.nextStep.length,
    0,
  )
  const activeJobIds = new Set<string>()
  for (const caller of [undefined, ...liveAgents.map(agent => agent.id)]) {
    for (const job of jobs.list(caller)) {
      if (job.status === 'running' || job.status === 'stopping') activeJobIds.add(String(job.id))
    }
  }
  const cron = ctx.get('desktopCronTasksController')
  const cronState = cron === undefined
    ? { running: 0, scheduled: 0 }
    : await cron.interruptionState()
  return Object.freeze({
    activeAgents,
    queuedMessages,
    activeJobs: activeJobIds.size,
    runningCronTasks: cronState.running,
    scheduledCronTasks: cronState.scheduled,
  })
}
