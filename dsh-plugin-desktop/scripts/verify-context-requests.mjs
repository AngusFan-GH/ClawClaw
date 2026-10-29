/** Real Loader/Agent request regression using a deterministic, network-free adapter. */
import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import { LlmAdapter, createUserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import { DESKTOP_RESPONSE_POLICY, DESKTOP_PRODUCT_CONTEXT } from '../lib/response-policy.js'
import { recordContextAudit } from './context-audit.mjs'

const textOf = message => message.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
const systemOf = request => textOf(request.messages.findLast(message => message.role === 'system'))

class ContextAdapter extends LlmAdapter {
  requests = []
  resolveModel(provider, model) {
    return Promise.resolve({ provider, id: model, name: model, systemPromptUpdate: 'in-history' })
  }
  async *stream(request) {
    // Session-title generation shares the adapter but uses a one-shot system field.
    if (request.messages.some(message => message.role === 'system')) this.requests.push(request)
    const text = 'OFFLINE_CONTEXT_OK'
    yield { type: 'block-start', index: 0, blockType: 'text' }
    yield { type: 'text-delta', index: 0, text }
    yield { type: 'block-end', index: 0, block: { type: 'text', text } }
    yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 10 } }
    yield { type: 'finish', reason: { kind: 'stop' } }
  }
}

function checkRequest(request, label) {
  assert.ok(request, `${label}: model received no request`)
  const system = systemOf(request)
  assert.equal(system.split(DESKTOP_RESPONSE_POLICY).length, 2, `${label}: response policy must appear once`)
  assert.equal(system.split(DESKTOP_PRODUCT_CONTEXT).length, 2, `${label}: product context must appear once`)
  assert.ok(!system.includes('You are an AI agent powered by DeepSeek Harness.'))
  const runtime = request.messages.findLast(message => message.source?.kind === 'runtime-context')
  assert.ok(runtime?.source.sections.some(section => section.name === 'working-directory:current'), `${label}: directory lost`)
  recordContextAudit(label, { request })
}

/** Preserve conversation input, scoped roles and policy across fresh turns, updates and cold resume. */
export async function verifyContextRequests(ctx, cwd, { team = false } = {}) {
  const adapter = new ContextAdapter()
  const release = ctx.llm.registerAdapter(['context-smoke'], adapter)
  const presets = team ? ['standard'] : ['standard', 'ptc', 'cordis', 'minimal']
  try {
    for (const preset of presets) {
      const id = SessionId(`context-${preset}-${randomUUID()}`)
      let handle = await ctx.agents.create({ sessionId: id, meta: { cwd, agentPreset: preset },
        agentOptions: { provider: 'context-smoke', model: 'offline' },
        setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) } })
      try {
        const inputs = team ? ['请以团队负责人身份用中文简要介绍当前角色。'] : [
          '请用中文说明进度，生成一份英文项目摘要。',
          'Continue in English and explain the next step. Preserve src/main.ts and npm run check.',
        ]
        for (const input of inputs) {
          const before = adapter.requests.length
          handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: input }] }))
          await handle.agent.whenIdle()
          assert.ok(adapter.requests.length > before, `${preset}: no model request after user input`)
          const request = adapter.requests.at(-1)
          checkRequest(request, `${team ? 'team:lead' : `request:${preset}`}`)
          assert.ok(request.messages.some(message => message.source?.kind === 'user' && textOf(message) === input))
          const language = request.messages.findLast(message => message.source?.kind === 'runtime-context').source.sections
            .find(section => section.name === 'clawclaw:conversation-language')
          assert.ok(language?.text.includes(input), `${preset}: current human language evidence missing`)
          if (preset !== 'minimal') {
            const sections = request.messages.findLast(message => message.source?.kind === 'runtime-context').source.sections
            for (const name of ['sandbox:policy', 'approval:policy', 'clawclaw:app-surface']) {
              assert.ok(sections.some(section => section.name === name), `${preset}: lost ${name}`)
            }
          }
        }
        if (team) {
          const lead = adapter.requests.at(-1)
          const context = lead.messages.findLast(message => message.source?.kind === 'runtime-context')
          assert.ok(context.source.sections.some(section => section.name === 'team:identity'))
          assert.match(textOf(context), /Team Lead/)
          // The deterministic adapter can finish and retire the child before
          // spawn returns. Capture its real handle at creation, rather than
          // requiring a completed activation to remain in the live registry.
          const created = new Map()
          const stopCreated = ctx.on('agent/created', ({ agent }) => { created.set(agent.id, agent) })
          let child
          try {
            const spawned = await ctx.agentTeams.spawnTeammate(handle.agent, { name: 'context-audit-member',
              description: 'Offline context fixture', prompt: [{ type: 'text', text: 'Review the project and return your findings. This is an English generated task wrapper.' }],
              context: 'fresh', provider: 'spawn', signal: AbortSignal.timeout(10_000) })
            child = ctx.agents.get(spawned.member.id) ?? created.get(spawned.member.id)
          } finally { stopCreated() }
          assert.ok(child, 'teammate was not created')
          await child.whenIdle()
          const request = adapter.requests.findLast(item => item.sessionId === child.id)
          checkRequest(request, 'team:teammate')
          const language = request.messages.findLast(message => message.source?.kind === 'runtime-context').source.sections
            .find(section => section.name === 'clawclaw:conversation-language')
          assert.ok(language?.text.includes(inputs[0]), 'teammate lost original user language evidence')
          assert.match(textOf(request.messages.findLast(message => message.source?.kind === 'runtime-context')), /You are teammate/)
          continue
        }
        // Scope a historical language policy, then remove it without forcing a new request series.
        if (preset === 'standard') {
          const stop = handle.agent.ctx.systemPrompt.section({ name: 'clawclaw:response-policy', order: 10200, text: 'Historical policy fixture.' })
          handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '保存一次历史策略。' }] }))
          await handle.agent.whenIdle()
          assert.match(systemOf(adapter.requests.at(-1)), /Historical policy fixture/)
          stop()
          handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '策略更新后继续用中文。' }] }))
          await handle.agent.whenIdle()
          checkRequest(adapter.requests.at(-1), 'updated:standard')
          assert.ok(!systemOf(adapter.requests.at(-1)).includes('Historical policy fixture.'))
        }
        await ctx.sessions.flush(handle.agent.session)
        await handle.dispose()
        handle = await ctx.agents.resume({ resumeSessionId: id,
          agentOptions: { provider: 'context-smoke', model: 'offline' },
          setup: async agentCtx => { await ctx.agentPresets.mount(agentCtx, preset) } })
        handle.agent.followup(createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '恢复后继续用中文。' }] }))
        await handle.agent.whenIdle()
        const resumed = adapter.requests.at(-1)
        checkRequest(resumed, `resumed:${preset}`)
        const language = resumed.messages.findLast(message => message.source?.kind === 'runtime-context').source.sections
          .find(section => section.name === 'clawclaw:conversation-language')
        assert.ok(language?.text.includes('恢复后继续用中文。'), `${preset}: resume lost current language evidence`)
        assert.ok(!systemOf(resumed).includes('Historical policy fixture.'))
        assert.ok(resumed.messages.some(message => message.source?.kind === 'user' && textOf(message) === inputs[0]), 'resume lost user history')
      } finally { await handle.dispose() }
    }
  } finally { release() }
  console.log(`verify-context-requests: ${team ? 'real Lead and teammate roles' : 'four presets, multilingual inputs, changed policy and cold resume'} preserved product context and one language policy`)
}
