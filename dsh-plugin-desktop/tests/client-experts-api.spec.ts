import { describe, expect, it, vi } from 'vitest'
import {
  createDesktopExpertsApi, parseDesktopExpertsView, parseDesktopExpertSummonResult,
} from '../src/client/experts-api.ts'

const expert = {
  id: 'data-analyst', version: '1.0.0', category: 'data-ai',
  display: { name: '数据分析师', title: '商业数据与可视化顾问', description: '清洗数据。', tags: ['Excel', 'CSV'] },
  entry: { defaultPrompt: '帮我分析这份数据', quickPrompts: ['分析销售数据'] },
  presetId: 'data-analyst', available: true,
}

const view = {
  experts: [expert],
  invalid: [{ id: 'broken', directory: '/dsh/broken', reason: 'missing required file: preset.yml' }],
  categories: ['data-ai'],
}

describe('Desktop Experts response parsing', () => {
  it('accepts a complete view', () => {
    const parsed = parseDesktopExpertsView(view)
    expect(parsed.experts[0]?.id).toBe('data-analyst')
    expect(parsed.experts[0]?.display.tags).toEqual(['Excel', 'CSV'])
    expect(parsed.invalid[0]?.reason).toContain('missing required file')
    expect(parsed.categories).toEqual(['data-ai'])
  })

  it('rejects malformed expert rows', () => {
    const badId = { ...expert, id: 123 }
    expect(() => parseDesktopExpertsView({ ...view, experts: [badId] })).toThrow(/invalid Expert/)
    const badPreset = { ...expert, presetId: 'other' }
    expect(() => parseDesktopExpertsView({ ...view, experts: [badPreset] })).toThrow(/presetId must equal id/)
    expect(() => parseDesktopExpertsView({ ...view, experts: [expert, expert] })).toThrow(/duplicate/)
    const badInvalid = { id: 'x', directory: 1, reason: 'r' }
    expect(() => parseDesktopExpertsView({ ...view, invalid: [badInvalid] })).toThrow(/invalid invalid-Expert/)
  })

  it('parses a summon result', () => {
    const result = parseDesktopExpertSummonResult({
      sessionId: 'session-abc', workspaceId: 'ws-default', agentPreset: 'data-analyst', expertName: '数据分析师',
    })
    expect(result).toMatchObject({ sessionId: 'session-abc', agentPreset: 'data-analyst' })
    expect(() => parseDesktopExpertSummonResult({ sessionId: 'x', workspaceId: 'w' })).toThrow(/invalid summon result/)
  })
})

describe('Desktop Experts client API', () => {
  it('reads the full catalog over GET', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify(view), { status: 200 }))
    const api = createDesktopExpertsApi(fetcher)
    const result = await api.read()
    expect(result.experts[0]?.id).toBe('data-analyst')
    expect(fetcher.mock.calls[0]?.[0]).toBe('/api/desktop/experts')
    expect(fetcher.mock.calls[0]?.[1]?.method).toBe('GET')
  })

  it('sends list, detail and summon actions over POST', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string }
      if (body.action === 'detail') return new Response(JSON.stringify(expert))
      if (body.action === 'summon') {
        return new Response(JSON.stringify({
          sessionId: 'session-abc', workspaceId: 'ws-default', agentPreset: 'data-analyst', expertName: '数据分析师',
        }))
      }
      return new Response(JSON.stringify(view))
    })
    const api = createDesktopExpertsApi(fetcher)
    await api.list('销售', 'data-ai')
    expect(JSON.parse(String(fetcher.mock.calls[0]?.[1]?.body))).toEqual({ action: 'list', query: '销售', category: 'data-ai' })
    await api.detail('data-analyst')
    expect(JSON.parse(String(fetcher.mock.calls[1]?.[1]?.body))).toEqual({ action: 'detail', id: 'data-analyst' })
    const summoned = await api.summon('data-analyst', '分析销售数据')
    expect(summoned.sessionId).toBe('session-abc')
    expect(JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body))).toEqual({ action: 'summon', id: 'data-analyst', prompt: '分析销售数据' })
  })

  it('surfaces host errors', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'Agent preset not registered' }), { status: 409 }))
    const api = createDesktopExpertsApi(fetcher)
    await expect(api.summon('data-analyst')).rejects.toThrow(/Agent preset not registered/)
  })
})
