import { describe, expect, it, vi } from 'vitest'
import {
  DesktopQuitConfirmation,
  DesktopQuitRequest,
  resolveDesktopQuitPrompt,
} from '../src/quit-confirmation.ts'
import type { DesktopInterruptionSnapshot } from '../src/interruption-inspection.ts'

const idle: DesktopInterruptionSnapshot = {
  activeAgents: 0, queuedMessages: 0, activeJobs: 0, runningCronTasks: 0, scheduledCronTasks: 0,
}

function setup(inspect: () => Promise<DesktopInterruptionSnapshot> | undefined) {
  const show = vi.fn(async () => ({ response: 0, checkboxChecked: false }))
  const focus = vi.fn()
  const confirmation = new DesktopQuitConfirmation({ locale: () => 'en', inspect, show, focus })
  return { confirmation, show, focus }
}

describe('Desktop quit confirmation', () => {
  it.each([
    [idle, undefined],
    [{ ...idle, activeAgents: 1 }, 'active'],
    [{ ...idle, scheduledCronTasks: 1 }, 'scheduled'],
    [{ ...idle, activeJobs: 1, scheduledCronTasks: 1 }, 'active-and-scheduled'],
    ['unknown', 'active'],
  ] as const)('classifies %j as %s', (snapshot, prompt) => {
    expect(resolveDesktopQuitPrompt(snapshot)).toBe(prompt)
  })

  it('quits silently before a Host exists or while it is idle', async () => {
    const beforeHost = setup(() => undefined)
    const idleHost = setup(async () => idle)

    await expect(beforeHost.confirmation.confirm()).resolves.toBe(true)
    await expect(idleHost.confirmation.confirm()).resolves.toBe(true)
    expect(beforeHost.show).not.toHaveBeenCalled()
    expect(idleHost.show).not.toHaveBeenCalled()
  })

  it('uses conservative copy after inspection failure and honors cancellation', async () => {
    const f = setup(async () => { throw new Error('Host timed out') })
    f.show.mockResolvedValueOnce({ response: 1, checkboxChecked: false })

    await expect(f.confirmation.confirm()).resolves.toBe(false)
    expect(f.show).toHaveBeenCalledWith(expect.objectContaining({
      detail: 'Active or queued tasks will stop immediately.',
      defaultId: 1,
      cancelId: 1,
    }))
  })

  it('coalesces an open decision and focuses it on repeated requests', async () => {
    let resolveInspection!: (snapshot: DesktopInterruptionSnapshot) => void
    const inspection = new Promise<DesktopInterruptionSnapshot>(resolve => { resolveInspection = resolve })
    const inspect = vi.fn(() => inspection)
    const f = setup(inspect)

    const first = f.confirmation.confirm()
    const second = f.confirmation.confirm()
    expect(first).toBe(second)
    expect(inspect).toHaveBeenCalledOnce()
    expect(f.focus).toHaveBeenCalledOnce()
    resolveInspection({ ...idle, runningCronTasks: 1, scheduledCronTasks: 1 })

    await expect(first).resolves.toBe(true)
    expect(f.show).toHaveBeenCalledOnce()
    expect(f.show).toHaveBeenCalledWith(expect.objectContaining({
      detail: 'Active or queued tasks will stop immediately, and scheduled tasks will not run while ClawClaw is closed.',
    }))
  })

  it('refuses completion after disposal and contains dialog failure', async () => {
    const disposed = setup(async () => ({ ...idle, activeAgents: 1 }))
    disposed.confirmation.dispose()
    await expect(disposed.confirmation.confirm()).resolves.toBe(false)

    const failed = setup(async () => ({ ...idle, activeAgents: 1 }))
    failed.show.mockRejectedValueOnce(new Error('dialog unavailable'))
    await expect(failed.confirmation.confirm()).resolves.toBe(false)
  })

  it('runs final shutdown once when repeated sources join an approved decision', async () => {
    let answer!: (confirmed: boolean) => void
    const decision = new Promise<boolean>(resolve => { answer = resolve })
    const confirmation = {
      confirm: vi.fn(() => decision),
    }
    const shutdown = vi.fn(async () => {})
    const request = new DesktopQuitRequest({ confirmation, shutdown })

    const first = request.request(0)
    const second = request.request(130)
    expect(first).toBe(second)
    answer(true)
    await first

    expect(confirmation.confirm).toHaveBeenCalledTimes(2)
    expect(shutdown).toHaveBeenCalledOnce()
    expect(shutdown).toHaveBeenCalledWith(0)
  })
})
