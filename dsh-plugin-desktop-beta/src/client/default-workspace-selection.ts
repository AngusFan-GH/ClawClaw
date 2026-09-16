/** Desktop policy for choosing a Workspace without requiring a picker step. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { IWorkspaces, WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SettingsScope, SettingsScopeSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { DesktopWorkspaceSettings } from '../workspace-settings.ts'
import { DESKTOP_WORKSPACE_SETTINGS_NAMESPACE } from '../workspace-settings.ts'
import { installDefaultWorkspaceMenu } from './default-workspace-menu.ts'
import { DEFAULT_WORKSPACE_LOCALE_NAMESPACE, DEFAULT_WORKSPACE_LOCALES, installDefaultWorkspaceLocale } from './default-workspace-locale.ts'

type BeforeWorkspaceOpen = (sessionId: SessionId) => void

interface DesktopUiWorkspace {
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: BeforeWorkspaceOpen): Promise<void>
  startSession(workspaceId?: WorkspaceId): void
}

interface WorkspaceMenuLocale {
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
  register(namespace: string, dictionaries: typeof DEFAULT_WORKSPACE_LOCALES): () => void
  subscribe(listener: () => void): () => void
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    uiWorkspace: DesktopUiWorkspace
  }
}

interface WorkspaceSelectionOptions {
  readonly uiWorkspace: DesktopUiWorkspace
  readonly workspaces: IWorkspaces
  readonly settings: SettingsScope<DesktopWorkspaceSettings>
  readonly warn?: (message: string, reason: unknown) => void
}

/** Resolve a valid explicit selection, then the persisted selection, then the product default. */
export function resolveDesktopWorkspaceSelection(
  workspace: Pick<WorkspaceSnapshot, 'items' | 'phase'>,
  settings: Pick<SettingsScopeSnapshot<DesktopWorkspaceSettings>, 'status' | 'value'>,
  explicit?: WorkspaceId,
): WorkspaceId | undefined {
  if (workspace.phase !== 'ready' || settings.status !== 'ready' || settings.value === undefined) {
    return undefined
  }
  const available = new Set(workspace.items.map(item => item.workspaceId as string))
  for (const candidate of [explicit, settings.value.activeWorkspaceId, settings.value.defaultWorkspaceId]) {
    if (candidate !== undefined && candidate !== '' && available.has(candidate as string)) {
      return candidate as WorkspaceId
    }
  }
  return undefined
}

/** Decorate the upstream navigation service while preserving all non-selection behavior. */
export function installDesktopWorkspaceSelection(options: WorkspaceSelectionOptions): () => void {
  const { uiWorkspace, workspaces, settings } = options
  const warn = options.warn ?? ((message, reason) => { console.warn(message, reason) })
  const originalOpenWorkspace = uiWorkspace.openWorkspace.bind(uiWorkspace)
  const originalStartSession = uiWorkspace.startSession.bind(uiWorkspace)
  let selected: WorkspaceId | undefined
  let disposed = false
  let initialTargetOpened = false

  const persistSelection = (workspaceId: WorkspaceId): void => {
    void settings.set('activeWorkspaceId', workspaceId).catch((reason: unknown) => {
      warn('failed to persist the active Workspace:', reason)
    })
  }
  const selectedTarget = (): WorkspaceId | undefined => resolveDesktopWorkspaceSelection(
    workspaces.list.getSnapshot(),
    settings.getSnapshot(),
    selected,
  )
  const openSelected = async (
    workspaceId: WorkspaceId,
    beforeOpen?: BeforeWorkspaceOpen,
  ): Promise<void> => {
    const previous = selected
    selected = workspaceId
    try {
      await originalOpenWorkspace(workspaceId, beforeOpen)
    } catch (reason) {
      selected = previous
      throw reason
    }
    persistSelection(workspaceId)
  }
  const startSelected = (workspaceId?: WorkspaceId): void => {
    const target = workspaceId === undefined ? selectedTarget() : workspaceId
    if (target === undefined) {
      originalStartSession()
      return
    }
    void openSelected(target).catch((reason: unknown) => {
      warn('new session failed:', reason)
    })
  }

  uiWorkspace.openWorkspace = openSelected
  uiWorkspace.startSession = startSelected

  const reconcile = (): void => {
    if (disposed) return
    const workspace = workspaces.list.getSnapshot()
    const snapshot = settings.getSnapshot()
    const target = resolveDesktopWorkspaceSelection(workspace, snapshot, selected)
    if (target === undefined) return
    const available = new Set(workspace.items.map(item => item.workspaceId as string))
    const persisted = snapshot.value?.activeWorkspaceId
    if ((selected !== undefined && !available.has(selected as string))
      || (persisted !== undefined && persisted !== '' && !available.has(persisted))) {
      selected = target
      persistSelection(target)
    }
    if (initialTargetOpened) return
    initialTargetOpened = true
    queueMicrotask(() => {
      if (disposed) return
      void originalOpenWorkspace(target).catch((reason: unknown) => {
        initialTargetOpened = false
        warn('initial default Workspace selection failed:', reason)
      })
    })
  }
  const unsubscribeWorkspaces = workspaces.list.subscribe(reconcile)
  const unsubscribeSettings = settings.subscribe(reconcile)
  reconcile()

  return () => {
    disposed = true
    unsubscribeSettings()
    unsubscribeWorkspaces()
    if (uiWorkspace.openWorkspace === openSelected) uiWorkspace.openWorkspace = originalOpenWorkspace
    if (uiWorkspace.startSession === startSelected) uiWorkspace.startSession = originalStartSession
  }
}

/** Install after the upstream Workspace services become available. */
export function applyDefaultWorkspaceSelection(ctx: ClientContext): void {
  ctx.inject(['uiWorkspace', 'workspaces', 'settingsScope', 'locale'], (scope: ClientContext) => {
    const settings = scope.settingsScope.bind<DesktopWorkspaceSettings>({
      namespace: DESKTOP_WORKSPACE_SETTINGS_NAMESPACE,
    })
    const locale = (scope as ClientContext & { locale: WorkspaceMenuLocale }).locale
    scope.effect(() => locale.register(DEFAULT_WORKSPACE_LOCALE_NAMESPACE, DEFAULT_WORKSPACE_LOCALES),
      'dsh-plugin-desktop: default Workspace dictionary')
    scope.effect(() => installDefaultWorkspaceLocale({
      source: scope.workspaces.list,
      defaultId: () => settings.getSnapshot().value?.defaultWorkspaceId,
      title: () => locale.bind(DEFAULT_WORKSPACE_LOCALE_NAMESPACE)('title'),
      subscribeLocale: listener => locale.subscribe(listener),
      subscribeSettings: listener => settings.subscribe(listener),
    }), 'dsh-plugin-desktop: default Workspace display name')
    scope.effect(
      () => installDesktopWorkspaceSelection({
        uiWorkspace: scope.uiWorkspace,
        workspaces: scope.workspaces,
        settings,
      }),
      'dsh-plugin-desktop: default Workspace selection',
    )
    scope.effect(() => installDefaultWorkspaceMenu(document, () => {
      const snapshot = settings.getSnapshot()
      const workspaceId = snapshot.value?.defaultWorkspaceId
      const workspace = scope.workspaces.list.getSnapshot().items.find(item => item.workspaceId === workspaceId)
      const t = locale.bind('workspace')
      return {
        anchor: workspace === undefined ? undefined : t('actions.workspace.aria', { name: workspace.title }),
        rename: t('rename'),
        delete: t('delete.workspace'),
      }
    }), 'dsh-plugin-desktop: default Workspace menu')
  })
}
