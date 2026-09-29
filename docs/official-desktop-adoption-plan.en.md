# ClawClaw Official Desktop Adoption Guide

[中文](official-desktop-adoption-plan.md)

## 1. Purpose and baseline

This guide directs selective adoption from the official DeepSeek Harness Desktop while keeping ClawClaw a fully independent desktop shell. It is both the implementation sequence and the acceptance checklist.

- ClawClaw baseline: the `dsh-desktop` branch, product version `0.2.2`.
- Runtime baseline: the read-only submodule and vendored runtime are DSH `0.1.7-rc.2`.
- Official baseline reviewed: `deepseek-ai/deepseek-harness` `master` at `21638c5631` (2026-09-27).
- Official reference directory: `apps/desktop/`. Upstream is MIT licensed; substantial source reuse must preserve required attribution and notices.

This is not a plan to synchronize the upstream Desktop. Upstream is a behavioral and testing reference; `dsh-plugin-desktop/` continues to own all product code.

## 2. Inviolable architecture boundaries

These constraints take precedence over upstream implementations:

1. `deepseek-harness/` is a pinned, read-only submodule and must not be edited by Desktop feature branches.
2. ClawClaw continues to own branding, Market, Channels, Profiles, client plugins, Electron bootstrap, packaging, and releases.
3. Compatibility mode runs the default upstream client without overrides. Advanced presentation uses ClawClaw Profile composition and documented slot/service replacement.
4. The trust boundaries among main, the isolated Host utility process, and renderer stay intact. New capabilities cross them through private typed RPC.
5. `asar: false`, the vendored DSH runtime, and dual `WebContentsView` modes are intentional and do not change to follow upstream layout.
6. GUI launch remains explicit. Build, typecheck, unit tests, and Loader smokes remain headless-safe.
7. An upstream submodule pin update is always committed separately from ClawClaw behavior.

## 3. Current capability inventory

ClawClaw already provides the following capabilities, so equivalent systems will not be ported again:

| Capability | Current ClawClaw implementation | Decision |
| --- | --- | --- |
| Host isolation and private RPC | `host-process.ts`, `host-process-entry.ts`, `host-rpc.ts` | Keep |
| Single-instance and second-instance activation | `main.ts` | Keep |
| Hide-on-close and tray residency | `electron-shell-generation.ts`, `electron-runtime.ts` | Keep |
| Update checks and artifact validation | `update-lifecycle.ts`, `update-download.ts` | Harden incrementally |
| Graceful Host shutdown | `shutdown.ts`, `startup-generation.ts` | Extend inspection, do not replace |
| Abnormal-run marker, bounded logs, diagnostics export | `crash-evidence.ts`, `log-files.ts` | Harden incrementally |
| Cron Tasks and reminders | ClawClaw-owned controllers and client plugins | Include in quit inspection |
| Windows NSIS and macOS Universal DMG | package/release scripts | Keep unsigned and harden structural validation |

## 4. Adoption classification

### 4.1 Adaptable implementations

| Official reference | Behavior to adopt | ClawClaw destination |
| --- | --- | --- |
| `quit-confirmation.ts` | Pre-quit inspection, conservative fallback, request coalescing, ownerless native dialog | New interruption snapshot and confirmation integrated with shutdown |
| `update-schedule.ts` | Monotonic clock, jitter, exponential backoff, in-flight joining | Extend periodic scheduling in `update-lifecycle.ts` |
| Update download behavior | Private storage, progress, size/digest/container validation, and safe installer handoff | Extend `update-download.ts` and the Electron runtime |
| `crash-report.ts` | Structured, bounded, atomically written fatal reports | Extend existing crash evidence without upload |
| `update-journal.ts` | Local opt-in update qualification journal | Add an opt-in local journal |
| installer tests | Installation transaction, failed rollback, uninstall preservation/removal boundaries | Expand the ClawClaw NSIS test matrix |
| `background-notice.ts`, `update-attention.ts` | First background-residency notice and update-ready attention | Use ClawClaw locale/tray/window APIs |

“Adapt” means copying the behavioral contract rather than the directory layout. Every implementation must use ClawClaw lifecycle, locale, settings, and test facilities.

### 4.2 Explicit non-goals

- DeepSeek account, Platform sign-in, or official cloud-service coupling.
- The official mandatory-update `40005` protocol and its product policy.
- DeepSeek analytics, COS publishing, or internal deployment workflows.
- The `dsh-app://` shell architecture or wholesale replacement with the official window/client.
- Official ASAR and runtime-resolution layout.
- SafeNet-specific signing orchestration.
- Native auto-update frameworks and their `latest.yml`, `latest-mac.yml`, and blockmap protocols.

Any future need for these requires a separate design record; it cannot enter as incidental scope in this plan.

## 5. Delivery phases

Statuses are `Not started`, `In progress`, `Complete`, or `Blocked`. A phase becomes complete only after code, automated tests, and this acceptance record are all updated.

### Phase 1 (P0): interruption inspection before quit and update installation

**Status: Complete (2026-09-28)**

Goal: quit silently when no work can be interrupted; ask for confirmation when an active agent/job or executing ClawClaw Cron Task exists; warn conservatively when inspection fails or times out.

Changes:

- Define a stable `DesktopInterruptionSnapshot` that sends only booleans and counts over RPC, never Cordis objects.
- Read running agents, running/stopping jobs, and Cron execution state from the Cordis Host in `host-bootstrap.ts`.
- Expose the same `inspectInterruptions()` through `startup-generation.ts` for in-process and isolated Hosts.
- Add private RPC in `host-process-entry.ts` / `host-process.ts`, with a short main-process timeout.
- Add a native confirmation that permits one decision at a time. Repeated quit requests join its Promise and do not force a hidden window visible.
- Route ordinary quit, tray quit, signals, and update installation through one approval/shutdown path; non-interactive OS termination remains able to terminate.

Tests and acceptance:

- Cover idle, active, scheduled, both, RPC error/timeout, and repeated requests.
- Cover identical answers from in-process and utility-process Hosts.
- Cancel leaves the Host and window usable; approval releases the generation exactly once.
- Headless tests create no real Electron window.

Rollback boundary: the new inspection and dialog may be removed together, but the idempotent shutdown guarantee of `DesktopShutdownCoordinator` must not be bypassed or reverted.

Delivered implementation: `interruption-inspection.ts` counts running agents, both inbox queues, and de-duplicated live jobs through public DSH registries. The ClawClaw Cron controller also reports running tasks and enabled tasks with a next trigger. `startup-generation.ts` exposes one interface for in-process and isolated Hosts; private RPC has a two-second deadline and runtime payload validation. `quit-confirmation.ts` coalesces inspection, dialog, and final shutdown. Unknown state warns conservatively and cancellation leaves the Host intact. Fatal exceptions still enter the existing bounded shutdown directly rather than waiting for interaction.

Verification: `corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/interruption-inspection.spec.ts tests/quit-confirmation.spec.ts tests/startup-generation.spec.ts tests/host-process.spec.ts tests/shutdown.spec.ts` (33 passing); `corepack pnpm --filter dsh-plugin-desktop run typecheck`; `corepack pnpm --filter dsh-plugin-desktop run build`; `corepack pnpm --filter dsh-plugin-desktop run test` (1239 passing, 6 existing skips).

### Phase 2 (P0): update jitter, backoff, and direct downloads

**Status: Complete (2026-09-28)**

Goal: preserve ClawClaw's normal six-hour polling policy while preventing synchronized client requests and validating installers through a product-owned download path.

Changes:

- Schedule against `performance.now()`, default to `20%` jitter, and exponentially back off failures to a configurable cap.
- Automatic, foreground-resume, and explicit checks join in-flight work. Manual checks bypass the deadline without starting a second request.
- Keep a bounded manifest request; installer downloads support cancellation, a size cap, progress, and atomic persistence.

Acceptance: deterministic random/clock tests cover bounds, backoff reset, manual bypass, and no rearm after disposal. Download tests cover cancellation, oversize responses, size mismatch, digest mismatch, and container mismatch. Rollback may restore fixed six-hour scheduling but must preserve existing hash, size, container, and redirect validation.

Delivered implementation: the first check remains fixed at 60 seconds after startup. The successful base interval remains six hours with `20%` default jitter. Failures advance through 12 hours to a 24-hour cap and success resets the delay. Manual checks continue to bypass the periodic timer and share in-flight network work through the existing `checkTask`. `update-download.ts` fetches installers directly through the Electron network boundary into a private temporary file under application data. It atomically replaces the destination only after size, SHA-512, and DMG/PE container validation. The existing 15-second total manifest-request deadline remains independent.

Verification: 39 focused update tests passing; `corepack pnpm --filter dsh-plugin-desktop run typecheck`; `corepack pnpm --filter dsh-plugin-desktop run build`; `corepack pnpm --filter dsh-plugin-desktop run test` (1247 passing, 6 existing skips).

### Phase 3 (P0): unsigned cross-platform publishing and installer handoff

**Status: Complete (2026-09-29)**

Goal: with both Windows and macOS intentionally unsigned, use one `release.json` protocol for download, content validation, and platform-appropriate handoff.

Changes and acceptance:

- `release.json` is the only update pointer and declares HTTPS URLs, byte sizes, and SHA-512 digests for the Windows NSIS installer and macOS Universal DMG.
- Publishing uploads both versioned installers first, recomputes size and digest, and atomically switches `release.json` last. It does not generate or upload YAML/blockmap metadata.
- Windows starts the verified NSIS installer only after successful Host shutdown; shutdown failure must not start it.
- macOS opens the verified DMG for manual application replacement and makes no native auto-replacement or rollback claim.

Delivered implementation: the runtime no longer depends on a native updater. Windows and macOS share `update-download.ts` private storage, atomic download, size/SHA-512/container validation, and retained-artifact state. Windows waits for quit approval and Host shutdown before visibly spawning NSIS; macOS opens an unsigned Universal DMG after download. The GitHub Actions `release.yml` dispatches native Windows and macOS runners from one tag and collects only EXE, DMG, and generated `release.json`. `upload-update.mjs` uses an SSH key, verifies the manifest against actual files, refuses to overwrite a version archive, and publishes the manifest last. This trust model uses HTTPS and published digests but does not authenticate a publisher identity; that is an explicitly accepted current product constraint and remains disclosed in user documentation.

### Phase 4 (P1): structured fatal crash reports

**Status: Complete (2026-09-28)**

Goal: supplement the existing abnormal-run marker with local, bounded, diagnosable fatal reports.

- Capture fatal type, time, product version, process role, and sanitized stack/message for main and Host.
- Write atomically with fixed file-count and total-size limits. Never persist tokens, environment variables, conversation content, or arbitrary request bodies.
- Include reports in existing user-initiated diagnostics export; do not upload by default.
- Test corrupt files, concurrent writes, rotation, path sanitization, and privacy-field exclusion.

Delivered implementation: `fatal-crash-report.ts` writes local structured reports for main-process failures, unexpected isolated Host failures, and Electron native-child termination. The allowlist contains only schema, time, source, process role, application version, platform/architecture, PID, and message/stack after `maskSecrets` and private-path replacement. It does not traverse custom Error properties or read environment variables, request bodies, or conversations. Each UTF-8 JSON document has a hard 128 KiB limit; the directory retains at most 10 reports and 1 MiB in total. Writes use an exclusive temporary file and atomic same-directory rename. Writing and pruning reject symbolic-link directories; rotation and diagnostics export accept only single-link regular files, preventing symbolic or hard links from exposing data outside the directory. Reports appear only in a user-requested diagnostics ZIP and have no upload path.

Integration points: uncaught main exceptions, unexpected Host failure, Electron `child-process-gone`, and startup failure. A report-write failure emits only a sanitized error and does not block the existing exit or recovery flow. Corrupt recognized reports rotate without parsing, and UUID names prevent collisions among writes in the same millisecond.

Verification: `corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/fatal-crash-report.spec.ts tests/diagnostic-export.spec.ts tests/desktop-logger.spec.ts` (33 passing); `corepack pnpm --filter dsh-plugin-desktop run typecheck`; `corepack pnpm --filter dsh-plugin-desktop run build`; `corepack pnpm --filter dsh-plugin-desktop run test` (1258 passing, 6 existing skips).

### Phase 5 (P1): opt-in update qualification journal

**Status: Complete (2026-09-28)**

Goal: after explicit opt-in, record local check, download, validation, staging, install handoff, and next-launch outcomes to diagnose update quality.

- Default off; update settings copy and privacy documentation together.
- Record versions, phase, error category, duration, and artifact identity digest only; omit full URL queries, device identity, and user content.
- Add schema versioning, size limit, atomic writes, and clear action. Include it only in user-initiated diagnostic exports.

Delivered implementation: Desktop settings now provides an off-by-default, live-toggleable Update qualification evidence option and a one-click clear action. `update-qualification-journal.ts` accepts fixed event enums and explicitly projects every persisted field. It covers launch readiness, check request/result, download confirmation/decline, release reconfirmation, completed staging, installation handoff, and classified failures. Records contain installed/target versions, integer durations, and a SHA-256 derived again from artifact digests in publisher metadata. URLs, raw errors, arbitrary extension fields, device identity, and user content cannot enter the persistence contract. The isolated Host receives the Electron-owned private directory through the existing typed runtime bridge; the in-process Host uses the same contract.

Every event flushes a complete JSON snapshot through an exclusive same-directory temporary file and atomic rename. A file is limited to 64 KiB; at most four files and 256 KiB total are retained. Directory creation, rotation, clearing, and diagnostics export reject symbolic-link directories and skip symbolic-link or multi-link files. Clearing an active journal cannot resurrect its old in-memory events. Storage failure produces a classified warning without blocking startup or updates. Existing journals enter only a user-requested diagnostics ZIP and have no automatic upload path. The root privacy notice, user guide, recovery copy, and bilingual settings copy now match this behavior.

Verification: 202 focused tests across the journal, update lifecycle, native installer, settings/API, diagnostics Worker, isolated bridge, and Electron runtime; `corepack pnpm --filter dsh-plugin-desktop run typecheck`; `corepack pnpm --filter dsh-plugin-desktop run build`; `corepack pnpm --filter dsh-plugin-desktop run test` (1264 passing, 6 existing skips).

### Phase 6 (P1): installer transaction, rollback, and uninstall tests

**Status: Complete (2026-09-28; real-platform cases run as release qualification)**

Goal: prove automatically that failed installation preserves a bootable version and that uninstall behavior matches user-data retention policy.

- Expand Windows VM coverage for upgrades, interruption, corrupt packages, completion after restart, and old-version launchability.
- Document and test the preservation matrix for app files, cache, logs, Profiles, and workspaces.
- Add equivalent macOS smokes for staged artifacts, replacement failure, and relaunch.

Delivered implementation: `installer-data-retention.ts` makes five uninstall boundaries executable policy: application files, uninstall registration, and shortcuts are removed; application cache, logs, Harness/Profile data, and workspaces are preserved. A unit test prevents the NSIS configuration in `package.json` from enabling `deleteAppDataOnUninstall`, and both user guides publish the same matrix.

The existing Windows NSIS A/B lab already covers normal upgrades, target-content integrity, mid-operation process-tree interruption, a locked `app.asar`, old/candidate coherence after interruption, and an actual startup probe. This phase extends `smoke-windows-installer-upgrade.ps1` to truncate a copy of the candidate and require Windows to reject it, then prove that the base version is unchanged and still launchable before proceeding through running-app upgrade, candidate relaunch, same-version overwrite, and uninstall. Before uninstall it writes unique markers into `%APPDATA%\ClawClaw` cache/log locations, an isolated `DSH_HOME` Profile, and an isolated workspace. It requires application files, registration, and shortcuts to disappear while all four data markers survive, then removes only its own markers. `check:win-package` now includes the policy test.

macOS native auto-update remains disabled. The product opens a user-confirmed unsigned Universal DMG rather than claiming an in-app atomic replacement/rollback path. Package smokes verify the mounted DMG, both `arm64` and `x86_64` architectures, and embedded native files. Download and Electron runtime tests prove that download/validation failure, cancellation, or failed Host teardown cannot produce an incorrect installer handoff. Manual DMG replacement and relaunch remain real macOS release qualifications.

Headless verification covers `installer-data-retention.spec.ts`, `update-download.spec.ts`, `electron-runtime.spec.ts`, and macOS package smokes; complete typecheck, production build, and unit tests form the final gate. This macOS development host cannot execute the Windows PowerShell/NSIS VM smoke. A real Windows installation report and macOS manual DMG replacement result must accompany the corresponding release and cannot be substituted by the headless result.

### Phase 7 (P2): background residency and update-ready attention

**Status: Complete (2026-09-28)**

Goal: notify once when the window first closes to the background; signal a prepared update through tray/window state without stealing focus.

- Persist notice state per product/Profile setting and support reset.
- Respect system notification permission; fall back to tray state.
- Do not show permanent tutorial copy or repeat a notice on every close.

Delivered implementation: `background-close-notice.ts` adapts the official one-time notice state machine to ClawClaw's Electron generation. The first close of the main window presents a localized native notice before the window actually hides. Repeated close requests while the dialog is pending only refocus the window instead of opening overlapping dialogs. Only explicit acknowledgement writes a private atomic marker beneath Electron `userData`, isolated by a SHA-256 digest of the Profile name. Cancellation, dialog failure, or generation disposal leaves the window visible. A marker-write failure does not block the currently acknowledged hide, but the notice returns on the next launch. Settings expose an explicit reset through the private same-origin API and typed Host RPC without revealing the marker path to the renderer.

Background update checks still persist their once-per-version announcement state first, then route the official update-attention behavior through ClawClaw's existing `notifyAttention`. A focused window stays completely quiet. Windows flashes the taskbar, while other platforms increment the application badge. A native system notification is created only when Electron reports support, and clicking it only reveals the application; it never downloads or installs. Taskbar/badge attention runs before the support check, and the update tray item continues to show the available version, so missing notification capability does not remove the fallback. Ordinary `updates.notify` remains available for status notices that do not require additional window attention.

Intentional differences from upstream: state is isolated per Profile rather than by one product-global key; reset belongs to the ClawClaw settings API; the existing macOS fullscreen-exit-before-hide state machine is retained; no permanent tutorial copy is added; notification clicks cannot start installation; and no official shell or settings structure is copied.

Verification: 156 focused tests across `background-close-notice.spec.ts`, `electron-runtime.spec.ts`, `client-desktop-settings.spec.ts`, `host-runtime-bridge.spec.ts`, and `updates.spec.ts`; complete typecheck and production build; complete unit suite with 1272 passing and 6 existing skips. Coverage includes first/subsequent close, explicit reset, concurrent close requests, cancellation/failure/disposal, Profile isolation, symlink-directory rejection, RPC projection, background update deduplication, focused-window silence, and taskbar fallback when system notifications are unavailable.

## 6. Common implementation workflow

For every phase:

1. Read the pinned official reference with `git show origin/master:apps/desktop/...`; never switch or modify the submodule.
2. State the ClawClaw behavioral contract and failure policy, then implement the smallest adaptation layer.
3. Run focused tests first, then `corepack pnpm typecheck` and `corepack pnpm test`; run the relevant package gate for packaging work.
4. Update this file with status, actual deviations, and verification commands.
5. Commit each phase separately. Always commit a submodule pin change on its own.

The complete headless pre-release gate is `corepack pnpm check`. Tests requiring Windows VMs or a GUI are explicit release qualifications; ordinary headless gates must not launch a GUI.

## 7. Definition of done

This plan is complete when:

- Phases 1 through 3 are complete and part of the default release gates.
- Phases 4 through 7 are complete or each has a reviewed deferral with an explicit risk owner.
- English and Chinese user documentation, privacy notices, and package operations match final behavior.
- `corepack pnpm check` passes and Windows/macOS release qualifications pass on their platforms.
- The `deepseek-harness/` worktree is unchanged and no submodule pin update shares a commit with Desktop behavior.

## 8. Upstream provenance

Primary references, all under official `apps/desktop/`:

- `src/quit-confirmation.ts`
- `src/update-schedule.ts`
- `src/update-journal.ts`
- `src/crash-report.ts`
- `src/background-notice.ts`
- `src/update-attention.ts`
- `tests/README.zh.md`

If a reference changes upstream during implementation, record the new commit in the implementation commit instead of silently moving this document's baseline.
