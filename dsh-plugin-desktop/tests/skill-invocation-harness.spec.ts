import { mkdir, mkdtemp, realpath, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import { createUserMessage, ToolCallId } from '@deepseek-ai/dsh-llm'
import { SESSION_FORMAT_VERSION, Session, SessionId } from '@deepseek-ai/dsh-session'
import AgentRegistry, { agentEvents, type Agent } from '@deepseek-ai/dsh-agent'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ClawClawSkillFileSystem from '../src/clawclaw-skill-filesystem.ts'
import SkillRegistry from '@deepseek-ai/dsh-skill'
import * as SkillFileSystem from '@deepseek-ai/dsh-skill-filesystem'
import * as toolSkill from '@deepseek-ai/dsh-tool-skill'
import { DesktopSkillsController } from '../src/skills.ts'
import { skillInsertion } from '../src/client/conversation-skills.ts'
import { clawClawDataLayout } from '../src/product-data-layout.ts'

it.each([false, true])('loads a user-only Skill from the active data directory through Harness (custom directory: %s)', async custom => {
  const home = await mkdtemp(join(tmpdir(), 'clawclaw-skill-invocation-'))
  const ctx = new Context()
  const layout = clawClawDataLayout(home)
  const dataHome = custom ? join(home, 'custom-data') : layout.dshHome
  vi.stubEnv('DSH_HOME', dataHome)
  try {
    await mkdir(layout.defaultWorkspace, { recursive: true })
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(SkillFileSystem, { dshHome: dataHome, agentsHome: join(home, '.agents'), watch: true })
    ctx.provide('workingDirectory', { ensure: async (agent: Agent) => agent.session.header.cwd ?? home } as unknown as Context['workingDirectory'])
    await ctx.plugin(toolSkill)
    const controller = new DesktopSkillsController(ctx)
    await controller.importDocument('---\nname: desktop-review\ndescription: Review code\ndisable-model-invocation: true\n---\nCheck all public interfaces before changing code.\n')
    await vi.waitFor(async () => { expect((await controller.detail('desktop-review')).path).toBe(await realpath(join(dataHome, 'skills', 'desktop-review', 'SKILL.md'))) })
    const skills = await ctx.skills.list({ cwd: layout.defaultWorkspace })
    const catalog = { skills: skills.filter(skill => skill.invocation?.userInvocable !== false).map(skill => ({ name: skill.name, description: skill.description, modelInvocable: skill.invocation?.modelInvocable !== false })), commands: [] }
    const draft = 'Review this change.'
    const insertion = skillInsertion('desktop-review', { draft, draftRev: 1, phase: 'plain' }, catalog)
    const id = SessionId('desktop-skill-test')
    const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: layout.defaultWorkspace, isSeeded: false })
    const agent = { id, ctx, session, options: {} } as Agent
    const messages = [createUserMessage({ content: [{ type: 'text', text: insertion.text + draft }], source: { kind: 'user' } })]
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', {
      messages, turn: 1, step: 1, signal: new AbortController().signal,
    }, async () => ({ kind: 'enter' as const, messages }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('Unexpected rejection')
    const loaded = decision.messages.find(message => message.source.kind === 'skill-invocation')
    expect(loaded?.source).toMatchObject({ kind: 'skill-invocation', name: 'desktop-review', form: 'instructions' })
    expect(loaded?.content).toEqual([expect.objectContaining({ type: 'text', text: expect.stringContaining('Check all public interfaces before changing code.') })])
    expect(decision.messages[0]).toEqual(messages[0])
  } finally {
    await ctx.fiber.dispose()
    vi.unstubAllEnvs()
    await rm(home, { recursive: true, force: true })
  }
})

it('loads bundled brief-compose through both model and manual Harness invocation', async () => {
  const home = await mkdtemp(join(tmpdir(), 'clawclaw-bundled-invocation-'))
  const ctx = new Context()
  try {
    ctx.provide('settings', { get: () => ({ paths: [] }) } as unknown as Context['settings'])
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(AgentRegistry)
    await ctx.plugin(SkillRegistry)
    await ctx.plugin(ClawClawSkillFileSystem)
    ctx.provide('workingDirectory', { ensure: async (agent: Agent) => agent.session.header.cwd ?? home } as unknown as Context['workingDirectory'])
    await ctx.plugin(toolSkill)
    const summaries = await ctx.skills.list({ cwd: home })
    expect(summaries.find(skill => skill.name === 'brief-compose')?.invocation).toEqual({ modelInvocable: true, userInvocable: true })
    const value = await ctx.tools.execute({ name: 'skill', arguments: { name: 'brief-compose' }, callId: ToolCallId('brief-model'), signal: new AbortController().signal })
    expect(value).toMatchObject({ isError: false, value: { name: 'brief-compose', content: expect.stringContaining('# 短文与通知快写') } })
    // Internal-only references stay inaccessible to direct model calls.
    await expect(ctx.tools.execute({ name: 'skill', arguments: { name: 'html-review' }, callId: ToolCallId('internal-model'), signal: new AbortController().signal })).resolves.toMatchObject({ isError: true })
    const catalog = { skills: summaries.filter(skill => skill.invocation.userInvocable).map(skill => ({ name: skill.name, description: skill.description, modelInvocable: skill.invocation.modelInvocable })), commands: [] }
    const insertion = skillInsertion('brief-compose', { draft: '', draftRev: 1, phase: 'plain' }, catalog)
    const id = SessionId('brief-manual')
    const session = Session.create(id, [], { version: SESSION_FORMAT_VERSION, id, createdAt: 0, cwd: home, isSeeded: false })
    const agent = { id, ctx, session, options: {} } as Agent
    const messages = [createUserMessage({ content: [{ type: 'text', text: insertion.text + '写一份会议通知。' }], source: { kind: 'user' } })]
    const decision = await agentEvents(ctx, agent).waterfall('agent/pre-step', { messages, turn: 1, step: 1, signal: new AbortController().signal }, async () => ({ kind: 'enter' as const, messages }))
    expect(decision.kind).toBe('enter')
    if (decision.kind !== 'enter') throw new Error('Unexpected rejection')
    expect(decision.messages.find(message => message.source.kind === 'skill-invocation')?.source).toMatchObject({ name: 'brief-compose', form: 'instructions' })
    // Entry and every reference resolve to real bundled resources, independent of cwd.
    const brief = await ctx.skills.get('brief-compose', { cwd: home })
    expect(brief?.resourceBase).toMatchObject({ kind: 'directory' })
    const reference = await ctx.skills.get('html-review', { cwd: home })
    expect(reference?.content).toBeTruthy()
  } finally {
    await ctx.fiber.dispose()
    await rm(home, { recursive: true, force: true })
  }
})
