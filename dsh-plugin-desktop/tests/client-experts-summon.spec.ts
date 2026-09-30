// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { summonExpert, seedConversationDraft } from '../src/client/experts-summon.ts'
import type { DesktopExpertsApi } from '../src/client/experts-api.ts'

const summonResult = {
  sessionId: 'session-abc', workspaceId: 'ws-default', agentPreset: 'data-analyst', expertName: '数据分析师',
}

function makeApi(summonImpl: (id: string, prompt?: string) => Promise<unknown> = async () => summonResult): DesktopExpertsApi {
  return {
    read: vi.fn(async () => ({ experts: [], invalid: [], categories: [] })),
    list: vi.fn(),
    detail: vi.fn(),
    summon: vi.fn(summonImpl) as DesktopExpertsApi['summon'],
  }
}

afterEach(() => {
  window.localStorage?.clear()
  vi.unstubAllGlobals()
})

describe('expert summon flow', () => {
  it('reconciles, seeds the draft, then opens the session', async () => {
    const api = makeApi()
    const calls: string[] = []
    const navigation = {
      reconcileWorkspace: vi.fn(async (workspaceId: string, sessionId: string) => {
        calls.push(`reconcile:${workspaceId}:${sessionId}`)
      }),
      refreshSessions: vi.fn(async () => { calls.push('refresh') }),
      openSession: vi.fn((sessionId: string) => { calls.push(`open:${sessionId}`) }),
    }
    await summonExpert(api, navigation, 'data-analyst', '分析销售数据')
    expect(api.summon).toHaveBeenCalledWith('data-analyst', '分析销售数据')
    expect(navigation.reconcileWorkspace).toHaveBeenCalledWith('ws-default', 'session-abc')
    expect(navigation.refreshSessions).toHaveBeenCalledOnce()
    expect(navigation.openSession).toHaveBeenCalledWith('session-abc')
    expect(calls).toEqual(['reconcile:ws-default:session-abc', 'refresh', 'open:session-abc'])
    const seeded = JSON.parse(window.localStorage.getItem('dsh.conversation.session-abc') ?? '{}')
    expect(seeded).toEqual({ draft: '分析销售数据', view: null, viewRequest: null })
  })

  it('does not reconcile or open when the host summon fails', async () => {
    const api = makeApi(async () => { throw new Error('Agent preset not registered') })
    const navigation = {
      reconcileWorkspace: vi.fn(async () => {}),
      refreshSessions: vi.fn(async () => {}),
      openSession: vi.fn((_sessionId: string) => {}),
    }
    await expect(summonExpert(api, navigation, 'ghost', '帮我分析')).rejects.toThrow(/Agent preset not registered/)
    expect(navigation.reconcileWorkspace).not.toHaveBeenCalled()
    expect(navigation.refreshSessions).not.toHaveBeenCalled()
    expect(navigation.openSession).not.toHaveBeenCalled()
    expect(window.localStorage.getItem('dsh.conversation.ghost')).toBeNull()
  })

  it('seeds a default prompt when no quick task is chosen', async () => {
    const api = makeApi()
    const navigation = {
      reconcileWorkspace: vi.fn(async () => {}),
      refreshSessions: vi.fn(async () => {}),
      openSession: vi.fn(() => {}),
    }
    await summonExpert(api, navigation, 'data-analyst', '帮我分析这份数据并输出管理层摘要')
    const seeded = JSON.parse(window.localStorage.getItem('dsh.conversation.session-abc') ?? '{}')
    expect(seeded.draft).toBe('帮我分析这份数据并输出管理层摘要')
  })

  it('seedConversationDraft tolerates missing localStorage', () => {
    vi.stubGlobal('localStorage', undefined)
    expect(() => seedConversationDraft('session-x', 'prompt')).not.toThrow()
  })
})
