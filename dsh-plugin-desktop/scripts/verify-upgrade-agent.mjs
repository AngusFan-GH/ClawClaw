/** Real preset, expert activation and persistence smoke using an offline model. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SessionId, pluginRecordOf } from '@deepseek-ai/dsh-session'

class OfflineAdapter extends LlmAdapter {
  requests = []
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model })
  }
  async *stream(options) {
    this.requests.push(options)
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
      assert.ok(assembly.sections.some(section => section.name === 'deployment:persona-prefix'
        && section.text.length > 0), 'expert persona was lost after resume')
      assert.ok(!assembly.tools.some(tool => tool.name === 'summon_expert_team'), 'expert restriction was lost after resume')
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
      name: 'Offline Schedule integration', prompt: 'Reply with the offline verification result.',
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
