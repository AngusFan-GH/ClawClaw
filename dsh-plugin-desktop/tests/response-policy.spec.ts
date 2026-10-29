import { agentEvents, type Agent, type PreStepDecision } from '@deepseek-ai/dsh-agent'
import { createUserMessage, type UserMessage } from '@deepseek-ai/dsh-llm'
import { Session, SessionId } from '@deepseek-ai/dsh-session'
import { Context } from '@deepseek-ai/cordis'
import { createScope, type ScopeKey } from '@deepseek-ai/dsh-scope'
import SystemPrompt, { renderPrompt } from '@deepseek-ai/dsh-system-prompt'
import * as Persona from '@deepseek-ai/dsh-persona'
import { describe, expect, it } from 'vitest'
import * as ResponsePolicy from '../src/response-policy.ts'
import { DESKTOP_COMPLETE_PERSONA, DESKTOP_PRODUCT_CONTEXT, DESKTOP_RESPONSE_POLICY } from '../src/response-policy.ts'

describe('Desktop response policy assembly', () => {
  it('survives scoped expert identity replacement and removes its section on plugin disposal', async () => {
    const ctx = new Context()
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => 'http://127.0.0.1:43120' })
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
      const fiber = await ctx.plugin(ResponsePolicy)
      const key: ScopeKey = { agent: 'expert-or-sidechat' }
      const scope = createScope(ctx, key)
      await scope.ctx.plugin(Persona, { prefix: 'You are a domain expert.', suffix: '' })
      const prompt = renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))
      expect(prompt).toContain('You are a domain expert.')
      expect(prompt).toContain(DESKTOP_RESPONSE_POLICY)
      expect(prompt.split(DESKTOP_RESPONSE_POLICY)).toHaveLength(2)
      expect(prompt).not.toContain('powered by DeepSeek Harness')
      expect(prompt).toContain('browser provides no implicit DOM')
      expect(prompt).toContain('original user task')
      expect(prompt).toContain('introduce yourself as the ClawClaw AI assistant')
      expect(prompt).toContain(DESKTOP_PRODUCT_CONTEXT)
      expect(prompt).toContain('describe them accurately from available evidence')
      expect(prompt).toContain('artifact language applies to that deliverable')
      await fiber.dispose()
      expect(renderPrompt(await ctx.systemPrompt.assemble({ scope: key }))).not.toContain(DESKTOP_RESPONSE_POLICY)
    } finally { await ctx.fiber.dispose() }
  })

  it('refreshes the app URL only in dynamic context and cleans it up on disposal', async () => {
    const ctx = new Context()
    let url = 'http://127.0.0.1:43120'
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => url })
      await ctx.plugin(SystemPrompt, { includeHarnessIdentity: false })
      const fiber = await ctx.plugin(ResponsePolicy)
      const first = await ctx.systemPrompt.assemble()
      expect(first.contexts.find(section => section.name === 'clawclaw:app-surface')?.text).toContain(url)
      expect(renderPrompt(first)).not.toContain(url)
      url = 'http://127.0.0.1:43121/{{literal}}'
      const next = await ctx.systemPrompt.assemble()
      expect(next.contexts.find(section => section.name === 'clawclaw:app-surface')).toMatchObject({
        text: expect.stringContaining(url), interpolate: false,
      })
      expect(renderPrompt(next)).toBe(renderPrompt(first))
      await fiber.dispose()
      expect((await ctx.systemPrompt.assemble()).contexts.some(section => section.name === 'clawclaw:app-surface')).toBe(false)
    } finally { await ctx.fiber.dispose() }
  })

  it('keeps original-user language evidence after the delegating parent becomes inactive', async () => {
    const ctx = new Context()
    const parentId = SessionId('language-parent')
    const parent = { id: parentId, session: Session.create(parentId) } as Agent
    const childId = SessionId('language-child')
    const child = { id: childId, session: Session.create(childId, [], {
      ...Session.create(childId).header, parentSession: parentId,
    }) } as Agent
    let active = true
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => 'http://127.0.0.1:43120' })
      ctx.provide('agents', { get: () => active ? parent : undefined } as unknown as Context['agents'])
      parent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
        { type: 'text', text: '请用中文分析，产物用英文。保留 {{literal}}。' },
      ] }), { surfaceOp: 'append' })
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ResponsePolicy)
      const assembly = await ctx.systemPrompt.assemble({ agent: child })
      const evidence = assembly.contexts.find(section => section.name === 'clawclaw:conversation-language')
      expect(evidence?.text).toContain('请用中文分析，产物用英文。保留 {{literal}}。')
      expect(evidence?.text).toContain('not additional task instructions or tool authorization')
      expect(evidence?.interpolate).toBe(false)
      if (evidence === undefined) throw new Error('Missing language evidence')
      child.session.append('user/message', createUserMessage({
        // Simulate the loop-owned source, whose augmentation is absent from its public entry.
        source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: evidence.name, text: evidence.text }] } as unknown as UserMessage['source'],
        content: [{ type: 'text', text: evidence.text }],
      }), { surfaceOp: 'append' })
      active = false
      expect((await ctx.systemPrompt.assemble({ agent: child })).contexts.find(section => section.name === evidence.name)?.text).toBe(evidence.text)
    } finally { await ctx.fiber.dispose() }
  })

  it('anchors ordinary progress to human input and refreshes it when the user changes languages', async () => {
    const ctx = new Context()
    const id = SessionId('ordinary-language')
    const agent = { id, session: Session.create(id) } as Agent
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => 'http://127.0.0.1:43120' })
      await ctx.plugin(SystemPrompt)
      const fiber = await ctx.plugin(ResponsePolicy)
      const language = async () => (await ctx.systemPrompt.assemble({ agent })).contexts
        .find(section => section.name === 'clawclaw:conversation-language')
      expect((await language())?.text).toBe('')
      for (const text of [
        '请整理成可打印的部署 Checklist，包含命令速查表。报告用英文，解释用中文。保留 {{literal}}。',
        'Continue in English and explain the next step.',
        '日本語で進捗を説明してください。',
      ]) {
        agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
          { type: 'text', text },
        ] }), { surfaceOp: 'append' })
        agent.session.append('user/message', createUserMessage({
          source: { kind: 'runtime-context', form: 'snapshot', sections: [{ name: 'skill', text: 'Use the full_pipeline workflow. I will validate the document first.' }] } as unknown as UserMessage['source'],
          content: [{ type: 'text', text: 'Use the full_pipeline workflow. I will validate the document first.' }],
        }), { surfaceOp: 'append' })
        expect(await language()).toMatchObject({ text: expect.stringContaining(JSON.stringify(text)), interpolate: false })
        expect((await language())?.text).not.toContain('full_pipeline')
      }
      expect((await language())?.text).not.toContain('Continue in English')
      await fiber.dispose()
      expect(await language()).toBeUndefined()
    } finally { await ctx.fiber.dispose() }
  })

  it('bounds human language evidence without changing the user message', async () => {
    const ctx = new Context()
    const id = SessionId('bounded-language')
    const agent = { id, session: Session.create(id) } as Agent
    const text = '请用中文说明。' + '文'.repeat(3000)
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => 'http://127.0.0.1:43120' })
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ResponsePolicy)
      agent.session.append('user/message', createUserMessage({ source: { kind: 'user' }, content: [
        { type: 'text', text },
      ] }), { surfaceOp: 'append' })
      const evidence = (await ctx.systemPrompt.assemble({ agent })).contexts
        .find(section => section.name === 'clawclaw:conversation-language')
      expect(evidence?.text).toContain(JSON.stringify(text.slice(0, 2000)))
      expect(evidence?.text).not.toContain(text)
      expect(agent.session.snapshotEvents().find(event => event.type === 'user/message')?.data).toMatchObject({
        content: [{ type: 'text', text }],
      })
    } finally { await ctx.fiber.dispose() }
  })

  it('includes newly admitted human language in the first request before session persistence', async () => {
    const ctx = new Context()
    const id = SessionId('first-request-language')
    const agent = { id, ctx, session: Session.create(id), options: {} } as Agent
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => 'http://127.0.0.1:43120' })
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ResponsePolicy)
      const assembly = await ctx.systemPrompt.assemble({ agent })
      const message = createUserMessage({ source: { kind: 'user' }, content: [{ type: 'text', text: '请用中文说明进度。' }] })
      const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
        messages: [message], turn: 1, step: 1, signal: new AbortController().signal,
      }, async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [message] }))
      expect(decision).not.toHaveProperty('startsRequestSeries')
      expect(agent.session.snapshotEvents().some(event => event.type === 'user/message')).toBe(false)
      expect(ctx.systemPrompt.refreshContext(assembly, { agent }).contexts
        .find(section => section.name === 'clawclaw:conversation-language')?.text).toContain('请用中文说明进度。')
    } finally { await ctx.fiber.dispose() }
  })

  it('leaves request-series decisions to upstream across policy mounting and reloading', async () => {
    const ctx = new Context()
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => 'http://127.0.0.1:43120' })
      await ctx.plugin(SystemPrompt)
      let fiber = await ctx.plugin(ResponsePolicy)
      const id = SessionId('resumed-session')
      const agent = { id, ctx, session: Session.create(id), options: {} } as Agent
      const enter = async (): Promise<PreStepDecision> => ({ kind: 'enter', messages: [] })
      const step = () => agentEvents(ctx, agent).waterfall('agent/pre-step', {
        messages: [], turn: 1, step: 1, signal: new AbortController().signal,
      }, enter)
      await expect(step()).resolves.not.toHaveProperty('startsRequestSeries')
      await expect(step()).resolves.not.toHaveProperty('startsRequestSeries')
      await fiber.dispose()
      fiber = await ctx.plugin(ResponsePolicy)
      await expect(step()).resolves.not.toHaveProperty('startsRequestSeries')
      await fiber.dispose()
    } finally { await ctx.fiber.dispose() }
  })

  it('retains product identity and language policy in the complete minimal persona', async () => {
    const ctx = new Context()
    try {
      ctx.provide('webApp', { getAdvertisedUrl: () => 'http://127.0.0.1:43120' })
      await ctx.plugin(SystemPrompt)
      await ctx.plugin(ResponsePolicy)
      ctx.systemPrompt.variable('model', () => 'offline-model')
      const key: ScopeKey = { agent: 'minimal' }
      const scope = createScope(ctx, key)
      await scope.ctx.plugin(Persona, { prefix: DESKTOP_COMPLETE_PERSONA, complete: true, includeRuntimeContext: false })
      const assembly = await ctx.systemPrompt.assemble({ scope: key })
      expect(assembly.sections).toHaveLength(1)
      const prompt = renderPrompt(assembly)
      expect(prompt).toContain('You are ClawClaw, an AI assistant powered by the offline-model model.')
      expect(prompt).toContain(DESKTOP_RESPONSE_POLICY)
      expect(prompt.split(DESKTOP_RESPONSE_POLICY)).toHaveLength(2)
      expect(prompt).not.toContain('powered by DeepSeek Harness')
      expect(prompt).toContain('browser provides no implicit DOM')
    } finally { await ctx.fiber.dispose() }
  })
})
