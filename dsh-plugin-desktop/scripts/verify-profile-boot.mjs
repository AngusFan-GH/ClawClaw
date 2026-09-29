/** Headless smoke for the complete published DSH Web profile and renderer manifest. */

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { boot, composeEntries } from '@deepseek-ai/dsh-app-boot'
import { provideCmdline } from '@deepseek-ai/dsh-cmdline'
import {
  createLaunchEnvironmentSnapshot,
  DSH_LAUNCH_ENVIRONMENT_KEY,
} from '@deepseek-ai/dsh-launch-environment'
import { DESKTOP_SETTINGS_NAMESPACE } from '../lib/index.js'
import { installDesktopPnpmRuntime } from '../lib/desktop-runtime-environment.js'
import { installProfilePackageResolver } from '../lib/module-resolution.js'
import { desktopHarnessProfileContext, prepareDesktopProfile } from '../lib/profile.js'
import { DesktopProfileService } from '../lib/profile-service.js'
import { importLegacyDesktopSetupWizardSettings } from '../lib/setup-wizard-settings.js'

const BIN_NAME = 'dsh-plugin-desktop-profile-smoke'
const HOST_SERVICE_PLUGIN_NAME = 'dsh-desktop-host-services-smoke-plugin'
const HOST_SERVICE_PROBE_KEY = 'desktopHostServiceProbe'
let ordinaryBrowserEnabled = false
const BROWSER_ACCESS = Object.freeze({
  get ordinaryBrowserEnabled() { return ordinaryBrowserEnabled },
  rendererHeader: Object.freeze({
    name: 'x-dsh-desktop-renderer',
    value: Buffer.alloc(32, 4).toString('base64url'),
  }),
  setOrdinaryBrowserEnabled(enabled) { ordinaryBrowserEnabled = enabled },
})
const LAN_HTTPS_SNAPSHOT = Object.freeze({
  state: 'inactive',
  actualPort: null,
  addresses: Object.freeze([]),
  caFingerprint: null,
  errorCode: null,
})
const LAN_HTTPS = Object.freeze({
  caCertificate: null,
  attach() {},
  snapshot() { return LAN_HTTPS_SNAPSHOT },
  async setEnabled() { return LAN_HTTPS_SNAPSHOT },
  async stop() { return LAN_HTTPS_SNAPSHOT },
})
const home = mkdtempSync(join(tmpdir(), 'dsh-desktop-profile-'))
let ctx
let releasePackageResolver
let pnpmRuntime
let mountedSpec
let nativeThemeSource = 'system'
const trayItems = []

try {
  writeFileSync(join(home, 'settings.yaml'), [
    'dsh-desktop:',
    '  mode: advanced',
    'agent-presets:',
    '  default: minimal',
    '',
  ].join('\n'))
  let prepared = prepareDesktopProfile(undefined, home, 'win32')
  await importLegacyDesktopSetupWizardSettings(prepared.profile.patchPath)
  prepared = prepareDesktopProfile(undefined, home, 'win32')
  const hostServicePluginDir = join(
    prepared.profile.dir,
    'node_modules',
    HOST_SERVICE_PLUGIN_NAME,
  )
  mkdirSync(join(prepared.profile.dir, 'node_modules'), { recursive: true })
  cpSync(
    fileURLToPath(new URL('../tests/fixtures/desktop-host-services-smoke-plugin/', import.meta.url)),
    hostServicePluginDir,
    { recursive: true, force: false, errorOnExist: true },
  )
  // Deliberately compose the consumer before the desktop-pnpm provider row.
  // Its required injection must keep it pending until that service mounts.
  const hostServicePatch = {
    insert: [{
      id: 'desktop-host-services-smoke-plugin',
      name: HOST_SERVICE_PLUGIN_NAME,
    }],
  }
  const patches = [
    hostServicePatch,
    ...prepared.patches,
  ]
  const packageRoot = new URL('../', import.meta.url)
  const packageManifest = JSON.parse(readFileSync(new URL('package.json', packageRoot), 'utf8'))
  const harnessVersion = packageManifest.dependencies?.['@deepseek-ai/dsh']
  const profilePackages = new Set(composeEntries([prepared.patches])
    .flatMap(entry => typeof entry.name === 'string' && entry.name.startsWith('@deepseek-ai/dsh')
      ? [entry.name.split('/').slice(0, 2).join('/')]
      : []))
  for (const packageName of profilePackages) {
    if (packageManifest.dependencies?.[packageName] === undefined) {
      throw new Error(`assembled profile package ${packageName} is not a direct Desktop dependency`)
    }
    const installed = JSON.parse(readFileSync(
      new URL(`node_modules/${packageName}/package.json`, packageRoot),
      'utf8',
    ))
    if (installed.version !== harnessVersion) {
      throw new Error(
        `assembled profile package ${packageName} uses ${installed.version} instead of ${harnessVersion}`,
      )
    }
  }
  const desktopRequire = createRequire(new URL('package.json', packageRoot))
  const webManifestPath = desktopRequire.resolve('@deepseek-ai/dsh-web-app/package.json')
  const webManifest = JSON.parse(readFileSync(webManifestPath, 'utf8'))
  const presetPatches = webManifest.dsh?.bundle?.patch
  if (!Array.isArray(presetPatches)) {
    throw new Error('Web bundle does not declare its preset patches')
  }
  const presetPackages = new Set(presetPatches
    .filter(file => typeof file === 'string' && file.startsWith('./presets/') && file.endsWith('.patch.yml'))
    .flatMap(file => [...readFileSync(join(dirname(webManifestPath), file), 'utf8')
      .matchAll(/@deepseek-ai\/dsh-[\w-]+/gu)]
      .map(match => match[0])))
  for (const packageName of presetPackages) {
    if (packageManifest.dependencies?.[packageName] === undefined) {
      throw new Error(`agent preset package ${packageName} is not a direct Desktop dependency`)
    }
    const installedPath = desktopRequire.resolve(`${packageName}/package.json`)
    const installed = JSON.parse(readFileSync(installedPath, 'utf8'))
    if (installed.version !== harnessVersion) {
      throw new Error(
        `agent preset package ${packageName} resolves to ${installed.version} instead of ${harnessVersion}`,
      )
    }
  }
  const pnpmBinPath = fileURLToPath(new URL('node_modules/pnpm/bin/pnpm.mjs', packageRoot))
  const electronVersion = JSON.parse(
    readFileSync(new URL('node_modules/electron/package.json', packageRoot), 'utf8'),
  ).version
  pnpmRuntime = installDesktopPnpmRuntime({
    platform: process.platform,
    appExecutable: process.execPath,
    pnpmBinPath,
    electronVersion,
    stateDir: join(home, 'runtime-commands'),
    environment: process.env,
  })
  releasePackageResolver = installProfilePackageResolver(prepared.bareModuleBaseUrl)
  const runtime = {
    platform: 'win32',
    windowsBuild: 22_631,
    locale: 'en',
    updates: {
      isPackaged: false,
      canDownload: true,
      currentVersion: '2.0.0',
      statePath: join(home, 'update-state.json'),
      request: async () => { throw new Error('profile smoke must not perform update requests') },
      confirmDownload: async () => false,
      showManualCheckResult: async () => {},
      showUpdateFailure: async () => {},
      downloadAndOpen: async () => {},
      notify: () => {},
    },
    schedule(spec) {
      mountedSpec = spec
      return async () => {}
    },
    async mountScheduled() {
      if (mountedSpec === undefined) throw new Error('desktop shell was not registered')
      runtime.setLocalePreference(mountedSpec.readLocalePreference())
      nativeThemeSource = mountedSpec.readThemeSource()
    },
    show() {},
    registerTrayItem(item) {
      trayItems.push(item)
      return {
        refresh() {},
        dispose() {
          const index = trayItems.indexOf(item)
          if (index >= 0) trayItems.splice(index, 1)
        },
      }
    },
    openTerminal() {},
    setLocalePreference(preference) { runtime.locale = preference ?? 'en' },
    setThemeSource(source) { nativeThemeSource = source },
    async requestRestart() {},
    prepareToQuit() {},
  }
  ctx = await boot(
    BIN_NAME,
    prepared.rootConfig,
    patches,
    async (host) => {
      // Match the public resolver path used by packaged Electron.
      host.loader.internal = undefined
      host.provide(DSH_LAUNCH_ENVIRONMENT_KEY, createLaunchEnvironmentSnapshot([]))
      host.provide('desktopBrowserAccess', BROWSER_ACCESS)
      host.provide('desktopLanHttps', LAN_HTTPS)
      host.provide('desktopRuntime', runtime)
      host.provide('desktopPnpmBootstrap', {
        activeProfileName: 'desktop',
        activeProfileDir: prepared.profile.dir,
        homeDir: prepared.homeDir,
        appExecutable: process.execPath,
        pnpmBinPath,
        electronVersion,
        nodeBinDir: pnpmRuntime.nodeBinDir,
        nodeShimPath: pnpmRuntime.nodeShimPath,
        clearEnvironmentPath: pnpmRuntime.clearEnvironmentPath,
        dshBootstrapPath: fileURLToPath(new URL('../lib/desktop-cli.js', import.meta.url)),
      })
      const profileContext = desktopHarnessProfileContext(prepared, host.desktopPnpmBootstrap)
      host.provide('profileContext', {
        ...profileContext,
        overlays: [hostServicePatch, ...profileContext.overlays],
      })
      await host.plugin(DesktopProfileService, {
        current: {
          name: 'desktop',
          dir: prepared.profile.dir,
        },
        list: () => [{
          name: 'desktop',
          dir: prepared.profile.dir,
          exists: true,
          bundles: prepared.profile.layers.map(layer => layer.packageName),
          webCapable: true,
        }],
        persistSelection: () => {},
        requestRestart: () => {},
      })
      provideCmdline(host, {
        args: ['--host', '127.0.0.1', '--port', '0'],
        exit: () => {},
      })
    },
    prepared.bareModuleBaseUrl,
  )
  await runtime.mountScheduled()
  let legacyImportCompleted = false
  for (let attempt = 0; attempt < 100; attempt++) {
    legacyImportCompleted = existsSync(join(home, 'settings.yaml.imported'))
      && readFileSync(prepared.profile.patchPath, 'utf8').includes('selectedDefault')
    if (legacyImportCompleted) break
    await new Promise(resolve => setTimeout(resolve, 10))
  }
  if (!legacyImportCompleted) {
    throw new Error('legacy settings import did not complete')
  }
  await ctx.loader.await()

  if (ctx.get('desktopPnpm') === undefined) {
    throw new Error('assembled desktop profile is missing the desktop pnpm Host capability')
  }
  const selection = ctx.agentDefaultModel.currentSelection()
  if (selection.provider !== 'spiritx' || selection.model !== 'DeepSeek-V4-Flash') {
    throw new Error(`assembled profile selected unexpected default model ${selection.provider}/${selection.model}`)
  }
  const providers = ctx.llm.listProviders()
  if (!providers.some(provider => provider.id === 'spiritx' && provider.name === 'SpiritX')
    || providers.some(provider => provider.id === 'deepseek-official')) {
    throw new Error(`assembled profile exposes unexpected model providers: ${JSON.stringify(providers)}`)
  }
  const configurableProviders = ctx.llm.listConfigurableProviders()
  const spiritxDirectory = configurableProviders.find(provider => provider.provider === 'spiritx')
  if (spiritxDirectory?.displayName !== 'SpiritX'
    || spiritxDirectory.declared !== false
    || spiritxDirectory.settingsNs !== 'spiritx') {
    throw new Error(`assembled profile does not present SpiritX as built in: ${JSON.stringify(configurableProviders)}`)
  }
  const officialCatalog = configurableProviders.filter(provider => provider.settingsNs === 'llm-pi-ai')
  if (!officialCatalog.some(provider => provider.provider === 'openai')
    || !officialCatalog.some(provider => provider.provider === 'anthropic')
    || !officialCatalog.some(provider => provider.provider === 'amazon-bedrock')) {
    throw new Error(`assembled profile is missing the official pi-ai provider catalog: ${JSON.stringify(configurableProviders)}`)
  }
  if (new Set(configurableProviders.map(provider => provider.provider)).size !== configurableProviders.length) {
    throw new Error(`assembled profile has duplicate configurable providers: ${JSON.stringify(configurableProviders)}`)
  }
  const spiritxModels = await ctx.llm.listModels('spiritx')
  if (!spiritxModels.some(model => model.id === 'DeepSeek-V4-Flash')) {
    throw new Error(`assembled profile is missing the SpiritX default model: ${JSON.stringify(spiritxModels)}`)
  }
  if (ctx.desktopProfiles.current.name !== 'desktop'
    || ctx.desktopProfiles.current.dir !== prepared.profile.dir) {
    throw new Error('assembled desktop profile service has the wrong active identity')
  }
  const agentPresets = ctx.get('agentPresets')
  if (agentPresets === undefined) {
    throw new Error('assembled Windows profile is missing the agent preset roster')
  }
  const presetIds = (await agentPresets.list()).map(preset => preset.id)
  if (!presetIds.includes('minimal') || !presetIds.includes('standard')) {
    throw new Error(`assembled Windows profile exposes unexpected presets: ${presetIds.join(', ')}`)
  }
  if (agentPresets.defaultId !== 'minimal') {
    throw new Error(`assembled Windows profile selected unexpected default ${agentPresets.defaultId}`)
  }
  const minimalPreset = await agentPresets.resolve('minimal')
  for (const presetId of presetIds) {
    const lease = await agentPresets.acquireScope(presetId)
    try {
      const snapshot = await ctx.skills.snapshot({ scope: lease.key })
      if (presetId === 'cordis'
        && !snapshot.skills.some(skill => skill.name === 'editing-cordis-compositions')) {
        throw new Error('Creator preset mounted but its scoped skills are not visible')
      }
    } finally {
      await lease[Symbol.asyncDispose]()
    }
  }
  if (ctx.get('hmr') !== undefined) {
    throw new Error('Desktop must use generation restarts instead of upstream internal-loader HMR')
  }
  const pluginManager = ctx.get('pluginManager')
  if (pluginManager !== undefined) {
    await pluginManager.listPlugins()
    await pluginManager.listBundles()
    if (ctx.profileContext.packageManager.command !== process.execPath) {
      throw new Error('plugin management must use the application-owned package manager runtime')
    }
  }
  if (minimalPreset.id !== 'minimal') {
    throw new Error(`assembled Windows profile remapped minimal preset to ${minimalPreset.id}`)
  }
  const hostServiceProbe = ctx.get(HOST_SERVICE_PROBE_KEY)
  if (hostServiceProbe?.current?.name !== 'desktop'
    || hostServiceProbe.current.dir !== prepared.profile.dir
    || hostServiceProbe.pnpm?.serviceName !== 'desktopPnpm'
    || hostServiceProbe.pnpm.lookupRun !== 'function'
    || hostServiceProbe.pnpm.run !== 'function') {
    throw new Error(
      `profile-local Host service plugin produced an unexpected probe: ${JSON.stringify(hostServiceProbe)}`,
    )
  }

  const picker = ctx.directoryPicker.capability()
  if (picker.kind !== 'browse') {
    throw new Error(`assembled Windows profile selected ${picker.kind} directory picker`)
  }
  const listing = await picker.list(home)
  if (listing.path !== home) {
    throw new Error(`assembled Windows browse picker listed ${listing.path} instead of ${home}`)
  }

  const expectedUrl = `http://127.0.0.1:${String(ctx.webServer.port)}/?dsh-desktop-mode=advanced&dsh-desktop-platform=win32&dsh-desktop-version=2.0.0&dsh-desktop-material=off&dsh-desktop-mica=1`
  if (mountedSpec?.url !== expectedUrl) {
    throw new Error(`desktop plugin produced an unexpected renderer URL: ${String(mountedSpec?.url)}`)
  }
  if (mountedSpec?.mode !== 'advanced') {
    throw new Error(`desktop plugin produced an unexpected shell mode: ${String(mountedSpec?.mode)}`)
  }
  if (mountedSpec?.rendererAccessHeader !== BROWSER_ACCESS.rendererHeader) {
    throw new Error('assembled profile did not preserve the launcher browser capability')
  }
  if (nativeThemeSource !== 'system') {
    throw new Error(`desktop plugin produced an unexpected native theme source: ${nativeThemeSource}`)
  }
  const desktopSettings = ctx.settings.get(DESKTOP_SETTINGS_NAMESPACE)
  if (desktopSettings?.mode !== 'advanced') {
    throw new Error('assembled Host settings are missing the advanced dsh-desktop mode')
  }
  if (!trayItems.some(item => item.label() === 'Check for Updates…')) {
    throw new Error('assembled desktop profile is missing the update tray command')
  }
  if (process.platform !== 'linux'
    && !trayItems.some(item => item.label() === 'Open DSH Terminal')) {
    throw new Error('assembled desktop profile is missing the terminal tray command')
  }
  const profileMenu = trayItems.find(item => item.label() === 'Profile: desktop')
  if (profileMenu?.submenu?.()[0]?.label() !== 'desktop') {
    throw new Error('assembled desktop profile is missing the active profile tray submenu')
  }
  const unauthenticated = await fetch(expectedUrl, {
    headers: {
      [BROWSER_ACCESS.rendererHeader.name]: BROWSER_ACCESS.rendererHeader.value,
    },
  })
  await unauthenticated.body?.cancel()
  if (unauthenticated.status !== 401) {
    throw new Error(
      `assembled Web root accepted a renderer without browser authentication: HTTP ${String(unauthenticated.status)}`,
    )
  }
  if (typeof mountedSpec?.authenticationUrl !== 'string') {
    throw new Error('desktop plugin did not provide an authentication URL')
  }
  const authenticationUrl = new URL(mountedSpec.authenticationUrl)
  const rendererUrl = new URL(expectedUrl)
  const authenticationTokens = authenticationUrl.searchParams.getAll('token')
  if (authenticationUrl.origin !== rendererUrl.origin
    || authenticationUrl.pathname !== '/'
    || authenticationUrl.hash !== ''
    || [...authenticationUrl.searchParams.keys()].some(key => key !== 'token')
    || authenticationTokens.length !== 1
    || !/^[A-Za-z0-9_-]{43}$/u.test(authenticationTokens[0])) {
    throw new Error(`desktop plugin produced an invalid authentication URL: ${authenticationUrl.href}`)
  }
  const exchange = await fetch(authenticationUrl, {
    headers: {
      [BROWSER_ACCESS.rendererHeader.name]: BROWSER_ACCESS.rendererHeader.value,
    },
    redirect: 'manual',
  })
  await exchange.body?.cancel()
  if (exchange.status !== 303 || exchange.headers.get('location') !== './') {
    throw new Error(
      `browser authentication exchange returned HTTP ${String(exchange.status)} instead of a root redirect`,
    )
  }
  const setCookie = exchange.headers.get('set-cookie')
  const cookie = setCookie?.split(';', 1)[0]
  if (cookie === undefined || cookie.length === 0) {
    throw new Error('browser authentication exchange did not mint a cookie')
  }
  const response = await fetch(expectedUrl, {
    headers: {
      [BROWSER_ACCESS.rendererHeader.name]: BROWSER_ACCESS.rendererHeader.value,
      Cookie: cookie,
    },
  })
  const html = await response.text()
  if (response.status !== 200) {
    throw new Error(`assembled Web root returned HTTP ${String(response.status)}`)
  }
  const bootMatch = html.match(/(?:window\.__DSH_BOOT__|globalThis\["__DSH_BOOT__"\]) = (\{.*?\})<\/script>/u)
  if (bootMatch?.[1] === undefined) {
    throw new Error('assembled Web root is missing window.__DSH_BOOT__')
  }
  const graph = JSON.parse(bootMatch[1])
  const ids = new Set(graph.entries.map(entry => entry.id))
  for (const id of [
    'dsh-plugin-desktop',
    '@deepseek-ai/dsh-client-ui-conversation',
    '@deepseek-ai/dsh-client-ui-sidebar',
    '@deepseek-ai/dsh-client-ui-directory-picker-browse',
  ]) {
    if (!ids.has(id)) {
      throw new Error(
        `assembled advanced Web graph is missing ${id}; received ${[...ids].sort().join(', ')}`,
      )
    }
  }
  for (const id of [
    '@deepseek-ai/dsh-client-ui-layout',
    '@deepseek-ai/dsh-client-ui-directory-picker-native',
  ]) {
    if (ids.has(id)) throw new Error(`assembled advanced Web graph unexpectedly includes ${id}`)
  }
} finally {
  await ctx?.fiber.dispose()
  releasePackageResolver?.()
  pnpmRuntime?.dispose()
  rmSync(home, { recursive: true, force: true })
}
