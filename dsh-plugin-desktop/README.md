# ClawClaw Desktop

[中文](README.zh.md)

`dsh-plugin-desktop` is the ClawClaw Desktop package, version `0.2.0`. It supplies Electron bootstrap, an isolated DSH Host, native windows/tray, profile and pnpm services, workspaces, recovery, updates, Market selection, and the ClawClaw client presentation. Its installed product identity is **ClawClaw** (`com.clawclaw.desktop`).

This package is part of the root pnpm workspace. Do not install it as a standalone npm application: it depends on the root vendored DSH runtime, overrides, patches, sibling Market, and Channels workspace package.

## Runtime model

Electron main starts the Host through `startIsolatedDesktopHost()` by default. `DSH_DESKTOP_ISOLATED_HOST=0` is an in-process diagnostic route. The Host owns Cordis and Web services; Electron main owns native resources. The browser content uses ordinary loopback HTTP/WebSocket and has no general Electron bridge.

The launcher prepares `~/.clawclaw/data` and `~/.clawclaw/workspaces/default` unless saved data-directory configuration, `DSH_HOME`, or safe mode selects another path. A sole legacy `~/.dsh` is moved; two existing roots are preserved without merging.

Compatibility and extended modes isolate desktop chrome from content in separate WebContentsViews on macOS/Windows. Advanced mode uses an integrated presentation. Window/profile changes restart the generation. The public plugin contracts are `./profile-service`, `./pnpm`, and `./client`; see [plugin services](docs/plugin-services.md).

## Commands

Run all commands at repository root:

```sh
corepack pnpm --filter dsh-plugin-desktop run build
corepack pnpm --filter dsh-plugin-desktop run typecheck
corepack pnpm --filter dsh-plugin-desktop run test
corepack pnpm --filter dsh-plugin-desktop run check
corepack pnpm --filter dsh-plugin-desktop run dev
corepack pnpm --filter dsh-plugin-desktop run package:dir
```

Use root shortcuts for the product workflow:

```sh
corepack pnpm dev
corepack pnpm build
corepack pnpm check
```

`dev` is graphical. Build, typecheck, tests, loader/profile/CLI smokes, runtime closure, notices, and reliability checks remain headless-safe.

## Packaging

`package:dir` creates an unpacked host-platform artifact. `dist:mac-smoke` performs unsigned macOS packaging smoke; `dist:mac` is the credentialed macOS release path. `dist:win` and `dist:win-portable` require native Windows x64. Local unsigned artifacts may show Gatekeeper, SmartScreen, or Unknown Publisher warnings and are not release evidence.

All platforms disable ASAR. Packaged application files and dependencies remain physically accessible under `resources/app/` (or `Contents/Resources/app/`) for Host, DSH CLI, pnpm, native modules, and profile fallback. Verify with `check`, then use the platform-specific packaging command on its target OS.

## Updates and releases

The client checks `https://clawclaw.xzinfra.com/updates/stable/release.json`. The manifest must contain a canonical release version and `darwin`/`win32` HTTPS artifacts with `url`, `sha512`, and `size`. The client rejects redirects, verifies the exact artifact size, SHA-512, and the DMG/PE container, and asks the user before handoff. It does not send legacy DSH Desktop statistics headers or verify an independent manifest signature.

Packaged applications check after 60 seconds and then every six hours. Background checks notify once per available version; they never download automatically. Settings and tray actions share one interactive check and download flow. Confirmation is followed by a fresh check: changed releases, failed checks, and download/verification/installer-opening failures receive an explicit result and can be retried through Check for Updates. Cancelling the save dialog or disposing the Host does not show an error.

Manifest reads are limited to 16 KiB before crossing the Host bridge. Cancelled downloads stop pending stream reads and remove partial files; an existing destination is replaced atomically only after validation. macOS opens the DMG for manual replacement; Windows asks before launching the installer and quitting. The upgraded app offers to keep or delete its recorded installer. Download progress, resumable transfers, and unattended installation are not implemented.

Run `verify:notices` after production dependency changes. Current product context is in the root [README](../README.en.md), [architecture](../docs/architecture.en.md), and [user guide](../docs/user-guide.en.md).
