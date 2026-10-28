import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as Persona from '@deepseek-ai/dsh-persona'
import { describe, expect, it } from 'vitest'
import * as ResponsePolicy from '../src/response-policy.ts'
import { DESKTOP_PERSONA, DESKTOP_RESPONSE_POLICY } from '../src/response-policy.ts'

describe('Desktop response policy assembly', () => {
  it('survives scoped expert identity replacement and removes its section on plugin disposal', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
      const fiber = await ctx.plugin(ResponsePolicy)
      const key: ScopeKey = { agent: 'expert-or-sidechat' }
      const scope = createScope(ctx, key)
      await scope.ctx.plugin(Persona, { prefix: 'You are a domain expert.', suffix: '' })
      const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
      expect(prompt).toContain('You are a domain expert.')
      expect(prompt).toContain(DESKTOP_RESPONSE_POLICY)
      expect(prompt).not.toContain('powered by DeepSeek Harness')
      expect(prompt).toContain('original user task')
      expect(prompt).toContain('introduce yourself as the ClawClaw AI assistant')
      expect(prompt).toContain('When the user explicitly asks about the model, technical architecture, environment, or tools, answer accurately')
      expect(prompt).toContain('artifact language applies to that deliverable')
      await fiber.dispose()
      expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))).not.toContain(DESKTOP_RESPONSE_POLICY)
    } finally { await ctx.fiber.dispose() }
  })

  it('starts a fresh request series for an existing session after policy mounting and reloading', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      let fiber = await ctx.plugin(ResponsePolicy)
      const id = SessionId('resumed-session')
      const agent = { id, ctx, session: Session.create(id), options: {} } as Agent
      const enter = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })
      const step = () => agentEvents(ctx, agent).waterfall('agent/pre-step', {
        messages: [], turn: 1, step: 1, signal: new AbortController().signal,
      }, enter)
      await expect(step()).resolves.toMatchObject({ startsRequestSeries: true })
      await expect(step()).resolves.not.toHaveProperty('startsRequestSeries')
      await fiber.dispose()
      fiber = await ctx.plugin(ResponsePolicy)
      await expect(step()).resolves.toMatchObject({ startsRequestSeries: true })
      await fiber.dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('retains product identity and language policy in the complete minimal persona', async () => {
    const ctx = new Context()
    try {
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ResponsePolicy)
      ctx.systemPrompt.variable('model', () => 'offline-model')
      const key: ScopeKey = { agent: 'minimal' }
      const scope = createScope(ctx, key)
      await scope.ctx.plugin(Persona, { prefix: DESKTOP_PERSONA, complete: true, includeRuntimeContext: false })
      const assembly = await ctx.systemPrompt.assemble({ scope: key })
      expect(assembly.sections).toHaveLength(1)
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('You are ClawClaw, an AI assistant powered by the offline-model model.')
      expect(prompt).toContain(DESKTOP_RESPONSE_POLICY)
      expect(prompt).not.toContain('powered by DeepSeek Harness')
    } finally { await ctx.fiber.dispose() }
  })
})
