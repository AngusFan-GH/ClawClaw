# ClawClaw Desktop Beta

[中文](README.zh.md)

`dsh-plugin-desktop-beta` is the Beta ClawClaw Desktop package, version `0.2.1-beta.1`. It supplies Electron bootstrap, an isolated DSH Host, native windows/tray, profile and pnpm services, workspaces, recovery, updates, Market selection, and the ClawClaw client presentation. Its installed product identity is **ClawClaw Beta** (`com.clawclaw.desktop.beta`).

This package is part of the root pnpm workspace. Do not install it as a standalone npm application: it depends on the root vendored DSH runtime, overrides, patches, sibling Market, and Channels workspace package.

## Runtime model

Electron main starts the Host through `startIsolatedDesktopHost()` by default. `DSH_DESKTOP_ISOLATED_HOST=0` is an in-process diagnostic route. The Host owns Cordis and Web services; Electron main owns native resources. The browser content uses ordinary loopback HTTP/WebSocket and has no general Electron bridge.

The launcher prepares `~/.clawclaw/data` and `~/.clawclaw/workspaces/default` unless saved data-directory configuration, `DSH_HOME`, or safe mode selects another path. A sole legacy `~/.dsh` is moved; two existing roots are preserved without merging. Stable and Beta have separate Electron user-data, but share default Harness data and workspace.

Compatibility and extended modes isolate desktop chrome from content in separate WebContentsViews on macOS/Windows. Advanced mode uses an integrated presentation. Window/profile changes restart the generation. The public plugin contracts are `./profile-service`, `./pnpm`, and `./client`; see [plugin services](docs/plugin-services.md).

## Commands

Run all commands at repository root:

```sh
corepack pnpm --filter dsh-plugin-desktop-beta run build
corepack pnpm --filter dsh-plugin-desktop-beta run typecheck
corepack pnpm --filter dsh-plugin-desktop-beta run test
corepack pnpm --filter dsh-plugin-desktop-beta run check
corepack pnpm --filter dsh-plugin-desktop-beta run dev
corepack pnpm --filter dsh-plugin-desktop-beta run package:dir
```

Use root shortcuts for the product workflow:

```sh
corepack pnpm dev:beta
corepack pnpm build
corepack pnpm check
corepack pnpm check:desktop-variants
```

`dev` is graphical. Build, typecheck, tests, loader/profile/CLI smokes, runtime closure, notices, and reliability checks remain headless-safe.

## Packaging

`package:dir` creates an unpacked host-platform artifact. `dist:mac-smoke` performs unsigned macOS packaging smoke; `dist:mac` is the credentialed macOS release path. `dist:win` and `dist:win-portable` require native Windows x64. Local unsigned artifacts may show Gatekeeper, SmartScreen, or Unknown Publisher warnings and are not release evidence.

All platforms disable ASAR. Packaged application files and dependencies remain physically accessible under `resources/app/` (or `Contents/Resources/app/`) for Host, DSH CLI, pnpm, native modules, and profile fallback. Verify with `check`, then use the platform-specific packaging command on its target OS.

## Updates and releases

The Beta client checks `https://clawclaw.xzinfra.com/updates/beta/release.json` and accepts only canonical `-beta.N` versions. Installing Stable is a separate user action. Manifests must include matching channel and `darwin`/`win32` HTTPS artifacts with `url`, `sha512`, and `size`. The client rejects redirects, verifies SHA-512 and the DMG/PE container, and asks the user before handoff. It does not send legacy DSH Desktop statistics headers or verify an independent manifest signature.

Develop and validate shared Desktop behavior here first, then synchronize it into Stable and run `corepack pnpm check:desktop-variants`. Run `verify:notices` after production dependency changes. Current product context is in the root [README](../README.en.md), [architecture](../docs/architecture.en.md), and [user guide](../docs/user-guide.en.md).
