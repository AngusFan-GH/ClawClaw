import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { OPTIONAL_BUNDLES, bundlePatchPaths, composeEntries, loadOverlayPatches } from '@deepseek-ai/dsh-app-boot'
import type { EntryOptions } from '@deepseek-ai/cordis-plugin-loader'
import { expect, it } from 'vitest'

const anchor = new URL('../package.json', import.meta.url)
const manifest = JSON.parse(readFileSync(anchor, 'utf8'))
const require = createRequire(anchor)

function flatten(rows: EntryOptions[]): EntryOptions[] {
  return rows.flatMap(row => [row, ...(row.group && Array.isArray(row.config) ? flatten(row.config as EntryOptions[]) : [])])
}

it.each(OPTIONAL_BUNDLES)('ships %s and every declared Loader module at the application root', (name) => {
  const version = manifest.dependencies['@deepseek-ai/dsh']
  expect(manifest.dependencies[name]).toBe(version)
  const path = require.resolve(`${name}/package.json`)
  const bundle = JSON.parse(readFileSync(path, 'utf8'))
  expect(bundle.version).toBe(version)
  const rows = composeEntries([bundlePatchPaths(dirname(path), bundle.dsh.bundle)
    .flatMap(file => loadOverlayPatches('clawclaw', file))])
  expect(rows.length).toBeGreaterThan(0)
  for (const row of flatten(rows)) {
    if (typeof row.name !== 'string' || !row.name.startsWith('@deepseek-ai/')) continue
    expect(manifest.dependencies[row.name], `${name} must supply ${row.name}`).toBe(version)
    expect(JSON.parse(readFileSync(require.resolve(`${row.name}/package.json`), 'utf8')).version).toBe(version)
    // Client payloads must be present in the package that the production resolver admits.
    const dependency = JSON.parse(readFileSync(require.resolve(`${row.name}/package.json`), 'utf8'))
    if (dependency.exports?.['./client'] !== undefined) {
      expect(readFileSync(require.resolve(`${row.name}/client`), 'utf8').length).toBeGreaterThan(0)
    }
  }
  expect(readFileSync(join(dirname(path), 'locale/zh.json'), 'utf8').length).toBeGreaterThan(0)
})
