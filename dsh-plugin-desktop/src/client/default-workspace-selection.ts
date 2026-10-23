/** Keep the Desktop directory-picker fallback aligned with upstream navigation. */

import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { IWorkspaces, WorkspaceId, WorkspaceSnapshot } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-api-workspace-controller/client'
import type {} from './workspace-client-contract.ts'
import type { DesktopWorkspaceSettings } from '../workspace-settings.ts'
import { installDefaultWorkspaceMenu } from './default-workspace-menu.ts'
import { DEFAULT_WORKSPACE_LOCALE_NAMESPACE, DEFAULT_WORKSPACE_LOCALES, installDefaultWorkspaceLocale } from './default-workspace-locale.ts'

interface WorkspaceMenuLocale {
  bind(namespace: string): (key: string, params?: Record<string, unknown>) => string
  register(namespace: string, dictionaries: typeof DEFAULT_WORKSPACE_LOCALES): () => void
  subscribe(listener: () => void): () => void
}

interface WorkspaceSelectionOptions {
  readonly sessions: Pick<ISessions, 'list'>
  readonly workspaces: Pick<IWorkspaces, 'list'>
  readonly settings: Pick<ConfigForm<DesktopWorkspaceSettings>, 'getSnapshot' | 'subscribe' | 'set'>
  readonly warn?: (message: string, reason: unknown) => void
}

/** Resolve the current Workspace, then the saved picker location, then the product default. */
export function resolveDesktopWorkspaceSelection(
  workspace: Pick<WorkspaceSnapshot, 'items' | 'phase'>,
  settings: Pick<ConfigFormSnapshot<DesktopWorkspaceSettings>, 'status' | 'value'>,
  current?: WorkspaceId,
): WorkspaceId | undefined {
  if (workspace.phase !== 'ready' || settings.status !== 'ready' || settings.value === undefined) {
    return undefined
  }
  const available = new Set(workspace.items.map(item => item.workspaceId as string))
  for (const candidate of [current, settings.value.activeWorkspaceId, settings.value.defaultWorkspaceId]) {
    if (candidate !== undefined && candidate !== '' && available.has(candidate as string)) {
      return candidate as WorkspaceId
    }
  }
  return undefined
}

/** Observe actual main-view membership without replacing upstream Session operations. */
export function installDesktopWorkspaceSelection(options: WorkspaceSelectionOptions): () => void {
  const { sessions, workspaces, settings } = options
  const warn = options.warn ?? ((message, reason) => { console.warn(message, reason) })
  let disposed = false
  let pending: WorkspaceId | undefined
  let writing = false

  // Serialize settings writes so an older navigation cannot land after a newer one.
  const persistSelection = async (workspaceId: WorkspaceId): Promise<void> => {
    pending = workspaceId
    if (writing) return
    writing = true
    try {
      while (!disposed && pending !== undefined) {
        const target = pending
        pending = undefined
        try {
          await settings.set('activeWorkspaceId', target)
        } catch (reason: unknown) {
          warn('failed to persist the active Workspace:', reason)
        }
      }
    } finally {
      writing = false
    }
  }
  const reconcile = (): void => {
    if (disposed) return
    const session = sessions.list.getSnapshot()
    const workspace = workspaces.list.getSnapshot()
    if (session.phase !== 'ready' || workspace.phase !== 'ready') return
    // During replacement the new and old references can both be retained briefly.
    // Wait for one main view rather than persisting that intermediate selection.
    const current = Object.values(session.byId).filter(item => (item.retainedBy.mainView ?? 0) > 0)
    if (current.length > 1) return
    const currentId = current[0]?.id
    const currentWorkspace = currentId === undefined ? undefined
      : workspace.items.find(item => item.sessionIds.includes(currentId))?.workspaceId
    const snapshot = settings.getSnapshot()
    const target = resolveDesktopWorkspaceSelection(workspace, snapshot, currentWorkspace)
    if (target !== undefined && target !== snapshot.value?.activeWorkspaceId) {
      void persistSelection(target)
    }
    // UiWorkspace owns startup restoration, current/recent Workspace selection,
    // fresh Session creation, preset selection, and draft preparation.
  }
  const unsubscribeSessions = sessions.list.subscribe(reconcile)
  const unsubscribeWorkspaces = workspaces.list.subscribe(reconcile)
  const unsubscribeSettings = settings.subscribe(reconcile)
  reconcile()

  return () => {
    disposed = true
    pending = undefined
    unsubscribeSettings()
    unsubscribeWorkspaces()
    unsubscribeSessions()
  }
}

/** Install after the upstream Workspace services become available. */
export function applyDefaultWorkspaceSelection(ctx: ClientContext): void {
  ctx.inject(['uiWorkspace', 'sessions', 'workspaces', 'configForms', 'locale'], (scope: ClientContext) => {
    // Desktop compiles Host and Client declarations together; this injection runs on the Client.
    const clientScope = scope as ClientContext & { readonly sessions: ISessions }
    const settings = scope.configForms.get<DesktopWorkspaceSettings>('desktop-default-workspace')
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
        sessions: clientScope.sessions,
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
