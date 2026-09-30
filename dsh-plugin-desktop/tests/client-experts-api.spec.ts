import { describe, expect, it, vi } from 'vitest'
import { createExpertsApi, filterExperts, parseExpertsView } from '../src/client/experts-api.ts'

const expert = {
  id: 'data-analyst', version: '1.0.0', category: 'data-ai',
  display: { name: '数据分析师', title: '商业数据与可视化顾问', description: '清洗数据', tags: ['Excel', 'CSV'] },
  entry: { defaultPrompt: '帮我分析这份数据', quickPrompts: ['分析销售数据', '制作经营周报'] },
  presetId: 'data-analyst', available: true,
}

describe('Experts client API', () => {
  it('parses a valid listing view', () => {
    const view = parseExpertsView({
      experts: [expert],
      invalid: [{ id: 'broken', reason: 'missing required file: agent.cordis.yml' }],
      categories: ['data-ai'],
    })
    expect(view.experts).toHaveLength(1)
    expect(view.experts[0]!.display.tags).toEqual(['Excel', 'CSV'])
    expect(view.invalid[0]!.reason).toContain('missing required file')
    expect(view.categories).toEqual(['data-ai'])
  })

  it('rejects malformed expert rows', () => {
    expect(() => parseExpertsView({ experts: [{}], invalid: [], categories: [] })).toThrow(/invalid expert/i)
    expect(() => parseExpertsView({ experts: [{ ...expert, available: 'yes' }], invalid: [], categories: [] }))
      .toThrow(/invalid expert/i)
    expect(() => parseExpertsView({ experts: [expert], invalid: [{ id: 'x' }], categories: [] }))
      .toThrow(/invalid invalid-expert/i)
  })

  it('summons through the action route and validates the result', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string; expertId?: string }
      expect(body).toMatchObject({ action: 'summon', expertId: 'data-analyst' })
      return new Response(JSON.stringify({ sessionId: 'session-1', agentPreset: 'data-analyst' }))
    })
    const api = createExpertsApi(fetcher)
    const result = await api.summon('data-analyst')
    expect(result).toEqual({ sessionId: 'session-1', agentPreset: 'data-analyst' })
    expect(fetcher.mock.calls[0]![1]?.method).toBe('POST')
  })

  it('passes the workspace id and surfaces host errors', async () => {
    const fetcher = vi.fn(async (_input: RequestInfo | URL, _init?: RequestInit) => new Response(JSON.stringify({ error: 'expert data-analyst is unavailable' }), { status: 409 }))
    const api = createExpertsApi(fetcher)
    await expect(api.summon('data-analyst', 'ws-1')).rejects.toThrow('unavailable')
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]?.body))).toMatchObject({ workspaceId: 'ws-1' })
  })
})

describe('expert filtering', () => {
  const experts = [
    { ...expert, id: 'data-analyst', display: { ...expert.display, name: '数据分析师', tags: ['Excel', 'CSV'] } },
    { ...expert, id: 'writer', category: 'content', display: { ...expert.display, name: '文案写手', title: '营销文案顾问', description: '撰写营销文案', tags: ['写作'] } },
  ] as const

  it('filters by keyword across name, title, tags, category and id', () => {
    expect(filterExperts(experts, 'Excel', '')).toHaveLength(1)
    expect(filterExperts(experts, '写作', '')).toHaveLength(1)
    expect(filterExperts(experts, 'data-ai', '')).toHaveLength(1)
    expect(filterExperts(experts, 'analyst', '')).toHaveLength(1)
    expect(filterExperts(experts, 'xyz', '')).toHaveLength(0)
  })

  it('filters by exact category', () => {
    expect(filterExperts(experts, '', 'content')).toHaveLength(1)
    expect(filterExperts(experts, '', 'data-ai')).toHaveLength(1)
    expect(filterExperts(experts, '', 'unknown')).toHaveLength(0)
  })

  it('combines keyword and category filters', () => {
    expect(filterExperts(experts, '数据', 'content')).toHaveLength(0)
    expect(filterExperts(experts, '文案', 'content')).toHaveLength(1)
  })
})
