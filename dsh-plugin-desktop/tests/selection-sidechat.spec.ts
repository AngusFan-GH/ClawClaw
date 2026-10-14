import { readFileSync } from 'node:fs'
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  isSelectionSideChatSessionId,
  parseSelectionSideChatPrepareRequest,
  parseSelectionSideChatPrepareResult,
  selectionSideChatLabel,
} from '../src/selection-sidechat-contract.ts'
import {
  prepareSelectionSideChat,
  publishSelectionSideChat,
  suppressSelectionSideChatSettlement,
  type SelectionSideChatRuntime,
} from '../src/selection-sidechat.ts'

const PARENT = SessionId('parent-session')
const REQUEST = {
  parentSessionId: PARENT,
  quote: {
    text: 'selected text',
    context: 'Surrounding source message',
    source: { messageKey: 'assistant:1', startOffset: 2, endOffset: 15 },
  },
}

function fixture(options: { parent?: Agent } = {}) {
  const getTool = vi.fn((name: string) => name === 'send_message' ? {} : undefined)
  const parentAppend = vi.fn()
  const parent = options.parent ?? ({
    id: PARENT,
    ctx: { get: (name: string) => name === 'tools' ? { get: getTool } : undefined } as unknown as Context,
    options: { provider: 'deepseek', model: 'chat', reasoningEffort: 'medium', maxTokens: 4096 },
    session: {
      append: parentAppend,
      header: { id: PARENT, createdAt: 1, cwd: '/workspace' },
      requestHeader: () => undefined,
    },
  } as unknown as Agent)
  const childAppend = vi.fn()
  const childSession = {
    append: childAppend,
    header: { id: SessionId('child'), createdAt: 42, parentSession: PARENT },
    isOwnSeq: vi.fn(() => true),
  }
  const dispose = vi.fn(async () => undefined)
  const create = vi.fn(async (spec: { setup?: (ctx: Context, child: Agent) => void; sessionId: SessionId }) => {
    const childCtx = {
      get: () => undefined,
      systemPrompt: {
        context: vi.fn(), getContextOrder: vi.fn(() => 0), getSectionOrder: vi.fn(() => 0), section: vi.fn(),
      },
      tools: { restrict: vi.fn() },
    } as unknown as Context
    const child = { id: spec.sessionId, session: childSession } as unknown as Agent
    spec.setup?.(childCtx, child)
    return { agent: child, dispose }
  })
  const prepareContinuable = vi.fn(async () => ({}))
  const flush = vi.fn(async () => true)
  const childIdentity = { mode: 'continuable' as const, label: 'selected text', seq: 0 }
  const parentCatalog: Array<{ id: SessionId }> = []
  const snapshot = vi.fn((session: unknown) => session === childSession
    ? { values: { subagent: childIdentity } }
    : { values: { subagentCatalog: parentCatalog } })
  const runtime = {
    agents: { get: vi.fn(() => parent), create },
    sessions: { flush },
    sessionProjections: { snapshot },
    subagents: { getProvider: vi.fn(() => ({ prepareContinuable })) },
  } as unknown as SelectionSideChatRuntime
  return {
    childAppend, childIdentity, childSession, create, dispose, flush, getTool, parent,
    parentAppend, parentCatalog, prepareContinuable, runtime, snapshot,
  }
}

describe('selection side-chat contract', () => {
  it('declares the session service used by side-chat persistence', () => {
    const entry = readFileSync(new URL('../src/index.ts', import.meta.url), 'utf8')
    const topLevelInject = entry.match(/export const inject = \[([\s\S]*?)\]/)?.[1]
    expect(topLevelInject).toContain("'sessions'")
    expect(topLevelInject).toContain("'sessionProjections'")
  })

  it('validates a bounded structured preparation request', () => {
    expect(parseSelectionSideChatPrepareRequest(REQUEST)).toEqual(REQUEST)
    expect(parseSelectionSideChatPrepareResult({ childSessionId: 'child' })).toEqual({ childSessionId: 'child' })
    expect(() => parseSelectionSideChatPrepareRequest({ ...REQUEST, quote: { text: '' } })).toThrow(/quote text/)
    expect(() => parseSelectionSideChatPrepareRequest({
      ...REQUEST, quote: { text: 'x', source: { messageKey: 'm', startOffset: 4, endOffset: 2 } },
    })).toThrow(/source/)
    expect(() => parseSelectionSideChatPrepareResult({})).toThrow(/response/)
  })

  it('normalizes labels and identifies only owned children', () => {
    expect(selectionSideChatLabel('  first\n  second  ')).toBe('first second')
    expect(selectionSideChatLabel('文'.repeat(140))).toBe(`${'文'.repeat(117)}...`)
    expect(isSelectionSideChatSessionId('selection-sidechat-child')).toBe(true)
    expect(isSelectionSideChatSessionId('ordinary-child')).toBe(false)
  })
})

describe('selection continuable subagent', () => {
  it('persists a dormant child without publishing it in the parent catalog', async () => {
    const value = fixture()

    const result = await prepareSelectionSideChat(value.runtime, REQUEST)

    expect(result).toEqual({
      childSessionId: expect.stringMatching(/^selection-sidechat-/),
    })
    expect(value.prepareContinuable).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: result.childSessionId, parent: value.parent, signal: expect.any(AbortSignal),
    }))
    expect(value.create).toHaveBeenCalledWith(expect.objectContaining({
      sessionId: result.childSessionId,
      parentAgent: value.parent,
      meta: expect.objectContaining({ parentSession: PARENT, origin: 'subagent', delegationDepth: 1 }),
      agentOptions: expect.objectContaining({ provider: 'deepseek', model: 'chat', subagentDepth: 1 }),
    }))
    expect(value.childAppend).toHaveBeenCalledWith('subagent/descriptor', expect.objectContaining({
      mode: 'continuable', provider: 'spawn', label: 'selected text', toolFilter: { deny: ['send_message'] },
    }))
    expect(value.parentAppend).not.toHaveBeenCalled()
    expect(value.flush).toHaveBeenCalledOnce()
    expect(value.flush).toHaveBeenCalledWith(expect.objectContaining({ header: expect.any(Object) }))
    expect(value.dispose).toHaveBeenCalledOnce()
  })

  it('publishes the prepared child when its first user prompt is submitted', async () => {
    const value = fixture()
    const child = {
      id: SessionId('selection-sidechat-child'),
      session: value.childSession,
    } as unknown as Agent
    const message = { source: { kind: 'user' } } as unknown as UserMessage

    await expect(publishSelectionSideChat(value.runtime, child, message)).resolves.toBe(true)

    expect(value.parentAppend).toHaveBeenCalledWith('subagent/catalog', {
      version: 0,
      childId: child.id,
      childCreatedAt: 42,
      mode: 'continuable',
      label: 'selected text',
    })
    expect(value.flush).toHaveBeenCalledWith(value.parent.session)
  })

  it('does not republish an existing child or react to non-user inbox traffic', async () => {
    const value = fixture()
    const child = {
      id: SessionId('selection-sidechat-child'),
      session: value.childSession,
    } as unknown as Agent
    value.parentCatalog.push({ id: child.id })

    await expect(publishSelectionSideChat(
      value.runtime,
      child,
      { source: { kind: 'user' } } as unknown as UserMessage,
    )).resolves.toBe(false)
    await expect(publishSelectionSideChat(
      value.runtime,
      child,
      { source: { kind: 'subagent-settled' } } as unknown as UserMessage,
    )).resolves.toBe(false)

    expect(value.parentAppend).not.toHaveBeenCalled()
    expect(value.flush).not.toHaveBeenCalled()
  })

  it('fails before creating anything when the visible parent is no longer active', async () => {
    const value = fixture()
    vi.mocked(value.runtime.agents.get).mockReturnValue(undefined)
    await expect(prepareSelectionSideChat(value.runtime, REQUEST)).rejects.toThrow(/not active/)
    expect(value.prepareContinuable).not.toHaveBeenCalled()
    expect(value.create).not.toHaveBeenCalled()
  })

  it('rejects before creation when the provider cannot prepare continuable children', async () => {
    const value = fixture()
    vi.mocked(value.runtime.subagents.getProvider).mockReturnValue(undefined)
    await expect(prepareSelectionSideChat(value.runtime, REQUEST)).rejects.toThrow(/unavailable/)
    expect(value.create).not.toHaveBeenCalled()
  })

  it('always releases a created child when persistence fails', async () => {
    const value = fixture()
    value.flush.mockRejectedValueOnce(new Error('disk full'))
    await expect(prepareSelectionSideChat(value.runtime, REQUEST)).rejects.toThrow('disk full')
    expect(value.parentAppend).not.toHaveBeenCalled()
    expect(value.dispose).toHaveBeenCalledOnce()
  })

  it('removes only selection-sidechat settlements and holds an idle parent wake', async () => {
    const remove = vi.fn((_id: string) => true)
    const state: { phase: 'idle' | 'maintenance' | 'running' } = { phase: 'idle' }
    let pending = true
    let wakeRequested = false
    let turnStarted = false
    const runMaintenance = vi.fn(async (job: () => Promise<void>) => {
      if (state.phase !== 'idle') throw new Error('agent already has active work')
      state.phase = 'maintenance'
      await job()
      state.phase = 'idle'
      if (wakeRequested && pending) turnStarted = true
    })
    const agent = {
      get status() { return state.phase === 'running' ? 'running' : 'idle' },
      inbox: { remove: vi.fn((id: string) => { pending = false; return remove(id) }) },
      runMaintenance,
    } as unknown as Agent
    const sideMessage = {
      id: 'message-1',
      source: { kind: 'subagent-settled', senderSessionId: 'selection-sidechat-child' },
    } as unknown as UserMessage
    const ordinaryMessage = {
      id: 'message-2',
      source: { kind: 'subagent-settled', senderSessionId: 'other-child' },
    } as unknown as UserMessage

    expect(suppressSelectionSideChatSettlement(agent, sideMessage)).toBe(true)
    // Upstream followup continues to its wake call after the inserted listener.
    if (state.phase === 'maintenance') wakeRequested = true
    else turnStarted = true
    await Promise.resolve()
    await Promise.resolve()

    expect(remove).toHaveBeenCalledWith('message-1')
    expect(runMaintenance).toHaveBeenCalledOnce()
    expect(turnStarted).toBe(false)
    expect(suppressSelectionSideChatSettlement(agent, ordinaryMessage)).toBe(false)
    expect(remove).toHaveBeenCalledOnce()
  })

  it('does not interrupt a parent turn while removing a steered settlement', () => {
    const remove = vi.fn(() => true)
    const runMaintenance = vi.fn()
    const agent = {
      status: 'running', inbox: { remove }, runMaintenance,
    } as unknown as Agent
    const message = {
      id: 'message-1',
      source: { kind: 'subagent-settled', senderSessionId: 'selection-sidechat-child' },
    } as unknown as UserMessage

    expect(suppressSelectionSideChatSettlement(agent, message)).toBe(true)
    expect(remove).toHaveBeenCalledWith('message-1')
    expect(runMaintenance).not.toHaveBeenCalled()
  })
})
