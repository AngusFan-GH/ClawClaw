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
