import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  desktopProfilePreferencesStatePath,
  readAndMigrateDesktopProfilePreferences,
  writeDesktopProfilePreferences,
  type DesktopProfilePreferences,
} from '../src/profile-preferences.ts'

const roots: string[] = []

const CURRENT: DesktopProfilePreferences = {
  mode: 'compatibility',
  openBrowser: true,
  networkExposure: 'lan',
  notifications: {
    enabled: true,
    notifyOnTurnCompletion: true,
    notifyOnTurnFailure: true,
    notifyOnJobCompletion: true,
    notifyOnJobFailure: true,
  },
  market: 'dsh-market',
}

afterEach(async () => {
  await Promise.all(roots.splice(0).map(async root => { await rm(root, { recursive: true, force: true }) }))
})

describe('Desktop Profile mode migration', () => {
  it.each(['extended', 'advanced'] as const)('normalizes and rewrites legacy %s state', async legacyMode => {
    const root = await mkdtemp(join(tmpdir(), 'dsh-desktop-mode-migration-'))
    roots.push(root)
    const userDataDir = join(root, 'user-data')
    const profileDir = join(root, 'profiles', 'desktop')
    const state = await writeDesktopProfilePreferences(userDataDir, profileDir, CURRENT)
    const path = desktopProfilePreferencesStatePath(userDataDir, profileDir)
    await writeFile(path, `${JSON.stringify({ ...state, mode: legacyMode }, undefined, 2)}\n`, { mode: 0o600 })

    const migrated = await readAndMigrateDesktopProfilePreferences(userDataDir, profileDir)
    expect(migrated).toMatchObject({
      ...CURRENT,
      openBrowser: false,
      networkExposure: 'loopback',
    })

    const persisted = JSON.parse(await readFile(path, 'utf8')) as { mode: string }
    expect(persisted).toMatchObject({
      mode: 'compatibility',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })
})
