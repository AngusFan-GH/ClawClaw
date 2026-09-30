import { readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, it, vi } from 'vitest'
import {
  MACOS_UNIVERSAL_NATIVE_ENTRIES,
  prepareMacUniversalRuntime,
} from '../scripts/mac-universal.ts'
import { REQUIRED_POSIX_FS_EXT_ENTRIES } from '../scripts/verify-packaged-runtime.ts'

describe('universal macOS native runtime preparation', () => {
  it('owns every thin runtime package required by a clean isolated install', () => {
    const manifest = JSON.parse(
      readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
    ) as {
      dependencies?: Record<string, string>
      optionalDependencies?: Record<string, string>
    }
    expect(manifest.dependencies?.['node-pty']).toBe('1.2.0-beta.15')
    expect(Object.keys(manifest.optionalDependencies ?? {})).toEqual([
      '@deepseek-ai/node-addon-system-darwin-arm64',
      '@deepseek-ai/node-addon-system-darwin-x64',
      '@img/sharp-darwin-arm64',
      '@img/sharp-darwin-x64',
      '@img/sharp-libvips-darwin-arm64',
      '@img/sharp-libvips-darwin-x64',
      '@koromix/koffi-darwin-arm64',
      '@koromix/koffi-darwin-x64',
      '@vscode/ripgrep-darwin-arm64',
      '@vscode/ripgrep-darwin-x64',
      'node-addon-require-builtin-darwin-arm64',
      'node-addon-require-builtin-darwin-x64',
    ])
  })

  it('tracks the Electron 44 fs-ext binding for both CPU architectures', () => {
    expect(MACOS_UNIVERSAL_NATIVE_ENTRIES).toEqual(expect.arrayContaining([
      {
        arch: 'arm64',
        path: 'node_modules/fs-ext/prebuilds/darwin-arm64/electron.abi149.node',
      },
      {
        arch: 'x86_64',
        path: 'node_modules/fs-ext/prebuilds/darwin-x64/electron.abi149.node',
      },
    ]))
    expect(REQUIRED_POSIX_FS_EXT_ENTRIES.darwin).toEqual({
      arm64: 'node_modules/fs-ext/prebuilds/darwin-arm64/electron.abi149.node',
      x64: 'node_modules/fs-ext/prebuilds/darwin-x64/electron.abi149.node',
    })
  })

  it('requires every CPU-specific file and repairs both node-pty helpers', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')

    prepareMacUniversalRuntime({ desktopRoot, exists: () => true, chmod })

    expect(chmod.mock.calls).toEqual([
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-arm64/spawn-helper'), 0o755],
      [join(desktopRoot, 'node_modules/node-pty/prebuilds/darwin-x64/spawn-helper'), 0o755],
    ])
  })

  it('fails before changing permissions when one architecture is incomplete', () => {
    const chmod = vi.fn()
    const desktopRoot = resolve('/desktop')
    const missing = MACOS_UNIVERSAL_NATIVE_ENTRIES.at(-1)!.path

    expect(() => prepareMacUniversalRuntime({
      desktopRoot,
      exists: path => path !== join(desktopRoot, missing),
      chmod,
    })).toThrow(join(desktopRoot, missing))
    expect(chmod).not.toHaveBeenCalled()
  })
})
