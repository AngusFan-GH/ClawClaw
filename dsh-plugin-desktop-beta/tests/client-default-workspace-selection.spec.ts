// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import { installDefaultWorkspaceMenu } from '../src/client/default-workspace-menu.ts'
import { installDefaultWorkspaceLocale } from '../src/client/default-workspace-locale.ts'
import type { WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import {
  installDesktopWorkspaceSelection,
  resolveDesktopWorkspaceSelection,
} from '../src/client/default-workspace-selection.ts'
import type { DesktopWorkspaceSettings } from '../src/workspace-settings.ts'

const defaultId = 'workspace-default' as WorkspaceId
const projectId = 'workspace-project' as WorkspaceId

describe('Desktop default Workspace display name', () => {
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
    state: 'idle',
    phase: 'ready',
    error: null,
  }
}

function settingsSnapshot(activeWorkspaceId = ''): SettingsScopeSnapshot<DesktopWorkspaceSettings> {
  return {
    status: 'ready',
    value: { defaultWorkspaceId: defaultId, activeWorkspaceId },
    base: undefined,
    user: undefined,
    revision: 1,
    writable: true,
    mode: 'host',
  }
}

describe('Desktop default Workspace selection', () => {
  it('prefers an explicit selection, then a valid persisted selection, then the default', () => {
    const workspaces = workspaceSnapshot()
    expect(resolveDesktopWorkspaceSelection(workspaces, settingsSnapshot(), projectId)).toBe(projectId)
    expect(resolveDesktopWorkspaceSelection(workspaces, settingsSnapshot(projectId))).toBe(projectId)
    expect(resolveDesktopWorkspaceSelection(workspaces, settingsSnapshot('missing'))).toBe(defaultId)
  })

  it('opens the default initially and keeps using the Workspace selected by the user', async () => {
    let workspace = workspaceSnapshot()
    let settingsState = settingsSnapshot()
    const workspaceListeners = new Set<() => void>()
    const settingsListeners = new Set<() => void>()
    const opened: WorkspaceId[] = []
    const persisted: unknown[] = []
    const uiWorkspace = {
      openWorkspace: vi.fn(async (workspaceId: WorkspaceId) => { opened.push(workspaceId) }),
      startSession: vi.fn(),
    }
    const settings = {
      getSnapshot: () => settingsState,
      subscribe: (listener: () => void) => {
        settingsListeners.add(listener)
        return () => { settingsListeners.delete(listener) }
      },
      set: vi.fn(async (_field: string, value: unknown) => {
        persisted.push(value)
        settingsState = settingsSnapshot(String(value))
        for (const listener of settingsListeners) listener()
      }),
    }
    const workspaces = {
      list: {
        getSnapshot: () => workspace,
        subscribe: (listener: () => void) => {
          workspaceListeners.add(listener)
          return () => { workspaceListeners.delete(listener) }
        },
      },
    }
    const dispose = installDesktopWorkspaceSelection({
      uiWorkspace: uiWorkspace as never,
      workspaces: workspaces as never,
      settings: settings as never,
    })
    await Promise.resolve()
    expect(opened).toEqual([defaultId])

    await uiWorkspace.openWorkspace(projectId)
    expect(persisted).toEqual([projectId])
    uiWorkspace.startSession()
    await Promise.resolve()
    expect(opened).toEqual([defaultId, projectId, projectId])

    workspace = workspaceSnapshot([defaultId])
    for (const listener of workspaceListeners) listener()
    await Promise.resolve()
    expect(persisted.at(-1)).toBe(defaultId)
    dispose()
  })
})
