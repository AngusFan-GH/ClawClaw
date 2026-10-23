# ClawClaw Desktop

[中文](README.zh.md)

`dsh-plugin-desktop` is the ClawClaw Desktop package, version `0.2.11`. It supplies Electron bootstrap, an isolated DSH Host, native windows/tray, profile and pnpm services, workspaces, recovery, updates, Market selection, and the ClawClaw client presentation. Its installed product identity is **ClawClaw** (`com.clawclaw.desktop`).

This package is part of the root pnpm workspace. Do not install it as a standalone npm application: it depends on the root vendored DSH runtime, overrides, patches, sibling Market, and Channels workspace package.

## Runtime model

Electron main starts the Host through `startIsolatedDesktopHost()` by default. `DSH_DESKTOP_ISOLATED_HOST=0` is an in-process diagnostic route. The Host owns Cordis and Web services; Electron main owns native resources. The browser content uses ordinary loopback HTTP/WebSocket and has no general Electron bridge.

The launcher prepares `~/.clawclaw/data` and `~/.clawclaw/workspaces/default` unless saved data-directory configuration, `CLAWCLAW_HOME`, or safe mode selects another path. It never reads, moves, or modifies another application's `~/.dsh` data.

ClawClaw keeps a product default Workspace registered across launches and protects it from deletion; existing user titles are preserved. Session creation, Agent presets, draft initialization, and current/recent Workspace selection use the upstream navigation service unchanged. The Desktop directory picker follows the Workspace of the main-view Session, including restored and historical Sessions, and falls back to its saved location or the product default when no grouped Session is selected. Expert and team creation prepare an editable request without submitting it; superseded navigation keeps Settings open and stops watching that creation attempt.

ClawClaw discovers user Skills from `<CLAWCLAW_HOME>/skills` (by default `~/.clawclaw/data/skills`) and project Skills from the selected Workspace's `.clawclaw/skills`. It does not scan `.dsh/skills`, `.agents/skills`, `.codex/skills`, or other applications' Skill directories by default. Users may explicitly add read-only scan directories from the Skills page; those paths remain ClawClaw-owned configuration and never alter the external files.

Compatibility and extended modes isolate desktop chrome from content in separate WebContentsViews on macOS/Windows. Advanced mode uses an integrated presentation. Window/profile changes restart the generation. The public plugin contracts are `./profile-service`, `./pnpm`, and `./client`; see [plugin services](docs/plugin-services.md).

ClawClaw skips the upstream preview notice during first-run onboarding. SpiritX API-key setup and the Models settings page remain available.

Sandboxed Electron preloads are built as independent bundles without local chunk imports. The runtime-closure gate executes both preload artifacts with sandbox-compatible module loading.

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

## Complete build and release procedure

### 1. Prepare a checkout

Use Node.js `^22.19.0` or `>=24.0.0`, Corepack, Git, and the root pnpm `11.8.0`. Run from the repository root:

```sh
git submodule update --init --recursive
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run upstream:prepare-runtime
corepack pnpm install --frozen-lockfile
```

The second install refreshes the desktop links after the pinned upstream runtime has been prepared. Never edit `deepseek-harness/` from a desktop feature branch.

### 2. Run the release gate

```sh
corepack pnpm check
```

Do not package or tag a release until this command passes. It covers the owned packages, type checking, unit tests, runtime closure, Loader/profile/CLI smokes, licenses, operations, documentation consistency, and the pinned upstream layout.

### 3. Build locally when needed

On native macOS:

```sh
corepack pnpm --filter dsh-plugin-desktop run dist:mac
```

Output: `dsh-plugin-desktop/dist/mac-smoke/ClawClaw-<version>-universal.dmg`.

On native Windows x64, from PowerShell or Command Prompt:

```sh
corepack pnpm --filter dsh-plugin-desktop run dist:win
```

Output: `dsh-plugin-desktop/dist/ClawClaw-<version>-x64-Setup.exe`.

Both commands run their platform package gate, prepare native modules for Electron, build an unsigned installer, and smoke-test the packaged runtime. Native modules make local cross-platform packaging unsupported; use GitHub Actions when both artifacts are required.

### 4. Configure publishing once

GitHub archives use the `github-release` environment and `GITHUB_TOKEN`. Deploy explicitly from a workstation on the company network using `corepack pnpm deploy:run <GitHub-run-id>`. See [Packaging and releases](../docs/github-packaging.en.md).

Use a dedicated non-root SSH account for server publication. Store the following settings in the Git-ignored `.env.server.local`:

```text
UPDATE_HOST             SSH hostname or IP of the company update server
UPDATE_USER             dedicated non-root release account
UPDATE_PORT             SSH port, default 22, not download port 9528
UPDATE_REMOTE_ROOT      /data/clawclaw/public
UPDATE_SSH_KEY_FILE     local path to the dedicated private key
UPDATE_SSH_KNOWN_HOSTS_FILE  path to independently verified known_hosts
```

Downloads use HTTPS 9528. Version directories and the feed reside at `/data/clawclaw/public/releases/dsh/<version>/` and `/data/clawclaw/public/updates/dsh/stable/release.json`. Keep SSH host-key verification enabled; keys, passwords, and certificate private keys do not belong in Git.

### 5. Run a non-publishing prebuild

Push the release commit, then build and assemble without touching the server:

```sh
git push origin dsh-desktop
run_url="$(gh workflow run release.yml --repo AngusFan-GH/ClawClaw --ref dsh-desktop -f publish=false)"
run_id="${run_url##*/}"
gh run watch "$run_id" --repo AngusFan-GH/ClawClaw --exit-status
gh run download "$run_id" --repo AngusFan-GH/ClawClaw --name desktop-release --dir release
```

Require `Build macos`, `Build windows`, and `Assemble release` to succeed on the same commit. Download `desktop-release` from that run and verify that it contains one DMG, one EXE, `release.json`, and `build-info.json`. The manifest version, sizes, and SHA-512 values must match the two installers.

### 6. Publish a version

Update `dsh-plugin-desktop/package.json` and the root README version text together, run the complete gate, commit, and repeat the non-publishing prebuild. Then tag that exact validated commit:

```sh
version=0.2.11
git tag -a "clawclaw-v$version" -m "Release ClawClaw $version"
git push origin "clawclaw-v$version"
```

The tag must exactly match the desktop package version. A matching tag rebuilds macOS and Windows from the same commit, assembles `desktop-release`, and publishes to GitHub Releases; a separate local deployment command uploads both installers and atomically switches the feed before public verification. Never reuse or move a published version tag.

### 7. Verify the publication

After the local deployment command completes upload and public verification, check the workflow and public manifest before announcing the release:

```sh
gh run list --repo AngusFan-GH/ClawClaw --workflow release.yml --limit 3
curl --fail --show-error --silent \
  https://clawclaw.xzinfra.com:9528/updates/dsh/stable/release.json
```

Confirm that the manifest reports the intended version and `stable` channel, both installer URLs return HTTP 200, their `Content-Length` values match, and the server files match the manifest SHA-512 values. `release.json` is the only update pointer; do not add `latest.yml` compatibility files.

### 8. Recover a failed deployment

If both builds and `Assemble release` succeeded but deployment failed, download that run's `desktop-release`; do not combine artifacts from different commits or rebuild only one platform. Load the dedicated key into an SSH agent, set `UPDATE_HOST`, `UPDATE_USER`, `UPDATE_PORT`, and `UPDATE_REMOTE_ROOT`, then run:

```sh
corepack pnpm run upload:update -- --directory /path/to/desktop-release --channel stable
```

The uploader validates the installers, manifest, and optional provenance, refuses to overwrite an existing version archive, uploads installers before the manifest, and cleans its staging paths on failure. Investigate an existing `/releases/dsh/<version>/` instead of deleting it or forcing a second publication.

## Updates and releases

DSH Desktop uses `https://clawclaw.xzinfra.com:9528/updates/dsh/stable/` and consumes only `release.json` from that directory. The manifest declares HTTPS URLs, sizes, and SHA-512 digests for the Windows NSIS installer and macOS Universal DMG. DSH Desktop does not consume `latest.yml`, `latest-mac.yml`, or the earlier OpenClaw `/updates/stable/` feed.

This endpoint migration requires 0.2.8–0.2.10 users to manually install the new client using 9528 once, then receive automatic updates. 0.2.11 is live; earlier same-version trials using 443 require a manual installation of the latest package. Subsequent formal versions must be at least 0.2.12; never replace a published version. Older versions are outside compatibility validation.

Packaged applications check after 60 seconds and then every six hours. Background checks notify once per available version; they never download automatically. Settings and tray actions share one interactive check and download flow. After confirmation, the application re-reads `release.json`, downloads into its private update directory, and verifies declared size, SHA-512, and the DMG/PE container while showing progress. Windows starts NSIS only after a second confirmation and successful Host shutdown. macOS opens the DMG so the user can quit the running application and replace it in Applications.

Manifest reads are limited to 16 KiB before crossing the Host bridge. Windows publishes an unsigned NSIS installer and macOS publishes an unsigned Universal DMG; one `release.json` describes both. The uploader recalculates SHA-512 and size from the actual installers, retains a versioned copy, uploads installers first, and atomically switches `release.json` last. Resumable transfers are not implemented.

The GitHub Actions `Release ClawClaw Desktop` workflow builds both installers from the same commit on hosted macOS and Windows runners. A `clawclaw-v<version>` tag must exactly match `dsh-plugin-desktop/package.json`; a matching tag publishes automatically. Manual dispatch builds and assembles by default, and publishes only when its `publish` input is selected. Official archives use the `github-release` GitHub environment. Daily CI performs checks without producing installers; server publication remains separate.

The dedicated non-root release account needs write access to `/data/clawclaw/public`. Local deployment downloads one successful packaging run, validates provenance and canonical URLs, uploads over LAN SSH, switches the feed last, and verifies public checksums. No timer or public SSH mapping is required.

Run `verify:notices` after production dependency changes. Current product context is in the root [README](../README.en.md), [architecture](../docs/architecture.en.md), and [user guide](../docs/user-guide.en.md).
