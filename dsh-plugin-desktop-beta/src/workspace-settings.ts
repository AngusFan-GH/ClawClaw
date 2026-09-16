/** Shared Host/client settings contract for Desktop Workspace selection. */

export const DESKTOP_WORKSPACE_SETTINGS_NAMESPACE = 'dsh-desktop-workspace'

export interface DesktopWorkspaceSettings {
  readonly defaultWorkspaceId: string
  readonly activeWorkspaceId: string
}
