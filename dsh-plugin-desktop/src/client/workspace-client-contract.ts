import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'

/** Workspace navigation and directory operations consumed by Desktop client features. */
export interface DesktopUiWorkspace {
  openSession(sessionId: string): void
  openWorkspace(workspaceId: WorkspaceId, beforeOpen?: (sessionId: SessionId) => void): Promise<void>
  startSession(workspaceId?: WorkspaceId): void
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    uiWorkspace: DesktopUiWorkspace
  }
}
