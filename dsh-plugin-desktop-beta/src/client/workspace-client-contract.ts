import type { DirectoryListing } from '@deepseek-ai/dsh-host-directory-picker/types'
import type { WorkspaceId } from '@deepseek-ai/dsh-api-workspace-controller/client'

/** Workspace navigation and directory operations consumed by Desktop client features. */
export interface DesktopUiWorkspace {
  openSession(sessionId: string): void
  openWorkspace(workspaceId: WorkspaceId): Promise<void>
  startSession(): void
  listDirectory(path?: string, signal?: AbortSignal): Promise<DirectoryListing>
  createDirectory(path: string, name: string): Promise<string>
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    uiWorkspace: DesktopUiWorkspace
  }
}
