import { defineConfig } from 'tsdown'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

const PACKAGE_NAME = 'dsh-plugin-desktop'
const PRODUCT_VERSION = (JSON.parse(
  readFileSync(new URL('./package.json', import.meta.url), 'utf8'),
) as { version?: unknown }).version
if (typeof PRODUCT_VERSION !== 'string') {
  throw new Error('dsh-plugin-desktop package.json has no product version')
}
const PLUGIN_MANAGER_MODULE_ID = 'clawclaw:plugin-manager-client'
const RESOLVED_PLUGIN_MANAGER_MODULE_ID = `\0${PLUGIN_MANAGER_MODULE_ID}`
const localRequire = createRequire(import.meta.url)
const pluginManagerClientPath = localRequire.resolve(
  '@deepseek-ai/dsh-client-ui-plugin-manager/client',
)

function publishedPluginManagerClient() {
  return {
    name: 'clawclaw-published-plugin-manager-client',
    resolveId(source: string) {
      return source === PLUGIN_MANAGER_MODULE_ID ? RESOLVED_PLUGIN_MANAGER_MODULE_ID : null
    },
    async load(id: string) {
      if (id !== RESOLVED_PLUGIN_MANAGER_MODULE_ID) return null
      this.addWatchFile(pluginManagerClientPath)
      const artifact = await readFile(pluginManagerClientPath, 'utf8')
      const match = artifact.match(
        /^window\.__ModuleLoader__\.load\(\{\s*id:\s*["']@deepseek-ai\/dsh-client-ui-plugin-manager["'],\s*factory:\s*((?:\(require\)|require)\s*=>\s*\{[\s\S]*\})\s*\}\);\s*(?:\/\/# sourceMappingURL=.*)?\s*$/,
      )
      if (match?.[1] === undefined) {
        throw new Error(`Unexpected published Plugins client wrapper: ${pluginManagerClientPath}`)
      }
      return `export default ${match[1]};`
    },
  }
}

export default defineConfig([
  {
    name: PACKAGE_NAME,
    entry: {
      index: 'src/index.ts',
      'module-resolution': 'src/module-resolution.ts',
      webserver: 'src/webserver.ts',
      profile: 'src/profile.ts',
      'setup-wizard-settings': 'src/setup-wizard-settings.ts',
      'profile-manager': 'src/profile-manager.ts',
      'profile-service': 'src/profile-service.ts',
      'desktop-plugins': 'src/desktop-plugins.ts',
      pnpm: 'src/pnpm.ts',
      profiles: 'src/profiles.ts',
      diagnostics: 'src/diagnostics.ts',
      notifications: 'src/notifications.ts',
      'cron-tasks': 'src/cron-tasks.ts',
      reminders: 'src/reminders.ts',
      'shortcut-menu': 'src/shortcut-menu.ts',
      'plugin-registry-probe': 'src/plugin-registry-probe.ts',
      'default-workspace': 'src/default-workspace.ts',
      skills: 'src/skills.ts',
      experts: 'src/experts.ts',
      'legacy-agent-presets': 'src/legacy-agent-presets.ts',
      mcp: 'src/mcp.ts',
      spiritx: 'src/spiritx.ts',
      'diagnostic-export-worker': 'src/diagnostic-export-worker.ts',
      'packaged-runtime-smoke': 'src/packaged-runtime-smoke.ts',
      runtime: 'src/runtime.ts',
      'electron-runtime': 'src/electron-runtime.ts',
      'desktop-runtime-environment': 'src/desktop-runtime-environment.ts',
      'desktop-terminal': 'src/desktop-terminal.ts',
      'desktop-cli': 'src/desktop-cli.ts',
      terminal: 'src/terminal.ts',
      'update-checker': 'src/update-checker.ts',
      'update-download': 'src/update-download.ts',
      updates: 'src/updates.ts',
      'windows-pwsh-sandbox': 'src/windows-pwsh-sandbox.ts',
      'windows-acl-runner': 'src/windows-acl-runner.ts',
      main: 'src/main.ts',
      'host-process-entry': 'src/host-process-entry.ts',
    },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
  },
  {
    name: `${PACKAGE_NAME}/bin`,
    entry: { bin: 'src/bin.ts' },
    outDir: 'lib',
    format: 'esm',
    platform: 'node',
    target: 'es2024',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    outputOptions: {
      banner: '#!/usr/bin/env node',
    },
  },
  {
    name: `${PACKAGE_NAME}/client`,
    entry: { client: 'src/client/index.ts' },
    tsconfig: 'tsconfig.client.json',
    outDir: 'lib',
    format: 'cjs',
    platform: 'browser',
    target: 'es2022',
    define: {
      'process.env.NODE_ENV': JSON.stringify('production'),
      'process.env.DSH_DESKTOP_PRODUCT_VERSION': JSON.stringify(PRODUCT_VERSION),
    },
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    plugins: [publishedPluginManagerClient()],
    external: [
      'react',
      'react/jsx-runtime',
      'react-dom',
      'react-dom/client',
      '@deepseek-ai/cordis',
      '@deepseek-ai/dsh-client-ui-slots',
      '@deepseek-ai/dsh-client-ui-renderer',
      '@deepseek-ai/dsh-client-ui-primitives',
    ],
    noExternal: (id: string) => id.startsWith('@deepseek-ai/') ? undefined : true,
    outputOptions: {
      entryFileNames: 'client.js',
      banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(PACKAGE_NAME)}, factory: (require) => {`,
      footer: 'return module.exports; } });',
      intro: 'var module = { exports: {} }; var exports = module.exports;',
    },
  },
  {
    name: `${PACKAGE_NAME}/preload`,
    entry: { preload: 'src/preload.ts', 'compatibility-preload': 'src/compatibility-preload.ts' },
    outDir: 'lib',
    format: 'cjs',
    platform: 'node',
    target: 'es2022',
    fixedExtension: false,
    dts: false,
    clean: false,
    sourcemap: true,
    external: ['electron'],
    outputOptions: {
      entryFileNames: '[name].cjs',
    },
  },
])
