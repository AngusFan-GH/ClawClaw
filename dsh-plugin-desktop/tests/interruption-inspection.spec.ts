import { describe, expect, it, vi } from 'vitest'
import {
  hasDesktopActiveInterruptions,
  hasDesktopScheduledInterruptions,
  inspectDesktopInterruptions,
  parseDesktopInterruptionSnapshot,
} from '../src/interruption-inspection.ts'

function fixture() {
  const agents = [
    { id: 'idle-agent', status: 'idle', inbox: { nextTurn: [{}], nextStep: [] } },
    { id: 'running-agent', status: 'running', inbox: { nextTurn: [], nextStep: [{}, {}] } },
  ]
  const cron = { interruptionState: vi.fn(async () => ({ running: 1, scheduled: 3 })) }
  const jobs = {
    list: vi.fn((caller?: object) => caller === undefined
      ? [{ id: 'bash-1', status: 'running' }]
      : [{ id: 'bash-1', status: 'running' }, { id: 'subagent-2', status: 'stopping' }, { id: 'done-3', status: 'completed' }]),
  }
  const services = { agents: { list: () => agents }, jobs, desktopCronTasksController: cron }
  const ctx = { get: (name: keyof typeof services) => services[name] }
  return { ctx, jobs, cron }
}

describe('Desktop interruption inspection', () => {
  it('counts public Host work and de-duplicates jobs visible to multiple callers', async () => {
    const f = fixture()
    const snapshot = await inspectDesktopInterruptions(f.ctx as never)

    expect(snapshot).toEqual({
      activeAgents: 1,
      queuedMessages: 3,
      activeJobs: 2,
      runningCronTasks: 1,
      scheduledCronTasks: 3,
    })
    expect(hasDesktopActiveInterruptions(snapshot)).toBe(true)
    expect(hasDesktopScheduledInterruptions(snapshot)).toBe(true)
    expect(f.jobs.list).toHaveBeenCalledTimes(3)
    expect(f.cron.interruptionState).toHaveBeenCalledOnce()
  })

  it('supports a profile without the optional ClawClaw Cron plugin', async () => {
    const ctx = { get: (name: string) => name === 'agents'
      ? { list: () => [] }
      : name === 'jobs' ? { list: () => [] } : undefined }

    await expect(inspectDesktopInterruptions(ctx as never)).resolves.toEqual({
      activeAgents: 0,
      queuedMessages: 0,
      activeJobs: 0,
      runningCronTasks: 0,
      scheduledCronTasks: 0,
    })
  })

  it('rejects when the core task registries are unavailable', async () => {
    await expect(inspectDesktopInterruptions({ get: () => undefined } as never))
      .rejects.toThrow('interruption services are unavailable')
  })

  it('rejects malformed private-RPC snapshots', () => {
    expect(() => parseDesktopInterruptionSnapshot({
      activeAgents: 0, queuedMessages: 0, activeJobs: -1, runningCronTasks: 0, scheduledCronTasks: 0,
    })).toThrow('Invalid interruption snapshot')
    expect(() => parseDesktopInterruptionSnapshot({})).toThrow('Invalid interruption snapshot')
  })
})
