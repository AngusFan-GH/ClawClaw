# GenUI result cards

English | [中文](genui.zh.md)

GenUI implements opt-in result cards with local chart, table and isolated HTML interactions. It does not replace the upstream Markdown renderer, observe the conversation DOM, or change layout ownership. The pinned upstream checkout is unchanged.

## Current scope

The product goal is to show useful charts and small interactive snippets directly in chat. Keep the standard components, isolated HTML, reset/pause/resume and text fallback. Source is retained with the conversation. Existing input restoration is a convenience, not a promise to resume every custom interaction. Custom-state hooks remain available for compatibility and are not a default generation requirement. State migrations, a storage-management UI, sharing, collaboration, exports and additional component families are deferred until a concrete user need justifies them.

## Enable in a test Profile

GenUI is off by default. In **Settings → General**, turn on **Visual responses**. The switch saves to the active Profile and takes effect immediately, without restarting. Like the other switches, it animates immediately and locks while saving, without adding a saving message or changing the row layout. A failed save restores the confirmed value and shows an error. Read-only settings cannot be changed. Rendering follows confirmed Host state. Turn it off in the same place to restore text results.

For manual Profile configuration, add or edit this override in the active Profile's `cordis.patch.yml`, after inserted entries:

```yaml
- id: desktop-genui
  config:
    enabled: true
```

Restart the Host after manually editing the file. The existing settings transport can also update the entry's `enabled` field. Set it to `false` to remove both model tools, the prompt contribution and the custom result view. Saved tool results retain their ordinary text content. Profile preparation preserves explicit choices and adds the entry to older Profiles without enabling it.

Ask naturally for a visual comparison, plan or chart; the enabled feature guides the model to call `clawclaw_render_ui`. Naming the tool in the request is optional. `clawclaw_validate_ui` returns field diagnostics without displaying a card. The document argument is:

```json
{
  "format": "clawclaw.genui/v1",
  "title": "Service status",
  "items": [
    { "type": "stat", "label": "Healthy", "value": 3 },
    { "type": "table", "columns": ["Service", "Requests"], "rows": [["API", 20], ["Worker", 4]] },
    { "type": "progress", "label": "Review", "value": 50 }
  ]
}
```

Prefer the `document_json` tool parameter: serialize the complete document as one JSON string. The legacy `document` object remains accepted. Supply exactly one parameter. This keeps nested JSON arrays intact in model transports that otherwise emit `{item: ...}` wrappers. Malformed wrappers still fail strict validation; they are never silently repaired. Failed validation returns an explicit inline retry hint.

## Plugin boundary

The Host is the opt-in Cordis plugin `desktop-genui`, exported as `dsh-plugin-desktop/genui`. It owns tools, prompt, presentation guard and the scoped state API. The Client is the built-in Cordis child plugin `desktop-genui-client`; the desktop Client registers it with `ctx.plugin`, rather than directly installing its views. Its own lifetime owns rendering slots, settings row, locale registration, subscriptions and styles. Disposing the child releases those registrations. Disabling Visual responses removes rendering while retaining the settings row for re-enabling. This is modular code inside the desktop package, not a separately published or independently installable npm package. Electron's srcdoc navigation policy is a generic host-platform safety capability in `isolated-preview-navigation.ts`, not a dependency on GenUI business logic. The upstream checkout remains unchanged.

Generation notices reflect actual render/validate lifecycles. Validation alone never counts as a displayed result. Corrective local-browser denials become a friendly inline-preparation notice in the answer area; technical diagnostics remain in work details. Completed failures offer an explicit Retry display action through the owning session's standard conversation send API. Retry creates a visible follow-up, preserves the composer draft and cannot silently send into another session. Successful results replace progress, and unknown historical turn state never shows an endless spinner.

## Protocol and ownership

Supported types are `text`, `card`, `row`, `stat`, `table`, `progress`, `callout`, `steps`, `chart` and `html`. Standard component text is literal; no HTML, arbitrary styles, executable expressions or model actions are interpreted outside isolated HTML previews. Tables sort locally and use semantic table headers with sort state. Limits are 64 KiB of serialized JSON, 200 components, eight component levels, 50 table rows, 12 columns, 24 steps, 2,000 characters per text field and 160 per title or label. Invalid or oversized documents produce diagnostics instead of silently discarding data. No repair is attempted.

The Host validates the document and uses the tool output contract to project it into replayable `meta`, while preserving a readable text result. The Client validates that metadata again. It renders settled results only; preparing/running arguments never become interactive UI. Independent successful results in each Turn are shown in order in the answer's public tail, outside collapsed work details. An optional nonblank `resultId` (at most 160 characters) replaces the result with the same ID in that Turn, preserving its original position. Omit the ID for a new result. Failed or invalid updates cannot replace a valid card; unrecognized metadata retains its saved text separately. This reads the owning Session's Turn-scoped Chat projection, including nested PTC results and hidden process nodes; it restores from history without another model call. The original tool result remains in work details. Missing, invalid or future metadata falls back to saved text. Session and call identity come from the owning view. Local sorting is ephemeral and does not write shared state or send model messages.

The feature follows confirmed Host configuration and disposes its tools, prompt, slot and styles. Result source stays in Session metadata; a separate bounded Profile storage domain holds HTML presentation state, without adding it to model context. Action delivery, business drafts, exports, inline fences and sidechat integration are outside the current product scope.

## Charts and presentation

Charts use Apache ECharts with SVG rendering. The `chart` node accepts `kind` (`bar`, `line` or `pie`), a `title`, `categories`, `series` (each with a unique `name` and `values`) and an optional `unit`. For example:

```json
{ "type": "chart", "kind": "bar", "title": "Service requests", "categories": ["API", "Worker", "Cache"], "series": [{ "name": "Requests", "values": [20, 4, 100] }], "unit": "requests" }
```

A document allows eight charts, each with at most 60 categories and four series. Pie charts allow 12 categories and one nonnegative series. Values must be finite and have magnitude at most 10^15. Bar and line charts accept `null` for missing values; zero remains zero. Series lengths must match categories. Arbitrary ECharts options, code and HTML are rejected.

Legend toggles only affect the current local view. Pie legends show values and shares of the currently visible categories, with an explicit scope explanation after filtering and a Restore all action. Their data tables always retain all categories and shares of the original total. Single-series bar/line charts show a series label without an unnecessary toggle. Every chart includes an expandable semantic data table; empty, all-hidden, all-missing and zero-sum pie data each explain the specific reason. Hidden data can be restored with one action. Rendering failures automatically expand the data table. Charts resize with the container and follow light/dark themes. Long-name or more-than-eight-category bars use a horizontally oriented comparison with vertical scrolling. Trends with more than 12 categories scroll horizontally, preserving all points and their source order. Plot heights follow content, with bounded scroll viewports. Keyboard users can scroll the plot region and expand the exact data table. Unmounting disposes charts and observers. Cards use theme colors, grouped metrics, restrained borders, numeric table alignment and compact progress bars. Callouts distinguish info, success, warning and error with labels, icons and semantic accent colors. The model is instructed to provide concise conclusions without repeating card data. The General setting includes a concrete example request.

## Local interactive HTML

HTML-only results render inline in the chat answer, before its message action buttons, without an outer result card or duplicate document heading. They do not require opening tool details or another page. Mixed structured results retain their card layout.

Use `html {type:"html",title:string,html:string,fallback:string}` for small self-contained calculators, filters or simulations that standard components cannot express. Each document allows two fragments, each at most 32 KiB of UTF-8 source. Title, source and a readable fallback are required. Tool text contains the fallback, not executable source; source remains in durable metadata for replay.

The Client runs fragments in an opaque-origin `iframe` with only `allow-scripts`. The initial policy blocks external resources, connections, nested frames, workers, objects, base URLs and form submission. Inline CSS and JavaScript are supported; external libraries, imports and eval are unavailable. Electron additionally cancels navigation initiated by or targeting a srcdoc frame, because CSP alone does not block self-navigation. Ordinary plugin iframe navigation remains unchanged. No Electron, filesystem, session, tool or privileged action bridge is exposed. This is a presentation runtime, not a general application or security boundary for arbitrary hostile workloads; CPU and memory quotas are not provided.

A narrow source-checked message channel reports readiness, failure and bounded height (120–720 px); it accepts no action commands. A separate bounded JSON message carries only presentation state. Theme updates go into the frame without resetting its local inputs. The host provides Pause/Resume and a collapsed description. Restore initial values is a secondary action inside the description and explicitly clears saved inputs. Loading and pause placeholders reserve the content height; Resume and Reload retain the last measured height. Save failures offer Retry without reloading the snippet, while runtime failures offer Reload with current inputs. Errors or an eight-second startup timeout expose the description. Stop removes the iframe while retaining state; Resume restores it. Reset explicitly clears saved inputs and recreates the initial view. Read/save failures are visible and failed loads do not overwrite stored data. Native input, checkbox, radio, select and textarea values automatically persist in the current Profile and restore on refresh, history reopen or Host restart. Password, file, hidden, `data-private` and `autocomplete="off"` fields are excluded. Saved controls are restored and emit input/change events so computed outputs update. Custom state uses `window.clawclaw.getState()` and `window.clawclaw.setState(json)`. This is not arbitrary JavaScript heap persistence; scripts must opt in for custom state. State is limited to 100 controls, bounded JSON, and 16 KiB per fragment. A Profile holds at most 1,000 snapshots; reaching the limit reports a save failure and never silently evicts existing entries. Do not put secrets into snippets or imitate permission dialogs. Static charts should continue to use the standard chart component.

Example request: “Create a local price calculator with unit price and quantity inputs, a live total and a reset button. Include a text explanation.” Users do not need to name a tool. Small visual and HTML requests default to direct chat rendering. The model is instructed not to create a file, start a server, open a browser or run browser automation just to display or verify an inline result. Explicit website, standalone-file, export or browser requests retain their requested workflow; researching source data remains available. When the latest human request explicitly asks for an inline result, an enabled Host execution guard denies local file/loopback navigation through browser_navigate before the browser body runs. Explicit browser instructions and external research URLs remain allowed. This is a narrow presentation rule, not a general browser sandbox. Validation success explicitly instructs the model to call render; validation itself still displays nothing.

The architecture follows the general isolated-document approach, informed by the locally available visualization preview wrapper and [OpenAI’s visualization overview](https://learn.chatgpt.com/docs/visualizations). The ClawClaw runtime and styles are original; this does not claim to reproduce Codex’s private app internals.

## Desktop acceptance

Automated and browser checks do not replace one real Desktop acceptance run. In the running app, enable Visual responses and ask for a price calculator in chat. Check inline interaction, pause/resume, refresh or conversation reopen, explicit reset and reopening historical source. For charts, check legend filtering and the source data table. Record real failures and fix them before expanding the feature. This checklist is pending until performed against the running Desktop app; it does not launch the graphical app automatically.

## Verification and provenance

Run the focused GenUI suites, typecheck, build and the standard headless gate. Tests exercise the real DSH tool registry, serialize and restore a Session result, check profile upgrade/enablement, render components in jsdom, and exercise the real ECharts SVG renderer without a browser or GPU. They do not establish painted Electron layout or live model behavior; graphical application launch remains explicit.

This increment is an original implementation informed by [dsh-genui](https://github.com/omdsh-dev/dsh-genui), particularly its separation of validation, tool metadata and presentation. It copies no source files and adds no dependency on that package. Future source migration must pin its origin and retain applicable license notices and regression tests.
