import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { afterEach, expect, it } from 'vitest'
import { ensureDesktopProfile, prepareDesktopProfile } from '../src/profile.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })

it.each([undefined, false, true])('keeps GenUI opt-in and preserves an older Profile choice (%s)', enabled => {
  const home = mkdtempSync(join(tmpdir(), 'clawclaw-genui-profile-')); homes.push(home)
  const fresh = composeEntries([prepareDesktopProfile(undefined, home).patches])
  expect(fresh.filter(row => row.id === 'desktop-genui')).toEqual([
    expect.objectContaining({ name: 'dsh-plugin-desktop/genui', config: { enabled: false } }),
  ])
  const patch = join(ensureDesktopProfile(home), 'cordis.patch.yml')
  writeFileSync(patch, enabled === undefined ? '[]\n' : `- id: desktop-genui\n  config:\n    enabled: ${enabled}\n`)
  const prepared = prepareDesktopProfile(undefined, home)
  const rows = composeEntries([prepared.patches]).filter(row => row.id === 'desktop-genui')
  expect(rows).toHaveLength(1)
  expect(rows[0]?.name).toBe('dsh-plugin-desktop/genui')
  expect((rows[0]?.config as { enabled?: boolean } | undefined)?.enabled ?? false).toBe(enabled ?? false)
  const saved = readFileSync(patch, 'utf8')
  expect(composeEntries([prepareDesktopProfile(undefined, home).patches]).filter(row => row.id === 'desktop-genui')).toEqual(rows)
  expect(readFileSync(patch, 'utf8')).toBe(saved)
})
