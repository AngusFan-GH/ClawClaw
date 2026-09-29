/** Product-owned data boundaries qualified by desktop installer tests. */

export type InstallerRemovalExpectation = 'remove' | 'preserve'

export interface InstallerDataRetentionEntry {
  readonly id: 'application-files' | 'application-cache' | 'logs' | 'profiles' | 'workspaces'
  readonly owner: 'installer' | 'desktop-runtime' | 'harness' | 'user'
  readonly expectation: InstallerRemovalExpectation
  readonly reason: string
}

/**
 * Uninstall removes only the installed application. Local state remains available
 * for reinstall, manual recovery, export, or deliberate user deletion.
 */
export const INSTALLER_DATA_RETENTION_POLICY = Object.freeze([
  {
    id: 'application-files',
    owner: 'installer',
    expectation: 'remove',
    reason: 'Executable payload, uninstaller, registry entry, and shortcuts belong to the installation.',
  },
  {
    id: 'application-cache',
    owner: 'desktop-runtime',
    expectation: 'preserve',
    reason: 'Electron application data can contain update state and recovery evidence needed after reinstall.',
  },
  {
    id: 'logs',
    owner: 'desktop-runtime',
    expectation: 'preserve',
    reason: 'Logs remain available for explicit diagnostics and failure investigation.',
  },
  {
    id: 'profiles',
    owner: 'harness',
    expectation: 'preserve',
    reason: 'Profiles, settings, sessions, and plugin state are user-controlled Harness data.',
  },
  {
    id: 'workspaces',
    owner: 'user',
    expectation: 'preserve',
    reason: 'Workspace files are user content and must never be deleted by the application uninstaller.',
  },
] as const satisfies readonly InstallerDataRetentionEntry[])

