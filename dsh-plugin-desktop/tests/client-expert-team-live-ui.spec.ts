// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { acceptCatalog } from '../src/experts/client/catalog.ts'
import { ExpertCardsSettings } from '../src/experts/client/index.ts'
import { acceptTeamSnapshot } from '../src/experts/client/team-cache.ts'
import type { TeamRemote } from '../src/experts/client/team-ui.tsx'

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

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
})

describe('expert team live UI state', () => {
  it('updates a mounted expert card directly from a team enable receipt', async () => {
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
        teams: [], enabledTeams: ['review-team'], enabledExperts: ['reviewer'], revision: 2,
      })
    })

    expect(host.querySelector('[role="switch"]')?.getAttribute('aria-checked')).toBe('true')
    expect(host.textContent).toContain('已启用')
  })
})
