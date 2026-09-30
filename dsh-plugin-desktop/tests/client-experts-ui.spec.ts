// @vitest-environment jsdom

import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ExpertView, ExpertsView } from '../src/experts-contract.ts'
import { createExpertCenterApi, type ExpertCenterApi } from '../src/client/experts-api.ts'
import { ExpertCenter } from '../src/client/experts-center.ts'
import { ExpertConversationPrefill, ExpertSessionBadge } from '../src/client/expert-conversation.tsx'
import { ExpertsPanel } from '../src/client/ExpertsPanel.tsx'
import { zh } from '../src/client/experts-locales.ts'

let root: Root | undefined
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.replaceChildren()
})

const expert: ExpertView = {
  id: 'data-analyst', presetId: 'data-analyst', status: 'available',
  presetName: '数据分析师', version: '1.0.0', category: 'data-ai',
  display: { name: '数据分析师', title: '商业数据与可视化顾问', description: '清洗数据、识别异常并输出图表和报告。', tags: ['Excel', 'CSV'] },
  entry: { defaultPrompt: '帮我分析这份数据并输出管理层摘要', quickPrompts: ['分析销售数据', '制作经营周报'] },
  directory: '/root/.dsh/.agent-presets/data-analyst',
}
const broken: ExpertView = {
  id: 'stale-expert', presetId: 'stale-expert', status: 'invalid', problem: 'missing-files',
  message: '/root/.dsh/.agent-presets/stale-expert/preset.yml is missing',
  directory: '/root/.dsh/.agent-presets/stale-expert',
}
const view: ExpertsView = {
  root: '/root/.dsh/.agent-presets',
  experts: [expert], categories: [{ id: 'data-ai', count: 1 }], truncated: false,
}

function translate(key: keyof typeof zh, params?: Record<string, unknown>): string {
  let text: string = zh[key]
  for (const [name, value] of Object.entries(params ?? {})) text = text.replaceAll(`{${name}}`, String(value))
  return text
}

function makeApi(overrides: Partial<ExpertCenterApi> = {}): ExpertCenterApi {
  return {
    read: vi.fn(async () => view),
    list: vi.fn(async (query: { readonly q?: string, readonly category?: string }) => ({
      ...view,
      experts: view.experts.filter(item =>
        (query.q === undefined || (item.display?.name ?? '').includes(query.q))
        && (query.category === undefined || item.category === query.category)),
    })),
    detail: vi.fn(async () => expert),
    summon: vi.fn(async (input: { readonly id: string, readonly prompt?: string }) => {
      const prompt = input.prompt ?? expert.entry?.defaultPrompt
      return {
        sessionId: 'session-7', expertId: input.id, presetId: input.id,
        ...(prompt === undefined ? {} : { prompt }),
      }
    }),
    ...overrides,
  }
}

interface Mounted {
  readonly center: ExpertCenter
  readonly openSession: ReturnType<typeof vi.fn>
}

async function mountPanel(api: ExpertCenterApi, options: {
  awaitSession?: (sessionId: string) => Promise<boolean>
  openSession?: (sessionId: string) => void
} = {}): Promise<Mounted> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const openSession = vi.fn(options.openSession ?? (() => {}))
  const center = new ExpertCenter({
    api,
    openSession,
    resolveWorkspaceId: () => 'ws-1',
    awaitSession: options.awaitSession ?? (async () => true),
  })
  const container = document.createElement('div')
  document.body.append(container)
  root = createRoot(container)
  await act(async () => {
    root?.render(createElement(ExpertsPanel, {
      center, t: (key: keyof typeof zh, params?: Record<string, unknown>) => translate(key, params),
    } as never))
  })
  return { center, openSession }
}

function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')]
    .find(item => item.textContent === text || item.getAttribute('aria-label') === text)
  if (found === undefined) throw new Error(`Missing button: ${text}`)
  return found
}
async function click(text: string): Promise<void> {
  await act(async () => { button(text).click() })
}
async function type(input: HTMLInputElement, value: string): Promise<void> {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}

describe('expert center panel', () => {
  it('lists experts with their status, metadata, and quick tasks', async () => {
    await mountPanel(makeApi())
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(1)
    const card = document.querySelector('.dshExpertsCard')!
    expect(card.querySelector('.dshExpertsCardTitle strong')?.textContent).toBe('数据分析师')
    expect(card.querySelector('.dshExpertsCardTitle span')?.textContent).toBe('商业数据与可视化顾问')
    expect(card.querySelector('.dshExpertsStatus')?.textContent).toBe(zh.statusAvailable)
    expect([...card.querySelectorAll('.dshExpertsTags li')].map(tag => tag.textContent)).toEqual(['Excel', 'CSV'])
    expect(button(zh.start).disabled).toBe(false)
    expect(document.querySelector(`[data-active="true"]`)?.textContent).toBe(`${zh.allCategories} · 1`)
  })

  it('searches through the Host and filters by category', async () => {
    const api = makeApi()
    await mountPanel(api)
    expect(api.list).not.toHaveBeenCalled()
    await type(document.querySelector<HTMLInputElement>('input[type="search"]')!, '数据')
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ q: '数据' }))
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(1)
    await type(document.querySelector<HTMLInputElement>('input[type="search"]')!, '不存在')
    expect(document.querySelector('.dshExpertsEmpty')).not.toBeNull()
    await click(zh.clearFilters)
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(1)
    await click(`data-ai · 1`)
    expect(api.list).toHaveBeenCalledWith(expect.objectContaining({ category: 'data-ai' }))
  })

  it('shows loading, empty, and error states with a retry', async () => {
    let rejectRead: ((cause: unknown) => void) | undefined
    const api = makeApi({
      read: vi.fn(async () => await new Promise<ExpertsView>((_resolve, reject) => { rejectRead = reject })),
    })
    await mountPanel(api)
    expect(document.querySelector('.dshIntegrationsEmpty')?.textContent).toBe(zh.loading)
    await act(async () => { rejectRead?.(new Error('host offline')) })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(zh.loadFailed)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('host offline')
    const retry = makeApi()
    vi.mocked(api.read).mockImplementation(retry.read)
    await click(zh.retry)
    expect(document.querySelectorAll('.dshExpertsCard')).toHaveLength(1)
  })

  it('shows the empty state with the package directory it expects', async () => {
    await mountPanel(makeApi({ read: vi.fn(async () => ({ ...view, experts: [], categories: [] })) }))
    expect(document.querySelector('.dshExpertsEmpty')?.textContent).toContain(zh.empty)
    expect(document.querySelector('.dshExpertsEmpty')?.textContent).toContain(view.root)
  })

  it('reports an invalid package instead of hiding it, and refuses to summon it', async () => {
    const api = makeApi({ read: vi.fn(async () => ({ ...view, experts: [broken], categories: [] })) })
    const { openSession } = await mountPanel(api)
    const card = document.querySelector('.dshExpertsCard')!
    expect(card.getAttribute('data-status')).toBe('invalid')
    expect(card.querySelector('.dshExpertsReason')?.textContent).toContain('preset.yml is missing')
    expect(button(zh.start).disabled).toBe(true)
    await click(zh.start)
    expect(api.summon).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
  })

  it('opens the detail view and starts a conversation from a quick task', async () => {
    const api = makeApi()
    const { openSession } = await mountPanel(api)
    await act(async () => { document.querySelector<HTMLButtonElement>('.dshExpertsCardTitle')!.click() })
    expect(api.detail).toHaveBeenCalledWith('data-analyst')
    expect(document.querySelector('.dshExpertsPrompt')?.textContent).toBe('帮我分析这份数据并输出管理层摘要')
    expect([...document.querySelectorAll('.dshExpertsQuickTask')].map(item => item.textContent))
      .toEqual(['分析销售数据', '制作经营周报'])
    await click('制作经营周报')
    expect(api.summon).toHaveBeenCalledWith({ id: 'data-analyst', prompt: '制作经营周报', workspaceId: 'ws-1' })
    expect(openSession).toHaveBeenCalledWith('session-7')
    expect(document.querySelector('.dshExpertsPrompt')).not.toBeNull()
  })

  it('keeps the page and reports the reason when the Host refuses a summon', async () => {
    const api = makeApi({ summon: vi.fn(async () => { throw new Error('preset "data-analyst" is not registered') }) })
    const { openSession } = await mountPanel(api)
    await click(zh.start)
    const notice = document.querySelector('.dshExpertsNotice')!
    expect(notice.getAttribute('data-kind')).toBe('error')
    expect(notice.textContent).toContain(zh.summonFailed)
    expect(notice.textContent).toContain('is not registered')
    expect(openSession).not.toHaveBeenCalled()
  })

  it('reports a Session the UI has not synced yet without pretending it opened', async () => {
    const { openSession } = await mountPanel(makeApi(), { awaitSession: async () => false })
    await click(zh.start)
    expect(openSession).not.toHaveBeenCalled()
    expect(document.querySelector('.dshExpertsNotice')?.textContent).toContain(zh.sessionPending)
  })
})

const drafts: string[] = []

describe('expert conversation surfaces', () => {
  async function mountConversation(center: ExpertCenter, preset: string | null, sessionId = 'session-7') {
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root?.render(createElement('div', null,
        createElement(ExpertSessionBadge, {
          center, t: translate, useProjection: () => preset,
        } as never),
        createElement(ExpertConversationPrefill, {
          center,
          useSession: (select: (state: { sessionId: string }) => unknown) => select({ sessionId }),
          inputActions: { setDraft: (draft: string) => { drafts.push(draft) } },
        } as never)))
    })
  }
  afterEach(() => { drafts.length = 0 })

  it('names the expert a Session runs and stays silent for other presets', async () => {
    const api = makeApi()
    const center = new ExpertCenter({
      api, openSession: () => {}, resolveWorkspaceId: () => undefined, awaitSession: async () => true,
    })
    await center.start()
    await mountConversation(center, 'data-analyst')
    expect(document.querySelector('.dshExpertsBadge')?.textContent).toContain('数据分析师')
    expect(document.querySelector('.dshExpertsBadge')?.getAttribute('title')).toBe('当前会话使用专家：数据分析师')
    expect(document.querySelector('.dshExpertsBadge')?.getAttribute('data-expert')).toBe('data-analyst')
    await act(async () => { root?.unmount() })
    document.body.replaceChildren()
    await mountConversation(center, 'standard')
    expect(document.querySelector('.dshExpertsBadge')).toBeNull()
  })

  it('prefills the summoned Session once and only for that Session', async () => {
    const api = makeApi()
    const center = new ExpertCenter({
      api, openSession: () => {}, resolveWorkspaceId: () => undefined, awaitSession: async () => true,
    })
    await center.start()
    await center.summon('data-analyst', '分析销售数据')
    expect(center.takePrefill('session-7')).toBe('分析销售数据')
    // The consumer seeds whatever the summon staged, then the stage is consumed.
    await center.summon('data-analyst')
    await mountConversation(center, 'data-analyst')
    expect(drafts).toEqual(['帮我分析这份数据并输出管理层摘要'])
    expect(center.takePrefill('session-7')).toBeUndefined()
  })
})

describe('expert center transport', () => {
  it('reads, searches, and summons over the same-origin routes', async () => {
    const calls: { url: string, init?: RequestInit }[] = []
    const fetcher = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      calls.push({ url: String(input), ...(init === undefined ? {} : { init }) })
      const body = JSON.parse(String(init?.body ?? '{}')) as { action?: string }
      const payload = body.action === 'detail' ? expert
        : body.action === 'summon'
          ? { sessionId: 'session-7', expertId: expert.id, presetId: expert.presetId, prompt: '分析销售数据' }
          : view
      return new Response(JSON.stringify(payload), { status: 200, headers: { 'content-type': 'application/json' } })
    })
    const api = createExpertCenterApi(fetcher as unknown as typeof fetch)
    expect((await api.read())?.experts[0]?.id).toBe('data-analyst')
    expect(calls[0]?.url).toBe('/api/desktop/experts')
    expect((await api.list({ q: '数据', category: 'data-ai' })).experts).toHaveLength(1)
    expect(calls[1]).toMatchObject({
      url: '/api/desktop/experts/action',
      init: { body: JSON.stringify({ action: 'list', q: '数据', category: 'data-ai' }) },
    })
    expect((await api.detail('data-analyst')).display?.tags).toEqual(['Excel', 'CSV'])
    expect(await api.summon({ id: 'data-analyst', prompt: '分析销售数据', workspaceId: 'ws-1' })).toMatchObject({ sessionId: 'session-7' })
  })

  it('rejects an unusable Host payload instead of rendering it', async () => {
    const row = vi.fn(async () => new Response(JSON.stringify({ experts: [{ id: '' }], categories: [], root: '/root/.dsh/.agent-presets' }), { status: 200 }))
    await expect(createExpertCenterApi(row as unknown as typeof fetch).read())
      .rejects.toThrowError(/invalid expert response/)
    const envelope = vi.fn(async () => new Response(JSON.stringify({ experts: 'nope' }), { status: 200 }))
    await expect(createExpertCenterApi(envelope as unknown as typeof fetch).read())
      .rejects.toThrowError(/invalid experts response/)
  })

  it('surfaces the Host refusal message', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ error: 'preset is not registered' }), { status: 409 }))
    const api = createExpertCenterApi(fetcher as unknown as typeof fetch)
    await expect(api.summon({ id: 'data-analyst' })).rejects.toThrowError('preset is not registered')
  })
})
