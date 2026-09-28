import { afterEach, describe, expect, it, vi } from 'vitest'
import { createCronTask, nextCronTaskRun, normalizeCronTaskInput, rehydrateCronTask } from '../src/cron-task-domain.ts'
import { CronTaskController, CronTasksSettingsSchema, runCronTask } from '../src/cron-tasks.ts'
import type { CronTask } from '../src/cron-task-domain.ts'

describe('desktop Cron task schedule domain', () => {
  it('validates standard expressions and computes future IANA-local occurrences', () => {
    expect(nextCronTaskRun('30 9 * * 1-5', 'Asia/Shanghai', Date.parse('2026-09-18T00:00:00Z')).toISOString())
      .toBe('2026-09-18T01:30:00.000Z')
    expect(() => normalizeCronTaskInput({ name: 'x', prompt: 'y', expression: 'nope', timeZone: 'UTC' })).toThrow()
    expect(() => normalizeCronTaskInput({ name: 'x', prompt: 'y', expression: '* * * * *', timeZone: 'Mars/Olympus' })).toThrow(/time zone/)
  })

  it('skips spring-forward gaps and avoids firing twice in a fall-back repeated hour', () => {
    expect(nextCronTaskRun('0 2 * * *', 'America/New_York', Date.parse('2025-03-09T07:30:00Z')).toISOString())
      .toBe('2025-03-10T06:00:00.000Z')
    expect(nextCronTaskRun('30 1 * * *', 'America/New_York', Date.parse('2025-11-02T05:45:00Z')).toISOString())
      .toBe('2025-11-03T06:30:00.000Z')
  })

  it('skips missed offline fires on rehydration and keeps disabled tasks unscheduled', () => {
    const task = createCronTask(normalizeCronTaskInput({ name: 'daily', prompt: 'check', expression: '0 9 * * *', timeZone: 'UTC' }),
      Date.parse('2026-09-16T09:01:00Z'))
    expect(rehydrateCronTask(task, Date.parse('2026-09-18T10:00:00Z')).nextRunAt).toBe('2026-09-19T09:00:00.000Z')
    expect(createCronTask({ ...task, enabled: false }, Date.parse('2026-09-16T09:01:00Z')).nextRunAt).toBeNull()
  })

  it('keeps an exact one-time instant and rejects one-time schedules in the past', () => {
    const now = Date.parse('2026-09-18T02:00:00Z')
    const task = createCronTask(normalizeCronTaskInput({ name: 'Launch', prompt: 'Prepare launch', expression: '0 0 * * *',
      oneTimeAt: '2026-09-18T03:30:00.000Z', timeZone: 'Asia/Shanghai' }), now)
    expect(task.nextRunAt).toBe('2026-09-18T03:30:00.000Z')
    expect(() => createCronTask(normalizeCronTaskInput({ name: 'Old', prompt: 'Too late', expression: '0 0 * * *',
      oneTimeAt: '2026-09-18T01:00:00.000Z', timeZone: 'UTC' }), now)).toThrow(/future/)
  })

  it('records and disables a one-time task missed while the host was offline', () => {
    const task = createCronTask(normalizeCronTaskInput({ name: 'Launch', prompt: 'Prepare launch', expression: '0 0 * * *',
      oneTimeAt: '2026-09-18T03:30:00.000Z', timeZone: 'UTC' }), Date.parse('2026-09-18T02:00:00Z'))
    const recovered = rehydrateCronTask(task, Date.parse('2026-09-18T04:00:00Z'))
    expect(recovered).toMatchObject({ enabled: false, nextRunAt: null, pendingRunAt: null })
    expect(recovered.history[0]).toMatchObject({
      status: 'skipped', scheduledFor: '2026-09-18T03:30:00.000Z', trigger: 'schedule',
    })
  })

  it('keeps recurring schedules recurring after a settings-schema round trip', () => {
    const task = createCronTask(normalizeCronTaskInput({ name: 'Daily', prompt: 'Check', expression: '0 9 * * *', timeZone: 'UTC' }),
      Date.parse('2026-09-18T02:00:00Z'))
    const parsed = CronTasksSettingsSchema({ jobs: [JSON.parse(JSON.stringify(task))] })
    expect(parsed.jobs[0]?.oneTimeAt).toBeUndefined()
  })
})

describe('desktop Cron task controller', () => {
  afterEach(() => { vi.useRealTimers() })

  it('resolves the configured default workspace instead of registry order', async () => {
    const first = { id: 'workspace-first', path: '/work/first' }
    const attachSession = vi.fn(async () => {})
    const configured = { id: 'workspace-default', path: '/work/default', attachSession }
    const get = vi.fn((id: string) => id === configured.id ? configured : undefined)
    const dispose = vi.fn(async () => {})
    const session = { ownEvents: () => [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }
    const create = vi.fn(async (options: { sessionId: string; meta: { cwd: string } }) => ({
      agent: { id: options.sessionId, followup: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn(),
        session },
      dispose,
    }))
    const flush = vi.fn(async () => {})
    const rename = vi.fn()
    const runtime = {
      workspaceRegistry: { list: () => [first, configured], get },
      defaultWorkspaceId: () => configured.id,
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      sessionTitle: { rename },
      sessions: { flush },
      agents: { create },
    } as never
    const task = createCronTask({ name: 'Default', prompt: 'Check', expression: '0 9 * * *', timeZone: 'UTC' },
      Date.parse('2026-09-18T02:00:00Z'))
    await expect(runCronTask(runtime, task)).resolves.toMatch(/^cron-/)
    expect(get).toHaveBeenCalledWith(configured.id)
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ meta: { cwd: configured.path } }))
    expect(rename).toHaveBeenCalledWith(session, '[Cron] Default')
    expect(attachSession).toHaveBeenCalledWith(expect.stringMatching(/^cron-/))
    expect(attachSession.mock.invocationCallOrder[0]).toBeLessThan(flush.mock.invocationCallOrder[0] as number)
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('resumes the task conversation instead of creating a session for every run', async () => {
    const attachSession = vi.fn(async () => {})
    const workspace = { id: 'workspace-1', path: '/work/project', attachSession }
    const dispose = vi.fn(async () => {})
    const session = { ownEvents: () => [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }
    const agent = { id: 'cron-existing', session, followup: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }
    const resume = vi.fn(async () => ({ agent, dispose }))
    const create = vi.fn()
    const runtime = {
      workspaceRegistry: { list: () => [workspace], get: () => workspace, archivedSessionIds: [] },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      sessionTitle: { rename: vi.fn() }, sessions: { flush: vi.fn(async () => {}) },
      agents: { get: vi.fn(() => undefined), resume, create },
    } as never
    const task = { ...createCronTask({ name: 'Daily', prompt: 'Check', expression: '0 9 * * *', timeZone: 'UTC' },
      Date.parse('2026-09-18T02:00:00Z')), activeSessionId: 'cron-existing', activeSessionWorkspaceId: 'workspace-1' }

    await expect(runCronTask(runtime, task)).resolves.toBe('cron-existing')
    expect(resume).toHaveBeenCalledWith(expect.objectContaining({ resumeSessionId: 'cron-existing' }))
    expect(create).not.toHaveBeenCalled()
    expect(agent.followup).toHaveBeenCalledOnce()
    expect(dispose).toHaveBeenCalledOnce()
  })

  it('queues a run on the existing live Agent without taking a second write owner', async () => {
    const workspace = { id: 'workspace-1', path: '/work/project', attachSession: vi.fn(async () => {}) }
    const session = { ownEvents: () => [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }
    const agent = {
      id: 'cron-live', session, followup: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn(),
      runMaintenance: vi.fn(async (job: () => Promise<void>) => await job()),
    }
    const resume = vi.fn()
    const create = vi.fn()
    const runtime = {
      workspaceRegistry: { list: () => [workspace], get: () => workspace, archivedSessionIds: [] },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      sessionTitle: { rename: vi.fn() }, sessions: { flush: vi.fn(async () => {}) },
      agents: { get: vi.fn(() => agent), resume, create },
    } as never
    const task = { ...createCronTask({ name: 'Daily', prompt: 'Check', expression: '0 9 * * *', timeZone: 'UTC' },
      Date.parse('2026-09-18T02:00:00Z')), activeSessionId: 'cron-live', activeSessionWorkspaceId: 'workspace-1' }

    await expect(runCronTask(runtime, task)).resolves.toBe('cron-live')
    expect(agent.runMaintenance).toHaveBeenCalledOnce()
    expect(agent.followup).toHaveBeenCalledOnce()
    expect(resume).not.toHaveBeenCalled()
    expect(create).not.toHaveBeenCalled()
  })

  it('rotates an archived task conversation without writing to it', async () => {
    const attachSession = vi.fn(async () => {})
    const workspace = { id: 'workspace-1', path: '/work/project', attachSession }
    const dispose = vi.fn(async () => {})
    const session = { ownEvents: () => [{ type: 'turn/end', data: { reason: { kind: 'completed' } } }] }
    const create = vi.fn(async (options: { sessionId: string }) => ({
      agent: { id: options.sessionId, session, followup: vi.fn(), whenIdle: vi.fn(async () => {}), cancel: vi.fn() }, dispose,
    }))
    const resume = vi.fn()
    const runtime = {
      workspaceRegistry: { list: () => [workspace], get: () => workspace, archivedSessionIds: ['cron-archived'] },
      agentDefaultModel: { currentSelection: () => ({ provider: 'test', model: 'test-model' }) },
      sessionTitle: { rename: vi.fn() }, sessions: { flush: vi.fn(async () => {}) },
      agents: { get: vi.fn(), resume, create },
    } as never
    const task = { ...createCronTask({ name: 'Daily', prompt: 'Check', expression: '0 9 * * *', timeZone: 'UTC' },
      Date.parse('2026-09-18T02:00:00Z')), activeSessionId: 'cron-archived', activeSessionWorkspaceId: 'workspace-1' }

    await expect(runCronTask(runtime, task)).resolves.toMatch(/^cron-/)
    expect(resume).not.toHaveBeenCalled()
    expect(create).toHaveBeenCalledOnce()
  })

  it('persists create, toggle, execution outcome, bounded history, and delete operations', async () => {
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const execute = vi.fn(async (_task: CronTask) => 'cron-session-1')
    const runtime = { workspaceRegistry: { list: () => [{ id: 'workspace-1', title: 'Project', path: '/work/project' }] } } as never
    const controller = new CronTaskController(runtime, settings, () => Date.parse('2026-09-18T02:00:00Z'), execute)
    const created = await controller.action({ action: 'create', input: {
      name: 'Morning report', prompt: 'Summarize updates', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai',
    } }) as CronTask
    expect(state.jobs).toHaveLength(1)
    expect(created.nextRunAt).toBe('2026-09-21T01:00:00.000Z')
    await controller.action({ action: 'run', id: created.id })
    expect(execute).toHaveBeenCalledOnce()
    const afterRun = (await controller.read() as { jobs: CronTask[] }).jobs[0]
    expect(afterRun?.lastRun).toMatchObject({ status: 'completed', sessionId: 'cron-session-1' })
    expect(afterRun?.activeSessionId).toBe('cron-session-1')
    expect(afterRun?.nextRunAt).toBe(created.nextRunAt)
    expect(afterRun?.history).toHaveLength(1)
    expect((await controller.read() as { workspaces: unknown[] }).workspaces).toEqual([
      { id: 'workspace-1', title: 'Project', path: '/work/project' },
    ])
    await controller.action({ action: 'run', id: created.id })
    expect(execute).toHaveBeenCalledTimes(2)
    expect(execute.mock.calls[1]?.[0]).toMatchObject({ activeSessionId: 'cron-session-1' })
    const disabled = await controller.action({ action: 'toggle', id: created.id, enabled: false }) as CronTask
    expect(disabled.nextRunAt).toBeNull()
    await expect(controller.action({ action: 'run', id: created.id })).rejects.toThrow(/Enable/)
    await controller.action({ action: 'delete', id: created.id })
    expect(state.jobs).toEqual([])
    controller.dispose()
  })

  it('reattaches a session from existing history before the client opens it', async () => {
    const attachSession = vi.fn(async () => {})
    const workspace = { id: 'workspace-1', title: 'Project', path: '/work/project', attachSession }
    const task = createCronTask({ name: 'Existing', prompt: 'Check', expression: '0 9 * * *', timeZone: 'UTC' },
      Date.parse('2026-09-18T02:00:00Z'))
    const historical = { ...task, history: [{ scheduledFor: '2026-09-18T02:00:00.000Z', trigger: 'manual' as const,
      startedAt: '2026-09-18T02:00:00.000Z', finishedAt: '2026-09-18T02:00:01.000Z', status: 'completed' as const,
      sessionId: 'cron-existing' }] }
    const settings = { get: () => ({ jobs: [historical] }), replace: vi.fn(async () => {}) }
    const runtime = { workspaceRegistry: { list: () => [workspace], get: () => workspace } } as never
    const controller = new CronTaskController(runtime, settings, () => Date.parse('2026-09-18T03:00:00Z'), async () => 'unused')

    await expect(controller.action({ action: 'attach-session', id: task.id, sessionId: 'cron-existing' }))
      .resolves.toMatchObject({ sessionId: 'cron-existing', attached: true })
    expect(attachSession).toHaveBeenCalledWith('cron-existing')
    await expect(controller.action({ action: 'attach-session', id: task.id, sessionId: 'cron-unrelated' }))
      .rejects.toThrow(/not part of this Cron task history/)
    await controller.dispose()
  })

  it('shares one persisted registry between the model-facing task operations and settings API', async () => {
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings,
      () => Date.parse('2026-09-18T02:00:00Z'), async () => 'cron-session-model')
    const task = await controller.action({ action: 'create', input: {
      name: 'Daily report', prompt: 'Summarize activity', expression: '0 9 * * 1-5', timeZone: 'Asia/Shanghai',
    } }) as CronTask
    expect(await controller.listForModel()).toContainEqual(expect.objectContaining({ id: task.id, name: 'Daily report' }))
    const updated = await controller.updateFromModel(task.id, { name: 'Morning report', enabled: false })
    expect(updated).toMatchObject({ name: 'Morning report', prompt: 'Summarize activity', expression: '0 9 * * 1-5', enabled: false })
    expect((await controller.read() as { jobs: CronTask[] }).jobs[0]).toMatchObject({ id: task.id, name: 'Morning report' })
    controller.dispose()
  })

  it('does not rewrite an already normalized registry during startup', async () => {
    const replace = vi.fn(async () => {})
    const controller = new CronTaskController(
      { workspaceRegistry: { list: () => [] } } as never,
      { get: () => ({ jobs: [] }), replace },
    )

    controller.start()
    await controller.read()

    expect(replace).not.toHaveBeenCalled()
    await controller.dispose()
  })

  it('recovers saved schedules and runs a due task once after the next firing time', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T09:00:10Z'))
    const overdue = createCronTask({ name: 'Minute', prompt: 'Check', expression: '* * * * *', timeZone: 'UTC' }, Date.now() - 120_000)
    const state: { jobs: CronTask[] } = { jobs: [overdue] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const execute = vi.fn(async () => 'cron-session-recovered')
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings, Date.now, execute)
    controller.start()
    const booted = (await controller.read() as { jobs: CronTask[] }).jobs[0]
    expect(booted?.nextRunAt).toBe('2026-09-18T09:01:00.000Z')
    await vi.advanceTimersByTimeAsync(50_000)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    expect((await controller.read() as { jobs: CronTask[] }).jobs[0]?.lastRun?.sessionId).toBe('cron-session-recovered')
    controller.dispose()
  })

  it('records an interrupted run without replaying potentially completed side effects', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T09:00:10Z'))
    const scheduled = createCronTask({ name: 'Minute', prompt: 'Check', expression: '* * * * *', timeZone: 'UTC' }, Date.now())
    const interrupted = { ...scheduled, pendingRunAt: '2026-09-18T09:01:00.000Z',
      nextRunAt: '2026-09-18T09:02:00.000Z' }
    const state: { jobs: CronTask[] } = { jobs: [interrupted] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const execute = vi.fn(async () => 'cron-session-retried')
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings, Date.now, execute)
    controller.start()
    const recovered = (await controller.read() as { jobs: CronTask[] }).jobs[0]
    expect(execute).not.toHaveBeenCalled()
    expect(recovered?.pendingRunAt).toBeNull()
    expect(recovered?.history[0]).toMatchObject({ status: 'failed', scheduledFor: '2026-09-18T09:01:00.000Z' })
    expect(recovered?.history[0]?.error).toMatch(/not retried/)
    await controller.dispose()
  })

  it('clears one-time and workspace overrides through model updates', async () => {
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings,
      () => Date.parse('2026-09-18T02:00:00Z'), async () => 'unused')
    const task = await controller.action({ action: 'create', input: { name: 'Once', prompt: 'Check', expression: '0 9 * * *',
      oneTimeAt: '2026-09-19T02:00:00Z', timeZone: 'UTC', workspaceId: 'workspace-1' } }) as CronTask
    const updated = await controller.updateFromModel(task.id, { one_time_at: '', workspace_id: '' })
    expect(updated.oneTimeAt).toBeUndefined()
    expect(updated.workspaceId).toBeUndefined()
    expect(updated.nextRunAt).toBe('2026-09-18T09:00:00.000Z')
    await controller.dispose()
  })

  it('cancels an active run and persists a cancelled outcome', async () => {
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const execute = vi.fn(async (_task: CronTask, signal?: AbortSignal) => await new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    }))
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings,
      () => Date.parse('2026-09-18T02:00:00Z'), execute)
    const task = await controller.action({ action: 'create', input: {
      name: 'Long run', prompt: 'Wait', expression: '0 9 * * *', timeZone: 'UTC',
    } }) as CronTask
    const run = controller.action({ action: 'run', id: task.id })
    await vi.waitFor(async () => { expect((await controller.read() as { running: string[] }).running).toContain(task.id) })
    await controller.action({ action: 'cancel', id: task.id })
    await run
    expect((await controller.read() as { jobs: CronTask[] }).jobs[0]?.lastRun?.status).toBe('cancelled')
    await controller.dispose()
  })

  it('rejects a concurrent start without replacing cancellation ownership', async () => {
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const execute = vi.fn(async (_task: CronTask, signal?: AbortSignal) => await new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    }))
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings,
      () => Date.parse('2026-09-18T02:00:00Z'), execute)
    const task = await controller.action({ action: 'create', input: {
      name: 'Single owner', prompt: 'Wait', expression: '0 9 * * *', timeZone: 'UTC',
    } }) as CronTask
    const first = controller.action({ action: 'run', id: task.id })
    await expect(controller.action({ action: 'run', id: task.id })).rejects.toThrow(/already running/)
    await controller.action({ action: 'cancel', id: task.id })
    await first
    expect(execute).toHaveBeenCalledOnce()
    expect(state.jobs[0]?.lastRun?.status).toBe('cancelled')
    await controller.dispose()
  })

  it('fails a run that exceeds its execution time limit', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T02:00:00Z'))
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const execute = vi.fn(async (_task: CronTask, signal?: AbortSignal) => await new Promise<string>((_resolve, reject) => {
      signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
    }))
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings,
      Date.now, execute, 1_000)
    const task = await controller.action({ action: 'create', input: {
      name: 'Slow run', prompt: 'Wait', expression: '0 9 * * *', timeZone: 'UTC',
    } }) as CronTask
    const operation = controller.action({ action: 'run', id: task.id })
    await vi.advanceTimersByTimeAsync(1_000)
    await operation
    expect((await controller.read() as { jobs: CronTask[] }).jobs[0]?.lastRun).toMatchObject({
      status: 'failed', error: 'Scheduled task exceeded its 0 minute time limit',
    })
    await controller.dispose()
  })

  it('cancels active work during disposal and waits for its final history commit', async () => {
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    let runSignal: AbortSignal | undefined
    const execute = vi.fn(async (_task: CronTask, signal?: AbortSignal) => {
      runSignal = signal
      return await new Promise<string>((_resolve, reject) => {
        signal?.addEventListener('abort', () => { reject(signal.reason) }, { once: true })
      })
    })
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings,
      () => Date.parse('2026-09-18T02:00:00Z'), execute)
    const task = await controller.action({ action: 'create', input: {
      name: 'Long run', prompt: 'Wait', expression: '0 9 * * *', timeZone: 'UTC',
    } }) as CronTask
    const operation = controller.action({ action: 'run', id: task.id })
    await vi.waitFor(() => { expect(execute).toHaveBeenCalledOnce() })
    await controller.dispose()
    await operation
    expect(runSignal?.aborted).toBe(true)
    expect(state.jobs[0]?.lastRun).toMatchObject({ status: 'cancelled', error: 'ClawClaw is shutting down' })
    expect(state.jobs[0]?.pendingRunAt).toBeNull()
  })

  it('records failed runs and sends privacy-safe desktop completion notices', async () => {
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const notifyAttention = vi.fn()
    const runtime = { workspaceRegistry: { list: () => [] }, desktopRuntime: { notifyAttention } } as never
    const controller = new CronTaskController(runtime, settings, () => Date.parse('2026-09-18T02:00:00Z'),
      async () => { throw new Error('provider unavailable') })
    const task = await controller.action({ action: 'create', input: {
      name: 'Report', prompt: 'Sensitive prompt text', expression: '0 9 * * *', timeZone: 'UTC',
    } }) as CronTask
    await controller.action({ action: 'run', id: task.id })
    const saved = (await controller.read() as { jobs: CronTask[] }).jobs[0]
    expect(saved?.lastRun).toMatchObject({ status: 'failed', error: 'provider unavailable' })
    expect(notifyAttention).toHaveBeenCalledWith({ title: 'Scheduled task failed',
      body: 'A scheduled task failed. Open ClawClaw for details.' })
    expect(JSON.stringify(notifyAttention.mock.calls)).not.toContain('Sensitive prompt text')
    controller.dispose()
  })

  it('disables a one-time task after its scheduled run', async () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-18T02:00:00Z'))
    const state: { jobs: CronTask[] } = { jobs: [] }
    const settings = { get: () => state, replace: async (value: object) => { Object.assign(state, value) } }
    const execute = vi.fn(async () => 'cron-session-once')
    const controller = new CronTaskController({ workspaceRegistry: { list: () => [] } } as never, settings, Date.now, execute)
    const task = await controller.action({ action: 'create', input: { name: 'Once', prompt: 'Run once', expression: '0 0 * * *',
      oneTimeAt: '2026-09-18T02:01:00.000Z', timeZone: 'UTC' } }) as CronTask
    controller.start()
    await vi.advanceTimersByTimeAsync(60_000)
    await vi.waitFor(() => expect(execute).toHaveBeenCalledOnce())
    const saved = (await controller.read() as { jobs: CronTask[] }).jobs[0]
    expect(saved).toMatchObject({ id: task.id, enabled: false, nextRunAt: null })
    controller.dispose()
  })
})
