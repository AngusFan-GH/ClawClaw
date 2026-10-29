import { Session, SessionId, appendPluginRecord } from '@deepseek-ai/dsh-session'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { BUILTIN_TEAMS } from '../src/experts/team-contract.ts'
import type { ExpertSummary } from '../src/experts/expert-contract.ts'
import { assertNoPendingNativeTeam, detectTeamEngine, dispatchNativeTeam, nativeTeamMemberName, resolveTeamEngine, type NativeTeamService } from '../src/experts/team-engine.ts'
import { teamExecutionEngine } from '../src/experts/team-execution.ts'

const team = structuredClone(BUILTIN_TEAMS[0]!)
const experts: ExpertSummary[] = team.members.map(member => ({
  slug: member.expertSlug, name: member.expertSlug, nameEn: member.expertSlug,
  description: 'Review', descriptionEn: 'Review', emoji: '', division: 'research', divisionZh: '研究',
  custom: false, skills: [], mcpServers: [],
}))
function service() {
  let taskId = 0
  return {
    tryMembership: vi.fn(), listMembers: vi.fn<NativeTeamService['listMembers']>(() => []), listTasks: vi.fn<NativeTeamService['listTasks']>(() => []),
    spawnTeammate: vi.fn<NativeTeamService['spawnTeammate']>(async () => ({ member: { name: 'member', status: 'running' } })),
    sendMessage: vi.fn(async () => {}), createTask: vi.fn<NativeTeamService['createTask']>(async () => ({ id: String(++taskId), revision: 1 })),
    updateTask: vi.fn(async () => {}), waitForChange: vi.fn(), interrupt: vi.fn(),
  } satisfies NativeTeamService
}
function dispatch(native: NativeTeamService, extra = {}) {
  return dispatchNativeTeam({ team, experts, enabled: experts.map(expert => expert.slug),
    task: 'Review the supplied report.', revision: 1, locale: 'en',
    readPersona: async expert => `Persona: ${expert.slug}`, provider: 'spawn', agent: { session: Session.create(SessionId('parent')) },
    signal: new AbortController().signal, service: native, ...extra })
}

describe('expert team execution with Agent Team enabled and disabled', () => {
  it.each([
    ['disabled', undefined, true, undefined, false, 'subagent'],
    ['enabled', service(), true, undefined, false, 'native'],
    ['old conversation', service(), false, undefined, false, 'subagent'],
    ['depth limited', service(), true, 3, false, 'subagent'],
    ['MCP isolation', service(), true, undefined, true, 'subagent'],
  ] as const)('%s uses %s without disabling domain teams', (_name, native, ready, depth, filter, mode) => {
    expect(detectTeamEngine(native, ready, depth, 'en', filter).mode).toBe(mode)
  })

  it('requires the tools used for member revisions and progress checks in the current conversation', () => {
    const native = service()
    const tools = new Set(['spawn_teammate', 'send_message', 'list_agents', 'wait_agent', 'team_task_create', 'team_task_get', 'team_task_update', 'team_task_list'])
    const ctx = { get: (name: string) => name === 'agentTeams' ? native : undefined } as unknown as Context
    const agent = { ctx: { tools: { get: (name: string) => tools.has(name) ? {} : undefined } } } as unknown as Agent
    expect(resolveTeamEngine(ctx, agent).status.mode).toBe('native')
    tools.delete('team_task_get')
    expect(resolveTeamEngine(ctx, agent).status).toMatchObject({ mode: 'subagent', state: 'disabled' })
  })

  it.each([false, true])('keeps plugin pipelines on their own executor with native enabled=%s', enabled => {
    const plugin = { ...team, runtime: { mode: 'lead' as const, execution: 'pipeline' as const, leadExpertSlug: experts[0]!.slug, initPrompt: '' } }
    const engine = teamExecutionEngine(plugin, experts, detectTeamEngine(enabled ? service() : undefined), 'en')
    expect(engine.mode).toBe('subagent')
    expect(engine.reason).toContain('independent lead executor')
  })

  it('uses the same MCP fallback in library explanations as in Host dispatch', () => {
    const bound = experts.map(expert => ({ ...expert, mcpServers: [{ name: 'docs', required: true, enabled: true }] }))
    expect(teamExecutionEngine(team, bound, detectTeamEngine(service()), 'en')).toMatchObject({ mode: 'subagent', reason: expect.stringContaining('isolate tools') })
  })

  it('returns only dispatch confirmation and durable task IDs in native mode', async () => {
    const native = service()
    const result = await dispatch(native)
    expect(result.dispatch.started).toBe(team.members.length)
    expect(result.dispatch.members.every(member => member.status === 'started' && member.taskId)).toBe(true)
    expect(result).not.toHaveProperty('coverage')
    expect(result.instruction).toContain('list_agents')
    expect(native.createTask.mock.calls[0]![1].description).not.toContain('[clawclaw-')
    expect(native.spawnTeammate.mock.calls[0]![1].prompt[0]!.text).toContain('team_task_get')
  })

  it('rejects concurrent dispatch before the first task reaches the durable board', async () => {
    const native = service()
    const agent = { session: Session.create(SessionId('parent')) }
    let release!: (value: string) => void
    const persona = new Promise<string>(resolve => { release = resolve })
    const first = dispatch(native, { agent, readPersona: () => persona })
    await expect(dispatch(native, { agent })).rejects.toThrow('Wait for dispatch to finish')
    release('Persona')
    await first
    expect(native.spawnTeammate).toHaveBeenCalledTimes(team.members.length)
  })

  it('does not mistake an inactive teammate for a completed previous assignment, including after restart', async () => {
    const native = service()
    native.listTasks.mockReturnValue([{ id: 'previous', status: 'in_progress', description: `[clawclaw-expert-team:${team.id}]\nPrevious run` }] as never)
    const session = Session.create(SessionId('parent'))
    appendPluginRecord(session, 'plugin:clawclaw/expert-team-task', { version: 1, teamId: team.id, taskId: 'previous' })
    await expect(dispatch(native, { agent: { session } })).rejects.toThrow('previous expert team task is unfinished')
    expect(native.createTask).not.toHaveBeenCalled()
    expect(native.spawnTeammate).not.toHaveBeenCalled()
  })

  it('preserves unfinished-run protection when Agent Team is switched off and the Host restarts', () => {
    const session = Session.create(SessionId('native-parent'))
    const append = session.append.bind(session) as unknown as (type: string, data: unknown) => void
    const task = { id: 'task-1', revision: 1, status: 'pending', subject: 'Review', description: `[clawclaw-expert-team:${team.id}]`, blockedBy: [], writeScopes: [] }
    appendPluginRecord(session, 'plugin:clawclaw/expert-team-task', { version: 1, teamId: team.id, taskId: task.id })
    append('team/task', { version: 2, teamId: session.id, task })
    const parent = { session }
    expect(() => assertNoPendingNativeTeam(undefined, parent, 'en')).toThrow('Re-enable Agent Team')
    append('team/task', { version: 2, teamId: session.id, task: { ...task, revision: 2, status: 'deleted' } })
    expect(() => assertNoPendingNativeTeam(undefined, parent, 'en')).not.toThrow()
    // Inherited records from a different root do not block a new conversation.
    append('team/task', { version: 2, teamId: 'other-root', task })
    expect(() => assertNoPendingNativeTeam(undefined, parent, 'en')).not.toThrow()
  })

  it('reuses idle members once previous tasks are completed', async () => {
    const native = service()
    native.listTasks.mockReturnValue([{ id: 'old', status: 'completed', description: `[clawclaw-expert-team:${team.id}]` }] as never)
    native.listMembers.mockReturnValue(team.members.map(member => ({ name: nativeTeamMemberName(team.id, member.expertSlug), status: 'inactive' })) as never)
    const result = await dispatch(native)
    expect(result.dispatch.started).toBe(team.members.length)
    expect(native.spawnTeammate).not.toHaveBeenCalled()
    expect(native.sendMessage).toHaveBeenCalledTimes(team.members.length)
  })

  it('cleans up failed dispatch tasks without launching fallback subagents', async () => {
    const native = service()
    native.spawnTeammate.mockRejectedValue(new Error('No free teammate slots'))
    const result = await dispatch(native)
    expect(result.dispatch.started).toBe(0)
    expect(result.dispatch.members.every(member => member.status === 'failed')).toBe(true)
    expect(native.updateTask).toHaveBeenCalledTimes(team.members.length)
    expect(result.instruction).toContain('without inventing opinions or automatically repeating')
  })

  it('interrupts accepted teammates when dispatch is cancelled and does not launch queued members', async () => {
    const native = service()
    const abort = new AbortController()
    native.spawnTeammate.mockImplementation(async () => { abort.abort(); return { member: { name: 'member', status: 'running' } } })
    await expect(dispatch(native, { signal: abort.signal })).rejects.toThrow()
    expect(native.interrupt).toHaveBeenCalled()
    expect(native.spawnTeammate.mock.calls.length).toBeLessThanOrEqual(4)
  })
})
