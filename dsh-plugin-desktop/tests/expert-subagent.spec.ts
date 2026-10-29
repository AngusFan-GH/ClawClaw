import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SubagentActivationSpec } from '@deepseek-ai/dsh-subagent'
import { Session, SessionId, appendPluginRecord } from '@deepseek-ai/dsh-session'
import { installExpertCompositionRecovery, startExpertSubagent } from '../src/experts/expert-subagent.ts'

function fixture() {
  const listeners = new Set<(payload: { agent: Agent }) => void>()
  const session = Session.create(SessionId('expert-child'))
  const section = vi.fn()
  const restrict = vi.fn()
  const child = {
    id: '', ctx: { systemPrompt: { section, getSectionOrder: () => 10 }, tools: { restrict } },
    session,
  } as unknown as Agent
  const dispose = vi.fn(async () => {})
  const settled = Promise.withResolvers<{ stopReason: 'completed'; output: [] }>()
  const startActivation = vi.fn(async (spec: SubagentActivationSpec) => {
    Object.assign(child, { id: spec.childId })
    for (const callback of listeners) callback({ agent: child })
    return { childId: spec.childId!, result: settled.promise, dispose }
  })
  const getProvider = vi.fn(() => ({ prepareContinuable: vi.fn() }))
  const ctx = {
    subagents: { getProvider, startActivation }, logger: { warn: vi.fn() },
    on: (_event: string, callback: (payload: { agent: Agent }) => void) => {
      listeners.add(callback)
      return () => { listeners.delete(callback) }
    },
  } as unknown as Context
  return { ctx, listeners, session, child, section, restrict, dispose, settled, startActivation, getProvider }
}

describe('DSH activation expert adaptation', () => {
  it('applies identity and MCP isolation before execution and preserves caller-owned results', async () => {
    const f = fixture()
    installExpertCompositionRecovery(f.ctx)
    const signal = new AbortController().signal
    const run = await startExpertSubagent(f.ctx, 'spawn', {
      parent: {} as Agent, prompt: [{ type: 'text', text: 'Review' }], label: 'reviewer',
      persona: 'Expert reviewer', toolFilter: { deny: ['mcp__unbound__write'] }, maxDepth: 2, signal,
    })
    expect(f.startActivation).toHaveBeenCalledWith(expect.objectContaining({
      delivery: 'caller', label: 'reviewer', signal,
      request: expect.objectContaining({ maxDepth: 2 }),
    }))
    expect(f.section).toHaveBeenCalledWith(expect.objectContaining({ text: 'Expert reviewer' }))
    expect(f.restrict).toHaveBeenCalledWith({ deny: ['mcp__unbound__write'] })
    expect(f.session.snapshotEvents().map(event => ({ type: event.type, ignorable: event.ignorable }))).toContainEqual({ type: 'plugin:clawclaw/expert-composition', ignorable: true })
    expect(f.listeners.size).toBe(1)
    f.settled.resolve({ stopReason: 'completed', output: [] })
    await expect(run.result).resolves.toMatchObject({ stopReason: 'completed' })
    await run.dispose()
    expect(f.dispose).toHaveBeenCalledOnce()
  })

  it('restores persisted composition on cold resume', () => {
    const f = fixture()
    const composition = { version: 1 as const, persona: 'Own expert', deniedTools: ['write_file'] }
    appendPluginRecord(f.session, 'plugin:clawclaw/expert-composition', composition)
    installExpertCompositionRecovery(f.ctx)
    for (const callback of f.listeners) callback({ agent: f.child })
    expect(f.section).toHaveBeenCalledOnce()
    expect(f.section).toHaveBeenCalledWith(expect.objectContaining({ text: 'Own expert' }))
    expect(f.restrict).toHaveBeenCalledWith({ deny: ['write_file'] })
  })

  it('keeps planning tools disabled on activation and cold resume', async () => {
    const f = fixture()
    await startExpertSubagent(f.ctx, 'spawn', {
      parent: {} as Agent, prompt: [], persona: 'Plan only', toolFilter: { deny: [], allow: [] },
    })
    expect(f.restrict).toHaveBeenCalledWith({ deny: [], allow: [] })
    f.restrict.mockClear()
    installExpertCompositionRecovery(f.ctx)
    for (const callback of f.listeners) callback({ agent: f.child })
    expect(f.restrict).toHaveBeenCalledWith({ deny: [], allow: [] })
    f.settled.resolve({ stopReason: 'completed', output: [] })
  })

  it('cancels an accepted activation when the owning tool is cancelled', async () => {
    const f = fixture()
    const controller = new AbortController()
    const run = await startExpertSubagent(f.ctx, 'spawn', {
      parent: {} as Agent, prompt: [], persona: 'Expert', toolFilter: { deny: [] }, signal: controller.signal,
    })
    controller.abort()
    expect(f.dispose).toHaveBeenCalledOnce()
    f.settled.resolve({ stopReason: 'completed', output: [] })
    await run.result
  })

  it('removes the creation listener when activation startup fails', async () => {
    const f = fixture()
    f.startActivation.mockRejectedValueOnce(new Error('startup failed'))
    await expect(startExpertSubagent(f.ctx, 'spawn', {
      parent: {} as Agent, prompt: [], persona: 'Expert', toolFilter: { deny: [] },
    })).rejects.toThrow('startup failed')
    expect(f.listeners.size).toBe(0)
  })
})
