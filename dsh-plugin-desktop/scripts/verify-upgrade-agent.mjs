/** Real preset, expert activation and persistence smoke using an offline model. */
import assert from 'node:assert/strict'
import { recordContextAudit } from './context-audit.mjs'
import { DESKTOP_RESPONSE_POLICY } from '../lib/response-policy.js'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, ToolCallId, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId, pluginRecordOf } from '@deepseek-ai/dsh-session'
import { capabilitySubmissionMarker } from '../src/experts/capability-submission.ts'

/** Read the loop-built system-role message rather than the one-shot system field. */
function requestSystem(request) {
  const system = request.messages.findLast(message => message.role === 'system')
  return system?.content.filter(block => block.type === 'text').map(block => block.text).join('\n') ?? request.system ?? ''
}

class OfflineAdapter extends LlmAdapter {
  requests = []
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options) {
    this.requests.push(options)
    recordContextAudit(String(options.sessionId).startsWith('expert-') ? 'expert:request' : 'automation:request', { request: options })
    const text = 'CLAWCLAW_UPGRADE_EXPERT_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

/** Exercise the production summon tool, then reopen its child's persisted log. */
export async function verifyUpgradeExpertRun(ctx, cwd, expert) {
  const adapter = new OfflineAdapter()
  const registration = ctx.llm.registerAdapter(['upgrade-smoke'], adapter)
  const parent = await ctx.agents.create({
    sessionId: SessionId(`upgrade-expert-parent-${randomUUID()}`),
    meta: { cwd, agentPreset: 'standard' },
    agentOptions: { provider: 'upgrade-smoke', model: 'offline' },
    setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') },
  })
  try {
    const result = await ctx.tools.execute({
      name: 'summon_expert', arguments: { expert: expert.name, task: 'Reply with the offline verification result.' },
      callId: ToolCallId('upgrade-expert-call'), agent: parent.agent,
      signal: AbortSignal.timeout(30_000),
    })
    assert.equal(result.isError, false, JSON.stringify(result))
    assert.equal(result.value.answer, 'CLAWCLAW_UPGRADE_EXPERT_OK')
    const request = adapter.requests.find(request => String(request.sessionId).startsWith('expert-'))
    assert.ok(request, 'expert never reached the offline model')
    assert.match(requestSystem(request), /This assistant session runs in ClawClaw/)
    assert.match(requestSystem(request), /original user task/)
    assert.ok(!request.tools.some(tool => tool.name === 'summon_expert_team'), 'expert delegation restriction was lost')
    const handle = await ctx.sessionPersistence.open(SessionId(String(request.sessionId)), 'read')
    try {
      const { events } = await handle.read()
      const record = events.map(pluginRecordOf).find(record => record?.type === 'plugin:clawclaw/expert-composition')
      assert.ok(record, 'expert composition did not survive persistence')
      assert.equal(record.data.version, 1)
      assert.ok(record.data.persona.length > 0)
      assert.ok(record.data.deniedTools.includes('summon_expert_team'))
    } finally {
      await handle.close()
    }
    const restored = await ctx.agents.resume({
      resumeSessionId: SessionId(String(request.sessionId)),
      agentOptions: { provider: 'upgrade-smoke', model: 'offline' },
      setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, 'standard') },
    })
    try {
      const assembly = await restored.agent.ctx.systemPrompt.assemble({ scope: restored.agent })
      recordContextAudit('expert:resumed', { assembly })
      assert.ok(assembly.sections.some(section => section.name === 'deployment:persona-prefix'
        && section.text.length > 0), 'expert persona was lost after resume')
      assert.ok(!assembly.tools.some(tool => tool.name === 'summon_expert_team'), 'expert restriction was lost after resume')
      assert.ok(assembly.sections.some(section => section.name === 'clawclaw:response-policy'), 'response language policy was lost after resume')
      restored.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '恢复后请用中文继续说明。' }] }))
      await restored.agent.whenIdle()
      const resumedRequest = adapter.requests.findLast(request => request.sessionId === restored.agent.id)
      assert.ok(resumedRequest, 'resumed expert never reached the offline model')
      assert.equal(requestSystem(resumedRequest).split(DESKTOP_RESPONSE_POLICY).length, 2)
      recordContextAudit('expert:resumed-request', { request: resumedRequest })
    } finally {
      await restored.dispose()
    }
    assert.equal(parent.agent.inbox.nextTurn.length, 0, 'caller-owned result also entered the parent inbox')
    console.log('verify-upgrade-agent: offline expert run, tool isolation, persistence and resume passed')
  } finally {
    await parent.dispose()
    registration()
  }
}

/** Exercise composer admission and every team activation against the real built Profile. */
export async function verifyUpgradeExpertTeamRun(ctx, cwd) {
  const teamId = 'plugin-team:migrated-document-production-team'
  const teams = ctx.get('agencyAgentsTeams')
  assert.ok(teams, 'team library is unavailable')
  const snapshot = await teams.snapshot()
  await teams.recall(teamId, snapshot.revision)
  const childRequests = []
  class TeamAdapter extends LlmAdapter {
    resolveModel(provider, model) { return Promise.resolve({ provider, id: model, name: model }) }
    async *stream(request) {
      if (String(request.sessionId).startsWith('expert-')) childRequests.push(request)
      const text = `OFFLINE_TEAM_PHASE_${childRequests.length}_COMPLETE`
      yield { type: 'block-start', index: 0, blockType: 'text' }
      yield { type: 'text-delta', index: 0, text }
      yield { type: 'block-end', index: 0, block: { type: 'text', text } }
      yield { type: 'usage', usage: { inputTokens: 1, outputTokens: 1 } }
      yield { type: 'finish', reason: { kind: 'stop' } }
    }
  }
  const release = ctx.llm.registerAdapter(['upgrade-team-smoke'], new TeamAdapter())
  const parent = await ctx.agents.create({
    sessionId: SessionId(`upgrade-team-parent-${randomUUID()}`), meta: { cwd, agentPreset: 'standard' },
    agentOptions: { provider: 'upgrade-team-smoke', model: 'offline' },
    setup: async scope => { await ctx.agentPresets.mount(scope, 'standard') },
  })
  try {
    const marker = capabilitySubmissionMarker({ expertIds: [], skillNames: [], teamId })
    parent.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: `${marker}\nCreate an offline test report.` }] }))
    await parent.agent.whenIdle()
    const events = parent.agent.session.snapshotEvents()
    assert.ok(events.some(event => event.type === 'user/message' && event.data.source.kind === 'user'
      && event.data.content.some(block => block.type === 'text' && /【(?:Expert team:|专家团：)/u.test(block.text))), 'durable team label is missing')
    assert.ok(!events.some(event => event.type === 'subagent/catalog'), 'team work blocked message admission')
    for (const name of ['get_expert_team', 'summon_expert_team']) {
      const result = await ctx.tools.execute({ name, arguments: { team: teamId, ...(name === 'summon_expert_team' ? { task: 'Create an offline test report.' } : {}) },
        callId: ToolCallId(`team-smoke-${name}`), agent: parent.agent, signal: AbortSignal.timeout(30_000) })
      assert.equal(result.isError, false, JSON.stringify(result))
    }
    assert.equal(childRequests.length, 5, 'plan, source production, two members and synthesis did not all complete')
    assert.ok(childRequests[0].tools.every(tool => tool.name === 'subagent'), `planning exposed work tools: ${childRequests[0].tools.map(tool => tool.name).join(', ')}`)
    assert.ok(childRequests[1].tools.length > 0, 'source production tools were disabled with planning tools')
    assert.ok(JSON.stringify(childRequests[3].messages).includes('OFFLINE_TEAM_PHASE_3_COMPLETE'), 'conversion did not receive formatting handoff')
    const planner = await ctx.agents.resume({ resumeSessionId: SessionId(String(childRequests[0].sessionId)),
      agentOptions: { provider: 'upgrade-team-smoke', model: 'offline' },
      setup: async scope => { await ctx.agentPresets.mount(scope, 'standard') } })
    try {
      const denied = await ctx.tools.execute({ name: 'subagent', arguments: { description: 'Unexpected planner delegation', prompt: 'This must be denied.' },
        callId: ToolCallId('planner-delegation-denied'), agent: planner.agent, signal: AbortSignal.timeout(10_000) })
      assert.equal(denied.isError, true, 'preset-local planner delegation was allowed')
      assert.match(JSON.stringify(denied.content), /planning phase cannot execute tools/u)
      assert.equal(childRequests.length, 5, 'planner guard started an extra model request')
    } finally { await planner.dispose() }
    assert.ok(!JSON.stringify(events.filter(event => event.type === 'user/message' && event.data.source.kind === 'user')).includes('<!--clawclaw-capabilities:'), 'wire carrier reached durable user text')
    console.log('verify-upgrade-team: composer admission, visible tool execution, tool-free planning and all team phases passed')
  } finally {
    await parent.dispose()
    release()
  }
}

/** Exercise the real official timer, real Agent admission and Desktop result history. */
export async function verifyDesktopSchedule(ctx) {
  const adapter = new OfflineAdapter()
  const release = ctx.llm.registerAdapter(['upgrade-schedule'], adapter)
  const previous = ctx.agentDefaultModel.currentSelection()
  try {
    await ctx.agentDefaultModel.saveSelection({ provider: 'upgrade-schedule', model: 'offline' })
    const controller = ctx.desktopCronTasksController
    const workspace = await ctx.workspaceRegistry.create(ctx.profileContext.home)
    const task = await controller.action({ action: 'create', input: {
      name: 'Offline Schedule integration', prompt: '请用中文返回离线验证结果。',
      expression: '0 0 * * *', timeZone: 'UTC', workspaceId: String(workspace.id), oneTimeAt: new Date(Date.now() + 3_000).toISOString(),
    } })
    const catalog = await ctx.schedule.catalog()
    assert.ok(catalog.some(record => String(record.id) === task.id), 'Desktop task is missing from the official Schedule core')
    let completed
    const deadline = Date.now() + 15_000
    while (Date.now() < deadline) {
      const view = await controller.read()
      completed = view.jobs.find(job => job.id === task.id)
      if (completed?.lastRun !== undefined && view.running.length === 0) break
      await new Promise(resolve => setTimeout(resolve, 25))
    }
    assert.equal(completed?.lastRun?.status, 'completed', JSON.stringify(completed?.lastRun))
    assert.equal(completed.enabled, false)
    assert.equal(completed.history.length, 1)
    assert.equal(adapter.requests.length, 1, 'official delivery executed more than once')
    assert.match(requestSystem(adapter.requests[0]), /This assistant session runs in ClawClaw/)
    assert.match(requestSystem(adapter.requests[0]), /language of the (?:user-written task|original user task)/)
    assert.equal(requestSystem(adapter.requests[0]).split(DESKTOP_RESPONSE_POLICY).length, 2)
    assert.ok(JSON.stringify(adapter.requests[0].messages).includes('请用中文返回离线验证结果。'))
    assert.equal(String(adapter.requests[0].sessionId), completed.activeSessionId)
    assert.ok(completed.lastClaimedMessageId, 'execution was not durably fenced')
    await new Promise(resolve => setTimeout(resolve, 25))
    const job = await controller.action({ action: 'create', input: {
      name: 'Manual Schedule integration', prompt: 'Reply with the offline verification result.',
      expression: '0 0 * * *', timeZone: 'UTC', workspaceId: String(workspace.id),
    } })
    const result = await controller.action({ action: 'run', id: job.id })
    assert.equal(result.run.status, 'completed')
    assert.equal(adapter.requests.length, 2)
    await controller.action({ action: 'toggle', id: job.id, enabled: false })
    const sessionId = (await controller.read()).jobs.find(task => task.id === job.id).activeSessionId
    await controller.action({ action: 'delete', id: job.id })
    assert.ok((await controller.read()).archivedJobs.some(task => task.id === job.id && task.history.length === 1),
      'task deletion discarded execution history')
    const observation = await ctx.sessionQuery.observeSession(SessionId(sessionId))
    try { assert.equal(String(observation.header.id), sessionId, 'task deletion removed its conversation') }
    finally { observation[Symbol.dispose]() }
    await controller.action({ action: 'create', input: {
      name: 'Restart preservation', prompt: 'Do not run during restart verification.',
      expression: '0 0 * * *', timeZone: 'UTC', workspaceId: String(workspace.id),
    } })
    console.log('verify-desktop-schedule: official timer, durable admission, manual run, results, pause and Session preservation passed')
  } finally {
    await ctx.agentDefaultModel.saveSelection(previous)
    release()
  }
}
