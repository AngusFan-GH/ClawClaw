# Windows Installer Redesign

## Product Goal

ClawClaw should feel like a modern desktop product from the first double-click.
The Windows installer must be simple for normal users, transparent for power
users, and conservative with local AI agent data.

The target experience is a branded one-page installer with an expandable custom
section, plus a maintenance/uninstall flow that clearly separates application
files from user data.

## Target User Flow

### Fresh Install

1. User opens `ClawClaw-Setup-v<version>-<arch>.exe`.
2. The first screen shows the product identity, version, install location, and a
   primary "Install" action.
3. "Custom install" expands advanced options:
   - install directory
   - desktop shortcut
   - launch at startup
   - install OpenClaw CLI into user PATH
4. The progress screen shows concrete steps:
   - prepare install directory
   - check old ClawClaw processes
   - copy application files
   - install bundled OpenClaw runtime
   - create shortcuts
   - configure OpenClaw CLI
5. The completion screen defaults to "Launch ClawClaw".

### Upgrade

1. Installer detects the existing installation from the current NSIS registry
   keys.
2. If the install scope and directory match, use in-place managed upgrade.
3. If an old installer must run, invoke it silently first.
4. If silent uninstall fails, fall back to the legacy interactive uninstaller.
5. Preserve all user data by default.
6. Clean stale runtime trees before copying new files:
   - `resources/openclaw`
   - `resources/openclaw-plugins`
   - legacy `resources/bin` and `resources/cli` for versions `<= 0.1.15`

### Uninstall

The uninstall/maintenance UI must default to deleting only application files.
Optional data removal is explicit:

- ClawClaw settings, cache, and logs
- OpenClaw user data under `~/.openclaw`
- cache and temporary files

The copy must explain that OpenClaw data can contain agents, channels,
credentials, skills, workspaces, sessions, and runtime state.

## Compatibility Requirements

Compatibility is handled as migration, not as a permanent fallback strategy.
The new installer core owns install, upgrade, uninstall, registry, shortcuts,
PATH, process handling, and data cleanup.

Must migrate from existing installations:

- current NSIS registry keys and uninstall registry keys
- current-user install scope
- previous install location
- previous desktop/start-menu shortcut state where detectable
- old OpenClaw Gateway service/task state
- old CLI PATH entry
- stale runtime layouts used by versions `<= 0.1.15`

Must not preserve as a long-term architecture:

- NSIS UI pages
- old interactive uninstall as the main recovery path
- duplicate install logic split across `.nsh` files
- product decisions hidden inside installer template macros

## Architecture

### Phase 1: Installer Core + UI Prototype

Add a separate installer package with a typed core. The core produces an
explicit plan for install, upgrade, and uninstall. UI renders that plan and the
runner executes it.

```text
packages/windows-installer
  src/
    App.tsx
    core/
      plan.ts
      types.ts
    installer-model.ts
    installer-copy.ts
    main.css
```

The phase-1 UI is static, but the domain model is not throwaway: the same plan
objects should drive the future Windows runner.

### Phase 2: Launcher

Create a small Windows installer launcher:

```text
ClawClaw-Setup-v<version>-<arch>.exe
  -> branded UI
  -> evaluates installer-core plan
  -> executes installer-core steps
  -> shows failure recovery actions
```

The launcher should consume a manifest produced by packaging:

```json
{
  "version": "0.1.17",
  "arch": "x64",
  "payload": "ClawClaw-v0.1.17-x64.payload",
  "backend": "clawclaw-installer-core",
  "manifestVersion": 1
}
```

### Phase 3: Remove NSIS From The User Path

The user-visible installer and uninstaller should no longer use NSIS pages.
The old NSIS product-flow overrides have been removed from the repository; any
future Windows installer work should extend the installer core instead of
reintroducing `.nsh` product logic.

## Engineering Milestones

1. Add `packages/windows-installer` UI package.
2. Add installer-core plan model for install, upgrade, and uninstall.
3. Add package scripts for local UI development and static build.
4. Add a Windows installer manifest format.
5. Build a launcher that executes installer-core steps.
6. Replace the Add/Remove Programs uninstall entry with the maintenance
   launcher.
7. Implement the native runner for the installer-core plan.

## Verification

Local checks:

```bash
pnpm run installer:win:typecheck
pnpm run installer:win:prepare
pnpm run installer:win:shell:pack # Windows host only
pnpm run typecheck
```

After `pnpm package:win`, inspect:

```bash
ls release/windows-installer
node release/windows-installer/runner/runner/cli.js --mode=upgrade --legacy-version=0.1.15
node release/windows-installer/runner/runner/cli.js --mode=uninstall --remove-openclaw-data
```

Expected output: the runner prints a concrete installer-core plan and marks
destructive cleanup steps with `!`.

Real execution is intentionally gated:

```bash
node release/windows-installer/runner/runner/cli.js --mode=upgrade --legacy-version=0.1.15 --execute
```

`--execute` only runs on Windows. Do not pass destructive data flags such as
`--remove-openclaw-data` unless you are testing in a disposable Windows user
profile or VM.

## Release Strategy

The first release with the custom installer should write compatible
registry/uninstall metadata, but the values should point at the new maintenance
launcher. `QuietUninstallString` should use the new runner's silent mode.

Old NSIS installations are treated as import targets. The new runner reads their
registry entries, migrates the install state, performs managed cleanup, and then
continues with the new install plan.
