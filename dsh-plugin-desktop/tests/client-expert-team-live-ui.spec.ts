// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptCatalog } from '../src/experts/client/catalog.ts'
import { ExpertCardsSettings } from '../src/experts/client/index.ts'
import { acceptTeamSnapshot } from '../src/experts/client/team-cache.ts'
import { TeamLocaleContext } from '../src/experts/client/team-locale.ts'
import { TeamsPanel, type TeamRemote } from '../src/experts/client/team-ui.tsx'
import { customZh } from '../src/experts/client/custom-locales.ts'

const expert = {
  slug: 'reviewer', name: '评审专家', nameEn: 'Reviewer',
  description: '负责评审', descriptionEn: 'Reviews work', emoji: 'R',
  division: 'testing', divisionZh: '测试', custom: false,
  skills: [], mcpServers: [],
}
const capabilitySnapshot = Object.freeze({
  catalog: Object.freeze({ skills: Object.freeze([]), mcpServers: Object.freeze([]) }),
  loading: false,
  revision: 1,
})
const pluginCapabilitySnapshot = Object.freeze({
  ...capabilitySnapshot,
  skillsLoaded: true,
  mcpLoaded: true,
})

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('expert team live UI state', () => {
  it('offers manual and conversation paths before creating an expert', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const remote = {
      getEnabled: vi.fn(async () => ({ ok: true, value: { enabled: [], revision: 1 } })),
    } as unknown as TeamRemote
    const onCreateWithConversation = vi.fn(async () => {})
    acceptCatalog(remote, { experts: [expert], enabled: [], revision: 1 })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => root!.render(React.createElement(ExpertCardsSettings, {
      remote, getActive: () => 'zh', t: ((key: string) => (customZh as Record<string, string>)[key] ?? key) as never,
      capabilityRegistry: { subscribe: () => () => {}, getSnapshot: () => capabilitySnapshot } as never,
      sharedHeader: true, onCreateWithConversation,
    } as unknown as React.ComponentProps<typeof ExpertCardsSettings>)))

    const create = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '新建专家')
    await act(async () => create?.click())
    expect(document.body.textContent).toContain('手动创建')
    expect(document.body.textContent).toContain('通过对话创建')

    const conversation = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('通过对话创建'))
    await act(async () => { conversation?.click(); await Promise.resolve() })
    expect(onCreateWithConversation).toHaveBeenCalledOnce()
  })

  it('opens a team example in the current conversation without summoning from settings', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const team = {
      id: 'team-review', builtin: true, name: '评审专家团', description: '联合评审', tags: ['评审'],
      goal: '评审交付物', constraints: '', deliveryRequirements: '输出评审结论',
      members: [
        { expertSlug: 'reviewer', duty: '主审', instructions: '检查问题' },
        { expertSlug: 'writer', duty: '记录', instructions: '整理结论' },
      ],
      examples: ['评审当前方案'], coordinatorMode: 'template' as const,
      coordinatorTemplateId: 'general' as const, coordinatorTemplateVersion: 1 as const, coordinatorPrompt: '',
      runtime: { mode: 'coordinator' as const, initPrompt: '' }, skills: [], connectors: [], connectorStates: [],
    }
    const writer = { ...expert, slug: 'writer', name: '记录专家', nameEn: 'Writer' }
    const snapshot = { teams: [team], enabledExperts: ['reviewer', 'writer'], revision: 1 }
    const remote = {
      getTeams: vi.fn(async () => ({ ok: true, value: snapshot })),
      getCatalog: vi.fn(async () => ({ ok: true, value: { experts: [expert, writer], enabled: snapshot.enabledExperts, revision: 1 } })),
      recallTeam: vi.fn(async () => ({ ok: true, value: snapshot })),
    } as unknown as TeamRemote
    const onSelectTeam = vi.fn(async () => true)
    acceptCatalog(remote, { experts: [expert, writer], enabled: snapshot.enabledExperts, revision: 1 })
    acceptTeamSnapshot(remote, snapshot)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root!.render(React.createElement(TeamLocaleContext.Provider, { value: 'zh' },
        React.createElement(TeamsPanel, { remote, sharedHeader: true, onSelectTeam })))
      await Promise.resolve()
    })

    expect(host.textContent).not.toContain('召唤专家团')
    expect(host.querySelector('[data-testid="team-card"]')?.textContent).toContain('查看详情')
    expect(host.querySelector('[data-testid="team-card"]')?.textContent).toContain('复制')
    const summon = host.querySelector<HTMLButtonElement>('.aag-team-summon')
    expect(summon?.textContent).toBe('召唤')
    expect(summon?.classList.contains('is-active')).toBe(true)
    expect(summon?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-testid="team-card"]')?.textContent).not.toContain('已召唤')
    expect(host.querySelector('[data-testid="team-card"]')?.textContent).not.toContain('已召回')
    const details = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('查看详情'))
    await act(async () => details?.click())
    expect(document.body.textContent).toContain('评审当前方案')
    expect(document.querySelector('.agt-detail')?.textContent).not.toContain('复制并自定义')
    expect(document.body.textContent).not.toContain('召唤专家团')
    expect(document.body.textContent).toContain('选择后填入聊天草稿')
    const example = [...document.body.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('评审当前方案'))
    await act(async () => { example?.click(); await Promise.resolve() })
    expect(onSelectTeam).toHaveBeenCalledWith(expect.objectContaining({ id: 'team-review' }), '评审当前方案')
  })

  it('updates a mounted expert card directly from a team snapshot receipt', async () => {
    const remote = {
      getEnabled: vi.fn(async () => ({ ok: true, value: { enabled: [], revision: 1 } })),
    } as unknown as TeamRemote
    acceptCatalog(remote, { experts: [expert], enabled: [], revision: 1 })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(React.createElement(ExpertCardsSettings, {
      remote,
      getActive: () => 'zh',
      t: ((key: string) => ({
        'settings.enabled': '已启用',
        'settings.disabled': '已停用',
        'settings.filter.source': '来源',
        'settings.filter.allSources': '全部来源',
        'settings.filter.category': '分类',
        'settings.filter.allCategories': '全部分类',
        'settings.filter.status': '状态',
        'settings.filter.allStatuses': '全部状态',
        'settings.search': '搜索专家',
        'settings.search.placeholder': '搜索',
        'settings.search.clear': '清除',
        'custom.new': '新建专家',
        'custom.base': '内置',
        'custom.source': '自定义',
        'custom.copy': '复制',
        'settings.viewPromptTitle': '查看提示词',
        'settings.viewPrompt': '查看',
        'settings.copyPromptTitle': '复制提示词',
        'settings.copyPrompt': '复制',
      } as Record<string, string>)[key] ?? key) as never,
      capabilityRegistry: {
        subscribe: () => () => {},
        getSnapshot: () => capabilitySnapshot,
      } as never,
      sharedHeader: true,
    } as unknown as React.ComponentProps<typeof ExpertCardsSettings>)))

    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('false')
    expect(host.textContent).toContain('已停用')

    await act(async () => {
      acceptTeamSnapshot(remote, {
        teams: [], enabledExperts: ['reviewer'], revision: 2,
      })
    })

    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('已启用')
  })

  it('shows package provenance and blocks enable while a required connector is missing', async () => {
    const remote = {
      getEnabled: vi.fn(async () => ({ ok: true, value: { enabled: [], revision: 1 } })),
    } as unknown as TeamRemote
    acceptCatalog(remote, { experts: [{
      ...expert,
      slug: 'plugin-reviewer',
      packageFormat: 'clawclaw-plugin',
      packageVersion: '1.4.0',
      packageType: 'agent',
      mcpServers: [{ name: 'private-docs', required: true, enabled: true }],
    }], enabled: [], revision: 1 })
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => root!.render(React.createElement(ExpertCardsSettings, {
      remote,
      getActive: () => 'en',
      t: ((key: string) => ({
        'settings.enabled': 'Enabled',
        'settings.disabled': 'Disabled',
        'settings.filter.source': 'Source',
        'settings.filter.allSources': 'All sources',
        'settings.source.builtin': 'Built-in',
        'settings.source.custom': 'Custom',
        'settings.filter.category': 'Category',
        'settings.filter.allCategories': 'All categories',
        'settings.filter.status': 'Status',
        'settings.filter.allStatuses': 'All statuses',
        'settings.search': 'Search',
        'settings.search.placeholder': 'Search',
        'settings.search.clear': 'Clear',
        'custom.new': 'New expert',
        'custom.copy': 'Copy',
        'settings.details': 'Details',
        'settings.copyPromptTitle': 'Copy prompt',
        'settings.copyPrompt': 'Copy',
        'capability.health.blocked': 'Required capability missing',
        'capability.missingHint': 'Configure required capabilities first.',
      } as Record<string, string>)[key] ?? key) as never,
      capabilityRegistry: {
        subscribe: () => () => {},
        getSnapshot: () => pluginCapabilitySnapshot,
      } as never,
      sharedHeader: true,
    } as unknown as React.ComponentProps<typeof ExpertCardsSettings>)))

    const source = host.querySelector('[data-source="base"]')
    const toggle = host.querySelector<HTMLButtonElement>('[role="switch"]')
    expect(source?.textContent).toBe('Built-in')
    expect(host.textContent).toContain('Required capability missing · 0/1')
    expect(toggle?.disabled).toBe(true)
    expect(toggle?.getAttribute('title')).toBe('Configure required capabilities first.')

    const details = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === 'Details')
    await act(async () => details?.click())
    expect(document.querySelector('.aag-expert-details')).not.toBeNull()
    expect(host.querySelector('[data-source="base"]')).not.toBeNull()
  })
})
