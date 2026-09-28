# ClawClaw Official Desktop Adoption Guide

[中文](official-desktop-adoption-plan.md)

## 1. Purpose and baseline

This guide directs selective adoption from the official DeepSeek Harness Desktop while keeping ClawClaw a fully independent desktop shell. It is both the implementation sequence and the acceptance checklist.

- ClawClaw baseline: the `dsh-desktop` branch, product version `0.2.2`.
- Runtime baseline: the read-only submodule and vendored runtime are DSH `0.1.5-rc.2`.
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
| Windows NSIS and macOS signing/notarization preflight | package/release scripts | Harden incrementally |

## 4. Adoption classification

### 4.1 Adaptable implementations

| Official reference | Behavior to adopt | ClawClaw destination |
| --- | --- | --- |
| `quit-confirmation.ts` | Pre-quit inspection, conservative fallback, request coalescing, ownerless native dialog | New interruption snapshot and confirmation integrated with shutdown |
| `update-schedule.ts` | Monotonic clock, jitter, exponential backoff, in-flight joining | Extend periodic scheduling in `update-lifecycle.ts` |
| `update-http-executor.ts` | Response-header and body-chunk idle timeouts | Adapt to the installed `electron-updater` before connecting to downloads |
| `test-windows-update-signature.mjs` | Exercise `NsisUpdater.verifySignature()` for correct, wrong, and missing publishers | New Windows release qualification |
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

Any future need for these requires a separate design record; it cannot enter as incidental scope in this plan.

## 5. Delivery phases

Statuses are `Not started`, `In progress`, `Complete`, or `Blocked`. A phase becomes complete only after code, automated tests, and this acceptance record are all updated.

### Phase 1 (P0): interruption inspection before quit and update installation

**Status: In progress**

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

### Phase 2 (P0): update jitter, backoff, and idle timeout

**Status: Not started**

Goal: preserve ClawClaw's normal six-hour polling policy while preventing synchronized client requests and ensuring that a connected but stalled transfer fails deterministically.

Changes:

- Schedule against `performance.now()`, default to `20%` jitter, and exponentially back off failures to a configurable cap.
- Automatic, foreground-resume, and explicit checks join in-flight work. Manual checks bypass the deadline without starting a second request.
- Use independent response-header and chunk-idle timeouts. Verify the installed `electron-updater` internal API first and upgrade it separately if required.

Acceptance: deterministic random/clock tests cover bounds, backoff reset, manual bypass, and no rearm after disposal; stalled headers/body fail within bounds. Rollback may restore fixed six-hour scheduling but must preserve existing hash, size, container, and redirect validation.

### Phase 3 (P0): Windows Authenticode publisher qualification

**Status: Not started**

Goal: distinguish a structurally valid PE from a trusted Authenticode identity. Update metadata `publisherName` must match the actual signing certificate.

Changes and acceptance:

- Keep `verify-win-installer.ts` as a PE/container smoke and do not describe it as signature verification.
- Add Windows-only release qualification using `NsisUpdater.verifySignature()`.
- Test matching publisher accepted, wrong publisher rejected, unsigned artifact rejected, and SHA-512 unchanged.
- Local unsigned development builds skip explicitly; formal release channels may not skip.

Rollback may remove qualification wiring only; it must not weaken publisher validation already configured in the production updater.

### Phase 4 (P1): structured fatal crash reports

**Status: Not started**

Goal: supplement the existing abnormal-run marker with local, bounded, diagnosable fatal reports.

- Capture fatal type, time, product version, process role, and sanitized stack/message for main and Host.
- Write atomically with fixed file-count and total-size limits. Never persist tokens, environment variables, conversation content, or arbitrary request bodies.
- Include reports in existing user-initiated diagnostics export; do not upload by default.
- Test corrupt files, concurrent writes, rotation, path sanitization, and privacy-field exclusion.

### Phase 5 (P1): opt-in update qualification journal

**Status: Not started**

Goal: after explicit opt-in, record local check, download, validation, staging, install handoff, and next-launch outcomes to diagnose update quality.

- Default off; update settings copy and privacy documentation together.
- Record versions, phase, error category, duration, and artifact identity digest only; omit full URL queries, device identity, and user content.
- Add schema versioning, size limit, atomic writes, and clear action. Include it only in user-initiated diagnostic exports.

### Phase 6 (P1): installer transaction, rollback, and uninstall tests

**Status: Not started**

Goal: prove automatically that failed installation preserves a bootable version and that uninstall behavior matches user-data retention policy.

- Expand Windows VM coverage for upgrades, interruption, corrupt packages, completion after restart, and old-version launchability.
- Document and test the preservation matrix for app files, cache, logs, Profiles, and workspaces.
- Add equivalent macOS smokes for staged artifacts, replacement failure, and relaunch.

### Phase 7 (P2): background residency and update-ready attention

**Status: Not started**

Goal: notify once when the window first closes to the background; signal a prepared update through tray/window state without stealing focus.

- Persist notice state per product/Profile setting and support reset.
- Respect system notification permission; fall back to tray state.
- Do not show permanent tutorial copy or repeat a notice on every close.

## 6. Common implementation workflow

For every phase:

1. Read the pinned official reference with `git show origin/master:apps/desktop/...`; never switch or modify the submodule.
2. State the ClawClaw behavioral contract and failure policy, then implement the smallest adaptation layer.
3. Run focused tests first, then `corepack pnpm typecheck` and `corepack pnpm test`; run the relevant package gate for packaging work.
4. Update this file with status, actual deviations, and verification commands.
5. Commit each phase separately. Always commit a submodule pin change on its own.

The complete headless pre-release gate is `corepack pnpm check`. Tests requiring real signing identities, Windows VMs, notarization services, or a GUI are explicit release qualifications; ordinary headless gates must neither launch a GUI nor depend on secrets.

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
- `src/update-http-executor.ts`
- `src/update-journal.ts`
- `src/crash-report.ts`
- `src/background-notice.ts`
- `src/update-attention.ts`
- `scripts/test-windows-update-signature.mjs`
- `scripts/windows-sign.mjs`
- `tests/README.zh.md`

If a reference changes upstream during implementation, record the new commit in the implementation commit instead of silently moving this document's baseline.
