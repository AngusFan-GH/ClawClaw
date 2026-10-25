# Desktop AI input assistance

This implementation incorporates the interaction design of `arch` at `f0eb2699`, retaining the Desktop-owned public composer integration and stronger cancellation/context checks. No upstream or vendor source is modified.

## Behavior

| Feature | Trigger | Adoption |
| --- | --- | --- |
| AI suggestions | Enabled, visible idle conversation with a completed exchange, exactly empty input and 500 ms stability. Existing history, enabling and new completed replies are supported. | Tab or Enter inserts one suggestion; the same Enter never sends it. |
| AI continuation | Enabled, genuine draft edit of six non-whitespace characters or more, focused caret at the end, then 800 ms pause. Calls are at least three seconds apart. | Tab appends the gray suffix as one undoable edit; Enter sends only the existing draft. |
| Optimize draft | Explicit toolbar action on an eligible plain-text draft of up to 8,000 characters. | Preview the original, replacement and separate missing-information notes, then explicitly replace. |

Suggestions and continuation default off and use the same public General Settings Switch, spacing and typography as other settings. Optimization is an explicit action, available by default. Settings are live and Profile-owned; plugin activation remains separate.

Suggestions work in existing conversations: a new chat or a new reply after enabling is no longer required. Empty conversations without a completed exchange have no context. Focus or clearing input alone does not create another request. Each completed context is attempted once; failure, cancellation and timeout do not auto-retry. Completed cached text may reappear after clearing an ordinary draft edit, but invalidated in-flight work cannot revive after type-and-delete.

Continuation never generates simply on mount, navigation or refocus. IME composition hides/cancels it; completing an actual composition permits generation after the closing-key guard and stable pause. It requires no attachments, references, claims, queues, menus or pending submissions. Whitespace at the draft/suffix join is preserved. Caret movement, selection, blur, editing, model changes and disabling invalidate its result. Optimization cancels continuation; closing or accepting optimization does not auto-resume continuation without another user edit.

Optimization preserves the original until confirmation and never submits it. Inline references and command drafts are unavailable because replacing their text could destroy structured meaning. Separately owned attachments are retained. Replacement uses public full-text `insertText` with the captured draft revision: one undoable edit, guarded against changes to the draft, attachments, context or eligibility. Empty, malformed and truncated output never becomes replacement prose. Cancel closes the preview and cancels Host work.

## Integration

- `input-suggestions.ts`, its contract and Client state machine own suggestions and bounded context extraction.
- `input-assistance.ts` and its contract share continuation/optimization Host lifecycle, validation and generation. Thin `ai-continuation.ts` and `ai-draft-optimization.ts` modules preserve the corresponding arch plugin identities.
- Client `input-assistance-state.ts` owns draft revisions, cancellation, previews and adoption. Client `input-assistance.tsx` renders continuation and optimization inside the shared public composer projection.
- `input-assistance-call.ts` allows one physical auxiliary call per LLM service across all three features. An adapter ignoring abort retains its slot until physical settlement, while cancellation releases the caller promptly.

The original upstream composer renders through the existing `registerEntryProjection`, retaining its locale, stores, injection and child slots. The wrapper is removed when all three preferences are off. Cordis and ModuleLoader explicitly declare the conversation service dependency; real Cordis regression tests verify both runtimes.

Suggestions use the documented placeholder owner prop, preserving its theme and ellipsis. Continuation is display-only and positioned from the browser selection within the mounted composer's own root. There are no global composer queries, private editor accesses, ComposerKeyboard imports or global keyboard listeners. Scoped capture preserves menu, modifier, repeat and IME precedence, including keyCode 229 and the 10 ms composition-closing guard. Unaccepted generated text is never draft content, clipboard content, history or persistence.

Public session, input, trigger-menu, model-selection, connection and remote-event faces supply current state. Dispatch, response and adoption recheck it. Host and Client independently reject stale results despite ignored abort. Session/content/model/credential changes, running Agents, pending input, disabling, unmount and disposal cancel or invalidate work. Optimization coordination is scoped to the mounted composer rather than a process-global boolean.

## Model budgets and privacy

Calls use the session's configured model and credentials through `llm.prepareCall`: no fallback provider, separate credential store, Agent loop, tools, file action or session append. Identity-free one-shot input is untrusted data beneath a fixed system prompt.

Context examines at most 200 recent events on the current surface, retaining human text and the successful final tool-free assistant answer per turn. Reasoning, tools, injected user-role messages, interrupted replies and selection quote envelopes are excluded; common secret spellings are redacted. At most six messages, 1,800 characters each and 6,000 serialized characters total are included. Drafts are primary input for continuation/optimization; oversized drafts are rejected, never silently truncated.

Budgets come from resolved model metadata, without model-name guessing:

- Suggestions/continuation: 512 tokens if the only advertised reasoning effort explicitly disables reasoning, 1,536 for reasoning-capable routes, and 1,024 for missing metadata. A positive configured `defaultMaxTokens` further caps this budget.
- Optimization: twice the draft character count plus 512, bounded to 2,048–8,192 tokens and capped by the deployment value.
- Use the least advertised supported reasoning effort. A single opaque/high effort still gets reasoning headroom. Metadata describes a configured output cap, not discovery of the provider's hard maximum or an exact tokenizer measurement.

Independent Client/Host deadlines remain three seconds for automatic features and twenty seconds for optimization. Higher budgets avoid truncating reasoning before the first visible token, but do not guarantee results from a slow model. No automatic retries occur. Output requires successful explicit stop and strict JSON, with accumulated output bounds and tool-output rejection.

Suggestion diagnostics use the existing local logger with fixed event codes, turn sequence, numeric budget and elapsed milliseconds. No transcript, draft, generated text, credential or provider error body is logged.

## Upgrades and validation

All three settings-backed plugins are Profile-owned editable entries. Preparation strips duplicate launcher insertions, preserving arch continuation/optimization insertions, explicit settings and unknown fields. Retired `desktop-ai-input-suggestions` and `desktop-ai-input-continuations` rows remain disabled with their old configuration. Their preferences migrate to the corresponding current feature only if it lacks an explicit preference; disabled old plugins do not enable replacements. Migration is idempotent, preserves YAML nodes and isolates Profiles. Other duplicate identities retain normal validation.

Desktop `check` covers build, all TypeScript projects, unit tests, closure, CLI, Loader, Profile, licenses and operation reliability. Feature regressions cover existing-history activation, scoped adoption, IME completion, whitespace joins, strict output, attachment preservation, stale previews, model changes, ignored abort, shared concurrency, deadlines and cleanup. Tests use mocked model calls plus real Cordis service boundaries.

The final unit run passed 200 files and 1,779 tests, with 11 skipped. Build and all TypeScript checks passed as part of the same Desktop gate.

Root validation has pre-existing blockers: a staged submodule pin differing from `upstream.json`, and the IM fixture's unavailable default `https-proxy-agent` export. User-staged changes are preserved; Desktop is validated independently. No graphical application is launched or paid model call made. Actual native IME candidate panels and model quality/latency still require graphical/model acceptance.

The delivery patch contains only owned feature source, integration, tests and this note relative to `73f91d6d`. It excludes dependencies, bundles, logs, credentials, unrelated staged IM files and the staged submodule pin. Run `git apply --check` before applying to that baseline.
