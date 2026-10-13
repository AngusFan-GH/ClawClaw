import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { CreateAgentOptions } from '@deepseek-ai/dsh-agent'
import { SessionId } from '@deepseek-ai/dsh-session'
import {
  parseSelectionSideChatCreateRequest,
  parseSelectionSideChatCreateResult,
} from '../src/selection-sidechat-contract.ts'
import {
  createSelectionSideChat,
  type SelectionSideChatRuntime,
} from '../src/selection-sidechat.ts'

const PARENT = SessionId('parent-session')

function fixture(options: { attachFailure?: Error } = {}) {
  const parentCtx = {} as Context
  const parentSession = {
    header: { id: PARENT, cwd: '/workspace/project' },
    requestHeader: () => ({ config: { provider: 'provider-next', model: 'model-next', reasoningEffort: 'high' } }),
  }
  const parent = {
    id: PARENT,
    ctx: parentCtx,
    options: { provider: 'provider-old', model: 'model-old', maxTokens: 4096 },
    session: parentSession,
  }
  const append = vi.fn()
  const childSession = { append }
  const dispose = vi.fn(async () => undefined)
  const create = vi.fn(async (_options: CreateAgentOptions) => ({ agent: { session: childSession }, dispose }))
  const attachSession = options.attachFailure === undefined
    ? vi.fn(async () => undefined)
    : vi.fn(async () => { throw options.attachFailure })
  const workspace = {
    id: 'workspace-1',
    path: '/workspace/project',
    sessionIds: [PARENT],
    attachSession,
  }
  const composeFrom = vi.fn(() => 'inherited-preset')
  const composedPreset = vi.fn(() => 'inherited-preset')
  const current = vi.fn(() => 'workspace-write')
  const set = vi.fn()
  const runtime = {
    agents: { get: vi.fn(() => parent), create },
    agentPresets: { composeFrom, composedPreset },
    permissionPresets: { current, set },
    workspaceRegistry: { list: vi.fn(() => [workspace]) },
  } as unknown as SelectionSideChatRuntime
  return { runtime, parentCtx, parentSession, childSession, create, dispose, attachSession, append, composeFrom, current, set }
}

describe('selection side-chat creation', () => {
  it('validates the small host contract', () => {
    expect(parseSelectionSideChatCreateRequest({ parentSessionId: PARENT })).toEqual({ parentSessionId: PARENT })
    expect(parseSelectionSideChatCreateResult({ sessionId: 'child-session' })).toEqual({ sessionId: 'child-session' })
    expect(() => parseSelectionSideChatCreateRequest({ parentSessionId: '' })).toThrow(/parentSessionId/)
    expect(() => parseSelectionSideChatCreateResult({})).toThrow(/sessionId/)
  })

  it('creates an empty ordinary child with inherited composition and workspace', async () => {
    const value = fixture()

    const result = await createSelectionSideChat(value.runtime, PARENT)

    expect(result.sessionId).toMatch(/^selection-sidechat-/)
    expect(value.create).toHaveBeenCalledOnce()
    const creation = value.create.mock.calls[0]![0]
    expect(creation).toEqual(expect.objectContaining({
      sessionId: result.sessionId,
      meta: {
        cwd: '/workspace/project',
        parentSession: PARENT,
        agentPreset: 'inherited-preset',
      },
      agentOptions: {
        provider: 'provider-next',
        model: 'model-next',
        reasoningEffort: 'high',
        maxTokens: 4096,
      },
    }))
    expect(creation).not.toHaveProperty('seed')
    const childCtx = {} as Context
    creation.setup?.(childCtx, {} as never)
    expect(value.composeFrom).toHaveBeenCalledWith(childCtx, value.parentCtx)
    expect(value.current).toHaveBeenCalledWith(value.parentSession)
    expect(value.append).toHaveBeenCalledWith('model/selection', {
      provider: 'provider-next', model: 'model-next', reasoningEffort: 'high',
    })
    expect(value.set).toHaveBeenCalledWith(value.childSession, 'workspace-write')
    expect(value.attachSession).toHaveBeenCalledWith(result.sessionId)
    expect(value.dispose).not.toHaveBeenCalled()
  })

  it('disposes a newly created agent when workspace attachment fails', async () => {
    const failure = new Error('attach failed')
    const value = fixture({ attachFailure: failure })

    await expect(createSelectionSideChat(value.runtime, PARENT)).rejects.toBe(failure)
    expect(value.dispose).toHaveBeenCalledOnce()
  })
})
