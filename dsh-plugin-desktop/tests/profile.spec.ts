import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'
import { evaluate } from '@deepseek-ai/cordis-plugin-loader'
import {
  composeEntries,
  initProfile,
  PROFILE_TEMPLATES,
  readProfilePatches,
} from '@deepseek-ai/dsh-app-boot'
import { retainAsarModuleResolver } from '../src/asar-module-resolver-state.ts'
import {
  DESKTOP_PACKAGE_NAME,
  desktopShellModeFromSettings,
  desktopStartupSettingsFromSettings,
  desktopBundleList,
  desktopHarnessProfileContext,
  ensureDesktopProfile,
  healDesktopProfileModuleFallback,
  prepareDesktopProfile,
  readDesktopShellMode,
  removeObsoleteDesktopSharedModuleFallback,
  shippedPresetRoot,
  validateDshMarketBundlePatches,
} from '../src/profile.ts'
import { DESKTOP_MARKET_IDENTITIES } from '../src/desktop-market.ts'

const homes: string[] = []

function temporaryHome(): string {
  const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
  homes.push(home)
  return home
}

function installWebClient(
  home: string,
  packageName: string,
  manifest: Record<string, unknown> = {},
): string {
  const webDir = join(home, 'profiles', 'web')
  const template = PROFILE_TEMPLATES.web
  if (template === undefined) throw new Error('test requires the shipped Web template')
  initProfile(webDir, template.bundles)
  const packageDir = join(webDir, 'node_modules', ...packageName.split('/'))
  mkdirSync(packageDir, { recursive: true })
  writeFileSync(join(packageDir, 'package.json'), JSON.stringify({
    name: packageName,
    version: '1.0.0',
    type: 'module',
    dsh: { client: { platform: 'web' } },
    ...manifest,
  }) + '\n')
  writeFileSync(join(packageDir, 'index.js'), 'export default {}\n')
  return webDir
}

function installBundle(home: string, packageName: string, patch: string, version = '1.0.0'): string {
  const bundleDir = join(home, 'profiles', 'desktop', 'node_modules', packageName)
  mkdirSync(bundleDir, { recursive: true })
  writeFileSync(join(bundleDir, 'package.json'), JSON.stringify({
    name: packageName,
    version,
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  }) + '\n')
  writeFileSync(join(bundleDir, 'cordis.patch.yml'), patch)
  return bundleDir
}

function writeDesktopShellPatch(home: string, config: Record<string, unknown>): void {
  const dir = ensureDesktopProfile(home)
  writeFileSync(join(dir, 'cordis.patch.yml'), `${JSON.stringify([{ id: 'desktop-shell', config }], undefined, 2)}\n`)
}

afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true })
})

describe('desktop profile composition', {
  timeout: process.platform === 'win32' ? 10_000 : 5_000,
}, () => {
  it('does not recreate the shared Profile fallback while the packaged ASAR resolver is active', async () => {
    const home = temporaryHome()
    const installAnchor = join(
      home,
      'resources',
      'app.asar',
      'node_modules',
      '@deepseek-ai',
      'dsh',
      'package.json',
    )
    const releaseResolver = retainAsarModuleResolver()
    try {
      void installAnchor
      await expect(healDesktopProfileModuleFallback(home)).resolves.toBeUndefined()
      expect(existsSync(join(home, 'profiles', 'node_modules'))).toBe(false)
    } finally {
      releaseResolver()
    }
  })

  it('removes only provably managed legacy shared fallbacks', () => {
    const home = temporaryHome()
    const sharedModules = join(home, 'profiles', 'node_modules')
    const legacyTarget = join(
      home,
      'old-install',
      'resources',
      'app.asar.unpacked',
      'node_modules',
      'legacy-package',
    )
    const ordinaryTarget = join(home, 'user-packages', 'ordinary-package')
    mkdirSync(legacyTarget, { recursive: true })
    mkdirSync(ordinaryTarget, { recursive: true })
    mkdirSync(sharedModules, { recursive: true })
    const legacyLink = join(sharedModules, 'legacy-package')
    const ordinaryLink = join(sharedModules, 'ordinary-package')
    symlinkSync(legacyTarget, legacyLink, process.platform === 'win32' ? 'junction' : 'dir')
    symlinkSync(ordinaryTarget, ordinaryLink, process.platform === 'win32' ? 'junction' : 'dir')

    const managedProxy = join(sharedModules, '@deepseek-ai', 'managed-proxy')
    mkdirSync(managedProxy, { recursive: true })
    writeFileSync(join(managedProxy, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/managed-proxy',
      dsh: {
        moduleFallback: {
          targets: { '.': pathToFileURL(join(legacyTarget, 'index.js')).href },
        },
      },
    })}\n`)
    const unknownDirectory = join(sharedModules, '@deepseek-ai', 'user-package')
    mkdirSync(unknownDirectory, { recursive: true })
    writeFileSync(join(unknownDirectory, 'package.json'), '{"name":"@deepseek-ai/user-package"}\n')
    const userManagedShape = join(sharedModules, '@deepseek-ai', 'user-managed-shape')
    mkdirSync(userManagedShape, { recursive: true })
    writeFileSync(join(userManagedShape, 'package.json'), `${JSON.stringify({
      name: '@deepseek-ai/user-managed-shape',
      dsh: {
        moduleFallback: {
          targets: { '.': pathToFileURL(join(ordinaryTarget, 'index.js')).href },
        },
      },
    })}\n`)
    writeFileSync(join(sharedModules, 'user-note.txt'), 'preserve me\n')

    expect(removeObsoleteDesktopSharedModuleFallback(home)).toBe(2)
    expect(existsSync(legacyLink)).toBe(false)
    expect(existsSync(managedProxy)).toBe(false)
    expect(existsSync(ordinaryLink)).toBe(true)
    expect(existsSync(unknownDirectory)).toBe(true)
    expect(existsSync(userManagedShape)).toBe(true)
    expect(readFileSync(join(sharedModules, 'user-note.txt'), 'utf8')).toBe('preserve me\n')
    expect(removeObsoleteDesktopSharedModuleFallback(home)).toBe(0)
  })

  it('ships a PowerShell-backed minimal preset patch for Windows', () => {
    const minimalPreset = readFileSync(
      join(shippedPresetRoot(), 'minimal.patch.yml'),
      'utf8',
    )

    expect(minimalPreset).toContain("name: '@deepseek-ai/dsh-tool-pwsh-persistent'")
    expect(minimalPreset).toContain("disabled: !!js process.platform !== 'win32'")
  })

  it('reads official preset patches from the logical ASAR Web bundle root', () => {
    const home = temporaryHome()
    const resources = join(home, 'resources')
    const archivedPresets = join(
      resources,
      'app.asar',
      'node_modules',
      '@deepseek-ai',
      'dsh-web-app',
    )
    const archivedPresetRoot = join(archivedPresets, 'presets')
    const presetPath = join(archivedPresetRoot, 'minimal.patch.yml')
    mkdirSync(join(resources, 'app.asar', 'lib'), { recursive: true })
    mkdirSync(archivedPresets, { recursive: true })
    mkdirSync(archivedPresetRoot, { recursive: true })
    writeFileSync(join(archivedPresets, 'package.json'), JSON.stringify({
      name: '@deepseek-ai/dsh-web-app',
      exports: { './package.json': './package.json' },
    }) + '\n')
    writeFileSync(presetPath, '- insert: []\n')

    const moduleUrl = pathToFileURL(join(resources, 'app.asar', 'lib', 'profile.js')).href
    const resolvedRoot = shippedPresetRoot(moduleUrl)

    expect(resolvedRoot).toBe(realpathSync(archivedPresetRoot))
    expect(readFileSync(join(resolvedRoot, 'minimal.patch.yml'), 'utf8')).toBe('- insert: []\n')
  })

  it('adds the Web surface before third-party bundles and removes the launcher bundle duplicate', () => {
    expect(desktopBundleList([
      '@deepseek-ai/dsh-base',
      'third-party-one',
      'dsh-plugin-desktop',
      DESKTOP_PACKAGE_NAME,
      'third-party-two',
    ])).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-free-search',
      '@clawclaw/dsh-im',
      'third-party-one',
      'third-party-two',
    ])
  })

  it('repairs a base-only CLI profile without replacing dependencies', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const path = join(dir, 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({
      ...manifest,
      dependencies: { 'third-party-plugin': '^1.2.3' },
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', 'third-party-plugin'] } },
      custom: { preserved: true },
    }, undefined, 2) + '\n')

    ensureDesktopProfile(home)
    const repaired = JSON.parse(readFileSync(path, 'utf8')) as {
      dependencies: Record<string, string>
      dsh: { profile: { bundles: string[] } }
      custom: { preserved: boolean }
    }
    expect(repaired.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-free-search',
      '@clawclaw/dsh-im',
      'third-party-plugin',
    ])
    expect(repaired.dependencies).toEqual({ 'third-party-plugin': '^1.2.3' })
    expect(repaired.custom.preserved).toBe(true)
  })

  it('migrates the obsolete Desktop bundle before loading a historical profile', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const path = join(dir, 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({
      ...manifest,
      dsh: {
        profile: {
          bundles: [
            '@deepseek-ai/dsh-base',
            '@deepseek-ai/dsh-web-app',
            '@deepseek-ai/dsh-desktop-app',
          ],
        },
      },
    }, undefined, 2) + '\n')

    expect(() => prepareDesktopProfile(undefined, home, 'win32')).not.toThrow()
    const repaired = JSON.parse(readFileSync(path, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    expect(repaired.dsh.profile.bundles).toEqual([
      '@deepseek-ai/dsh-base',
      '@deepseek-ai/dsh-web-app',
      'dsh-free-search',
      '@clawclaw/dsh-im',
    ])
  })

  it('marks legacy isolated Profile dependencies for one-time migration', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const modulesDir = join(dir, 'node_modules')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(dir, 'pnpm-workspace.yaml'), `packages:
  - .

nodeLinker: isolated
autoInstallPeers: true
customSetting: preserved
`)
    writeFileSync(join(modulesDir, '.modules.yaml'), `layoutVersion: 5
nodeLinker: isolated
packageManager: pnpm@9.12.0
`)
    writeFileSync(join(dir, 'pnpm-lock.yaml'), `lockfileVersion: '9.0'
settings:
  autoInstallPeers: true
`)

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')

    expect(prepared.requiresDependencyMigration).toBe(true)
    expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('nodeLinker: hoisted')
    expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('autoInstallPeers: false')
    expect(readFileSync(join(dir, 'pnpm-workspace.yaml'), 'utf8')).toContain('customSetting: preserved')
  })

  it('leaves an already-hoisted Profile dependency tree untouched', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const modulesDir = join(dir, 'node_modules')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(modulesDir, '.modules.yaml'), `layoutVersion: 5
nodeLinker: hoisted
packageManager: pnpm@11.7.0
virtualStoreDirMaxLength: 120
`)

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')

    expect(prepared.requiresDependencyMigration).toBe(false)
  })

  it('migrates a hoisted Profile dependency tree created by pnpm 9', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const modulesDir = join(dir, 'node_modules')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(modulesDir, '.modules.yaml'), `layoutVersion: 5
nodeLinker: hoisted
packageManager: pnpm@9.12.0
virtualStoreDirMaxLength: 120
`)

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')

    expect(prepared.requiresDependencyMigration).toBe(true)
  })

  it('migrates Windows Profile metadata created with the non-Windows virtual store limit', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const modulesDir = join(dir, 'node_modules')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(modulesDir, '.modules.yaml'), `layoutVersion: 5
nodeLinker: hoisted
packageManager: pnpm@11.7.0
virtualStoreDirMaxLength: 120
`)

    const prepared = prepareDesktopProfile(undefined, home, 'win32')

    expect(prepared.requiresDependencyMigration).toBe(true)
  })

  it('leaves current Windows Profile dependency metadata untouched', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const modulesDir = join(dir, 'node_modules')
    mkdirSync(modulesDir, { recursive: true })
    writeFileSync(join(modulesDir, '.modules.yaml'), `layoutVersion: 5
nodeLinker: hoisted
packageManager: pnpm@11.7.0
virtualStoreDirMaxLength: 60
`)

    const prepared = prepareDesktopProfile(undefined, home, 'win32')

    expect(prepared.requiresDependencyMigration).toBe(false)
  })

  it('rejects malformed persistent bundle metadata', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const path = join(dir, 'package.json')
    const manifest = JSON.parse(readFileSync(path, 'utf8')) as Record<string, unknown>
    writeFileSync(path, JSON.stringify({ ...manifest, dsh: { profile: { bundles: 'not-an-array' } } }) + '\n')
    expect(() => ensureDesktopProfile(home)).toThrow('dsh.profile.bundles must be an array')
  })

  it('assembles the Host shell without replacing the upstream client shell', () => {
    const home = temporaryHome()
    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const patches = prepared.patches as Array<Record<string, unknown>>
    const inserted = patches.flatMap((patch) => {
      const rows = patch.insert
      return Array.isArray(rows) ? rows as Array<Record<string, unknown>> : []
    })
    expect(inserted).toContainEqual(expect.objectContaining({
      name: DESKTOP_PACKAGE_NAME,
      config: { mode: 'compatibility' },
    }))
    expect(patches).toContainEqual(expect.objectContaining({
      id: 'webserver',
      name: '@deepseek-ai/dsh-host-webserver',
      disabled: true,
    }))
    expect(inserted).toContainEqual(expect.objectContaining({
      id: 'desktop-webserver',
      name: 'dsh-plugin-desktop/webserver',
      config: { host: '127.0.0.1', port: 43_120 },
    }))
    expect(inserted).toContainEqual(expect.objectContaining({
      id: 'desktop-legacy-agent-presets',
      name: 'dsh-plugin-desktop/legacy-agent-presets',
    }))
    expect(existsSync(join(
      prepared.profile.dir,
      'agent-preset-compat',
      'code',
      'agent.cordis.yml',
    ))).toBe(false)
    expect(readFileSync(prepared.rootConfig, 'utf8')).toBe('[]\n')
    expect(prepared.homeDir).toBe(home)
    expect(fileURLToPath(prepared.bareModuleBaseUrl)).toBe(join(prepared.profile.dir, 'package.json'))
    expect(prepared.mode).toBe('compatibility')
    expect(prepared.openBrowser).toBe(false)
    expect(prepared.networkExposure).toBe('loopback')

    const rows = composeEntries([prepared.patches])
    for (const [id, name] of [
      ['ui-layout', '@deepseek-ai/dsh-client-ui-layout'],
      ['ui-sidebar', '@deepseek-ai/dsh-client-ui-sidebar'],
      ['ui-conversation', '@deepseek-ai/dsh-client-ui-conversation'],
    ] as const) {
      const matching = rows.filter(row => row.id === id)
      expect(matching).toHaveLength(1)
      expect(matching[0]).toEqual(expect.objectContaining({ name }))
      expect(matching[0]?.disabled).toBeFalsy()
    }
    expect(rows.find(row => row.id === 'directory-picker')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-host-directory-picker-auto',
    }))
    expect(rows.find(row => row.id === 'directory-picker')?.disabled).toBe(true)
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'desktop-directory-picker-browse-host',
      name: '@deepseek-ai/dsh-host-directory-picker-browse',
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'desktop-directory-picker-browse-surface',
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    }))
    expect(rows.find(row => row.id === 'subprocess')).toEqual({
      id: 'subprocess',
      name: '@deepseek-ai/dsh-subprocess-local',
    })
    expect(rows.map(row => row.id)).not.toContain('desktop-windows-subprocess')
    expect(rows.find(row => row.id === 'sandbox')).toEqual({
      id: 'sandbox',
      name: '@deepseek-ai/dsh-sandbox-local',
    })
    expect(rows.find(row => row.id === 'preset-standard')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-agent-preset',
    }))
    expect(rows.find(row => row.id === 'desktop-legacy-agent-presets')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/legacy-agent-presets',
    }))
    expect(rows.find(row => row.id === 'clawclaw-experts-remote')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/experts-remote',
    }))
    expect(rows.find(row => row.id === 'clawclaw-experts')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/experts',
    }))
    expect(rows.find(row => row.id === 'pwsh-sandbox')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-pwsh-sandbox',
    }))
    expect(rows.map(row => row.id)).not.toContain('desktop-windows-pwsh-sandbox')
    expect(rows.find(row => row.id === 'desktop-terminal')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/terminal',
      disabled: { __jsExpr: "process.platform === 'linux'" },
    }))
    expect(rows.find(row => row.id === 'desktop-pnpm')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/pnpm',
    }))
    expect(rows.find(row => row.id === 'desktop-updates')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/updates',
    }))
    expect(rows.find(row => row.id === 'desktop-notifications')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/notifications',
    }))
    expect(rows.find(row => row.id === 'desktop-cron-tasks')).toEqual({
      id: 'desktop-cron-tasks',
      name: 'dsh-plugin-desktop/cron-tasks',
    })
    expect(rows.find(row => row.id === 'schedule')).toEqual({
      id: 'schedule',
      name: '@deepseek-ai/dsh-schedule',
      disabled: true,
    })
    expect(rows.find(row => row.id === 'ui-schedule')).toEqual({
      id: 'ui-schedule',
      name: '@deepseek-ai/dsh-client-ui-schedule',
      disabled: true,
    })
    expect(rows.find(row => row.id === 'ui-plugin-manager')).toEqual({
      id: 'ui-plugin-manager',
      name: '@deepseek-ai/dsh-client-ui-plugin-manager',
      disabled: true,
    })
    expect(rows.find(row => row.id === 'ui-settings-account')).toEqual({
      id: 'ui-settings-account',
      name: '@deepseek-ai/dsh-client-ui-settings-account',
      disabled: true,
    })
    expect(rows.find(row => row.id === 'desktop-shortcuts')).toEqual({
      id: 'desktop-shortcuts',
      name: 'dsh-plugin-desktop/shortcut-menu',
    })
    expect(rows.find(row => row.id === 'desktop-plugin-registry-probe')).toEqual({
      id: 'desktop-plugin-registry-probe',
      name: 'dsh-plugin-desktop/plugin-registry-probe',
    })
    expect(rows.find(row => row.id === 'desktop-default-workspace')).toEqual({
      id: 'desktop-default-workspace',
      name: 'dsh-plugin-desktop/default-workspace',
      config: { path: { __jsExpr: 'process.env.CLAWCLAW_DEFAULT_WORKSPACE' } },
    })
    expect(rows.find(row => row.id === 'desktop-profiles')).toBeUndefined()
  })

  it('migrates the old empty SpiritX seed to pending setup exactly once', () => {
    const home = temporaryHome()
    const prepared = prepareDesktopProfile(undefined, home, 'win32')
    const path = prepared.profile.patchPath
    writeFileSync(path, readFileSync(path, 'utf8').replace(/^\s+setupPending: true\r?\n/gm, '\n'))
    const migrated = prepareDesktopProfile(undefined, home, 'win32')
    const route = composeEntries([migrated.patches]).find(row => row.id === 'llm-pi-ai')?.config.providers.spiritx
    expect(route.setupPending).toBe(true)
    expect(route.models).toEqual([])
    const content = readFileSync(path, 'utf8')
    prepareDesktopProfile(undefined, home, 'win32')
    expect(readFileSync(path, 'utf8')).toBe(content)
  })

  it.each([
    { models: [{ id: 'saved-chat' }] },
    { baseURL: 'https://custom.example/v1' },
    { modelOverrides: { 'missing-model': { maxTokens: 100 } } },
  ])('does not overwrite configured or edited SpiritX routes: %j', changes => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    const route = { displayName: 'SpiritX', apiKeyEnv: 'SPIRITX_API_KEY', api: 'openai-responses',
      baseURL: 'https://ai.xzinfra.com/spiritx-api/v1', models: [], ...changes }
    writeFileSync(join(profileDir, 'cordis.patch.yml'), `- id: llm-pi-ai\n  config:\n    providers:\n      spiritx: ${JSON.stringify(route)}\n`)
    const prepared = prepareDesktopProfile(undefined, home, 'win32')
    expect(composeEntries([prepared.patches]).find(row => row.id === 'llm-pi-ai')?.config.providers.spiritx).toEqual(route)
  })

  it('starts SpiritX without a built-in model catalog', () => {
    const prepared = prepareDesktopProfile(undefined, temporaryHome(), 'darwin')
    const rows = composeEntries([prepared.patches])

    expect(rows.find(row => row.id === 'agent-default-model')).toEqual(expect.objectContaining({
      config: { provider: 'spiritx', model: '__unconfigured__' },
    }))
    expect(rows.find(row => row.id === 'spiritx')).toBeUndefined()
    expect(rows.find(row => row.id === 'llm-pi-ai')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-llm-pi-ai',
      config: {
        providers: {
          spiritx: {
            setupPending: true,
            displayName: 'SpiritX',
            apiKeyEnv: 'SPIRITX_API_KEY',
            api: 'openai-responses',
            baseURL: 'https://ai.xzinfra.com/spiritx-api/v1',
            models: [],
          },
        },
      },
    }))
    expect(rows.find(row => row.id === 'llm-pi-ai')?.disabled).not.toBe(true)
    for (const id of [
      'llm-deepseek',
      'llm-deepseek-account',
      'deepseek-llm-api-extensions',
      'session-log-deepseek',
      'plugin-package-inventory-deepseek',
      'web-search-deepseek',
      'ui-brand-official',
      'command-feedback',
      'message-feedback',
      'ui-message-feedback',
      'session-telemetry-otel',
      'desktop-product-telemetry',
      'product-analytics',
    ]) {
      expect(rows.find(row => row.id === id)?.disabled).toBe(true)
    }
    expect(rows.find(row => row.id === 'web')).toEqual(expect.objectContaining({
      config: { fetchProvider: 'http' },
    }))
  })

  it('loads native search with the keyless Bing default', () => {
    const prepared = prepareDesktopProfile(undefined, temporaryHome(), 'darwin')
    const rows = composeEntries([prepared.patches])

    expect(prepared.profile.layers.some(layer => layer.packageName === 'dsh-free-search')).toBe(true)
    expect(rows.find(row => row.id === 'web-search-free')).toEqual(expect.objectContaining({
      name: 'dsh-free-search',
      config: expect.objectContaining({ provider: 'bing', bingMarket: 'zh-CN' }),
    }))
    expect(rows.find(row => row.id === 'web-search-deepseek')?.disabled).toBe(true)
  })

  it('keeps feedback and telemetry disabled across Profile and machine overrides', () => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    const enabledRows = [
      'command-feedback',
      'message-feedback',
      'ui-message-feedback',
      'session-telemetry-otel',
      'desktop-product-telemetry',
      'product-analytics',
    ]
    writeFileSync(join(profileDir, 'cordis.patch.yml'), [
      ...enabledRows.flatMap(id => [`- id: ${id}`, '  disabled: false']),
      '',
    ].join('\n'))
    writeFileSync(join(home, 'cordis.patch.yml'), [
      ...enabledRows.flatMap(id => [`- id: ${id}`, '  disabled: false']),
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])

    for (const id of enabledRows) {
      expect(rows.find(row => row.id === id)?.disabled).toBe(true)
    }
  })

  it.each([
    { prior: '[]\n', expected: undefined },
    { prior: '- id: desktop-input-suggestions\n  config:\n    enabled: false\n', expected: false },
    { prior: '- id: desktop-input-suggestions\n  config:\n    enabled: true\n', expected: true },
  ])('upgrades older Profiles with absent or config-only input suggestion rows: $expected', ({ prior, expected }) => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    const path = join(profileDir, 'cordis.patch.yml')
    writeFileSync(path, prior)
    const first = prepareDesktopProfile(undefined, home, 'win32')
    const persisted = readFileSync(path, 'utf8')
    const second = prepareDesktopProfile(undefined, home, 'win32')
    for (const prepared of [first, second]) {
      const rows = composeEntries([prepared.patches]).filter(row => row.id === 'desktop-input-suggestions')
      expect(rows).toHaveLength(1)
      expect((rows[0]?.config as { enabled?: boolean } | undefined)?.enabled).toBe(expected)
    }
    expect(readFileSync(path, 'utf8')).toBe(persisted)
  })

  it.each([
    { canonical: undefined, oldDisabled: false, expected: true },
    { canonical: undefined, oldDisabled: true, expected: false },
    { canonical: false, oldDisabled: false, expected: false },
    { canonical: true, oldDisabled: true, expected: true },
  ])('retires removed input plugin exports without losing settings or re-enabling a disabled feature: $expected', ({ canonical, oldDisabled, expected }) => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    const path = join(profileDir, 'cordis.patch.yml')
    writeFileSync(path, JSON.stringify([
      { insert: [
        { id: 'desktop-ai-input-suggestions', name: 'dsh-plugin-desktop/ai-input-suggestions', disabled: oldDisabled,
          config: { enabled: true, savedLegacyOption: 'preserve' } },
        { id: 'desktop-ai-input-continuations', name: 'dsh-plugin-desktop/ai-input-continuations', config: { enabled: true } },
      ] },
      ...(canonical === undefined ? [] : [{ id: 'desktop-input-suggestions', config: { enabled: canonical, untouched: 'preserve' } }]),
    ]))
    const first = prepareDesktopProfile(undefined, home, 'win32')
    const persisted = readFileSync(path, 'utf8')
    const second = prepareDesktopProfile(undefined, home, 'win32')
    for (const prepared of [first, second]) {
      const rows = composeEntries([prepared.patches])
      expect(rows.filter(row => row.id === 'desktop-input-suggestions')).toHaveLength(1)
      expect(rows.find(row => row.id === 'desktop-input-suggestions')?.config).toEqual({
        enabled: expected, ...(canonical === undefined ? {} : { untouched: 'preserve' }),
      })
      expect(rows.find(row => row.id === 'desktop-ai-input-suggestions')).toMatchObject({
        disabled: true, config: { enabled: true, savedLegacyOption: 'preserve' },
      })
      expect(rows.find(row => row.id === 'desktop-ai-input-continuations')).toMatchObject({ disabled: true, config: { enabled: true } })
    }
    expect(readFileSync(path, 'utf8')).toBe(persisted)
  })

  it('keeps suggestion preferences isolated between upgraded Profiles', () => {
    const home = temporaryHome()
    ensureDesktopProfile(home)
    const alternateDir = join(home, 'profiles', 'work')
    initProfile(alternateDir, PROFILE_TEMPLATES.web!.bundles)
    for (const [profileName, enabled] of [['desktop', true], ['work', false]] as const) {
      writeFileSync(join(home, 'profiles', profileName, 'cordis.patch.yml'), JSON.stringify([
        { id: 'desktop-input-suggestions', config: { enabled } },
      ]))
      const prepared = prepareDesktopProfile(undefined, home, 'win32', profileName)
      expect(composeEntries([prepared.patches]).find(row => row.id === 'desktop-input-suggestions')?.config).toEqual({ enabled })
    }
    const again = prepareDesktopProfile(undefined, home, 'win32')
    expect(composeEntries([again.patches]).find(row => row.id === 'desktop-input-suggestions')?.config).toEqual({ enabled: true })
  })

  it.each(['desktop-ai-continuation', 'desktop-ai-draft-optimization'] as const)('upgrades arch insertions for %s without duplicates or losing explicit settings', id => {
    const home = temporaryHome(); const profileDir = ensureDesktopProfile(home)
    const path = join(profileDir, 'cordis.patch.yml')
    const name = `dsh-plugin-desktop/${id.slice('desktop-'.length)}`
    writeFileSync(path, JSON.stringify([{ insert: [{ id, name, config: { enabled: true, custom: 'retain' } }] }]))
    const first = prepareDesktopProfile(undefined, home, 'win32'); const saved = readFileSync(path, 'utf8')
    const second = prepareDesktopProfile(undefined, home, 'win32')
    for (const prepared of [first, second]) {
      const entries = composeEntries([prepared.patches]).filter(row => row.id === id)
      expect(entries).toHaveLength(1); expect(entries[0]?.config).toEqual({ enabled: true, custom: 'retain' })
    }
    expect(readFileSync(path, 'utf8')).toBe(saved)
  })

  it('migrates the retired plural continuation preference independently from suggestions', () => {
    const home = temporaryHome(); const profileDir = ensureDesktopProfile(home)
    writeFileSync(join(profileDir, 'cordis.patch.yml'), JSON.stringify([{ insert: [{
      id: 'desktop-ai-input-continuations', name: 'dsh-plugin-desktop/ai-input-continuations', config: { enabled: true },
    }] }]))
    const entries = composeEntries([prepareDesktopProfile(undefined, home, 'win32').patches])
    expect(entries.filter(row => row.id === 'desktop-ai-continuation')).toHaveLength(1)
    expect(entries.find(row => row.id === 'desktop-ai-continuation')?.config).toEqual({ enabled: true })
    expect((entries.find(row => row.id === 'desktop-input-suggestions')?.config as { enabled?: boolean } | undefined)?.enabled).not.toBe(true)
  })

  it.each([false, true])('keeps an already persisted input suggestions insertion unique and preserves enabled=%s across restarts', enabled => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    const patchPath = join(profileDir, 'cordis.patch.yml')
    writeFileSync(patchPath, [
      '- insert:',
      '    - id: desktop-input-suggestions',
      '      name: dsh-plugin-desktop/input-suggestions',
      '- id: desktop-input-suggestions',
      '  name: dsh-plugin-desktop/input-suggestions',
      '  config:',
      `    enabled: ${enabled}`,
      '',
    ].join('\n'))

    const first = prepareDesktopProfile(undefined, home, 'win32')
    const persisted = readFileSync(patchPath, 'utf8')
    const second = prepareDesktopProfile(undefined, home, 'win32')
    for (const prepared of [first, second]) {
      expect(composeEntries([prepared.patches]).filter(row => row.id === 'desktop-input-suggestions')).toEqual([{
        id: 'desktop-input-suggestions', name: 'dsh-plugin-desktop/input-suggestions', config: { enabled },
      }])
      expect(prepared.overlays.some(patch => Array.isArray(patch.insert)
        && patch.insert.some(row => row.id === 'desktop-input-suggestions'))).toBe(false)
    }
    expect(readFileSync(patchPath, 'utf8')).toBe(persisted)
  })

  it('keeps every settings-backed Desktop feature in the Profile layer instead of launcher overlays', () => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    writeFileSync(join(profileDir, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: spiritx',
      '      name: dsh-plugin-desktop/spiritx',
      '      config:',
      '        providers:',
      '          spiritx:',
      '            models:',
      '              - id: legacy-chat',
      '                name: Legacy Chat',
      '- id: llm-pi-ai',
      '  config:',
      '    providers:',
      '      minimax-cn:',
      '        apiKeyEnv: MINIMAX_CN_API_KEY',
      '- id: desktop-shortcuts',
      '  config:',
      '    items:',
      '      - desktop-reminders',
      '- id: desktop-input-suggestions',
      '  config:',
      '    enabled: true',
      '- id: desktop-cron-tasks',
      '  config:',
      '    jobs:',
      '      - id: morning-briefing',
      '        name: Morning briefing',
      '- id: desktop-skills',
      '  config:',
      '    paths:',
      '      - /opt/team-skills',
      '- id: desktop-mcp',
      '  config:',
      '    mcpServers:',
      '      - serverName: local',
      '        transport: stdio',
      '        command: node',
      '        args: []',
      '        cwd: ""',
      '        env: {}',
      '        timeoutMs: 60000',
      '        reconnect:',
      '          enabled: true',
      '          initialDelayMs: 500',
      '          maxDelayMs: 30000',
      '          maxAttempts: 10',
      '        enabled: true',
      '- id: desktop-reminders',
      '  config:',
      '    reminders: []',
      '- id: desktop-notifications',
      '  config:',
      '    enabled: false',
      '- id: desktop-default-workspace',
      '  config:',
      '    activeWorkspaceId: workspace-2',
      '- id: clawclaw-experts',
      '  config:',
      '    enabled:',
      '      - product-manager',
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])
    const firstPersisted = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    const preparedAgain = prepareDesktopProfile(undefined, home, 'darwin')
    const persisted = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')

    expect(rows.find(row => row.id === 'desktop-shortcuts')).toEqual({
      id: 'desktop-shortcuts',
      name: 'dsh-plugin-desktop/shortcut-menu',
      config: { items: ['desktop-reminders'] },
    })
    expect(rows.filter(row => row.id === 'desktop-input-suggestions')).toEqual([{
      id: 'desktop-input-suggestions', name: 'dsh-plugin-desktop/input-suggestions', config: { enabled: true },
    }])
    expect(rows.find(row => row.id === 'desktop-cron-tasks')).toEqual({
      id: 'desktop-cron-tasks',
      name: 'dsh-plugin-desktop/cron-tasks',
      config: { jobs: [{ id: 'morning-briefing', name: 'Morning briefing' }] },
    })
    expect(rows.find(row => row.id === 'desktop-skills')).toEqual({
      id: 'desktop-skills',
      name: 'dsh-plugin-desktop/skills',
      config: { paths: ['/opt/team-skills'] },
    })
    expect(rows.find(row => row.id === 'desktop-mcp')).toEqual(expect.objectContaining({
      id: 'desktop-mcp',
      name: 'dsh-plugin-desktop/mcp',
      config: expect.objectContaining({
        mcpServers: [expect.objectContaining({ serverName: 'local', command: 'node' })],
      }),
    }))
    expect(rows.find(row => row.id === 'desktop-reminders')).toEqual({
      id: 'desktop-reminders',
      name: 'dsh-plugin-desktop/reminders',
      config: { reminders: [] },
    })
    expect(rows.find(row => row.id === 'desktop-notifications')).toEqual({
      id: 'desktop-notifications',
      name: 'dsh-plugin-desktop/notifications',
      config: { enabled: false },
    })
    expect(rows.find(row => row.id === 'desktop-default-workspace')).toEqual({
      id: 'desktop-default-workspace',
      name: 'dsh-plugin-desktop/default-workspace',
      config: {
        path: { __jsExpr: 'process.env.CLAWCLAW_DEFAULT_WORKSPACE' },
        activeWorkspaceId: 'workspace-2',
      },
    })
    expect(rows.find(row => row.id === 'clawclaw-experts')).toEqual({
      id: 'clawclaw-experts',
      name: 'dsh-plugin-desktop/experts',
      config: { enabled: ['product-manager'] },
    })
    expect(rows.find(row => row.id === 'llm-pi-ai')?.config).toEqual({
      providers: {
        'minimax-cn': { apiKeyEnv: 'MINIMAX_CN_API_KEY' },
        spiritx: {
          setupPending: true,
          displayName: 'SpiritX',
          apiKeyEnv: 'SPIRITX_API_KEY',
          api: 'openai-responses',
          baseURL: 'https://ai.xzinfra.com/spiritx-api/v1',
          models: [{ id: 'legacy-chat', name: 'Legacy Chat' }],
        },
      },
    })
    expect(firstPersisted).toBe(persisted)
    expect(persisted.indexOf('insert:')).toBeLessThan(persisted.indexOf('id: desktop-shortcuts\n  config:'))
    expect(persisted.indexOf('insert:')).toBeLessThan(persisted.indexOf('id: desktop-cron-tasks\n  config:'))
    expect(persisted.match(/id: desktop-shortcuts\n/g)).toHaveLength(2)
    expect(persisted.match(/id: desktop-cron-tasks\n/g)).toHaveLength(2)
    expect(persisted.match(/id: desktop-skills\n/g)).toHaveLength(2)
    expect(persisted.match(/id: desktop-mcp\n/g)).toHaveLength(2)
    expect(persisted.match(/id: desktop-reminders\n/g)).toHaveLength(2)
    expect(persisted.match(/id: desktop-notifications\n/g)).toHaveLength(2)
    expect(persisted.match(/id: desktop-default-workspace\n/g)).toHaveLength(2)
    expect(persisted).toContain('path: !!js process.env.CLAWCLAW_DEFAULT_WORKSPACE')
    expect(persisted.match(/id: spiritx\n/g) ?? []).toHaveLength(0)
    expect(persisted.match(/id: llm-pi-ai\n/g)).toHaveLength(1)
    expect(persisted.match(/id: agent-default-model\n/g)).toHaveLength(1)
    expect(persisted.match(/id: clawclaw-experts\n/g)).toHaveLength(2)
    expect(prepared.overlays.some(patch => patch.id === 'desktop-shell')).toBe(true)
    expect(prepared.overlays.some(patch => Array.isArray(patch.insert)
      && patch.insert.some(row => row.id === 'desktop-shortcuts' || row.id === 'desktop-cron-tasks'
        || row.id === 'desktop-input-suggestions'
        || row.id === 'desktop-skills' || row.id === 'desktop-mcp' || row.id === 'desktop-reminders'
        || row.id === 'desktop-notifications' || row.id === 'desktop-default-workspace'
        || row.id === 'clawclaw-experts'))).toBe(false)
    expect(prepared.overlays.some(patch => patch.id === 'agent-default-model')).toBe(false)
    expect(composeEntries([preparedAgain.patches]).find(row => row.id === 'desktop-cron-tasks'))
      .toEqual(rows.find(row => row.id === 'desktop-cron-tasks'))
    expect(composeEntries([preparedAgain.patches]).find(row => row.id === 'desktop-skills'))
      .toEqual(rows.find(row => row.id === 'desktop-skills'))
    expect(composeEntries([preparedAgain.patches]).find(row => row.id === 'desktop-mcp'))
      .toEqual(rows.find(row => row.id === 'desktop-mcp'))
    expect(composeEntries([preparedAgain.patches]).find(row => row.id === 'desktop-reminders'))
      .toEqual(rows.find(row => row.id === 'desktop-reminders'))
    expect(composeEntries([preparedAgain.patches]).find(row => row.id === 'desktop-notifications'))
      .toEqual(rows.find(row => row.id === 'desktop-notifications'))
    expect(composeEntries([preparedAgain.patches]).find(row => row.id === 'desktop-default-workspace'))
      .toEqual(rows.find(row => row.id === 'desktop-default-workspace'))
    expect(composeEntries([preparedAgain.patches]).find(row => row.id === 'clawclaw-experts'))
      .toEqual(rows.find(row => row.id === 'clawclaw-experts'))
  })

  it('preserves explicit Web runtime trust without adding network peers', () => {
    const home = temporaryHome()
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- id: web-runtime',
      '  config:',
      '    trustedHosts:',
      '      - lab.internal',
      '      - 192.168.1.5',
      '      - lab.internal',
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])

    expect(rows.find(row => row.id === 'web-runtime')).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        openBrowser: false,
        trustedHosts: ['lab.internal', '192.168.1.5'],
      }),
    }))
    const connection = rows.find(row => row.id === 'connection')
    const trust = connection?.config?.trustedHosts as { __jsExpr: string }
    expect(evaluate({ ctx: { webStartup: { trustedHosts: ['proxy.internal'] } } }, trust.__jsExpr))
      .toEqual(['proxy.internal', 'lab.internal', '192.168.1.5'])
    expect(rows.find(row => row.id === 'desktop-webserver')).toEqual(expect.objectContaining({
      config: { host: '127.0.0.1', port: 43_120 },
    }))
  })

  it('rejects malformed Web trust config', () => {
    const malformedHome = temporaryHome()
    writeFileSync(join(malformedHome, 'cordis.patch.yml'), [
      '- id: web-runtime',
      '  config:',
      '    trustedHosts: lab.internal',
      '',
    ].join('\n'))

    expect(() => prepareDesktopProfile(undefined, malformedHome, 'darwin')).toThrow(
      'web-runtime trustedHosts must be an array of strings',
    )
  })

  it('keeps both Market providers absent until the user explicitly enables one', () => {
    const home = temporaryHome()
    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])

    expect(prepared.market).toEqual({
      requested: 'disabled',
      effective: 'disabled',
      legacyDefaulted: true,
    })
    expect(rows.some(row => row.id === 'community-market'
      || row.id === DESKTOP_MARKET_IDENTITIES.dshMarket.rowId)).toBe(false)
  })


  it('loads the exact dshmarket dependency as a direct bundle only after explicit selection', () => {
    const home = temporaryHome()
    const profileMarketDir = installBundle(home, DESKTOP_MARKET_IDENTITIES.dshMarket.packageName, [
      '- insert:',
      '    - id: dsh-market',
      '      name: dshmarket',
      '',
    ].join('\n'), '99.0.0')
    const profileManifestPath = join(ensureDesktopProfile(home), 'package.json')
    const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    profileManifest.dsh.profile.bundles.push(DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)
    writeFileSync(profileManifestPath, JSON.stringify(profileManifest) + '\n')
    const prepared = prepareDesktopProfile(undefined, home, 'darwin', 'desktop', undefined, {
      requested: 'dsh-market',
      effective: 'dsh-market',
      legacyDefaulted: false,
    })
    const rows = composeEntries([prepared.patches])

    expect(prepared.market.effective).toBe('dsh-market')
    expect(prepared.profile.layers.find(layer =>
      layer.packageName === DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)?.packageDir,
    ).toBe(profileMarketDir)
    expect(rows.filter(row => row.id === DESKTOP_MARKET_IDENTITIES.dshMarket.rowId)).toEqual([{
      id: DESKTOP_MARKET_IDENTITIES.dshMarket.rowId,
      name: DESKTOP_MARKET_IDENTITIES.dshMarket.packageName,
    }])
    expect(rows.some(row => row.id === 'community-market')).toBe(false)
  })

  it.each(['disabled', 'dsh-market'] as const)('retains market selection %s across Profile reloads and bundle changes', provider => {
    const home = temporaryHome()
    const prepared = prepareDesktopProfile(undefined, home, 'darwin', 'desktop', undefined, {
      requested: provider, effective: provider, legacyDefaulted: false,
    })
    const context = desktopHarnessProfileContext(prepared, {
      activeProfileName: 'desktop', activeProfileDir: prepared.profile.dir, homeDir: home,
      appExecutable: process.execPath, pnpmBinPath: join(home, 'pnpm.mjs'), electronVersion: '44.0.0',
      nodeBinDir: join(home, 'bin'), nodeShimPath: join(home, 'bin/node'),
      clearEnvironmentPath: join(home, 'clear-env.mjs'), dshBootstrapPath: join(home, 'desktop-cli.js'),
    })
    const marketRows = () => composeEntries([readProfilePatches('desktop-test', context)])
      .filter(row => row.id === DESKTOP_MARKET_IDENTITIES.dshMarket.rowId)
    expect(marketRows()).toEqual(provider === 'disabled' ? [] : [{ id: 'dsh-market', name: 'dshmarket' }])

    const manifestPath = join(prepared.profile.dir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dsh.profile.bundles.push('dshmarket')
    writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(marketRows()).toEqual([{ id: 'dsh-market', name: 'dshmarket', disabled: provider === 'disabled' }])

    manifest.dsh.profile.bundles = manifest.dsh.profile.bundles.filter(name => name !== 'dshmarket')
    writeFileSync(manifestPath, JSON.stringify(manifest))
    expect(marketRows()).toEqual(provider === 'disabled' ? [] : [{ id: 'dsh-market', name: 'dshmarket' }])
  })

  it('keeps the newer Desktop dshmarket when a Profile copy is older', () => {
    const home = temporaryHome()
    const oldProfileMarketDir = installBundle(home, DESKTOP_MARKET_IDENTITIES.dshMarket.packageName, [
      '- insert:',
      '    - id: dsh-market',
      '      name: dshmarket',
      '',
    ].join('\n'), '0.1.0')
    const profileManifestPath = join(ensureDesktopProfile(home), 'package.json')
    const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    profileManifest.dsh.profile.bundles.push(DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)
    writeFileSync(profileManifestPath, `${JSON.stringify(profileManifest)}\n`)

    const prepared = prepareDesktopProfile(undefined, home, 'darwin', 'desktop', undefined, {
      requested: 'dsh-market',
      effective: 'dsh-market',
      legacyDefaulted: false,
    })
    const selected = prepared.profile.layers.find(layer =>
      layer.packageName === DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)
    expect(selected?.packageDir).not.toBe(oldProfileMarketDir)
    expect(JSON.parse(readFileSync(join(selected!.packageDir, 'package.json'), 'utf8'))).toMatchObject({
      name: 'dshmarket',
      version: '1.38.1',
    })
  })

  it('applies Desktop-managed disables independently of market selection', () => {
    const home = temporaryHome()
    const packageName = 'third-party-plugin'
    installBundle(home, packageName, '- insert:\n    - id: third-party-marker\n      name: cordis:example\n')
    const profileManifestPath = join(ensureDesktopProfile(home), 'package.json')
    const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    profileManifest.dsh.profile.bundles.push(packageName)
    writeFileSync(profileManifestPath, JSON.stringify(profileManifest) + '\n')
    const managementStatePath = join(home, 'user-data', 'plugin-management', 'state.json')
    mkdirSync(dirname(managementStatePath), { recursive: true })
    writeFileSync(managementStatePath, JSON.stringify({
      version: 1,
      profiles: [{ profileName: 'desktop', disabledBundles: [packageName] }],
    }) + '\n')

    const external = prepareDesktopProfile(
      undefined,
      home,
      'darwin',
      'desktop',
      managementStatePath,
      { requested: 'dsh-market', effective: 'dsh-market', legacyDefaulted: false },
    )
    expect(composeEntries([external.patches])).not.toContainEqual(expect.objectContaining({
      id: 'third-party-marker',
    }))

    const disabled = prepareDesktopProfile(
      undefined,
      home,
      'darwin',
      'desktop',
      managementStatePath,
      { requested: 'disabled', effective: 'disabled', legacyDefaulted: false },
    )
    expect(composeEntries([disabled.patches])).not.toContainEqual(expect.objectContaining({
      id: 'third-party-marker',
    }))
  })

  it('ignores obsolete startup-recovery disable state for every market provider', () => {
    const home = temporaryHome()
    const packageName = 'third-party-plugin'
    installBundle(home, packageName, '- insert:\n    - id: third-party-marker\n      name: cordis:example\n')
    const profileManifestPath = join(ensureDesktopProfile(home), 'package.json')
    const profileManifest = JSON.parse(readFileSync(profileManifestPath, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    profileManifest.dsh.profile.bundles.push(packageName)
    writeFileSync(profileManifestPath, JSON.stringify(profileManifest) + '\n')
    const managementStatePath = join(home, 'user-data', 'plugin-management', 'state.json')
    const recoveryStatePath = join(home, 'user-data', 'startup-recovery', 'state.json')
    mkdirSync(dirname(recoveryStatePath), { recursive: true })
    writeFileSync(recoveryStatePath, JSON.stringify({
      version: 1,
      profiles: [{ profileName: 'desktop', disabledBundles: [packageName] }],
    }) + '\n')

    const prepared = prepareDesktopProfile(
      undefined,
      home,
      'darwin',
      'desktop',
      managementStatePath,
      { requested: 'dsh-market', effective: 'dsh-market', legacyDefaulted: false },
    )
    expect(composeEntries([prepared.patches])).toContainEqual(expect.objectContaining({
      id: 'third-party-marker',
    }))
  })

  it('filters an unselected dshmarket bundle before resolving or parsing its patch', () => {
    const home = temporaryHome()
    const dir = ensureDesktopProfile(home)
    const manifestPath = join(dir, 'package.json')
    const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
      dsh: { profile: { bundles: string[] } }
    }
    manifest.dsh.profile.bundles.push(DESKTOP_MARKET_IDENTITIES.dshMarket.packageName)
    writeFileSync(manifestPath, JSON.stringify(manifest, undefined, 2) + '\n')
    installBundle(home, DESKTOP_MARKET_IDENTITIES.dshMarket.packageName, 'not: [valid yaml')

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])

    expect(prepared.market.effective).toBe('disabled')
    expect(rows.some(row => row.id === DESKTOP_MARKET_IDENTITIES.dshMarket.rowId)).toBe(false)
  })

  it('fails a conflicting provider identity closed without blocking the core profile', () => {
    const home = temporaryHome()
    writeFileSync(join(home, 'cordis.patch.yml'), `- insert:\n    - id: community-market\n      name: dsh-community-market\n`)

    const prepared = prepareDesktopProfile(undefined, home, 'darwin', 'desktop', undefined, {
      requested: 'dsh-market',
      effective: 'dsh-market',
      legacyDefaulted: false,
    })
    const rows = composeEntries([prepared.patches])

    expect(prepared.market.effective).toBe('disabled')
    expect(prepared.marketFailure).toContain('conflicting Market provider Loader identity')
    expect(rows.some(row => row.id === 'community-market'
      || row.id === DESKTOP_MARKET_IDENTITIES.dshMarket.rowId)).toBe(false)
    expect(rows.some(row => row.id === 'webserver')).toBe(true)
  })

  it('rejects a non-canonical dshmarket bundle patch before it reaches the Loader', () => {
    expect(() => validateDshMarketBundlePatches([{
      insert: [{ id: 'dsh-market', name: 'unexpected-market' }],
    }])).toThrow('must insert exactly the canonical dsh-market row')
  })

  it('boots a selected Web profile without overriding its compatibility UI rows', () => {
    const home = temporaryHome()
    const webDir = join(home, 'profiles', 'web')
    const template = PROFILE_TEMPLATES.web
    if (template === undefined) throw new Error('test requires the shipped Web template')
    initProfile(webDir, template.bundles)
    writeFileSync(join(webDir, 'cordis.patch.yml'), [
      '- id: ui-layout',
      "  name: '@deepseek-ai/dsh-client-ui-layout'",
      '  disabled: true',
      '- insert:',
      '    - id: third-party-layout',
      "      name: 'third-party-layout'",
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'darwin', 'web')
    const rows = composeEntries([prepared.patches])

    expect(prepared.profile.name).toBe('web')
    expect(rows.find(row => row.id === 'ui-layout')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-client-ui-layout',
      disabled: true,
    }))
    expect(rows.find(row => row.id === 'third-party-layout')).toEqual({
      id: 'third-party-layout',
      name: 'third-party-layout',
    })
    expect(rows.find(row => row.id === 'desktop-shell')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop',
      config: expect.objectContaining({ mode: 'compatibility' }),
    }))
  })

  it('uses ClawClaw identity and language guidance in every built-in persona, including complete minimal mode', () => {
    const prepared = prepareDesktopProfile(undefined, temporaryHome(), 'darwin')
    const rows = composeEntries([prepared.patches])
    const system = rows.find(row => row.id === 'system-prompt')?.config
    expect(system?.includeHarnessIdentity).toBe(false)
    expect(prepared.overlays.find(patch => patch.id === 'system-prompt')?.config).toEqual(system)
    expect(system?.personaPrefix).toContain('You are ClawClaw, an AI assistant')
    expect(rows.find(row => row.id === 'harness-dev-context')?.disabled).toBe(true)
    for (const id of ['preset-standard', 'preset-ptc', 'preset-cordis', 'preset-minimal']) {
      const plugins = rows.find(row => row.id === id)?.config?.plugins as Array<{ name: string; config?: Record<string, unknown> }>
      const persona = plugins.find(plugin => plugin.name === '@deepseek-ai/dsh-persona')?.config
      expect(persona?.prefix).toContain(String(system?.personaPrefix))
      expect(prepared.overlays.findLast(patch => patch.id === id)?.config?.plugins).toEqual(rows.find(row => row.id === id)?.config?.plugins)
      if (id === 'preset-minimal') expect(persona?.prefix).toContain("Use the user's conversational language for all user-facing responses")
      else expect(persona?.prefix).not.toContain("Use the user's conversational language")
      if (id === 'preset-minimal') {
        expect(persona?.complete).toBe(true)
        expect(persona?.includeRuntimeContext).toBe(false)
      }
    }
  })

  it('updates saved upstream default identities in memory without rewriting the Profile', () => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    const source = JSON.stringify([
      { id: 'system-prompt', config: { personaPrefix: 'You are a coding agent powered by the {{model}} model.', includeRuntimeContext: false } },
      { id: 'preset-minimal', config: { id: 'minimal', plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'You are a helpful software engineer assistant.', complete: true } },
      ] } },
    ])
    writeFileSync(join(profileDir, 'cordis.patch.yml'), source)
    const rows = composeEntries([prepareDesktopProfile(undefined, home, 'darwin').patches])
    const system = rows.find(row => row.id === 'system-prompt')?.config
    expect(system).toMatchObject({ includeHarnessIdentity: false, includeRuntimeContext: false })
    expect(system?.personaPrefix).toContain('You are ClawClaw')
    const plugins = rows.find(row => row.id === 'preset-minimal')?.config?.plugins as Array<{ config?: Record<string, unknown> }>
    expect(plugins[0]?.config).toMatchObject({ complete: true })
    expect(plugins[0]?.config?.prefix).toContain(String(system?.personaPrefix))
    expect(rows.find(row => row.id === 'desktop-response-policy')?.name).toBe('dsh-plugin-desktop/response-policy')
    const persisted = readFileSync(join(profileDir, 'cordis.patch.yml'), 'utf8')
    expect(persisted).toContain('You are a helpful software engineer assistant.')
    expect(persisted).not.toContain('You are ClawClaw')
  })

  it('lets Profile overrides replace the default system identity and preset persona', () => {
    const home = temporaryHome()
    const profileDir = ensureDesktopProfile(home)
    writeFileSync(join(profileDir, 'cordis.patch.yml'), JSON.stringify([
      { id: 'system-prompt', config: { includeHarnessIdentity: true, personaPrefix: 'Custom deployment.' } },
      { id: 'preset-standard', config: { id: 'standard', plugins: [
        { id: 'persona', name: '@deepseek-ai/dsh-persona', config: { prefix: 'Custom assistant.', suffix: 'Custom suffix.' } },
      ] } },
    ]))
    const rows = composeEntries([prepareDesktopProfile(undefined, home, 'darwin').patches])
    expect(rows.find(row => row.id === 'system-prompt')?.config).toEqual({
      includeHarnessIdentity: true, personaPrefix: 'Custom deployment.',
    })
    const plugins = rows.find(row => row.id === 'preset-standard')?.config?.plugins as Array<{ id: string; config?: unknown }>
    expect(plugins.find(plugin => plugin.id === 'persona')?.config).toEqual({
      prefix: 'Custom assistant.', suffix: 'Custom suffix.',
    })
  })

  it('keeps upstream Schedule tools disabled inside Agent presets', () => {
    const prepared = prepareDesktopProfile(undefined, temporaryHome(), 'darwin')
    const rows = composeEntries([prepared.patches])
    for (const id of ['preset-standard', 'preset-ptc', 'preset-cordis']) {
      const row = rows.find(row => row.id === id)
      const plugins = row?.config?.plugins as Array<{ name: string; disabled?: boolean }>
      expect(plugins.find(plugin => plugin.name === '@deepseek-ai/dsh-tool-schedule')?.disabled).toBe(true)
    }
  })

  it('isolates every Skill-capable preset from Harness and shared Agent roots', () => {
    const prepared = prepareDesktopProfile(undefined, temporaryHome(), 'darwin')
    const rows = composeEntries([prepared.patches])

    for (const preset of ['standard', 'ptc', 'cordis']) {
      const row = rows.find(candidate => candidate.id === `preset-${preset}`) as {
        config?: { plugins?: Array<{ id?: string; config?: Record<string, unknown> }> }
      } | undefined
      const filesystem = row?.config?.plugins?.find(plugin => plugin.id === 'skill-filesystem')
      const projectFilesystem = row?.config?.plugins?.find(plugin => plugin.id === 'clawclaw-skill-filesystem')
      expect(filesystem?.config).toEqual(expect.objectContaining({
        includeDefaultRoots: false,
        customSkillDirs: [join(prepared.homeDir, 'skills')],
      }))
      expect(filesystem?.config?.bundledSkillDir).toEqual(expect.objectContaining({ __jsExpr: expect.any(String) }))
      expect(projectFilesystem).toEqual(expect.objectContaining({
        name: 'dsh-plugin-desktop/clawclaw-skill-filesystem',
      }))
    }
  })

  it('normalizes a legacy advanced profile to the fixed compatibility presentation', () => {
    const home = temporaryHome()
    writeDesktopShellPatch(home, {
      mode: 'advanced', port: 43_189, openBrowser: true, networkExposure: 'lan',
    })

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])

    expect(prepared.mode).toBe('compatibility')
    expect(prepared.port).toBe(43_189)
    expect(prepared.openBrowser).toBe(false)
    expect(prepared.networkExposure).toBe('loopback')
    expect(rows.find(row => row.id === 'desktop-shell')).toEqual(expect.objectContaining({
      disabled: false,
      config: expect.objectContaining({ mode: 'compatibility', port: 43_189 }),
    }))
    expect(rows.find(row => row.id === 'webserver')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-host-webserver',
      disabled: true,
    }))
    expect(rows.find(row => row.id === 'desktop-webserver')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/webserver',
      config: { host: '127.0.0.1', port: 43_189 },
    }))
    expect(rows.find(row => row.id === 'web-runtime')).toEqual(expect.objectContaining({
      config: expect.objectContaining({ openBrowser: false }),
    }))
    expect(rows.find(row => row.id === 'ui-layout')?.disabled).not.toBe(true)
  })

  it('retires legacy browser and LAN intent when compatibility mode is selected', () => {
    const home = temporaryHome()
    writeDesktopShellPatch(home, {
      mode: 'compatibility', port: 43_189, openBrowser: true, networkExposure: 'lan',
    })

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    const rows = composeEntries([prepared.patches])

    expect(prepared).toMatchObject({
      mode: 'compatibility',
      openBrowser: false,
      networkExposure: 'loopback',
    })
    expect(rows.find(row => row.id === 'desktop-webserver')).toEqual(expect.objectContaining({
      config: { host: '127.0.0.1', port: 43_189 },
    }))
    expect(rows.find(row => row.id === 'web-runtime')).toEqual(expect.objectContaining({
      config: expect.objectContaining({ openBrowser: false }),
    }))
  })

  it('normalizes a legacy extended profile without replacing the official root layout', () => {
    const home = temporaryHome()
    writeDesktopShellPatch(home, {
      mode: 'extended', macosMaterial: 'off', windowsMaterial: 'mica',
    })

    const prepared = prepareDesktopProfile(undefined, home, 'win32')
    const rows = composeEntries([prepared.patches])

    expect(prepared).toEqual(expect.objectContaining({
      mode: 'compatibility',
      macosMaterial: 'off',
      windowsMaterial: 'mica',
    }))
    expect(rows.find(row => row.id === 'ui-layout')?.disabled).not.toBe(true)
    expect(rows.find(row => row.id === 'desktop-shell')).toEqual(expect.objectContaining({
      config: expect.objectContaining({
        mode: 'compatibility',
        macosMaterial: 'off',
        windowsMaterial: 'mica',
      }),
    }))
  })

  it('reads JSON settings and defaults an absent desktop namespace to compatibility', () => {
    const home = temporaryHome()
    const path = join(home, 'desktop-settings.json')
    writeFileSync(path, JSON.stringify({ 'dsh-desktop': { mode: 'advanced' } }))

    expect(readDesktopShellMode({ path })).toBe('compatibility')
    expect(desktopStartupSettingsFromSettings({ 'dsh-desktop': { mode: 'advanced', port: 43_189 } })).toEqual({
      mode: 'compatibility',
      port: 43_189,
      macosMaterial: 'transparent',
      windowsMaterial: 'off',
      openBrowser: false,
      networkExposure: 'loopback',
    })
    expect(desktopStartupSettingsFromSettings({ 'dsh-desktop': { mode: 'advanced' } })).toEqual({
      mode: 'compatibility',
      port: 43_120,
      macosMaterial: 'transparent',
      windowsMaterial: 'off',
      openBrowser: false,
      networkExposure: 'loopback',
    })
    expect(desktopShellModeFromSettings({ unrelated: { enabled: true } })).toBe('compatibility')
  })

  it('retires legacy LAN exposure while normalizing old modes', () => {
    expect(desktopStartupSettingsFromSettings({
      'dsh-desktop': {
        mode: 'advanced',
        openBrowser: false,
        networkExposure: 'lan',
      },
    })).toMatchObject({
      mode: 'compatibility',
      openBrowser: false,
      networkExposure: 'loopback',
    })
    expect(desktopStartupSettingsFromSettings({
      'dsh-desktop': {
        mode: 'compatibility',
        openBrowser: false,
        networkExposure: 'lan',
      },
    })).toMatchObject({
      mode: 'compatibility',
      openBrowser: false,
      networkExposure: 'loopback',
    })
  })

  it('rejects invalid settings roots, sections, modes, and YAML', () => {
    expect(() => desktopShellModeFromSettings([])).toThrow('must be a map')
    expect(() => desktopShellModeFromSettings({ 'dsh-desktop': true })).toThrow('settings must be a map')
    expect(() => desktopShellModeFromSettings({ 'dsh-desktop': { mode: 'glass' } })).toThrow(
      'must be "compatibility"',
    )
    for (const port of [-1, 1.5, 65_536, '43189']) {
      expect(() => desktopStartupSettingsFromSettings({ 'dsh-desktop': { port } })).toThrow(
        'port must be an integer from 0 through 65535',
      )
    }
    expect(() => desktopStartupSettingsFromSettings({ 'dsh-desktop': { openBrowser: 'yes' } }))
      .toThrow('openBrowser must be a boolean')
    expect(() => desktopStartupSettingsFromSettings({ 'dsh-desktop': { networkExposure: 'internet' } }))
      .toThrow('networkExposure must be "loopback" or "lan"')

    const home = temporaryHome()
    const path = join(home, 'invalid.yaml')
    writeFileSync(path, 'dsh-desktop: [\n')
    expect(() => readDesktopShellMode({ path })).toThrow('invalid settings document')
  })

  it('treats only YAML-null machine-wide patch documents as no desktop patches without rewriting them', () => {
    for (const content of [
      '',
      '  \n\t\n',
      '# no machine-wide patches\n',
      'null\n',
      '~\n',
      '---\n',
      '---\n# no machine-wide patches\n...\n',
    ]) {
      const home = temporaryHome()
      const path = join(home, 'cordis.patch.yml')
      writeFileSync(path, content)

      expect(() => prepareDesktopProfile(undefined, home, 'win32')).not.toThrow()
      expect(readFileSync(path, 'utf8')).toBe(content)
    }
  })

  it('keeps non-null and invalid machine-wide patch documents on the strict upstream path', () => {
    for (const [content, diagnostic] of [
      ['not: a patch list\n', 'must be a top-level YAML array of loader patch entries'],
      ['{}\n', 'must be a top-level YAML array of loader patch entries'],
      ['false\n', 'must be a top-level YAML array of loader patch entries'],
      ['"null"\n', 'must be a top-level YAML array of loader patch entries'],
      ['not: [\n', 'failed to parse patches'],
      ['---\nnull\n---\n[]\n', 'failed to parse patches'],
    ] as const) {
      const home = temporaryHome()
      const path = join(home, 'cordis.patch.yml')
      writeFileSync(path, content)

      expect(() => prepareDesktopProfile(undefined, home, 'win32')).toThrow(diagnostic)
      expect(readFileSync(path, 'utf8')).toBe(content)
    }
  })

  it('continues to load machine-wide patch arrays with upstream !!js expressions', () => {
    const home = temporaryHome()
    const path = join(home, 'cordis.patch.yml')
    const content = [
      '- id: web-runtime',
      '  config:',
      '    desktopNullNormalizationProbe: !!js process.platform',
      '',
    ].join('\n')
    writeFileSync(path, content)

    const prepared = prepareDesktopProfile(undefined, home, 'win32')

    expect(prepared.patches).toContainEqual(expect.objectContaining({
      id: 'web-runtime',
      config: expect.objectContaining({
        desktopNullNormalizationProbe: { __jsExpr: 'process.platform' },
      }),
    }))
    expect(readFileSync(path, 'utf8')).toBe(content)
  })

  it('keeps the Windows browse panel, official subprocess and presets, and desktop pwsh provider', () => {
    const home = temporaryHome()
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- id: pwsh-sandbox',
      "  name: '@deepseek-ai/dsh-pwsh-sandbox'",
      '  config:',
      "    cwd: 'C:\\workspace'",
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'win32')
    const rows = composeEntries([prepared.patches])
    const picker = rows.find(row => row.id === 'directory-picker')

    expect(picker).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-host-directory-picker-auto',
      disabled: true,
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'desktop-directory-picker-browse-host',
      name: '@deepseek-ai/dsh-host-directory-picker-browse',
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'desktop-directory-picker-browse-surface',
      name: '@deepseek-ai/dsh-client-ui-directory-picker-browse',
    }))
    expect(rows.map(row => row.name)).not.toContain('@deepseek-ai/dsh-host-directory-picker-native')
    expect(rows.map(row => row.name)).not.toContain('@deepseek-ai/dsh-client-ui-directory-picker-native')
    expect(rows.find(row => row.id === 'subprocess')).toEqual({
      id: 'subprocess',
      name: '@deepseek-ai/dsh-subprocess-local',
    })
    expect(rows.map(row => row.id)).not.toContain('desktop-windows-subprocess')
    expect(rows.find(row => row.id === 'sandbox')).toEqual({
      id: 'sandbox',
      name: '@deepseek-ai/dsh-sandbox-local',
    })
    expect(rows.find(row => row.id === 'preset-standard')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-agent-preset',
    }))
    expect(rows.find(row => row.id === 'desktop-legacy-agent-presets')).toEqual(expect.objectContaining({
      name: 'dsh-plugin-desktop/legacy-agent-presets',
    }))
    expect(rows.find(row => row.id === 'pwsh-sandbox')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-pwsh-sandbox',
      disabled: true,
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'desktop-windows-pwsh-sandbox',
      name: 'dsh-plugin-desktop/windows-pwsh-sandbox',
      disabled: { __jsExpr: "process.platform !== 'win32'" },
      config: { cwd: 'C:\\workspace' },
    }))
  })

  it('rejects a bundle and user patch that register the same loader entry id', () => {
    const home = temporaryHome()
    const packageName = 'dsh-usage-stats'
    const bundlePatch = [
      '- insert:',
      '    - id: usage-stats',
      `      name: '${packageName}'`,
      '',
    ].join('\n')
    installBundle(home, packageName, bundlePatch)
    const profileDir = join(home, 'profiles', 'desktop')
    writeFileSync(join(profileDir, 'package.json'), JSON.stringify({
      name: 'dsh-profile-desktop',
      private: true,
      dependencies: {},
      dsh: { profile: { bundles: ['@deepseek-ai/dsh-base', '@deepseek-ai/dsh-web-app', packageName] } },
    }) + '\n')
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: usage-stats',
      `      name: '${packageName}'`,
      '',
    ].join('\n'))

    expect(() => prepareDesktopProfile(undefined, home, 'win32')).toThrow(
      'duplicate loader entry id "usage-stats" in the composed profile',
    )
  })

  it('keeps a Web Client in its owning profile and omits it from desktop', () => {
    const home = temporaryHome()
    const packageName = '@linxin666/dsh-client-ui-skin-whale-song'
    installWebClient(home, packageName, { exports: { '.': { import: './index.js' } } })
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: missing-skin',
      `      name: '${packageName}'`,
      '    - id: third-party-host',
      "      name: 'third-party-host-plugin'",
      '',
    ].join('\n'))

    const desktop = prepareDesktopProfile(undefined, home, 'darwin')
    const desktopRows = composeEntries([desktop.patches])

    expect(desktopRows.map(row => row.id)).not.toContain('missing-skin')
    expect(desktopRows).toContainEqual({
      id: 'third-party-host',
      name: 'third-party-host-plugin',
    })
    expect(desktop.skippedOptionalEntries).toEqual([{
      id: 'missing-skin',
      name: packageName,
    }])

    const web = prepareDesktopProfile(undefined, home, 'darwin', 'web')
    const webRows = composeEntries([web.patches])
    expect(webRows).toContainEqual({ id: 'missing-skin', name: packageName })
    expect(web.skippedOptionalEntries).toEqual([])
  })

  it('keeps unresolved non-UI package entries fail-loud', () => {
    const home = temporaryHome()
    const packageName = '@example/whale-song-theme'
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: optional-theme',
      `      name: '${packageName}'`,
      '',
    ].join('\n'))

    const desktop = prepareDesktopProfile(undefined, home, 'darwin')
    expect(composeEntries([desktop.patches])).toContainEqual({ id: 'optional-theme', name: packageName })
    expect(desktop.skippedOptionalEntries).toEqual([])
  })

  it('does not treat ordinary array config as nested Loader entries', () => {
    const home = temporaryHome()
    const packageName = '@example/whale-song-theme'
    installWebClient(home, packageName)
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: config-holder',
      "      name: 'third-party-host-plugin'",
      '      config:',
      `        - name: '${packageName}'`,
      '          enabled: true',
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    expect(composeEntries([prepared.patches])).toContainEqual({
      id: 'config-holder',
      name: 'third-party-host-plugin',
      config: [{ name: packageName, enabled: true }],
    })
    expect(prepared.skippedOptionalEntries).toEqual([])
  })

  it('leaves non-package Loader specifiers unchanged', () => {
    const home = temporaryHome()
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- insert:',
      '    - id: builtin-plugin',
      "      name: 'cordis:example'",
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'darwin')
    expect(composeEntries([prepared.patches])).toContainEqual({
      id: 'builtin-plugin',
      name: 'cordis:example',
    })
    expect(prepared.skippedOptionalEntries).toEqual([])
  })

  it('preserves explicitly disabled upstream Windows providers and third-party replacements', () => {
    const home = temporaryHome()
    writeFileSync(join(home, 'cordis.patch.yml'), [
      '- id: pwsh-sandbox',
      "  name: '@deepseek-ai/dsh-pwsh-sandbox'",
      '  disabled: true',
      '- insert:',
      '    - id: third-party-pwsh-sandbox',
      "      name: 'third-party-pwsh-sandbox'",
      '- id: subprocess',
      "  name: '@deepseek-ai/dsh-subprocess-local'",
      '  disabled: true',
      '- insert:',
      '    - id: third-party-subprocess',
      "      name: 'third-party-subprocess'",
      '',
    ].join('\n'))

    const prepared = prepareDesktopProfile(undefined, home, 'win32')
    const rows = composeEntries([prepared.patches])

    expect(rows.find(row => row.id === 'pwsh-sandbox')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-pwsh-sandbox',
      disabled: true,
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'third-party-pwsh-sandbox',
      name: 'third-party-pwsh-sandbox',
    }))
    expect(rows.map(row => row.id)).not.toContain('desktop-windows-pwsh-sandbox')
    expect(rows.find(row => row.id === 'subprocess')).toEqual(expect.objectContaining({
      name: '@deepseek-ai/dsh-subprocess-local',
      disabled: true,
    }))
    expect(rows).toContainEqual(expect.objectContaining({
      id: 'third-party-subprocess',
      name: 'third-party-subprocess',
    }))
    expect(rows.map(row => row.id)).not.toContain('desktop-windows-subprocess')
  })
})
