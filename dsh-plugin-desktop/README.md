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

`package:dir` creates an unpacked host-platform artifact. `dist:mac` builds the unsigned Universal DMG; `dist:win` and `dist:win-portable` require native Windows x64. Unsigned artifacts may show Gatekeeper, SmartScreen, or Unknown Publisher warnings.

Both platform commands deliberately remove signing and notarization credentials, producing an unsigned NSIS installer and Universal DMG. Windows may show SmartScreen/Unknown Publisher and macOS may require approval in Privacy & Security. These prompts are part of the distribution model; SHA-512 integrity checks do not authenticate an operating-system publisher.

All platforms disable ASAR. Packaged application files and dependencies remain physically accessible under `resources/app/` (or `Contents/Resources/app/`) for Host, DSH CLI, pnpm, native modules, and profile fallback. Verify with `check`, then use the platform-specific packaging command on its target OS.

## Updates and releases

DSH Desktop uses `https://clawclaw.xzinfra.com/updates/dsh/stable/` and consumes only `release.json` from that directory. The manifest declares HTTPS URLs, sizes, and SHA-512 digests for the Windows NSIS installer and macOS Universal DMG. DSH Desktop does not consume `latest.yml`, `latest-mac.yml`, or the earlier OpenClaw `/updates/stable/` feed.

Packaged applications check after 60 seconds and then every six hours. Background checks notify once per available version; they never download automatically. Settings and tray actions share one interactive check and download flow. After confirmation, the application re-reads `release.json`, downloads into its private update directory, and verifies declared size, SHA-512, and the DMG/PE container while showing progress. Windows starts NSIS only after a second confirmation and successful Host shutdown. macOS opens the DMG so the user can quit the running application and replace it in Applications.

Manifest reads are limited to 16 KiB before crossing the Host bridge. Windows publishes an unsigned NSIS installer and macOS publishes an unsigned Universal DMG; one `release.json` describes both. The uploader recalculates SHA-512 and size from the actual installers, retains a versioned copy, uploads installers first, and atomically switches `release.json` last. Resumable transfers are not implemented.

The GitHub Actions `Release ClawClaw Desktop` workflow builds both installers from the same commit on hosted macOS and Windows runners. A `clawclaw-v<version>` tag must exactly match `dsh-plugin-desktop/package.json`; a matching tag publishes automatically. Manual dispatch builds and assembles by default, and publishes only when its `publish` input is selected. Configure the `stable-update` GitHub environment with `UPDATE_SSH_PRIVATE_KEY` and `UPDATE_KNOWN_HOSTS` secrets. Configure repository variables `UPDATE_HOST` and `UPDATE_USER`; optional repository variables are `UPDATE_PORT`, `UPDATE_REMOTE_ROOT`, and `UPDATE_BASE_URL`.

The update-origin account should be a dedicated non-root SSH user with write access to the configured remote root. After that one-time server setup, GitHub performs routine releases without an interactive server login. To publish a prepared `release/` directory manually, use an SSH agent and load the ignored `.env.server.local` file before running `pnpm run upload:update -- --directory release --channel stable`. Password-based `sshpass` publishing is intentionally unsupported. Before transfer, the command checks the version, HTTPS URLs, file sizes, and SHA-512 digests against both installers. It refuses to overwrite an existing `/releases/dsh/<version>/`, uploads installers first, and switches the manifest last.

Run `verify:notices` after production dependency changes. Current product context is in the root [README](../README.en.md), [architecture](../docs/architecture.en.md), and [user guide](../docs/user-guide.en.md).
