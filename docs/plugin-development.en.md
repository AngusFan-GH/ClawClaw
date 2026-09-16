# ClawClaw plugin development

[中文](plugin-development.md)

Ordinary DSH plugins should prefer upstream public contracts so they run in CLI, ordinary Web profiles, and ClawClaw. Depend on ClawClaw contracts only when desktop capabilities are necessary. Fabric RFCs are design discussions, not current packages, schemas, or loader dependencies.

## Lifecycle

Every profile boot and presentation-mode switch creates a Host generation. Host/Client services, process handles, and profile paths are valid only for that generation. Cancel subprocesses, unsubscribe, and discard references in Cordis effect cleanup. Do not infer the active profile from argv, URL, `DSH_HOME`, or settings.

## Desktop Host services

Import types from the appropriate channel package: Stable is `dsh-plugin-desktop/*`; Beta is `dsh-plugin-desktop-beta/*`. Do not mix them in one bundle.

```ts
import type { Context } from '@deepseek-ai/cordis'
import type {} from 'dsh-plugin-desktop/profile-service'
import type { DesktopPnpmHandle } from 'dsh-plugin-desktop/pnpm'

export const inject = ['desktopProfiles', 'desktopPnpm']

export function apply(ctx: Context) {
  const profile = ctx.desktopProfiles.current
  let operation: DesktopPnpmHandle | undefined

  async function add(packageName: string) {
    operation = ctx.desktopPnpm.run(['add', '--save-exact', packageName])
    operation.stdout.resume()
    operation.stderr.resume()
    const result = await operation.done
    if (result.exitCode !== 0 || result.signal !== null) throw new Error('pnpm operation failed')
  }

  ctx.effect(() => () => {
    operation?.cancel()
  }, `example plugin for ${profile.name}`)
}
```

`desktopProfiles.current` exposes immutable active-profile name and absolute directory. `list()` is read-only discovery; `create()`, `prepareSelection()`, `select()`, `canDelete()`, and `delete()` go through the launcher boundary. `select()` performs an orderly restart. See the [Stable contract](../dsh-plugin-desktop/docs/plugin-services.md) or its Beta counterpart for exact signatures.

`desktopPnpm` methods are:

| Method | Purpose |
| --- | --- |
| `run(argv, signal?)` | Runs bundled pnpm in the active-profile directory. The caller owns npm target policy, bundle reconciliation, progress, and validation. |
| `runPlugin(argv, invokingDir, signal?)` | Uses bundled `dsh plugin --profile <active>` for ordinary plugin management semantics. |
| `runExternalMarketPluginInstall(...)` | A restricted exact-version `add` adapter only for bundled `dshmarket` compatibility. |

There is no `installPlugin()`, installation receipt, automatic retry, snapshot, or rollback. Each generation permits one package operation. Read stdout/stderr, set timeouts, check `exitCode` and `signal`, and call `cancel()` then await `done` during disposal. Pass argv; never construct shell strings.

## Supporting ordinary DSH too

Do not declare Desktop services in top-level required `inject`. Detect them, then mount the adapter in nested injection:

```ts
export const inject = ['webServer']

export function apply(ctx: Context) {
  if (ctx.get('desktopProfiles') === undefined) {
    mountOrdinaryDsh(ctx)
    return
  }
  ctx.inject(['desktopProfiles', 'desktopPnpm'], desktop => {
    desktop.effect(() => mountDesktopAdapter(desktop), 'desktop adapter')
  })
}
```

The plugin owns its ordinary DSH fallback. Renderers cannot use Host services directly; browser UI uses routes, RPC, client services, and slots.

## Client service

Browser plugins can type-only import `dsh-plugin-desktop/client` (or Beta) and inject `desktopWindow`. It exposes immutable generation-local mode, platform, effective material, and geometry, not Electron controls. Content WebContentsViews in compatibility/extended modes already sit below isolated Chrome, so both `safeAreaInsets.top` and `dragRegion.height` are `0`; plugins must not add toolbar spacing. Only advanced mode reports integrated caption geometry.

## Private implementation

`desktopRuntime`, `desktopPnpmBootstrap`, Electron APIs, Host RPC, BrowserWindow, tray, bundled Node shims, internal resolvers, and installers are private implementation. Their presence at runtime or in declarations does not create a compatibility promise.

Test separately in ordinary DSH and the target ClawClaw channel. Shared Desktop work also requires `corepack pnpm check:desktop-variants`.
