// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptCatalog } from '../src/experts/client/catalog.ts'
import { ExpertCardsSettings } from '../src/experts/client/index.ts'
import { acceptTeamSnapshot } from '../src/experts/client/team-cache.ts'
import { TeamLocaleContext } from '../src/experts/client/team-locale.ts'
import { isDeletableTeam, TeamsPanel, type TeamRemote } from '../src/experts/client/team-ui.tsx'
import { TeamEditor } from '../src/experts/client/team-editor.tsx'
import { customZh } from '../src/experts/client/custom-locales.ts'
import { BUILTIN_TEAMS } from '../src/experts/team-contract.ts'

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
  it('blocks a team with missing member Skills and updates when the shared registry becomes ready', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const members = [expert, { ...expert, slug: 'writer', name: '写作专家' }].map(item => ({ ...item, skills: [{ name: 'review', required: true, enabled: true }] }))
    const team = { ...structuredClone(BUILTIN_TEAMS[0]!), members: members.map(item => ({ expertSlug: item.slug, duty: 'Review', instructions: 'Inspect evidence.' })) }
    const snapshot = { teams: [team], enabledExperts: [], revision: 1 }
    const remote = { getTeams: vi.fn(async () => ({ ok: true, value: snapshot })), getCatalog: vi.fn(async () => ({ ok: true, value: { experts: members, enabled: [], revision: 1 } })), getEnabled: vi.fn(async () => ({ ok: true, value: { enabled: [], revision: 1 } })) } as unknown as TeamRemote
    acceptCatalog(remote, { experts: members, enabled: [], revision: 1 })
    acceptTeamSnapshot(remote, snapshot)
    const listeners = new Set<() => void>()
    let capabilities = { ...pluginCapabilitySnapshot, catalog: { skills: [] as Array<{ value: string; label: string; available: boolean; state: 'ready' }>, mcpServers: [] } }
    const registry = { subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }, getSnapshot: () => capabilities }
    const host = document.createElement('div'); document.body.append(host); root = createRoot(host)
    await act(async () => root!.render(React.createElement(TeamLocaleContext.Provider, { value: 'zh' }, React.createElement(TeamsPanel, { remote, sharedHeader: true, capabilityRegistry: registry as never }))))
    expect(host.querySelector<HTMLButtonElement>('.aag-team-summon')?.disabled).toBe(true)
    await act(async () => { capabilities = { ...capabilities, catalog: { skills: [{ value: 'review', label: 'review', available: true, state: 'ready' }], mcpServers: [] } }; listeners.forEach(listener => listener()) })
    expect(host.querySelector<HTMLButtonElement>('.aag-team-summon')?.disabled).toBe(false)
  })
  it('allows deleting conversation-created teams without making bundled teams writable', () => {
    expect(isDeletableTeam({ builtin: true })).toBe(false)
    expect(isDeletableTeam({ builtin: false })).toBe(true)
    expect(isDeletableTeam({ builtin: true, conversationCreated: true })).toBe(true)
  })

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
    expect(create?.querySelector('.lucide-plus')).not.toBeNull()
    expect(host.querySelector('.aag-expert-primary-action .lucide-copy-plus')).not.toBeNull()
    await act(async () => create?.click())
    expect(document.body.textContent).toContain('手动创建')
    expect(document.body.textContent).toContain('通过对话创建')

    const conversation = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('通过对话创建'))
    await act(async () => { conversation?.click(); await Promise.resolve() })
    expect(onCreateWithConversation).toHaveBeenCalledExactlyOnceWith('agent')
  })

  it('offers manual and conversation paths before creating a team', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const snapshot = { teams: [], enabledExperts: ['reviewer'], revision: 1 }
    const remote = {
      getTeams: vi.fn(async () => ({ ok: true, value: snapshot })),
      getCatalog: vi.fn(async () => ({ ok: true, value: { experts: [expert], enabled: snapshot.enabledExperts, revision: 1 } })),
    } as unknown as TeamRemote
    const onCreateWithConversation = vi.fn(async () => {})
    acceptCatalog(remote, { experts: [expert], enabled: snapshot.enabledExperts, revision: 1 })
    acceptTeamSnapshot(remote, snapshot)
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => {
      root!.render(React.createElement(TeamLocaleContext.Provider, { value: 'zh' },
        React.createElement(TeamsPanel, { remote, sharedHeader: true, onCreateWithConversation })))
      await Promise.resolve()
    })

    const create = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '新建专家团')
    expect(create?.querySelector('.lucide-plus')).not.toBeNull()
    await act(async () => create?.click())
    expect(document.body.textContent).toContain('手动创建')
    expect(document.body.textContent).toContain('通过对话创建')
    expect(document.body.textContent).toContain('创建本地专家团配置，直接填写团队目标、成员和分工。')
    expect(document.body.textContent).toContain('生成完整专家团包')

    const conversation = [...document.body.querySelectorAll<HTMLButtonElement>('button')]
      .find(button => button.textContent?.includes('通过对话创建'))
    await act(async () => { conversation?.click(); await Promise.resolve() })
    expect(onCreateWithConversation).toHaveBeenCalledExactlyOnceWith('team')
  })

  it('keeps team creation compact with one submit action and progressive coordinator rules', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)

    await act(async () => root!.render(React.createElement(TeamLocaleContext.Provider, { value: 'zh' },
      React.createElement(TeamEditor, {
        experts: [expert], enabledExperts: ['reviewer'], save: vi.fn(async () => {}), close: vi.fn(),
        refresh: vi.fn(async () => ({ teams: [], enabledExperts: ['reviewer'], revision: 1 })),
      }))))

    expect(document.querySelector('[aria-label="主理人提示词正文"]')).toBeNull()
    const footerButtons = [...document.querySelectorAll<HTMLButtonElement>('.aag-custom-footer button')]
    expect(footerButtons).toHaveLength(2)
    expect(footerButtons.at(-1)?.textContent).toBe('保存专家团')
    expect(footerButtons.some(button => button.textContent === '保存')).toBe(false)
    const viewRules = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('查看主理人规则'))
    expect(viewRules?.querySelector('.lucide-chevron-down')).not.toBeNull()
    await act(async () => viewRules?.click())
    expect(document.querySelector('[aria-label="主理人提示词正文"]')).not.toBeNull()

    const custom = [...document.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '自定义')
    await act(async () => custom?.click())
    expect(document.querySelector<HTMLTextAreaElement>('[aria-label="主理人提示词正文"]')?.readOnly).toBe(false)
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
    expect(host.querySelector('.aag-card-guidance')?.textContent).toContain('输出评审结论')
    const details = host.querySelector<HTMLButtonElement>('.aag-card-open[aria-label^="查看详情:"]')
    expect(details).not.toBeNull()
    expect(host.querySelector('.aag-card-more-trigger')).toBeNull()
    expect(host.querySelector<HTMLButtonElement>('.aag-team-copy')?.textContent).toBe('复制')
    expect(host.querySelector('.aag-team-copy .lucide-copy-plus')).not.toBeNull()
    const summon = host.querySelector<HTMLButtonElement>('.aag-team-summon')
    expect(summon?.textContent).toBe('召唤')
    expect(summon?.classList.contains('is-active')).toBe(true)
    expect(summon?.getAttribute('aria-pressed')).toBe('true')
    expect(host.querySelector('[data-testid="team-card"]')?.textContent).not.toContain('已召唤')
    expect(host.querySelector('[data-testid="team-card"]')?.textContent).not.toContain('已召回')
    await act(async () => details?.click())
    expect(document.querySelector('.aag-team-details-drawer')).not.toBeNull()
    expect(document.querySelector('.agt-detail-overview')?.textContent).toContain('评审交付物')
    expect(document.querySelectorAll('.agt-detail-roster article')).toHaveLength(2)
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
    const getPrompt = vi.fn(async () => ({ ok: true, value: { prompt: 'Review every required capability before responding.' } }))
    const remote = {
      getEnabled: vi.fn(async () => ({ ok: true, value: { enabled: [], revision: 1 } })),
      getPrompt,
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
        'custom.viewPrompt': 'View prompt',
        'custom.hidePrompt': 'Hide prompt',
        'custom.loadingPrompt': 'Loading prompt...',
        'settings.details': 'Details',
        'settings.viewPromptTitle': 'View prompt',
        'settings.hidePrompt': 'Hide prompt',
        'settings.promptLoading': 'Loading prompt...',
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
    expect(host.querySelector('.aag-card-more-trigger')).toBeNull()
    expect(host.querySelector('.aag-expert-primary-action')).not.toBeNull()
    expect(host.querySelector('[aria-label="Copy prompt"]')).toBeNull()
    expect(host.textContent).not.toContain('Capabilities ready')
    expect(host.textContent).not.toContain('Can run with reduced capabilities')

    const copy = host.querySelector<HTMLButtonElement>('.aag-expert-primary-action')
    expect(copy?.textContent).toBe('Copy')
    await act(async () => { copy?.click(); await Promise.resolve() })
    expect(getPrompt).not.toHaveBeenCalled()
    expect(document.querySelector('.aag-editor-drawer .ant-drawer-title')?.textContent).toBe('New expert')
    expect(document.querySelector<HTMLInputElement>('.aag-editor-drawer input[required]')?.value).toBe('Reviewer copy')
    expect(document.querySelector('.aag-editor-drawer .aag-custom-prompt')).toBeNull()
    const viewCopiedPrompt = [...document.querySelectorAll<HTMLButtonElement>('.aag-editor-drawer button')]
      .find(button => button.textContent?.includes('View prompt'))
    await act(async () => { viewCopiedPrompt?.click(); await Promise.resolve() })
    expect(getPrompt).toHaveBeenCalledWith('plugin-reviewer', 'testing')
    expect(document.querySelector<HTMLTextAreaElement>('.aag-editor-drawer .aag-custom-prompt')?.value).toBe('Review every required capability before responding.')
    await act(async () => document.querySelector<HTMLButtonElement>('.aag-editor-drawer .ant-drawer-close')?.click())

    getPrompt.mockClear()
    const details = host.querySelector<HTMLButtonElement>('.aag-card-open[aria-label^="Details:"]')
    await act(async () => { details?.click(); await Promise.resolve() })
    expect(document.querySelector('.aag-expert-details')).not.toBeNull()
    expect(getPrompt).not.toHaveBeenCalled()
    expect(document.querySelector('.aag-detail-prompt')).toBeNull()
    const viewDetailsPrompt = [...document.querySelectorAll<HTMLButtonElement>('.aag-expert-details-drawer button')]
      .find(button => button.textContent?.includes('View prompt'))
    await act(async () => { viewDetailsPrompt?.click(); await Promise.resolve() })
    expect(getPrompt).toHaveBeenCalledWith('plugin-reviewer', 'testing')
    expect(document.querySelector<HTMLTextAreaElement>('.aag-detail-prompt')?.value).toBe('Review every required capability before responding.')
    expect(document.querySelector('.aag-expert-details-drawer .ant-modal')).toBeNull()
    expect(host.querySelector('[data-source="base"]')).not.toBeNull()
  })
})
