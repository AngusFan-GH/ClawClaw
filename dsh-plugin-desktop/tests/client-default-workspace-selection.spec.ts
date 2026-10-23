// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDefaultWorkspaceMenu } from '../src/client/default-workspace-menu.ts'
import { installDefaultWorkspaceLocale } from '../src/client/default-workspace-locale.ts'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import { SessionId } from '@deepseek-ai/dsh-session/types'
import type { SessionListState } from '@deepseek-ai/dsh-api-session-controller/client'
import type { DesktopUiWorkspace } from '../src/client/workspace-client-contract.ts'
import type { ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  applyDefaultWorkspaceSelection,
  installDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelection,
} from '../src/client/default-workspace-selection.ts'
import type { DesktopWorkspaceSettings } from '../src/workspace-settings.ts'

const defaultId = 'workspace-default' as WorkspaceId
const projectId = 'workspace-project' as WorkspaceId

describe('Desktop default Workspace display name', () => {
  it('uses the localized product title before the default Workspace settings arrive', () => {
    const base = workspaceSnapshot()
    const source = { getSnapshot: () => base, subscribe: (_listener: () => void) => () => {} }
    const dispose = installDefaultWorkspaceLocale({
      source,
      defaultId: () => undefined,
      title: () => 'Default',
      subscribeLocale: () => () => {},
      subscribeSettings: () => () => {},
    })
    expect(source.getSnapshot().items.map(item => item.title)).toEqual(['Default', 'Project'])
    dispose()
  })

  it('updates on language switches without renaming stored or user-created workspaces', () => {
    let title = '默认'
    let base = workspaceSnapshot()
    base = { ...base, items: base.items.map(item => ({ ...item, title: '默认' })) }
    let languageChanged = () => {}
    const source = { getSnapshot: () => base, subscribe: (_listener: () => void) => () => {} }
    const original = source.getSnapshot
    const dispose = installDefaultWorkspaceLocale({
      source,
      defaultId: () => defaultId,
      title: () => title,
      subscribeLocale: listener => { languageChanged = listener; return () => {} },
      subscribeSettings: () => () => {},
    })
    const changed = vi.fn()
    const off = source.subscribe(changed)
    expect(source.getSnapshot()).toBe(base)
    title = 'Default'
    languageChanged()
    expect(changed).toHaveBeenCalledOnce()
    const english = source.getSnapshot()
    expect(english.items.map(item => item.title)).toEqual(['Default', '默认'])
    expect(source.getSnapshot()).toBe(english)
    expect(base.items[0]?.title).toBe('默认')
    title = '默认'
    languageChanged()
    expect(source.getSnapshot()).toBe(base)
    base = { ...base, items: base.items.map(item => ({ ...item, title: 'My workspace' })) }
    title = 'Default'
    expect(source.getSnapshot()).toBe(base)
    off()
    dispose()
    expect(source.getSnapshot).toBe(original)
  })
})

describe('Desktop default Workspace menu', () => {
  it.each([
    ['默认工作区操作', '重命名', '删除工作区'],
    ['Default workspace actions', 'Rename', 'Delete workspace'],
  ])('hides only the default delete row for %s and restores on disposal', async (anchor, rename, remove) => {
    document.body.replaceChildren()
    const dispose = installDefaultWorkspaceMenu(document, () => ({ anchor, rename, delete: remove }))
    const trigger = document.createElement('button')
    trigger.setAttribute('aria-label', anchor)
    const treeitem = document.createElement('div')
    treeitem.setAttribute('role', 'treeitem')
    treeitem.append(trigger)
    document.body.append(treeitem)
    trigger.click()
    const menu = document.createElement('div')
    menu.setAttribute('role', 'menu')
    for (const label of [rename, remove]) {
      const wrapper = document.createElement('div')
      const button = document.createElement('button')
      button.setAttribute('role', 'menuitem')
      button.textContent = label
      wrapper.append(button)
      menu.append(wrapper)
    }
    document.body.append(menu)
    await Promise.resolve()
    expect((menu.lastElementChild as HTMLElement).style.display).toBe('none')
    expect((menu.firstElementChild as HTMLElement).style.display).toBe('')
    trigger.setAttribute('aria-label', 'Project workspace actions')
    trigger.click()
    expect((menu.lastElementChild as HTMLElement).style.display).toBe('')
    trigger.setAttribute('aria-label', anchor)
    trigger.click()
    expect((menu.lastElementChild as HTMLElement).style.display).toBe('none')
    dispose()
    expect((menu.lastElementChild as HTMLElement).style.display).toBe('')
    document.body.replaceChildren()
  })
})

function workspaceSnapshot(ids = [defaultId, projectId]): WorkspaceSnapshot {
  return {
    items: ids.map(workspaceId => ({
      workspaceId,
      path: `/work/${workspaceId as string}`,
      title: workspaceId === defaultId ? '默认' : 'Project',
      sessionIds: [],
      createdAt: '2026-09-16T00:00:00.000Z',
      updatedAt: '2026-09-16T00:00:00.000Z',
    })),
    archivedSessionIds: [],
    pinnedSessionIds: [],
    state: 'idle',
    phase: 'ready',
    error: null,
  }
}

function settingsSnapshot(activeWorkspaceId = ''): ConfigFormSnapshot<DesktopWorkspaceSettings> {
  return {
    status: 'ready',
    value: { defaultWorkspaceId: defaultId, activeWorkspaceId },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
  }
}

describe('Desktop default Workspace selection', () => {
  it('prefers the current Workspace, then a valid saved picker location, then the default', () => {
    const workspaces = workspaceSnapshot()
    expect(resolveDesktopWorkspaceSelection(workspaces, settingsSnapshot(), projectId)).toBe(projectId)
    expect(resolveDesktopWorkspaceSelection(workspaces, settingsSnapshot(projectId))).toBe(projectId)
    expect(resolveDesktopWorkspaceSelection(workspaces, settingsSnapshot('missing'))).toBe(defaultId)
  })

})

function source<T>(initial: T) {
  let value = initial
  const listeners = new Set<() => void>()
  return {
    getSnapshot: () => value,
    subscribe(listener: () => void) { listeners.add(listener); return () => { listeners.delete(listener) } },
    set(next: T) { value = next; for (const listener of listeners) listener() },
    listeners,
  }
}

const defaultSession = SessionId('default-session')
const projectSession = SessionId('project-session')

function sessionSnapshot(current?: SessionId, phase: SessionListState['phase'] = 'ready'): SessionListState {
  return {
    ids: [defaultSession, projectSession],
    byId: Object.fromEntries([defaultSession, projectSession].map(id => [id, {
      id, displayTitle: id, blank: false, running: false, updatedAt: 1,
      retainedBy: id === current ? { mainView: 1 } : {},
    }])),
    phase,
    projectionsBySession: {},
  }
}

const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0).reverse()) dispose() })

function selectionHarness(current?: SessionId, active: string = defaultId) {
  const sessionList = source(sessionSnapshot(current))
  const base = workspaceSnapshot()
  const workspace = { ...base, items: base.items.map(item => ({
    ...item, sessionIds: [item.workspaceId === defaultId ? defaultSession : projectSession],
  })) }
  const workspaceList = source<WorkspaceSnapshot>(workspace)
  const settingsState = source(settingsSnapshot(active))
  const settings = {
    getSnapshot: settingsState.getSnapshot,
    subscribe: settingsState.subscribe,
    set: vi.fn(async (_key: 'activeWorkspaceId', value: string) => {
      settingsState.set(settingsSnapshot(value))
      return true
    }),
  }
  const options = { sessions: { list: sessionList }, workspaces: { list: workspaceList }, settings }
  return { ...options, sessionList, workspaceList, settingsState,
    install() { const dispose = installDesktopWorkspaceSelection(options); disposers.push(dispose); return dispose },
  }
}

describe('Desktop Workspace navigation synchronization', () => {
  it('uses a restored Session rather than the stale saved Workspace', async () => {
    const h = selectionHarness(projectSession)
    h.install()
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId))
  })

  it('follows historical Session navigation and preserves the location when the view clears', async () => {
    const h = selectionHarness(defaultSession)
    h.install()
    h.sessionList.set(sessionSnapshot(projectSession))
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId))
    h.sessionList.set(sessionSnapshot())
    expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId)
    h.sessionList.set(sessionSnapshot(defaultSession))
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(defaultId))
  })

  it('waits for Session and Workspace baselines and reacts to changed membership', async () => {
    const h = selectionHarness(projectSession)
    h.sessionList.set(sessionSnapshot(projectSession, 'pending'))
    h.install()
    expect(h.settings.set).not.toHaveBeenCalled()
    h.workspaceList.set({ ...h.workspaceList.getSnapshot(), phase: 'pending' })
    h.sessionList.set(sessionSnapshot(projectSession))
    expect(h.settings.set).not.toHaveBeenCalled()
    h.workspaceList.set({ ...h.workspaceList.getSnapshot(), phase: 'ready' })
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId))
    h.workspaceList.set(workspaceSnapshot([defaultId]))
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(defaultId))
  })

  it('waits until a main-view reference replacement has settled', async () => {
    const h = selectionHarness(defaultSession)
    h.install()
    const overlapping = sessionSnapshot(projectSession)
    overlapping.byId[defaultSession] = { ...overlapping.byId[defaultSession]!, retainedBy: { mainView: 1 } }
    h.sessionList.set(overlapping)
    expect(h.settings.set).not.toHaveBeenCalled()
    h.sessionList.set(sessionSnapshot(projectSession))
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId))
  })

  it('serializes rapid navigation writes and stops observing on disposal', async () => {
    const h = selectionHarness(defaultSession)
    let finish: (() => void) | undefined
    h.settings.set.mockImplementationOnce(async (_key, value) => {
      await new Promise<void>(resolve => { finish = resolve })
      h.settingsState.set(settingsSnapshot(value))
      return true
    })
    const dispose = h.install()
    h.sessionList.set(sessionSnapshot(projectSession))
    h.sessionList.set(sessionSnapshot(defaultSession))
    expect(h.settings.set).toHaveBeenCalledTimes(1)
    finish!()
    await vi.waitFor(() => expect(h.settings.set).toHaveBeenCalledTimes(2))
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(defaultId))
    expect(h.settings.set.mock.calls.map(([, value]) => value)).toEqual([projectId, defaultId])
    dispose()
    h.sessionList.set(sessionSnapshot(projectSession))
    expect(h.settings.set).toHaveBeenCalledTimes(2)
    expect(h.sessionList.listeners.size).toBe(0)
    expect(h.workspaceList.listeners.size).toBe(0)
    expect(h.settingsState.listeners.size).toBe(0)
  })

  it('waits for settings and ignores background or ungrouped Sessions', async () => {
    const h = selectionHarness(projectSession)
    const readySettings = h.settingsState.getSnapshot()
    h.settingsState.set({ ...readySettings, status: 'loading', value: undefined })
    h.install()
    expect(h.settings.set).not.toHaveBeenCalled()
    h.settingsState.set(readySettings)
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId))
    const background = sessionSnapshot()
    background.byId[defaultSession] = { ...background.byId[defaultSession]!, retainedBy: { controllerOperation: 1 } }
    h.sessionList.set(background)
    const ungrouped = sessionSnapshot(defaultSession)
    h.workspaceList.set({ ...h.workspaceList.getSnapshot(), items: h.workspaceList.getSnapshot().items.map(item => ({
      ...item, sessionIds: item.sessionIds.filter(id => id !== defaultSession),
    })) })
    h.sessionList.set(ungrouped)
    expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId)
    expect(h.settings.set).toHaveBeenCalledTimes(1)
  })

  it('reports a failed settings write and can synchronize later navigation', async () => {
    const h = selectionHarness(defaultSession)
    const warn = vi.fn()
    const reason = new Error('settings unavailable')
    h.settings.set.mockRejectedValueOnce(reason)
    disposers.push(installDesktopWorkspaceSelection({ ...h, warn }))
    h.sessionList.set(sessionSnapshot(projectSession))
    await vi.waitFor(() => expect(warn).toHaveBeenCalledWith('failed to persist the active Workspace:', reason))
    h.sessionList.set(sessionSnapshot(defaultSession))
    h.sessionList.set(sessionSnapshot(projectSession))
    await vi.waitFor(() => expect(h.settingsState.getSnapshot().value?.activeWorkspaceId).toBe(projectId))
  })

  it('keeps upstream navigation methods and their preset, callback, and draft arguments intact', async () => {
    const h = selectionHarness(defaultSession)
    const startSession = vi.fn<DesktopUiWorkspace['startSession']>()
    const openWorkspace = vi.fn<DesktopUiWorkspace['openWorkspace']>(async () => {})
    const openSession = vi.fn<DesktopUiWorkspace['openSession']>()
    const uiWorkspace = { startSession, openWorkspace, openSession }
    const locale = {
      register: () => () => {}, subscribe: () => () => {},
      bind: () => (key: string) => key,
    }
    const scope = {
      ...h, uiWorkspace, locale, configForms: { get: () => h.settings }, get: () => h.sessions,
      effect: (factory: () => () => void) => { disposers.push(factory()) },
    }
    const inject = vi.fn((_keys: string[], callback: (value: typeof scope) => void) => { callback(scope) })
    applyDefaultWorkspaceSelection({ inject } as never)
    expect(uiWorkspace.startSession).toBe(startSession)
    expect(uiWorkspace.openWorkspace).toBe(openWorkspace)
    expect(uiWorkspace.openSession).toBe(openSession)
    expect(startSession).not.toHaveBeenCalled()
    expect(openWorkspace).not.toHaveBeenCalled()
    expect(openSession).not.toHaveBeenCalled()
    const draft = { prompt: 'Continue this task', clearPreviousDraft: true, agentPreset: 'cordis' }
    uiWorkspace.startSession(projectId, draft)
    expect(startSession).toHaveBeenLastCalledWith(projectId, draft)
    uiWorkspace.startSession(undefined, { agentPreset: 'cordis', clearPreviousDraft: false })
    expect(startSession).toHaveBeenLastCalledWith(undefined, { agentPreset: 'cordis', clearPreviousDraft: false })
    uiWorkspace.startSession()
    expect(startSession).toHaveBeenLastCalledWith()
    const beforeOpen = vi.fn()
    const preset = { agentPreset: 'cordis' }
    await uiWorkspace.openWorkspace(projectId, beforeOpen, preset)
    expect(openWorkspace).toHaveBeenLastCalledWith(projectId, beforeOpen, preset)
    uiWorkspace.openSession(projectSession)
    expect(openSession).toHaveBeenLastCalledWith(projectSession)
  })
})
