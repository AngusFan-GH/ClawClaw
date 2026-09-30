// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { ExpertsPanel, type ExpertsPanelProps } from '../src/client/ExpertsPanel.tsx'
import type { DesktopExpertsApi } from '../src/client/experts-api.ts'
import { zh } from '../src/client/experts-locales.ts'

const expert = {
  id: 'data-analyst', version: '1.0.0', category: 'data-ai',
  display: { name: '数据分析师', title: '商业数据与可视化顾问', description: '清洗数据、识别异常并输出图表和报告。', tags: ['Excel', 'CSV', '图表'] },
  entry: { defaultPrompt: '帮我分析这份数据并输出管理层摘要', quickPrompts: ['分析销售数据', '制作经营周报'] },
  presetId: 'data-analyst', available: true,
}
const unavailableExpert = {
  id: 'writer', version: '1.0.0', category: 'writing',
  display: { name: '技术写作', title: '技术文档写作', description: '撰写报告。', tags: ['文档'] },
  entry: { defaultPrompt: '撰写发布说明', quickPrompts: [] },
  presetId: 'writer', available: false,
  unavailableReason: 'mount failed: missing plugin',
}

let root: Root | undefined

function makeApi(overrides: Partial<DesktopExpertsApi> = {}): DesktopExpertsApi {
  return {
    read: vi.fn(async () => ({ experts: [expert, unavailableExpert], invalid: [], categories: ['data-ai', 'writing'] })),
    list: vi.fn(),
    detail: vi.fn(),
    summon: vi.fn(async () => ({ sessionId: 'session-abc', workspaceId: 'ws-default', agentPreset: 'data-analyst', expertName: '数据分析师' })),
    ...overrides,
  }
}

async function mount(options: {
  api?: DesktopExpertsApi
  summon?: (id: string, prompt: string) => Promise<void>
} = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const api = options.api ?? makeApi()
  const summon = options.summon ?? vi.fn(async () => {})
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root!.render(createElement(ExpertsPanel, {
      api, summon, t: (key: keyof typeof zh) => zh[key],
    } as ExpertsPanelProps))
  })
  return { api, summon }
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text)
  if (found === undefined) throw new Error(`Missing button: ${text}`)
  return found
}

async function click(text: string) { await act(async () => { button(text).click() }) }

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('Experts panel', () => {
  it('renders the expert catalog after loading', async () => {
    await mount()
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(2)
    expect([...document.querySelectorAll('.dshExpertsCardHead h3')].map(item => item.textContent)).toEqual(['技术写作', '数据分析师'])
    const analystCard = [...document.querySelectorAll('.dshExpertsCard')].find(card => card.textContent?.includes('数据分析师'))
    expect(analystCard?.querySelector('.dshExpertsStatus')?.textContent).toBe(zh.available)
  })

  it('shows the empty state when no experts exist', async () => {
    const api = makeApi({ read: vi.fn(async () => ({ experts: [], invalid: [], categories: [] })) })
    await mount({ api })
    expect(document.querySelector('.dshExpertsNotice')?.textContent).toBe(zh.empty)
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(0)
  })

  it('shows the error state when the catalog cannot be read', async () => {
    const api = makeApi({ read: vi.fn(async () => { throw new Error('boom') }) })
    await mount({ api })
    expect(document.querySelector('[role="alert"]')?.textContent).toBe('boom')
  })

  it('filters by search keyword and category', async () => {
    await mount()
    const search = document.querySelector('.dshIntegrationsSearch input') as HTMLInputElement
    const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!
    await act(async () => {
      setter.call(search, '销售')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(1)
    expect(document.querySelector('.dshExpertsCardHead h3')?.textContent).toBe('数据分析师')

    await act(async () => {
      setter.call(search, '')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    const select = document.querySelector('.dshExpertsToolbar select') as HTMLSelectElement
    await act(async () => {
      select.value = 'writing'
      select.dispatchEvent(new Event('change', { bubbles: true }))
    })
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(1)
    expect(document.querySelector('.dshExpertsCardHead h3')?.textContent).toBe('技术写作')
  })

  async function openAnalystDetail() {
    const card = [...document.querySelectorAll('.dshExpertsCard')].find(card => card.textContent?.includes('数据分析师'))
    const detailButton = card ? [...card.querySelectorAll('button')].find(btn => btn.textContent?.includes(zh.viewDetails)) : undefined
    await act(async () => { (detailButton as HTMLButtonElement).click() })
  }

  it('opens the detail view with tasks and summons on start', async () => {
    const { summon } = await mount()
    await openAnalystDetail()
    expect(document.querySelector('.dshExpertsDetail')?.textContent).toContain('商业数据与可视化顾问')
    expect(document.querySelector('.dshExpertsDetail')?.textContent).toContain('分析销售数据')
    await click(zh.startConversation)
    expect(summon).toHaveBeenCalledWith('data-analyst', '帮我分析这份数据并输出管理层摘要')
  })

  it('summons with a quick task prompt', async () => {
    const { summon } = await mount()
    await openAnalystDetail()
    await click('分析销售数据')
    expect(summon).toHaveBeenCalledWith('data-analyst', '分析销售数据')
  })

  it('disables start conversation for unavailable experts and shows the reason', async () => {
    await mount()
    const cards = [...document.querySelectorAll('.dshExpertsCard')]
    const writerCard = cards.find(card => card.textContent?.includes('技术写作'))
    expect(writerCard?.querySelector('.dshExpertsUnavailableReason')?.textContent).toContain('mount failed')
    const startButtons = [...(writerCard?.querySelectorAll('button') ?? [])]
    const start = startButtons.find(btn => btn.textContent?.includes(zh.startConversation))
    expect(start?.disabled).toBe(true)
  })

  it('lists isolated invalid packages', async () => {
    const api = makeApi({
      read: vi.fn(async () => ({
        experts: [],
        invalid: [{ id: 'broken', directory: '/dsh/broken', reason: 'missing required file: preset.yml' }],
        categories: [],
      })),
    })
    await mount({ api })
    expect(document.querySelector('.dshExpertsInvalid')?.textContent).toContain('missing required file: preset.yml')
  })
})
