import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { INSTALLER_DATA_RETENTION_POLICY } from '../scripts/installer-data-retention.ts'

describe('desktop installer data-retention contract', () => {
  it('removes only installer-owned application files', () => {
    expect(INSTALLER_DATA_RETENTION_POLICY).toEqual([
      expect.objectContaining({ id: 'application-files', owner: 'installer', expectation: 'remove' }),
      expect.objectContaining({ id: 'application-cache', expectation: 'preserve' }),
      expect.objectContaining({ id: 'logs', expectation: 'preserve' }),
      expect.objectContaining({ id: 'profiles', expectation: 'preserve' }),
      expect.objectContaining({ id: 'workspaces', expectation: 'preserve' }),
    ])
    expect(new Set(INSTALLER_DATA_RETENTION_POLICY.map(entry => entry.id)).size)
      .toBe(INSTALLER_DATA_RETENTION_POLICY.length)
  })

  it('keeps electron-builder from deleting application data during NSIS uninstall', () => {
    const manifest = JSON.parse(readFileSync(join(process.cwd(), 'package.json'), 'utf8')) as {
      build?: { nsis?: { deleteAppDataOnUninstall?: boolean } }
    }
    expect(manifest.build?.nsis?.deleteAppDataOnUninstall ?? false).toBe(false)
  })

  it('requires the Windows VM smoke to exercise every retention boundary', () => {
    const smoke = readFileSync(
      join(process.cwd(), 'scripts', 'smoke-windows-installer-upgrade.ps1'),
      'utf8',
    )
    for (const marker of [
      'applicationCachePreserved',
      'logsPreserved',
      'profilesPreserved',
      'workspacePreserved',
      'corruptInstallerRejected',
      'baseLaunchableAfterCorruptInstaller',
    ]) {
      expect(smoke).toContain(marker)
    }
  })
})

