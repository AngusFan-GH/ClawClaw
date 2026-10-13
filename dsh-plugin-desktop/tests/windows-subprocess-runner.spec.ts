import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join } from 'node:path'
import { describe, expect, it } from 'vitest'

const require = createRequire(import.meta.url)

describe('packaged subprocess runner adaptation', () => {
  it('starts the official private runner in Electron Node mode without leaking inherited casing', () => {
    const manifestPath = require.resolve('@deepseek-ai/dsh-subprocess-local/package.json')
    const packageRoot = dirname(manifestPath)
    const index = readFileSync(join(packageRoot, 'lib', 'index.js'), 'utf8')
    const chunk = /from "\.\/(runner-launch-[^"]+\.js)"/u.exec(index)?.[1]

    expect(chunk).toBeTypeOf('string')
    const runner = readFileSync(join(packageRoot, 'lib', chunk as string), 'utf8')
    expect(runner).toContain('const ELECTRON_RUN_AS_NODE = "ELECTRON_RUN_AS_NODE";')
    expect(runner).toContain('normalized === ELECTRON_RUN_AS_NODE || RUNNER_CONTROL_ENV_PREFIXES.some')
    expect(runner).toContain(
      'process.versions.electron === void 0 ? {} : { [ELECTRON_RUN_AS_NODE]: "1" }',
    )
  })
})
