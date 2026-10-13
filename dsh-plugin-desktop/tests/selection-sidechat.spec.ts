import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { UserMessage } from '@deepseek-ai/dsh-llm'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  isSelectionSideChatSessionId,
  parseSelectionSideChatStartRequest,
  parseSelectionSideChatStartResult,
  selectionSideChatLabel,
} from '../src/selection-sidechat-contract.ts'
import {
  startSelectionSideChat,
  suppressSelectionSideChatSettlement,
  type SelectionSideChatRuntime,
} from '../src/selection-sidechat.ts'

const PARENT = SessionId('parent-session')
const REQUEST = {
  parentSessionId: PARENT,
  question: 'What does this mean?',
  quote: {
    text: 'selected text',
    context: 'Surrounding source message',
    source: { messageKey: 'assistant:1', startOffset: 2, endOffset: 15 },
  },
}

function fixture(options: { parent?: Agent } = {}) {
  const getTool = vi.fn((name: string) => name === 'send_message' ? {} : undefined)
  const parent = options.parent ?? ({
    id: PARENT,
    ctx: { get: (name: string) => name === 'tools' ? { get: getTool } : undefined } as unknown as Context,
  } as Agent)
  const startContinuable = vi.fn(async (spec: { childId: SessionId }) => ({
    childId: spec.childId,
    messageId: 'message-1',
  }))
  const runtime = {
    agents: { get: vi.fn(() => parent) },
    subagents: { startContinuable },
  } as unknown as SelectionSideChatRuntime
  return { getTool, parent, runtime, startContinuable }
}

describe('selection side-chat contract', () => {
  it('validates a bounded structured first question', () => {
    expect(parseSelectionSideChatStartRequest(REQUEST)).toEqual(REQUEST)
    expect(parseSelectionSideChatStartResult({ childSessionId: 'child' })).toEqual({ childSessionId: 'child' })
    expect(() => parseSelectionSideChatStartRequest({ ...REQUEST, question: ' ' })).toThrow(/question/)
    expect(() => parseSelectionSideChatStartRequest({ ...REQUEST, quote: { text: '' } })).toThrow(/quote text/)
    expect(() => parseSelectionSideChatStartRequest({
      ...REQUEST, quote: { text: 'x', source: { messageKey: 'm', startOffset: 4, endOffset: 2 } },
    })).toThrow(/source/)
    expect(() => parseSelectionSideChatStartResult({})).toThrow(/response/)
  })

  it('normalizes labels and identifies only owned children', () => {
    expect(selectionSideChatLabel('  first\n  second  ')).toBe('first second')
    expect(selectionSideChatLabel('文'.repeat(140))).toBe(`${'文'.repeat(117)}...`)
    expect(isSelectionSideChatSessionId('selection-sidechat-child')).toBe(true)
    expect(isSelectionSideChatSessionId('ordinary-child')).toBe(false)
  })
})

describe('selection continuable subagent', () => {
  it('starts a fresh addressed child with the quote and question as its first prompt', async () => {
    const value = fixture()

    const result = await startSelectionSideChat(value.runtime, REQUEST)

    expect(result).toEqual({
      childSessionId: expect.stringMatching(/^selection-sidechat-/),
    })
    expect(value.startContinuable).toHaveBeenCalledOnce()
    const spec = value.startContinuable.mock.calls[0]![0] as unknown as {
      provider: string
      childId: SessionId
      label: string
      request: { parent: Agent; prompt: Array<{ type: string; text: string }>; toolFilter?: unknown }
      signal: AbortSignal
    }
    expect(spec.provider).toBe('spawn')
    expect(spec.childId).toBe(result.childSessionId)
    expect(spec.label).toBe('selected text')
    expect(spec.request.parent).toBe(value.parent)
    expect(spec.request.toolFilter).toEqual({ deny: ['send_message'] })
    expect(spec.request.prompt).toEqual([{ type: 'text', text: expect.stringContaining('What does this mean?') }])
    expect(spec.request.prompt[0]?.text).toContain('<clawclaw-selection-quote>')
    expect(spec.request.prompt[0]?.text).toContain('Surrounding source message')
    expect(spec.signal).toBeInstanceOf(AbortSignal)
  })

  it('fails before creating anything when the visible parent is no longer active', async () => {
    const value = fixture()
    vi.mocked(value.runtime.agents.get).mockReturnValue(undefined)
    await expect(startSelectionSideChat(value.runtime, REQUEST)).rejects.toThrow(/not active/)
    expect(value.startContinuable).not.toHaveBeenCalled()
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
