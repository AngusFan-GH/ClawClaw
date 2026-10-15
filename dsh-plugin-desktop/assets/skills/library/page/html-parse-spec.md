# HTML Parsing Strategies and Field-Type Inference Rules

`parse_html.py` extracts a data-table structure (schema) from an HTML file. This document describes the parsing strategies and inference rules.

---

## Preprocessing

### Body extraction

Before running any strategy, the script first extracts the `<body>` content, **ignoring** the `<meta>`, `<link>`, `<style>`, and external `<script src>` references inside `<head>`.

- If `<body>` exists → only the HTML and inline `<script>` inside body are analyzed.
- If `<body>` doesn't exist (an HTML fragment) → the whole text is analyzed as-is.
- `<title>` is extracted separately as a table-name reference (appended to the output's `title` field).

**Benefit**: avoids CSS/meta in the head interfering with strategy matching; saves the agent 30–40% of tokens when reading the output.

### Multi-strategy merging

The script no longer "returns as soon as the first strategy succeeds" — instead it **collects the results of every matching strategy and merges them**:

- Each table carries a `confidence` field (`high` / `medium` / `low`).
- Tables with the same name have their fields merged (deduplicated), keeping the higher confidence.
- The `source` field lists every matching strategy's origin (e.g. `"table_structure+form_structure"`).
- **The one exception**: when Strategy 1 (an existing `__SMART_PAGE__.database` call) matches, it returns immediately without merging.

---

## Parsing strategies

### Strategy 1: an existing `__SMART_PAGE__.database` call (confidence: high)

Scans the content of `<script>` tags for a regex match:

```
__SMART_PAGE__\.database\.(addRecord|getRecord|query)\s*\(\s*\{[^}]*databaseId\s*:\s*['"](\w+)['"]
```

- Extracts the databaseId (capture group 2).
- The SDK method set is kept consistent with `database-sdk-contract.md` §10.
- This strategy can only extract the databaseId; fields must be inferred later from the actual call arguments.
- **When this strategy matches, it returns immediately, without merging other strategies.**

### Strategy 2: HTML `<table>` structure parsing (confidence: high)

Matching condition: the HTML contains a `<table>` tag with `<thead>` / `<th>`.

Parsing steps:

1. Extract every `<table>` tag (multiple tables are supported).
2. For each `<table>`:
   - Extract field names from the `<th>` tags.
   - Collect **up to 20 rows** of `<td>` data, used for multi-value type inference.
   - Table name: taken from the `<table>`'s `id` / `data-table` attribute; falls back to `table_N` if absent.
3. **Enhancement**: supports select-enum inference — if a column's values form a bounded enum (≤10 distinct values, repeating), it's automatically inferred as `select` with `options` attached.

Example input:
```html
<table id="orders">
  <thead>
    <tr>
      <th>订单号</th>
      <th>产品</th>
      <th>价格</th>
      <th>日期</th>
      <th>状态</th>
    </tr>
  </thead>
  <tbody>
    <tr><td>ORD-001</td><td>iPhone 15</td><td>¥7999</td><td>2026-01-15</td><td>已发货</td></tr>
    <tr><td>ORD-002</td><td>MacBook</td><td>¥14999</td><td>2026-01-16</td><td>待处理</td></tr>
    <tr><td>ORD-003</td><td>AirPods</td><td>¥1299</td><td>2026-01-17</td><td>已发货</td></tr>
  </tbody>
</table>
```

Inferred result:
```json
{
  "name": "orders",
  "fields": [
    { "name": "order_id", "type": "text", "description": "订单号" },
    { "name": "product", "type": "text", "description": "产品" },
    { "name": "price", "type": "number", "description": "价格" },
    { "name": "date", "type": "date", "description": "日期" },
    { "name": "status", "type": "select", "description": "状态", "options": ["已发货", "待处理"] }
  ],
  "confidence": "high"
}
```

### Strategy 3: `<form>` structure parsing (confidence: high)

Matching condition: the HTML contains a `<form>` tag with `<input>` / `<select>` / `<textarea>` inside it.

Applicable scenarios: sign-up forms, registration forms, feedback forms, questionnaires, check-in forms, and other **write-oriented** pages.

Parsing steps:

1. Extract every `<form>` tag.
2. For each `<form>`:
   - Extract field name and type from `<input name="xxx" type="yyy">`.
   - Extract a select field from `<select name="xxx">`, using the `<option>` values as `options`.
   - Recognize `<select multiple>` as `multi_select`.
   - Extract a text field from `<textarea name="xxx">`.
   - Associate a field description from `<label for="id">`.
   - Table name: taken from the `<form>`'s `id` / `data-table` attribute; falls back to `form_N` if absent.
3. Ignore `type="submit"` / `type="button"` / `type="reset"` / `type="image"`.

Mapping from input type → database field type:

- `text` / `hidden` / `password` → `text`
- `email` → `email`
- `tel` → `phone_number`
- `url` → `url`
- `number` / `range` → `number`
- `date` / `datetime-local` / `month` / `week` → `date`
- `checkbox` → `checkbox`
- `color` → `text`
- `file` → `file`
- `time` → `text`

Example input:

```html
<form id="registration">
  <label for="name">姓名</label>
  <input id="name" name="name" type="text" required>

  <label for="email">邮箱</label>
  <input id="email" name="email" type="email">

  <label for="phone">电话</label>
  <input id="phone" name="phone" type="tel">

  <label for="dept">部门</label>
  <select id="dept" name="department">
    <option>技术部</option>
    <option>产品部</option>
    <option>设计部</option>
  </select>

  <label for="skills">技能（多选）</label>
  <select id="skills" name="skills" multiple>
    <option>前端</option>
    <option>后端</option>
    <option>设计</option>
  </select>

  <button type="submit">报名</button>
</form>
```

Inferred result:

```json
{
  "name": "registration",
  "fields": [
    { "name": "name", "type": "text", "description": "姓名" },
    { "name": "email", "type": "email", "description": "邮箱" },
    { "name": "phone", "type": "phone_number", "description": "电话" },
    { "name": "department", "type": "select", "description": "部门", "options": ["技术部", "产品部", "设计部"] },
    { "name": "skills", "type": "multi_select", "description": "技能（多选）", "options": ["前端", "后端", "设计"] }
  ],
  "confidence": "high"
}
```

### Strategy 4: `data-*` attribute parsing (confidence: high)

Matching condition: the HTML contains a `data-table` or `data-field` attribute.

```html
<div data-table="users">
  <span data-field="name">张三</span>
  <span data-field="email">zhangsan@example.com</span>
  <span data-field="age">28</span>
</div>
```

- `data-table` → the table name.
- `data-field` → the field name.
- The field type is inferred from the element's content.

### Strategy 5: template-placeholder parsing (confidence: medium)

Matching condition: the HTML contains `{{xxx}}` or `${xxx}` template syntax.

```html
<div class="card">
  <h2>{{product.name}}</h2>
  <p>价格：{{product.price}}</p>
  <p>日期：{{product.created_at}}</p>
</div>
```

- A placeholder with a `.` → the part before it is the table name, the part after is the field name.
- A placeholder with no `.` → it's the field name; the table name must be inferred separately.
- Marks `html_has_template_syntax: true`.

### Strategy 6: fetch/XHR/axios call parsing (confidence: medium)

Scans `<script>` content for network-request calls:

```javascript
fetch('/api/orders?page=1&limit=10')
fetch('/api/products')
axios.get('/api/users')
```

Supported patterns:
- `fetch('/api/xxx')` / `fetch("https://host/api/xxx")`
- `XMLHttpRequest.open('GET', '/api/xxx')`
- `axios.get('/api/xxx')` / `axios.post('/api/xxx')` / `axios.put` / `axios.delete` / `axios.patch`

Extracts the table name from the URL path segment (e.g. `/api/orders` → `orders`).

### Strategy 7: repeated-structure detection (confidence: medium)

Solves card/list layouts: detects groups of **structurally isomorphic, repeated sibling elements** in the DOM and extracts the shared child elements as fields — product card lists, personnel-info cards, news/article lists, any repeated `<div>` structure.

Example input:
```html
<div class="product-card">
  <img src="phone.jpg">
  <h3>iPhone 15</h3>
  <span class="price">¥7999</span>
  <span class="category">手机</span>
</div>
<div class="product-card">
  <img src="laptop.jpg">
  <h3>MacBook Pro</h3>
  <span class="price">¥14999</span>
  <span class="category">电脑</span>
</div>
```

Detection logic:
1. Walk the DOM tree, grouping sibling elements by tag.
2. For each group of same-tag elements, compare the tag sequence (signature) of their children.
3. Identical signature and count ≥ 2 → judged as a repeated structure.
4. Infer field names from the children's CSS class / tag.
5. Collect the text at every repeated item's corresponding position, for multi-value type inference.

#### Sub-strategy 7.5: `<ul>/<ol>/<dl>` list parsing (confidence: low)

Falls back to detecting semantic list tags when Strategy 7's main logic doesn't match:

- Structurally identical `<li>` elements within `<ul>/<ol>` → extract their children as fields.
- `<dt>/<dd>` pairs within `<dl>` → each pair maps to one field.

Example:
```html
<ul class="todo-list">
  <li>
    <span class="title">完成报告</span>
    <span class="due">2026-05-20</span>
    <span class="status">进行中</span>
  </li>
  <li>
    <span class="title">代码评审</span>
    <span class="due">2026-05-21</span>
    <span class="status">待处理</span>
  </li>
</ul>
```

### Strategy 8: div pseudo-table detection (confidence: medium)

**A newly added strategy** — solves the problem of not being able to recognize CSS Grid/Flexbox-simulated tables.

Detects grids in a `<div>` layout that have a header/cell structure:

```html
<div class="grid">
  <div class="header">姓名</div><div class="header">部门</div><div class="header">职级</div>
  <div class="cell">张三</div><div class="cell">技术</div><div class="cell">T9</div>
  <div class="cell">李四</div><div class="cell">产品</div><div class="cell">P7</div>
</div>
```

Detection logic:
1. The DOM parser detects children with a `header`/`head`/`th`/`title` class → treated as headers.
2. Detects children with a `cell`/`td`/`col`/`data`/`value` class → treated as data.
3. Verifies the cell count is an integer multiple of the header count.
4. Groups by column for multi-value type inference.

Fallback: if the DOM parser finds no match, use a regex to detect divs whose `class` contains `header`/`cell`.

### Strategy 9: inline JavaScript data-object extraction (confidence: medium)

**A newly added strategy** — solves the problem of not being able to recognize JS-dynamically-rendered pages.

Extracts JS array/object literals from `<script>`:

```html
<script>
  const data = [
    { name: "张三", age: 28, dept: "技术部" },
    { name: "李四", age: 32, dept: "产品部" },
  ];
</script>
```

Detected patterns:
- `const/let/var xxx = [{ ... }]` — an array assigned to a variable.
- `xxx: [{ ... }]` — an array as an object property.

Excluded variable names (not treated as data): `options`, `config`, `settings`, `plugins`, `routes`, `headers`, `columns`, `rules`, `validators`, `styles`.

Extraction logic:
1. Regex-match the array variable/property.
2. Extract the keys of the first object as field names.
3. Extract the corresponding values for type inference.
4. Convert the variable name from camelCase → snake_case to form the table name, stripping the `_data`/`_list`/`_items` suffix.

---

## Type-inference table

### Single-value inference

When inferring a field type from HTML content, apply the following rules:

- Pure numeric (including decimals) → `number` — examples: `42`, `3.14`, `1,000`
- Contains a currency symbol → `number` — examples: `¥7999`, `$29.99`, `€100`
- Contains a percent sign → `number` — examples: `85%`, `3.14％`
- A date format → `date` — examples: `2026-01-15`, `01/15/2026`, `2026年1月`
- An email format → `email` — example: `user@example.com`
- A URL format → `url` — examples: `https://example.com`, `http://...`
- A phone format → `phone_number` — examples: `13800138000`, `+86-138-0013-8000`
- A boolean value → `checkbox` — examples: `true/false`, `是/否`, `✓/✗`, `yes/no`
- Anything else / default → `text` — plain text

### Multi-value inference (enhanced)

When ≥2 sample values have been collected, run a joint multi-value inference:

- Base type is text, ≤10 distinct values, and repetition observed → `select` (a bounded enum, with `options` attached).
- Base type is text, >50% of values contain a comma/Chinese-comma separator → `multi_select` (a multi-value selection).
- Anything else → take the most common type (majority vote).

---

## Field-name normalization

Chinese-header mapping, CSS class inference, and JS variable normalization live in `../database/field-normalization.md`. This file does not duplicate the bodies — Strategies 7/8/9 reference that file when they need the matcher behavior.

---

## Confidence levels

Every table and the overall result carry a `confidence` field:

- `high` — meaning: the structure is clear and field information is complete — applicable strategies: Strategy 1 (SDK call), 2 (table), 3 (form), 4 (data-*).
- `medium` — meaning: the structure can be inferred, but fields may be incomplete — applicable strategies: Strategy 5 (template), 6 (fetch), 7 (repeated structure), 8 (div pseudo-table), 9 (JS data).
- `low` — meaning: inference confidence is low; the agent should supplement/confirm — applicable strategy: Strategy 7.5 (ul/ol/dl list).

**Recommended agent decision-making**:
- `high` → can be used directly.
- `medium` → show it to the user for confirmation.
- `low` → treat as a reference only; the agent should add semantic supplementation or ask the user to describe it.

---

## Output format

The script's final output is a **canonical schema** (JSON on stdout), which can be fed directly into `create_database.py`:

```json
{
  "title": "<Chinese-language display name>",
  "page_type": "form | display | mixed",
  "properties": [
    {
      "name": "<Chinese-language field name>",
      "config": { "<oneof type>": "<placeholder value>" }
    }
  ],
  "field_mapping": {
    "<Chinese-language field name>": {
      "value_type": "text | number | select | multi_select | date | checkbox | url | email | phone_number | image",
      "form_input": "string | null",
      "display_selector": "string | null",
      "render_signal": "string",
      "options_value_key": "value | text"
    }
  },
  "options_map": {
    "<Chinese-language field name>": {
      "<value or text>": { "text": "<option text, in Chinese>", "id": "<a 16-char alphanumeric id>" }
    }
  },
  "needs_database": { "level": "strong | medium | weak | none", "reason": "..." },
  "source": "<matching strategies, +-joined>",
  "sdk_calls_found": false,
  "html_has_template_syntax": false,
  "confidence": "high | medium | low"
}
```

### Field descriptions

- **title**: extracted from the HTML `<title>` (already in Chinese); if missing, falls back to a translation of the main table's name.
- **page_type**: inferred from the matched sources.
  - Matched `form_structure` with no display-type source → `form`.
  - Matched `table_structure` / `repeating_structure` / `div_table` / `data_attributes` / `list_structure` / `template_syntax` with no form → `display`.
  - Matched both a form and a display-type source → `mixed`.
- **properties**: `[{ "name": string, "config": PropertyConfig }]` (array form); PropertyConfig is a oneof — see `../database/entry.md` for details.
  - Every SelectOption for select / multi_select carries its own `id` (generated by the script via `secrets.token_urlsafe(12)[:16]`).
- **field_mapping**: the physical-location selector for every schema field within the HTML.
  - Selector priority: `[name="..."]` > `[data-field="..."]` > `#id` > `.first-class` > `td:nth-child(N)` / `:nth-child(N)`.
  - `options_value_key` only applies to select / multi_select: if every `<option>` carries an explicit `value` attribute → `"value"`; otherwise → `"text"`.
- **options_map**: `map<field name, map<second-level key, {text, id}>>`, which stage 4 copies **wholesale** into OPTIONS_MAP when retrofitting the HTML.

> **Multi-table scenario**: when multiple tables exist in the HTML, the script only outputs the table with **the highest confidence + the most fields** as the primary table, discarding the rest. To build multiple tables, call the script multiple times (each time feeding it an HTML fragment containing only one table).

### Special path: the HTML already has the SDK wired up

When Strategy 1 (an `__SMART_PAGE__.database.*` call) matches, **the output format differs from the canonical schema** — the HTML is already wired up to one or more databases, so no table needs to be created and no retrofit is needed:

```json
{
  "existing_databases": [
    { "id": "<database_id_1>" },
    { "id": "<database_id_2>" }
  ],
  "source": "sdk_calls",
  "sdk_calls_found": true,
  "confidence": "high",
  "needs_database": { "level": "strong", "reason": "HTML 已包含 __SMART_PAGE__.database SDK 调用" }
}
```

Field descriptions:
- **existing_databases**: the list of every database binding referenced in the HTML (deduplicated and sorted). Each item contains `id` (the database's unique identifier; the backend now uniformly relates via `id`).
- **sdk_calls_found**: always `true` — the agent uses this to recognize this path.

In this case the agent should: ① recognize `sdk_calls_found=true`; ② skip stages 2–4 (create table / user check / retrofit HTML); ③ go directly to stage 5 to upload the HTML, passing `existing_databases`'s `id`s as the `import_html.py --databases` parameter.

### Parse failure

On a parse failure, the script outputs an empty JSON `{}`, and the agent should prompt the user to describe the table structure.

---

## Companion tool: lint_schema.py (hard verification)

After the user edits the canonical schema output by `parse_html.py` in stage 2, inconsistent fields or mis-edited selectors can appear. `scripts/lint_schema.py` is the companion hard-verification script and **must** be invoked once before stage 4 outputs the final HTML.

### Invocation

```bash
# Verify only the schema's self-consistency
echo '<canonical_schema_JSON>' | python3 "${CLAWCLAW_SKILL_DIR}/page/lint_schema.py" --stdin

# Also verify the selectors actually exist in the HTML (strongly recommended)
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_schema.py" --schema '<JSON>' --html page.html
```

### Output protocol

- `MINDX_LINT_OK` — exit 0 — meaning: passed.
- `MINDX_LINT_FAIL <rule number> <field name>: <reason>` (one line per violation) — exit 2 — meaning: verification failed; fix according to the rule number.
- A brief hint on stderr — exit 1 — meaning: malformed input (not a lint failure).

> Unlike the convention followed by other mindx scripts ("any error silently exits 0"), the lint script **must explicitly surface problems** — that's the whole point of it existing as a "hard verification" step.

### Verification rules

- R1 — all top-level contract fields are present (title / page_type / properties / field_mapping / options_map); the SDK path must have existing_databases.
- R2 — the `properties` / `field_mapping` keys are character-for-character consistent.
- R3 — selectors are well-formed (a simple CSS selector, e.g. `[name="x"]` / `.cell` / `#id` / `td:nth-child(1)` / `:nth-child(1)`, or `null`).
- R4 — select / multi_select must have a valid `options_value_key` ("value" or "text").
- R5 — PropertyConfig's oneof is mutually exclusive: a given field's config may have only one type key.
- R6 — select / multi_select options must include both text and id; the id is globally unique across all fields.
- R7 — select / multi_select fields must have an options_map, and every entry's id matches the id of the same-named option in `properties` (prevents desync after the user edits the options).
- R8 — page_type=display/mixed → at least one field has a non-empty display_selector.
- R9 — page_type=form/mixed → at least one field has a non-empty form_input.
- R10 — (when `--html` is passed) every non-empty selector can find a matching element in the HTML (an existence check across the class/id/attr dimensions).

## Companion tool: lint_database_sdk_usage.py (hard verification)

`lint_database_sdk_usage.py` verifies whether the database SDK calls in the final HTML conform to `database-sdk-contract.md`.

### Invocation

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/get_database_schema.py" --database-id "<database_id>"

python3 "${CLAWCLAW_SKILL_DIR}/page/lint_database_sdk_usage.py" --schema '<get_database_schema_stdout_JSON>' --html page.html
```

`--schema` is recommended to be passed the stdout JSON of `get_database_schema.py`, so field names are guaranteed to come from the real server-side database schema.
Any page flow that has an already-linked database runs this lint; a static-upload flow with no database binding skips it.

### Output protocol

- `MINDX_DBSDK_LINT_OK` — exit 0 — meaning: passed.
- `MINDX_DBSDK_LINT_FAIL <rule number> <target>: <reason>` — exit 2 — meaning: verification failed.
- A brief hint on stderr — exit 1 — meaning: malformed input.

### First-version rules

- DSDK001 — SDK method allowlist: `query` / `addRecord` / `getRecord`.
- DSDK002 — the SDK call includes `databaseId`, or uses a hardcoded `DATABASE_ID` constant.
- DSDK003 — every `properties["field name"]` belongs to `schema.properties`.
- DSDK006 — every `row["field name"]` belongs to `schema.properties`.
- DSDK007 — the HTML contains a database SDK call.
- DSDK011 — `data-sp-bindable` / `data-sp-database-id` appear as a pair, with valid values.
- DSDK012 — any page that reads and renders database data (`query`/`getRecord` + a DOM write) must carry a binding annotation.



## Appendix: HTML data-source recognition priority (fallback-scenario quick reference)

> Only used in the retrofit branch's stage 1 step 2 **fallback scenario**: when `parse_html.py` returns `{}`, the agent infers the data structure from the HTML itself.
>
> Under normal circumstances `parse_html.py` already covers Strategies 1–9 and produces the canonical schema directly — the agent does **not** need to analyze from scratch.

- Priority 1 (highest) — signal: the HTML already has an `__SMART_PAGE__.database.*` call — script coverage: yes (Strategy 1) — handling: no table creation/retrofit needed; extract the databaseId directly and upload.
- Priority 2 — signal: a `<table>` in the HTML has clear headers — script coverage: yes (Strategy 2) — handling: infer field names from `<th>`, infer types from multiple `<td>` rows (including select enums).
- Priority 3 — signal: a `<form>` in the HTML contains `<input>` / `<select>` — script coverage: yes (Strategy 3) — handling: extract fields from input name/type and select options.
- Priority 4 — signal: `data-table` / `data-field` attributes exist in the HTML — script coverage: yes (Strategy 4) — handling: extract table name and field names from the attributes.
- Priority 5 — signal: `{{xxx}}` / `${xxx}` template placeholders exist in the HTML — script coverage: yes (Strategy 5) — handling: infer field names from the placeholders.
- Priority 6 — signal: fetch/XHR/axios calls in the HTML — script coverage: yes (Strategy 6) — handling: infer from the URL path and parameter names.
- Priority 7 — signal: a repeated DOM structure (card/list layout) — script coverage: yes (Strategy 7) — handling: isomorphic sibling-element detection + extract fields from child elements.
- Priority 8 — signal: a semantic `<ul>/<ol>/<dl>` list — script coverage: yes (Strategy 7.5) — handling: extract fields from `<li>` children / `<dt><dd>` pairs.
- Priority 9 — signal: a div pseudo-table (Grid/Flexbox simulation) — script coverage: yes (Strategy 8) — handling: header/cell class detection + column-grouped inference.
- Priority 10 — signal: an inline JavaScript data object — script coverage: yes (Strategy 9) — handling: extract keys as fields from `const xxx = [{...}]`.
- Priority 11 (lowest) — signal: purely static content, no signal at all — script coverage: no — handling: prompt the user to describe the table structure.
