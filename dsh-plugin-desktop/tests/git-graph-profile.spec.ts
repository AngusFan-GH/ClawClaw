import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { composeEntries } from '@deepseek-ai/dsh-app-boot'
import { afterEach, expect, it } from 'vitest'
import { ensureDesktopProfile, prepareDesktopProfile } from '../src/profile.ts'

const homes: string[] = []
afterEach(() => { for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true }) })
it('adds one Git plugin with opt-in features off and preserves explicitly edited settings on repeat preparation', () => {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-git-')); homes.push(home)
  const prepared = prepareDesktopProfile(undefined, home)
  const rows = composeEntries([prepared.patches]).filter(row => row.id === 'desktop-git-graph')
  expect(rows).toHaveLength(1)
  expect(rows[0]).toMatchObject({ name: 'dsh-plugin-desktop/git-graph', config: { autoIsolate: false, autoBaseline: 'current', agentTool: false } })
  const patch = join(ensureDesktopProfile(home), 'cordis.patch.yml')
  writeFileSync(patch, '- id: desktop-git-graph\n  config:\n    autoIsolate: true\n    autoBaseline: default\n    agentTool: false\n')
  const updated = prepareDesktopProfile(undefined, home)
  expect(composeEntries([updated.patches]).filter(row => row.id === 'desktop-git-graph')).toEqual([
    expect.objectContaining({ config: { autoIsolate: true, autoBaseline: 'default', agentTool: false } }),
  ])
  const text = readFileSync(patch, 'utf8')
  prepareDesktopProfile(undefined, home)
  expect(readFileSync(patch, 'utf8')).toBe(text)
})
