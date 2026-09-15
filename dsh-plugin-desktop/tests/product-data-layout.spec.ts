import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import {
  clawClawDataLayout,
  prepareClawClawDataLayout,
} from '../src/product-data-layout.ts'

const roots: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'clawclaw-layout-'))
  roots.push(home)
  return home
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ClawClaw product data layout', () => {
  it('keeps runtime data and the default Workspace under separate children', () => {
    const home = temporaryHome()
    expect(clawClawDataLayout(home)).toEqual({
      rootDir: join(home, '.clawclaw'),
      dshHome: join(home, '.clawclaw', 'data'),
      defaultWorkspace: join(home, '.clawclaw', 'workspaces', 'default'),
    })
  })

  it('creates a fresh private product data directory', () => {
    const prepared = prepareClawClawDataLayout(temporaryHome())
    expect(prepared.migratedLegacyHome).toBe(false)
    expect(prepared.legacyHomeConflict).toBe(false)
    expect(lstatSync(prepared.dshHome).isDirectory()).toBe(true)
  })

  it('moves a sole legacy DSH home without copying its state', () => {
    const home = temporaryHome()
    const legacy = join(home, '.dsh')
    mkdirSync(legacy)
    writeFileSync(join(legacy, 'marker.txt'), 'legacy\n')
    const prepared = prepareClawClawDataLayout(home)
    expect(prepared.migratedLegacyHome).toBe(true)
    expect(existsSync(legacy)).toBe(false)
    expect(readFileSync(join(prepared.dshHome, 'marker.txt'), 'utf8')).toBe('legacy\n')
  })

  it('never merges two independently populated data directories', () => {
    const home = temporaryHome()
    const layout = clawClawDataLayout(home)
    mkdirSync(join(home, '.dsh'))
    mkdirSync(layout.dshHome, { recursive: true })
    const prepared = prepareClawClawDataLayout(home)
    expect(prepared.legacyHomeConflict).toBe(true)
    expect(existsSync(join(home, '.dsh'))).toBe(true)
  })
})
