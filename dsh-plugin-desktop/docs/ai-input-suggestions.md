# AI input suggestions

The feature is an optional Desktop Cordis module, enabled by the live, Profile-owned `dsh-desktop-input-suggestions.enabled` preference. It defaults to `false`. The General settings row is localized in Chinese and English, explains the configured-model call, and uses the same public `Switch` component, spacing and typography as the General developer-tools setting. Turning it off immediately hides the suggestion, cancels work, and removes the composer presentation wrapper. Plugin activation and the feature preference remain separate.

## Integration and keyboard boundary

- `src/input-suggestions.ts`: Host entry, settings schema, bounded context selection, model invocation, cancellation and request ownership.
- `src/input-suggestions-contract.ts`: browser-safe identities and output validation.
- `src/client/input-suggestions-state.ts`: request/cache/adoption state machine.
- `src/client/input-suggestions.tsx`: General settings contribution and public composer-slot composition.
- `cordis.patch.yml`, `package.json`, `tsdown.config.ts`: Host registration, export and build entry. `src/client/index.ts` composes the Client face. `src/profile.ts` assigns the editable entry to the Profile layer and migrates older input-plugin rows.

The current public input action face has revision-protected insertion but no pre-submit key interceptor. `ComposerKeyboard` and the editor object remain private and are never read or imported. The implementation instead composes the documented `conversation.composer.bar` slot using the repository's existing `registerEntryProjection` adapter, forwarding the original component's injected props, locale, store and child slots intact. It reads the public per-session trigger-menu snapshot. A React capture handler **inside this composer only** handles plain Tab/Enter before the original editor's native keymap; open menus, modifiers, repeated keys, composition, legacy keyCode 229, and the 10 ms composition-closing guard all pass to the original composer. There is no global keyboard listener.

Completed text is supplied through the original composer's documented `placeholder` owner prop. This reuses its gray theme color, one-line ellipsis in narrow docked composers, hero clamp, reference spacing, and IME placeholder suppression, without stacking another placeholder or adding buttons. The suggestion is independent memory state: no draft mutation, pending submission or transcript record exists until adoption. Adoption consumes the key first, clears the cached suggestion, then calls `captureInsertion()` and `insertText()` against the observed empty draft revision. The same Enter cannot submit. Later editing and Enter use the original behavior.

The unmodified upstream client remains the rendered composer. When the preference is off, its original slot entry is also the direct winner. No upstream source, vendor package, submodule pin, package manager configuration, or credential provider is changed.

The Client explicitly declares its `conversation` service dependency and its ModuleLoader dependency on `@deepseek-ai/dsh-client-ui-conversation`. Cordis rejects direct service access without `inject`; plain-object mocks cannot validate this rule. A real Cordis Context regression test now verifies runtime initialization, a completion-triggered request and adoption-ready text with the declared dependencies.

## Trigger and request policy

Only a **live completed turn event observed by a mounted, visible composer**, followed by Agent idle, can reserve an opportunity. Initial history, navigation, refocus, clearing input, enabling the feature, and redisplaying cached text do not trigger generation. The draft must contain exactly no text, attachments, references, command claim, queue or pending submission, and no trigger menu may own it. A 500 ms stable window precedes dispatch. Editing, paste, drop, composition or a gate change cancels that opportunity without retry.

The Host validates the completed turn sequence against an exact public `sessionQuery.observeSession()` lease and current live Agent. It reads at most the last 200 events, keeps only current-surface human text and successful final tool-free assistant answers, then selects at most six text messages, 1,800 characters each and 6,000 serialized characters total. Reasoning, tools, injected user-role messages, interrupted assistant answers and selection quote envelopes are excluded; common credential spellings are redacted. Transcript JSON is low-priority data under a fixed instruction, never a system instruction assembled from conversation content.

The session's model-selection projection chooses the existing configured route. `llm.prepareCall()` binds the provider generation and chooses the least supported reasoning effort. The call has identity-free one-shot input, no tools, a 160-token output cap and no Agent loop, session append, file action or fallback provider. The model must return a single JSON string, including the empty string when appropriate. Text is shown only after a successful explicit stop, JSON decoding and 2–240-character single-line validation. Wrapped explanations, lists, truncated/failed streams and empty outputs are discarded.

Client and Host have independent 3,000 ms total deadlines. Neither retries. The Host races cancellation against model work, so the HTTP caller is released even if an adapter ignores abort. It retains a single physical execution slot until that work actually settles, preventing a succession of cancelled calls from accumulating. Such a broken adapter can suppress later suggestions until it settles or the Host generation restarts; the main conversation is never blocked.

Requests bind the session id, completed-turn sequence, request UUID, context revision and model identity. The Host additionally checks surface/content and adapter/credential generations. Client stores are read synchronously at input changes, dispatch, return and adoption; remote adapter/credential changes and connection-generation changes invalidate the cache. Session replacement, branch/content changes, Agent activity, disabling, unmount and disposal cancel or invalidate old work. Abort is an optimization: request identity/version checks independently reject late and reordered results. Only an already completed suggestion can survive ordinary draft editing and reappear after clearing. An in-flight request cannot revive after type-and-delete.

Diagnostic events use the existing local Host logger with the `input-suggestions:` prefix. They identify completion gates, request/model dispatch, cancellation, timeout, stale context, empty model output, invalid JSON/format and successful display. Only fixed event codes, the completed-turn sequence and elapsed milliseconds are recorded; no prompt, suggestion text, credential or provider error body is logged. Client completion/display reports never initiate model generation and add no product UI. A diagnostic-free completion after enabling should be investigated as a Client initialization/transport failure rather than assumed to be model slowness.

## Verification and delivery

### Upgrade compatibility

Settings-backed Desktop plugins must also be listed in `DESKTOP_EDITABLE_PROFILE_ENTRIES`, not only inserted by `cordis.patch.yml`. This makes the Profile the single owner of the insertion and strips the duplicate launcher insertion. Otherwise an old installation's saved insertion conflicts with the newer bundle at startup, before the plugin can load. `desktop-input-suggestions` now follows this existing ownership policy.

Upgrade regression coverage includes absent rows, config-only preferences, already saved insertions, enabled and disabled values, repeated startup and different Profiles. The two retired owned exports `desktop-ai-input-suggestions` and `desktop-ai-input-continuations` are retained with all their config fields but marked disabled, since the current package does not export them. The old suggestion preference is inherited only if the current entry has no explicit `enabled`; a disabled old plugin never implicitly enables the new feature. Continuation is never converted into next-request suggestions. Migration preserves existing YAML nodes and is idempotent. Other plugin identities still receive the normal conflict validation.

The user's existing Profile document was copied into an isolated temporary Profile and successfully composed with one current suggestion entry, its existing enabled value, and both retired exports inactive. A second preparation left the migrated document unchanged; the original user Profile was not modified by this verification. A repaired build applies this migration during normal Profile preparation without requiring manual deletion of the Profile.

The two feature test files cover keyboard adoption and ordinary subsequent send, empty input, whitespace, attachments, reference chips, claims, menus, IME and its closing key, cached redisplay, stable-window interruption, slow/ignored cancellation, timeout, failure/empty/invalid output, out-of-order responses, models/credentials/connections, visibility, immediate settings writes, public slot ownership and cleanup. Model calls use mocks; no account or credential is required. The browser test verifies React capture ordering against the resident composer's downstream key handler.

Validation was performed on Windows with Node 22.20.0 and Corepack pnpm 11.8.0:

- Frozen dependency installation passed.
- Root build and root typecheck passed on successful reruns. Earlier builds encountered transient Windows mapped-file errors in the existing IM build output.
- The feature suite passed: 73 tests, including a real Cordis plugin lifetime, privacy-preserving diagnostics, the shared settings Switch and immediate preference updates while saving.
- Profile composition/upgrade tests passed: 57 tests, including 10 new upgrade regressions.
- The Desktop package's complete headless `check` includes build, typecheck, full unit suite (198 files; 1,716 tests passed, 11 skipped), closure, CLI, Loader, Profile, licenses and operation checks. Expected incompatible-plugin fixtures and upstream missing-source-map/jsdom warnings do not fail these checks.
- Root `pnpm check` was executed and remains blocked at `verify-layout`: the pre-existing staged submodule gitlink is `477b4f420553e8a52c2fbccc464d7561b239c443`, while `upstream.json` requires `687f282e8625c6b8d11ff58211a90524be2e4317`. The pin was preserved.
- Root `pnpm test` was executed and stops before Desktop tests in the existing IM suite: `@xmanrui/dsh-im/plugin-src/host/channels/feishu/production.mjs` imports the unavailable default export of `https-proxy-agent`. Desktop tests were therefore run independently through their full gate.

No graphical application was launched and no real paid model call was made. Actual OS IME candidate panels and visual acceptance across window sizes/themes still require an explicit graphical session; this delivery verifies their state/keyboard guards headlessly and inherits the existing composer's layout. An independent suggestion-model picker is intentionally outside this version. The 3-second budget can produce no suggestion for slow reasoning-only models.

The supplied patch contains only this feature's owned source, integration, tests and this note. It excludes dependencies, generated bundles, logs, credentials, unrelated staged IM changes and the existing staged submodule change. Apply it to the corresponding source baseline with `git apply --check` followed by `git apply`; adapt context if the receiving project has since changed. Do not merge a handoff archive's anonymous repository history.
