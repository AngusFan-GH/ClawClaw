# GenUI result cards

English | [中文](genui.zh.md)

GenUI implements opt-in result cards with local chart and table interactions. It does not replace the upstream Markdown renderer, observe the conversation DOM, or change layout ownership. The pinned upstream checkout is unchanged.

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

## Protocol and ownership

Supported types are `text`, `card`, `row`, `stat`, `table`, `progress`, `callout` `steps` and `chart`. Text is literal; no HTML, arbitrary styles, executable expressions or model actions are interpreted. Tables sort locally and use semantic table headers with sort state. Limits are 64 KiB of serialized JSON, 200 components, eight component levels, 50 table rows, 12 columns, 24 steps, 2,000 characters per text field and 160 per title or label. Invalid or oversized documents produce diagnostics instead of silently discarding data. No repair is attempted.

The Host validates the document and uses the tool output contract to project it into replayable `meta`, while preserving a readable text result. The Client validates that metadata again. It renders settled results only; preparing/running arguments never become interactive UI. Independent successful results in each Turn are shown in order in the answer's public tail, outside collapsed work details. An optional nonblank `resultId` (at most 160 characters) replaces the result with the same ID in that Turn, preserving its original position. Omit the ID for a new result. Failed or invalid updates cannot replace a valid card; unrecognized metadata retains its saved text separately. This reads the owning Session's Turn-scoped Chat projection, including nested PTC results and hidden process nodes; it restores from history without another model call. The original tool result remains in work details. Missing, invalid or future metadata falls back to saved text. Session and call identity come from the owning view. Local sorting is ephemeral and does not write shared state or send model messages.

The feature follows confirmed Host configuration and disposes its tools, prompt, slot and styles. There is no independent result database or browser persistence. Forms, action delivery, durable drafts, exports, inline fences and sidechat integration remain subsequent work; this increment does not establish their routing or persistence guarantees.

## Charts and presentation

Charts use Apache ECharts with SVG rendering. The `chart` node accepts `kind` (`bar`, `line` or `pie`), a `title`, `categories`, `series` (each with a unique `name` and `values`) and an optional `unit`. For example:

```json
{ "type": "chart", "kind": "bar", "title": "Service requests", "categories": ["API", "Worker", "Cache"], "series": [{ "name": "Requests", "values": [20, 4, 100] }], "unit": "requests" }
```

A document allows eight charts, each with at most 60 categories and four series. Pie charts allow 12 categories and one nonnegative series. Values must be finite and have magnitude at most 10^15. Bar and line charts accept `null` for missing values; zero remains zero. Series lengths must match categories. Arbitrary ECharts options, code and HTML are rejected.

Legend toggles only affect the current local view. Pie legends show values and shares of the currently visible categories, with an explicit scope explanation after filtering and a Restore all action. Their data tables always retain all categories and shares of the original total. Single-series bar/line charts show a series label without an unnecessary toggle. Every chart includes an expandable semantic data table; empty, all-hidden, all-missing and zero-sum pie data each explain the specific reason. Hidden data can be restored with one action. Rendering failures automatically expand the data table. Charts resize with the container and follow light/dark themes. Long-name or more-than-eight-category bars use a horizontally oriented comparison with vertical scrolling. Trends with more than 12 categories scroll horizontally, preserving all points and their source order. Plot heights follow content, with bounded scroll viewports. Keyboard users can scroll the plot region and expand the exact data table. Unmounting disposes charts and observers. Cards use theme colors, grouped metrics, restrained borders, numeric table alignment and compact progress bars. Callouts distinguish info, success, warning and error with labels, icons and semantic accent colors. The model is instructed to provide concise conclusions without repeating card data. The General setting includes a concrete example request.

## Verification and provenance

Run the focused GenUI suites, typecheck, build and the standard headless gate. Tests exercise the real DSH tool registry, serialize and restore a Session result, check profile upgrade/enablement, render components in jsdom, and exercise the real ECharts SVG renderer without a browser or GPU. They do not establish painted Electron layout or live model behavior; graphical application launch remains explicit.

This increment is an original implementation informed by [dsh-genui](https://github.com/omdsh-dev/dsh-genui), particularly its separation of validation, tool metadata and presentation. It copies no source files and adds no dependency on that package. Future source migration must pin its origin and retain applicable license notices and regression tests.
