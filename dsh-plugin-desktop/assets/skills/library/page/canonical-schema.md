# canonical-schema — canonical schema rules (shared by both the retrofit and create branches)

In this document, "phase N" refers to the execution phases of `modify-branch.md` / `create-branch.md`; the retrofit branch produces the schema via `parse_html.py`, the create branch via the Agent.

## 1. canonical schema rules

### 1.1 Format

```json
{
  "title": "订单管理",
  "page_type": "display | form | mixed",
  "properties": {
    "产品名称": { "text": "" },
    "状态": { "select": { "options": [{ "text": "待发货", "id": "k3x8f2m91jqvbz4a" }, { "text": "已发货", "id": "a7b2c9d41npwke5t" }, { "text": "已送达", "id": "p9m3n7x52rqfhs6y" }] } },
    "价格": { "number": { "decimalPlaces": 2, "useSeparate": false } },
    "下单日期": { "date": "1970-01-01T00:00:00Z" },
    "订单编号": { "text": "" }
  },
  "field_mapping": {
    "产品名称": { "value_type": "text", "form_input": "[name=\"product\"]", "display_selector": "td:nth-child(2)", "render_signal": "th:contains('产品')" },
    "状态":     { "value_type": "select", "form_input": "[name=\"status\"]", "display_selector": ".status-cell", "render_signal": "th:contains('状态')", "options_value_key": "value" },
    "价格":     { "value_type": "number", "form_input": "[name=\"price\"]", "display_selector": ".price-cell", "render_signal": "th:contains('价格')" },
    "下单日期": { "value_type": "date",   "form_input": "[name=\"order_date\"]", "display_selector": "td.date", "render_signal": "th:contains('日期')" },
    "订单编号": { "value_type": "text",   "form_input": null, "display_selector": "td:nth-child(1)", "render_signal": "th:contains('编号')" }
  },
  "options_map": {
    "状态": {
      "pending": { "text": "待发货", "id": "k3x8f2m91jqvbz4a" },
      "shipped": { "text": "已发货", "id": "a7b2c9d41npwke5t" },
      "delivered": { "text": "已送达", "id": "p9m3n7x52rqfhs6y" }
    }
  },
  "source": "...",
  "sdk_calls_found": false,
  "confidence": "high",
  "needs_database": { "level": "strong | medium | weak | none", "reason": "..." }
}
```

- The top-level keys of `properties` / `field_mapping` / `options_map` must be **exactly identical** (same language, same characters) and correspond one-to-one.
- The PropertyConfig type is a oneof: `text`/`number`/`select`/`multi_select`/`date`/`checkbox`/`url`/`email`/`phone_number`/`image` (protocol field names, never translated). Table creation uses `PropertyConfig`, record writes use `PropertyValue` — see `../database/entry.md`.

### 1.2 Field names

Follow the user's requested field-name language, or the conversation language when none is specified. Preserve existing schema field names unless the user requests a rename. For a new schema, use the term table only when its target language matches the requested language. Keep the keys of `properties`, `field_mapping`, and `options_map` identical whenever a field is renamed; protocol type names remain unchanged.

### 1.3 Field ordering

Order by **primary identifier → core business field → time → ID**:

1. **Primary identifier** (text only): `名称`/`标题`/`产品名称`/`姓名`/`name`/`title`, etc.
2. **Core business fields**: amount, status, phone, stock level, etc.
3. **Time-related**: `日期`/`时间`/`created_at` go later (unless the table's core subject is itself time-based, e.g. a "schedule" or "check-in" table)
4. **ID / sequence number / code**: `id`/`订单编号`/`单号`/`序号` go last

- `form`: `properties` follow the ordering above, but **when displayed to the user** follow the form's original input order
- `display`: the `properties` order is the final order; `mixed`: primarily follows the display view's field order
- Retrofit branch: the script has already ordered fields — do not reorder (unless the user explicitly asks in phase 2); create branch: the Agent outputs fields already ordered correctly

### 1.4 field_mapping

`map<fieldName, MappingEntry>`, with keys corresponding one-to-one to `properties`.

- `value_type` — string — same as PropertyConfig, required
- `form_input` — string | null — the form input selector (read by addRecord); `null` if not in a form. Required
- `display_selector` — string | null — the display-render selector (written by renderData); `null` for a pure form page. Required
- `render_signal` — string — the HTML signal used to recognize the field (e.g. `th:contains('产品')`), required
- `options_value_key` — `"value"` | `"text"` — required only for `select`/`multi_select`

**Selector priority** (high→low): `[name="..."]` > `[data-field="..."]` > `#id` > `.first-class` > `td:nth-child(N)` / `:nth-child(N)`. Positional selectors are the last resort.

- Retrofit branch: selectors are collected by `parse_html.py` — **never guess them**; create branch: the selector is a commitment made when phase 4 writes the HTML.
- `options_value_key`: `"value"` if every `<option>` carries a `value`; otherwise `"text"`.
- When a field name/order changes, rename the `field_mapping` key to match; selector content stays unchanged.

### 1.5 Option IDs and OPTIONS_MAP

Every `SelectOption` for `select`/`multi_select` must carry an `id` (16-character alphanumeric):

- Retrofit branch: `parse_html.py` generates it with `secrets.token_urlsafe(12)[:16]`
- Create branch: the Agent generates it with `Math.random().toString(36).slice(2, 10) + Date.now().toString(36)`
- **Never replace** an already-generated ID; `options_map[fieldName][...].id` must match `properties[fieldName].select.options[].id`.

`options_map` has the shape `map<fieldName, map<secondaryKey, {text, id}>>`, where the secondary key is determined by `field_mapping[fieldName].options_value_key`. Phase 4 **copies this block over verbatim** — never reconstruct it.

**Runtime options must be fetched dynamically, never hard-coded**: `<option>` elements are rendered dynamically after calling `db.getSchema`; the `{text,id}` map used on submit is built from `db.getSchema`'s `config.options`; filter options / field metadata likewise prefer `db.getSchema`. The static `options_map` is only used for the table's initial options + lint validation — it has no effect at runtime.

### 1.5.5 database binding markers (`data-sp-bindable` / `data-sp-database-id`) · single source of truth

Both branches, the presentation format (`wbp-presentation-contract.md`), and Page editing (`edit-flow.md`) all reference this section.

**When to mark**: when an element's text comes **directly from** a database (written by `renderData()`) or is **indirectly derived from** one (a statistic/aggregate/count, e.g. "共 128 单" or a KPI number), add **both** of the following:

- `data-sp-bindable` = `"database"`
- `data-sp-database-id` = `"<databaseId>"` (for multi-table derivations, use the primary source; hard-code the literal value)

**When not to mark**: hard-coded text, form input controls, plain containers. **Granularity**: mark the innermost element that actually carries the text — never the outer container.

```html
<div><p data-sp-bindable="database" data-sp-database-id="db_xxx">共 128 单</p></div>  <!-- mark the inner p -->
```

**Runtime sync**: when writing to the DOM, set both `setAttribute('data-sp-bindable','database')` and `setAttribute('data-sp-database-id', DATABASE_ID)` together. Hard-checked by DSDK011 / DSDK012.

### 1.6 Field-mapping and SDK-usage self-check

If either check fails → **do not** emit the final HTML; go back and redo the field mapping. Bypassing a failed lint is never allowed.

- A lint failure or an unavailable tool must be reported explicitly: if either of the two lints fails, errors out, or its environment is unavailable → stop and explicitly tell the user; never redirect errors away (e.g. `2>/dev/null`), silently skip, or pass it off as "partially passed" — a check that didn't run is equivalent to no check at all.
- Deep checks are deferred: once these three self-checks pass, proceed to upload/delivery; extended checks (external link reachability, JS syntax/DOM checks, call-chain cycle detection, jsdom smoke tests) are moved to after the delivery receipt and are budget-constrained (≤2 rounds).

#### First check: lint_schema.py (must run before emitting the final HTML)

```bash
echo '<canonical_schema_JSON>' | python3 "${CLAWCLAW_SKILL_DIR}/page/lint_schema.py" --stdin
# if the HTML is available locally, also validate selectors
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_schema.py" --schema '<JSON>' --html "<path/to/page.html>"
```

Output → exit code → handling:
- `MINDX_LINT_OK` → 0 → passed, proceed to phase 4
- `MINDX_LINT_FAIL <rule_code> <fieldName>: <reason>` → 2 → do not emit HTML; fix per the rule code and rerun
- stderr + exit 1 → 1 → malformed input schema JSON

Rules:
- R1 — a top-level contract field is missing (title/page_type/properties/field_mapping/options_map) — fix: rerun `parse_html.py` or check the phase-2 edits
- R2 — `properties` / `field_mapping` keys don't match — fix: when renaming a field, sync the rename to the `field_mapping` key too
- R3 — malformed selector — fix: copy it directly from the script's output, don't stuff in natural language
- R4 — select/multi_select missing `options_value_key` — fix: add it ("value"/"text")
- R5 — PropertyConfig oneof conflict — fix: a field may only have one type key
- R6 — an option is missing text/id, or ids are duplicated — fix: copy option ids directly from the script's output
- R7 — `options_map` missing, or its ids don't match `properties` — fix: sync ids in both places when an option changes
- R8 — page_type is display/mixed but every field's `display_selector` is null — fix: at least one display field must have a selector
- R9 — page_type is form/mixed but every field's `form_input` is null — fix: at least one form field must have a selector
- R10 — (with `--html`) a selector has no match in the HTML — fix: go back to `field_mapping` and get the real selector

#### Second check: lint_database_sdk_usage.py (must run after emitting the final HTML, before upload)

Fetch the real server-side schema first, then validate the final HTML.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/get_database_schema.py" --database-id "<database_id>"
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_database_sdk_usage.py" --schema '<get_database_schema_stdout_JSON>' --html "<path/to/final.html>"
```

stdout → exit code → meaning:
- `MINDX_DBSDK_LINT_OK` → 0 → passed, ready to upload
- `MINDX_DBSDK_LINT_FAIL <rule_code> <target>: <reason>` → 2 → fix the HTML and rerun
- stderr + exit 1 → 1 → unreadable or malformed schema/HTML input

Rules:
- DSDK001 — the SDK method isn't one of `query/addRecord/getRecord/updateRecord/deleteRecord/getSchema` — fix: check `database-sdk-contract.md` §2/§6
- DSDK002 — an SDK call is missing `databaseId` and there's no `DATABASE_ID` constant — fix: add `databaseId` or define `DATABASE_ID`
- DSDK003 — `properties["fieldName"]` isn't in `schema.properties` — fix: replace with a real schema field name
- DSDK006 — `row["fieldName"]` isn't in `schema.properties` — fix: have renderData read using the schema's field names
- DSDK007 — the HTML has no database SDK calls at all — fix: add `db.query`/`db.addRecord`/`db.getRecord`
- DSDK009 — `sorts`/`filter`/`fields` reference a field that doesn't exist in the schema — fix: field names must come from `db.getSchema()`
- DSDK010 — reading data via `.records`/`.success`/`.data` — fix: only take the array from `result.results`
- DSDK011 — the two binding attributes aren't paired, or hold an invalid value — fix: add both together, values per §1.5.5
- DSDK012 — the HTML has `query`/`getRecord` + DOM writes but zero `data-sp-bindable` — fix: add markers per §1.5.5

#### Third check: manual checklist

- `properties` keys — must match `schema.properties` character-for-character; Chinese keys must never be written in English
- `addRecord` selectors — must all come from `field_mapping[fieldName].form_input`
- OPTIONS_MAP — no hard-coded constants; options are populated into `SCHEMA_OPTIONS` via `db.getSchema`, and `<option>` elements are rendered dynamically by `renderSelectOptions()`
- select/multi_select submitted value — `option.value` is set to `opt.id`, and submission reads `selectEl.value` directly
- the `row[xxx]` key inside `renderData` — must be the schema field name, never an HTML class/id or an English alias
- rendering-element selectors — must all come from `field_mapping[fieldName].display_selector`; display fields must not be null
- `field_mapping`/`options_map` vs `properties` — keys must have been synced/renamed after any field name/order change
