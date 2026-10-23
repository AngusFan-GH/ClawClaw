// @vitest-environment jsdom
/** Exercise Desktop feature entry points against the installed DSH client artifact. */
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { runInNewContext } from 'node:vm'
import * as cordis from '@deepseek-ai/cordis'
import * as store from '@deepseek-ai/dsh-client-store'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import * as React from 'react'
import * as jsx from 'react/jsx-runtime'
import type { ISessions, SessionListState, SessionSummary, SessionReference } from '@deepseek-ai/dsh-api-session-controller/client'
import type { WorkspaceId, WorkspaceSnapshot, WorkspaceView } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { UiWorkspace } from '@deepseek-ai/dsh-client-ui-workspace/client'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDesktopWorkspaceSelection } from '../src/client/default-workspace-selection.ts'
import type { DesktopWorkspaceSettings } from '../src/workspace-settings.ts'
import {
  expertCreationDraft, expertCreationWorkspaceId, openCapabilityConversation, openExpertCreationConversation,
} from '../src/experts/client/expert-conversation-creation.ts'

const productId = 'product-default' as WorkspaceId
const projectId = 'project' as WorkspaceId
const sourceId = SessionId('source')
const blankId = SessionId('blank')
const disposers: Array<() => void | Promise<void>> = []
afterEach(async () => {
  for (const dispose of disposers.splice(0).reverse()) await dispose()
  localStorage.clear()
  vi.unstubAllGlobals()
})

/** Use the normal bundle registration/factory interface; do not extract private classes. */
function installedWorkspacePlugin(): { apply(ctx: cordis.Context): void } {
  const require = createRequire(import.meta.url)
  const manifest = require.resolve('@deepseek-ai/dsh-client-ui-workspace/package.json')
  const dependencies: Record<string, unknown> = {
    '@deepseek-ai/cordis': cordis,
    '@deepseek-ai/dsh-client-store': store,
    '@deepseek-ai/dsh-client-ui-primitives': primitives,
    react: React,
    'react/jsx-runtime': jsx,
  }
  let plugin: { apply(ctx: cordis.Context): void } | undefined
  runInNewContext(readFileSync(join(dirname(manifest), 'lib/client.js'), 'utf8'), {
    window: { __ModuleLoader__: { load: (registration: {
      factory(require: (name: string) => unknown): { apply(ctx: cordis.Context): void }
    }) => {
      plugin = registration.factory(name => {
        if (!(name in dependencies)) throw new Error(`Unmapped client dependency: ${name}`)
        return dependencies[name]
      })
    } } },
    AbortController, AbortSignal, Error, console, setTimeout, clearTimeout,
  })
  if (plugin === undefined) throw new Error('Workspace artifact did not register')
  return plugin
}

function workspace(id: WorkspaceId, sessionIds: SessionId[], createdAt: string): WorkspaceView {
  return { workspaceId: id, path: `/work/${id}`, title: id, sessionIds, createdAt, updatedAt: createdAt }
}
function summary(id: SessionId, workspaceId: WorkspaceId, blank = false): SessionSummary {
  return { id, cwd: `/work/${workspaceId}`, displayTitle: id, blank, running: false,
    updatedAt: Date.parse('2026-03-01T00:00:00.000Z'), retainedBy: {} }
}
function bench(options: { blank?: boolean; archivedBlank?: boolean; current?: boolean; fresh?: boolean } = {}) {
  localStorage.clear()
  if (options.current !== false && !options.fresh) localStorage.setItem('dsh.sessions.current', JSON.stringify({ sessionId: sourceId }))
  const ctx = new cordis.Context()
  disposers.push(async () => { await ctx.fiber.dispose() })
  const workspaceList = store.createSnapshotStore<WorkspaceSnapshot>({
    items: [workspace(productId, [], '2026-01-01T00:00:00.000Z'), ...(options.fresh ? [] : [workspace(projectId,
      [sourceId, ...(options.blank ? [blankId] : [])], '2026-02-01T00:00:00.000Z')])],
    archivedSessionIds: options.archivedBlank ? [blankId] : [], pinnedSessionIds: [],
    phase: 'ready', state: 'idle', error: null,
  })
  const sessionList = store.createSnapshotStore<SessionListState>({
    ids: options.fresh ? [] : [sourceId, ...(options.blank ? [blankId] : [])],
    byId: Object.fromEntries((options.fresh ? [] : [summary(sourceId, projectId), ...(options.blank ? [summary(blankId, projectId, true)] : [])]).map(item => [item.id, item])),
    phase: 'pending', projectionsBySession: {},
  })
  const drafts = new Map<SessionId, string>([[sourceId, 'Keep my current draft']])
  const sessionContexts = new Map<SessionId, cordis.Context>()
  const sessionContext = (id: SessionId) => {
    let actx = sessionContexts.get(id)
    if (actx === undefined) { actx = new cordis.Context(); sessionContexts.set(id, actx) }
    return actx
  }
  const binding = (id: SessionId) => ({ sessionId: id, ctx: sessionContext(id) }) as SessionReference['binding']
  let sequence = 0
  const create = vi.fn<ISessions['create']>(async request => {
    const workspaceId = request?.workspaceId as WorkspaceId
    const id = request?.sessionId ?? SessionId(`created-${++sequence}`)
    if (sessionList.getSnapshot().byId[id] === undefined) {
      const state = sessionList.getSnapshot()
      sessionList.set({ ...state, ids: [...state.ids, id], byId: { ...state.byId, [id]: summary(id, workspaceId, true) } })
      workspaceList.set({ ...workspaceList.getSnapshot(), items: workspaceList.getSnapshot().items.map(item => item.workspaceId === workspaceId
        ? { ...item, sessionIds: [...item.sessionIds, id] } : item) })
    }
    return id
  })
  const retain = vi.fn<ISessions['retain']>((target, retainOptions) => {
    const id = typeof target === 'string' ? target : target.childSessionId
    const source = retainOptions.source
    const updateCount = (delta: number) => {
      const state = sessionList.getSnapshot()
      const item = state.byId[id]!
      sessionList.set({ ...state, byId: { ...state.byId, [id]: { ...item,
        retainedBy: { ...item.retainedBy, [source]: (item.retainedBy[source] ?? 0) + delta },
      } } })
    }
    updateCount(1)
    let released = false
    const release = () => { if (!released) { released = true; updateCount(-1) } }
    const current = binding(id)
    return { sessionId: id, binding: current, ready: Promise.resolve(current), release, [Symbol.dispose]: release }
  })
  const sessions = { list: sessionList, create, retain, binding,
    subagentAddress: () => undefined, refreshProjections: vi.fn(async () => {}), fork: vi.fn(async () => SessionId('fork')) }
  const initializeDefault = vi.fn(async () => undefined)
  const workspaces = { list: workspaceList, initializeDefault }
  const settingsState = store.createSnapshotStore<ConfigFormSnapshot<DesktopWorkspaceSettings>>({
    status: 'ready', value: { defaultWorkspaceId: productId, activeWorkspaceId: productId },
    base: undefined, user: undefined, revision: 1, writable: true,
  })
  const settings = { getSnapshot: settingsState.getSnapshot, subscribe: settingsState.subscribe,
    set: vi.fn(async (_key: keyof DesktopWorkspaceSettings, value: string) => {
      settingsState.set({ ...settingsState.getSnapshot(), value: { defaultWorkspaceId: productId, activeWorkspaceId: value } })
      return true
    }) }
  let navigation = new AbortController()
  const selectedPanel = vi.fn(() => { navigation.abort() })
  ctx.provide('sessions', sessions as never)
  ctx.provide('workspaces', workspaces as never)
  ctx.provide('locale', { bind: () => (key: string) => key, register: () => () => {} } as never)
  ctx.provide('remote', { directoryPicker: {}, $host: {} } as never)
  ctx.provide('remoteAccess', { source: () => undefined } as never)
  ctx.provide('layout', {
    beginNavigation: () => { navigation.abort(); navigation = new AbortController(); return navigation.signal },
    selectPanel: selectedPanel, panelInfo: store.createSnapshotStore({ activePanelId: null }),
  } as never)
  const requestDraftInitialization = vi.fn((_binding: SessionReference['binding'], draft: { prompt?: string }) => {
    if (draft.prompt !== undefined) drafts.set(_binding.sessionId, draft.prompt)
    return 'applied'
  })
  ctx.provide('conversation', { input: { requestDraftInitialization } } as never)
  ctx.provide('shortcuts', { register: () => () => {}, catalog: store.createSnapshotStore([]) } as never)
  ctx.provide('slots', { provideRoot: () => () => {}, registerFactory: () => () => {},
    inject: () => () => {}, entries: () => [], subscribe: () => () => {},
  } as never)
  installedWorkspacePlugin().apply(ctx)
  const navigationService: UiWorkspace = ctx.get('uiWorkspace')!
  disposers.push(installDesktopWorkspaceSelection({ sessions, workspaces, settings }))
  sessionList.set({ ...sessionList.getSnapshot(), phase: 'ready' })
  const currentId = () => Object.values(sessionList.getSnapshot().byId).find(item => (item.retainedBy.mainView ?? 0) > 0)?.id
  return { uiWorkspace: navigationService, sessions, workspaces, drafts, sessionContexts, settingsState,
    requestDraftInitialization, create, currentId, selectedPanel, initializeDefault,
    async ready() { await vi.waitFor(() => expect(currentId()).toBe(options.fresh ? SessionId('created-1') : options.current === false ? blankId : sourceId)); create.mockClear() },
  }
}

describe('installed DSH navigation with Desktop features', () => {
  it.each(['agent', 'team'] as const)('prepares %s creation in the current Workspace without replacing its draft or submitting', async kind => {
    const b = bench({ blank: true })
    await b.ready()
    const target = expertCreationWorkspaceId(b.workspaces.list.getSnapshot(), b.currentId())
    const closeSettings = vi.fn()
    const submit = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    await openExpertCreationConversation({ locale: 'zh', kind, workspaceId: target!,
      sessions: { binding: b.sessions.binding },
      conversationFor: actx => {
        const id = [...b.sessionContexts].find(([, context]) => context === actx)?.[0]
        return { actions: { setDraft: text => { b.drafts.set(id!, text) }, submit } }
      },
      openWorkspace: b.uiWorkspace.openWorkspace.bind(b.uiWorkspace), closeSettings,
    })
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: projectId, sessionId: blankId })
    expect(b.currentId()).toBe(blankId)
    expect(b.drafts.get(blankId)).toBe(expertCreationDraft('zh', kind))
    expect(b.drafts.get(sourceId)).toBe('Keep my current draft')
    expect(submit).not.toHaveBeenCalled()
    expect(closeSettings).toHaveBeenCalledOnce()
    expect(b.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId)
  })

  it.each(['expert', 'team'] as const)('prepares a selected %s capability in the target Session', async kind => {
    const b = bench()
    await b.ready()
    const prepare = vi.fn((id: SessionId) => { b.drafts.set(id, `@${kind} task`); return true })
    await expect(openCapabilityConversation({ workspaceId: projectId,
      openWorkspace: b.uiWorkspace.openWorkspace.bind(b.uiWorkspace), prepare,
    })).resolves.toBe(true)
    const id = b.currentId()!
    expect(id).not.toBe(sourceId)
    expect(prepare).toHaveBeenCalledExactlyOnceWith(id)
    expect(b.drafts.get(sourceId)).toBe('Keep my current draft')
    expect(b.drafts.get(id)).toBe(`@${kind} task`)
  })

  it('creates a fresh ordinary Session even when a reusable blank exists', async () => {
    const b = bench({ blank: true })
    await b.ready()
    b.uiWorkspace.startSession()
    await vi.waitFor(() => expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: projectId }))
    expect(b.currentId()).not.toBe(blankId)
    expect(b.requestDraftInitialization).not.toHaveBeenCalled()
  })

  it('preserves explicit preset and draft initialization on a reused Session', async () => {
    const b = bench({ blank: true })
    await b.ready()
    const draft = { prompt: '/expert-manager create a team', clearPreviousDraft: true, agentPreset: 'cordis' }
    b.uiWorkspace.startSession(undefined, draft)
    await vi.waitFor(() => expect(b.requestDraftInitialization).toHaveBeenCalledOnce())
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: projectId, sessionId: blankId, agentPreset: 'cordis' })
    expect(b.requestDraftInitialization.mock.calls[0]?.[1]).toEqual({ prompt: draft.prompt, clearPreviousDraft: true })
    expect(b.drafts.get(blankId)).toBe(draft.prompt)
    expect(b.drafts.get(sourceId)).toBe('Keep my current draft')
  })

  it('honors an explicit Workspace and its before-open preset options', async () => {
    const b = bench({ blank: true })
    await b.ready()
    const prepare = vi.fn()
    await b.uiWorkspace.openWorkspace(productId, prepare, { agentPreset: 'cordis' })
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: productId, agentPreset: 'cordis' })
    expect(prepare).toHaveBeenCalledExactlyOnceWith(b.currentId())
    expect(b.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(productId)
  })

  it('inherits a historical Session Workspace rather than the saved picker fallback', async () => {
    const b = bench()
    await b.ready()
    await b.uiWorkspace.openWorkspace(productId)
    expect(b.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(productId)
    b.uiWorkspace.openSession(sourceId)
    b.create.mockClear()
    b.uiWorkspace.startSession()
    await vi.waitFor(() => expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: projectId }))
    expect(b.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId)
  })

  it('uses the recent Workspace at startup without creating a second default Workspace', async () => {
    const b = bench({ current: false, blank: true })
    await b.ready()
    expect(b.currentId()).toBe(blankId)
    expect(b.initializeDefault).not.toHaveBeenCalled()
    b.uiWorkspace.startSession()
    await vi.waitFor(() => expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: projectId }))
  })

  it('opens the product default on a fresh installation without another automatic Workspace', async () => {
    const b = bench({ fresh: true })
    await b.ready()
    expect(b.initializeDefault).not.toHaveBeenCalled()
    expect(b.workspaces.list.getSnapshot().items.map(item => item.workspaceId)).toEqual([productId])
    expect(b.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(productId)
    b.uiWorkspace.startSession()
    await vi.waitFor(() => expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: productId }))
  })

  it('keeps expert/team creation Settings open when a later navigation supersedes it', async () => {
    const b = bench()
    await b.ready()
    const pending = Promise.withResolvers<SessionId>()
    b.create.mockImplementationOnce(() => pending.promise)
    const closeSettings = vi.fn()
    const focusComposer = vi.fn()
    const setDraft = vi.fn()
    vi.stubGlobal('requestAnimationFrame', (callback: FrameRequestCallback) => { callback(0); return 1 })
    const opening = openExpertCreationConversation({ locale: 'zh', kind: 'team', workspaceId: projectId,
      sessions: { binding: b.sessions.binding }, conversationFor: () => ({ actions: { setDraft } }),
      openWorkspace: b.uiWorkspace.openWorkspace.bind(b.uiWorkspace), closeSettings, focusComposer,
    })
    b.uiWorkspace.openSession(sourceId)
    pending.resolve(sourceId)
    await expect(opening).resolves.toBe(false)
    expect(setDraft).not.toHaveBeenCalled()
    expect(closeSettings).not.toHaveBeenCalled()
    expect(focusComposer).not.toHaveBeenCalled()
    expect(b.currentId()).toBe(sourceId)
  })

  it('does not reuse an archived blank for expert/team creation', async () => {
    const b = bench({ blank: true, archivedBlank: true })
    await b.ready()
    await openCapabilityConversation({ workspaceId: projectId,
      openWorkspace: b.uiWorkspace.openWorkspace.bind(b.uiWorkspace), prepare: () => true,
    })
    expect(b.create).toHaveBeenCalledExactlyOnceWith({ workspaceId: projectId })
    expect(b.currentId()).not.toBe(blankId)
  })

  it('keeps the current Session when preparation throws', async () => {
    const b = bench({ blank: true })
    await b.ready()
    const failure = new Error('composer unavailable')
    await expect(openCapabilityConversation({ workspaceId: projectId,
      openWorkspace: b.uiWorkspace.openWorkspace.bind(b.uiWorkspace), prepare: () => { throw failure },
    })).rejects.toBe(failure)
    expect(b.currentId()).toBe(sourceId)
    expect(b.drafts.get(sourceId)).toBe('Keep my current draft')
  })

  it('does not prepare a superseded expert/team navigation', async () => {
    const b = bench()
    await b.ready()
    const pending = Promise.withResolvers<SessionId>()
    b.create.mockImplementationOnce(() => pending.promise)
    const prepare = vi.fn(() => true)
    const opening = openCapabilityConversation({ workspaceId: projectId,
      openWorkspace: b.uiWorkspace.openWorkspace.bind(b.uiWorkspace), prepare,
    })
    b.uiWorkspace.openSession(sourceId)
    pending.resolve(sourceId)
    await expect(opening).resolves.toBe(false)
    expect(prepare).not.toHaveBeenCalled()
    expect(b.currentId()).toBe(sourceId)
  })
})
