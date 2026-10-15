// @vitest-environment jsdom
import React, { act } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { EXPERT_AVATAR_URLS } from '../src/experts/client/avatars.ts'
import {
  applyCapabilitySidebar,
  CAPABILITY_SIDEBAR_KIND,
  CapabilitySidebarTab,
  openCapabilitySidebar,
  type ExpertSidebarEntry,
} from '../src/experts/client/capability-sidebar.tsx'

const expert = {
  slug: 'reviewer', name: '评审专家', nameEn: 'Reviewer', description: '负责评审', descriptionEn: 'Reviews work',
  emoji: 'R', division: 'testing', divisionZh: '测试', custom: false, skills: [], mcpServers: [],
}

let root: Root | undefined
afterEach(async () => {
  await act(async () => root?.unmount())
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('capability details sidebar', () => {
  it('registers a resource tab and opens a capability in the host right sidebar', () => {
    let provider: ResourceProvider<'clawclaw-capability'> | undefined
    let definition: SidebarRightTabDefinition | undefined
    const registrations: Array<Record<string, unknown>> = []
    const ctx = {
      resources: { register: (value: ResourceProvider<'clawclaw-capability'>) => { provider = value; return () => undefined } },
      sidebarRightTabs: { register: (value: SidebarRightTabDefinition) => { definition = value; return () => undefined } },
      slots: {
        inject: (_name: string, install: () => unknown) => install(),
        register: (options: Record<string, unknown>) => { registrations.push(options); return () => undefined },
      },
      effect: (install: () => unknown) => { install(); return () => undefined },
      inject: (_names: readonly string[], install: (scope: Context) => unknown) => install(ctx as unknown as Context),
    } as unknown as Context
    applyCapabilitySidebar(ctx)

    const openResource = vi.fn()
    const entry: ExpertSidebarEntry = { kind: 'expert', expert, avatar: '/avatar.png', locale: 'zh', examples: ['检查这份方案'], select: vi.fn(), focusComposer: vi.fn() }
    const address = openCapabilitySidebar({ openResource }, entry)
    expect(provider?.protocol).toBe('clawclaw-capability')
    expect(definition?.kind).toBe(CAPABILITY_SIDEBAR_KIND)
    expect(definition?.title(address)).toBe('评审专家')
    expect(registrations).toEqual([{ name: 'sidebar.right.pane.tab', key: CAPABILITY_SIDEBAR_KIND }])
    expect(openResource).toHaveBeenCalledWith(address, { kind: CAPABILITY_SIDEBAR_KIND })
  })

  it('uses both a preset question and the fixed test button to select and focus the conversation', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const select = vi.fn(async () => true)
    const focusComposer = vi.fn()
    const entry: ExpertSidebarEntry = {
      kind: 'expert', expert, avatar: '/avatar.png', locale: 'zh', examples: ['检查这份方案', '列出风险'], select, focusComposer,
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(React.createElement(CapabilitySidebarTab, {
      useResource: () => ({ status: 'live', value: { entry }, failure: undefined }),
      useTabInfo: () => ({ tab: { contentId: 'dsh-resource://clawclaw-capability/details/test' } }),
    } as never)))

    const preset = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent?.includes('列出风险'))
    await act(async () => { preset?.click(); await Promise.resolve() })
    expect(select).toHaveBeenLastCalledWith('列出风险')
    expect(focusComposer).toHaveBeenCalledOnce()

    const test = [...host.querySelectorAll<HTMLButtonElement>('button')].find(button => button.textContent === '立即测试')
    await act(async () => { test?.click(); await Promise.resolve() })
    expect(select).toHaveBeenLastCalledWith('检查这份方案')
    expect(focusComposer).toHaveBeenCalledTimes(2)
  })

  it('waits for the conversation sidebar to remount after settings closes', () => {
    let mountedSession: SessionId | undefined
    const listeners = new Set<() => void>()
    const openResource = vi.fn()
    const entry: ExpertSidebarEntry = { kind: 'expert', expert, avatar: '/avatar.png', locale: 'zh', examples: [], select: vi.fn(), focusComposer: vi.fn() }

    openCapabilitySidebar({
      openResource,
      mounted: {
        getSnapshot: () => mountedSession,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener) },
      },
    }, entry)

    expect(openResource).not.toHaveBeenCalled()
    mountedSession = 'session-1' as SessionId
    listeners.forEach(listener => listener())
    expect(openResource).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
  })

  it('shows each team member preset avatar instead of a name initial', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const reviewer = { ...expert, avatar: 5 }
    const writer = { ...expert, slug: 'writer', name: '记录专家', nameEn: 'Writer', avatar: 12 }
    const team = {
      id: 'team-review', builtin: true, name: '评审专家团', description: '联合评审', tags: ['评审'],
      goal: '评审交付物', constraints: '', deliveryRequirements: '输出结论',
      members: [
        { expertSlug: 'reviewer', duty: '主审', instructions: '检查问题' },
        { expertSlug: 'writer', duty: '记录', instructions: '整理结论' },
      ],
      examples: [], coordinatorMode: 'template' as const, coordinatorTemplateId: 'general' as const,
      coordinatorTemplateVersion: 1 as const, coordinatorPrompt: '', runtime: { mode: 'coordinator' as const, initPrompt: '' },
      skills: [], connectors: [], connectorStates: [],
    }
    const host = document.createElement('div')
    document.body.append(host)
    root = createRoot(host)
    await act(async () => root!.render(React.createElement(CapabilitySidebarTab, {
      useResource: () => ({ status: 'live', value: { entry: { kind: 'team', team, experts: [reviewer, writer], locale: 'zh', examples: [], select: vi.fn(), focusComposer: vi.fn() } }, failure: undefined }),
      useTabInfo: () => ({ tab: { contentId: 'dsh-resource://clawclaw-capability/details/team' } }),
    } as never)))

    expect([...host.querySelectorAll<HTMLImageElement>('.clawCapabilityMembers img')].map(image => image.src)).toEqual([
      new URL(EXPERT_AVATAR_URLS[5]!, window.location.href).href,
      new URL(EXPERT_AVATAR_URLS[12]!, window.location.href).href,
    ])
  })
})
