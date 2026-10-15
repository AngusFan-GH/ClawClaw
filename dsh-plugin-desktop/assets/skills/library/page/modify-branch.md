# modify-branch — Retrofit branch · existing HTML (parse → create table → retrofit → upload)

Entry conditions and pre-dispatch gate: see `data-page-flow.md`. §1.x references in this doc refer to sections of `canonical-schema.md`; upload always goes through `import-flow.md`.

## 3. Retrofit branch · existing HTML (parse → create table → retrofit → upload)

### Phase 1: Parse HTML → canonical schema

The script is the **only** place schema gets generated; the Agent only fills gaps when the script fails or fields are missing — never generate a schema from scratch.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/parse_html.py" --html "<path/to/page.html>"
```

The script performs, in one pass, parsing (see `html-parse-spec.md`) + field translation / ordering / selector collection / `options_value_key` inference / option ID generation / `page_type` / `needs_database` determination.

- `properties` non-empty → proceed to phase 2 (even at low confidence, trust the script's output — do not rewrite it)
- `properties` empty or `{}` → fallback

**Fallback** (only when script fields are empty and the user has explicitly asked to connect data): preconditions are ① user has expressed intent to "connect data" ② script result is empty; if either is unmet, return to `data-page-flow.md`'s pre-dispatch gate for re-dispatch. When reading HTML, only look at `<body>` and its `<script>` tags, ignore `<head>`: read the full text if <200KB; for 200–500KB read the first 500 lines + search for key structures; for >500KB ask the user to describe the structure. Output format same as §1.1.

**Special case**: if the HTML already contains `__SMART_PAGE__.database.*` calls → the script marks `sdk_calls_found:true`, skip phase 4. If fallback still cannot identify a structure → reply: `{{未能从 HTML 中识别出数据结构。你可以直接描述需要的表结构（如「订单表，含产品名、价格、日期」），我按你描述建表。}}`

### Phase 2: Confirm schema (graded by information completeness)

**Skip if strong**: skip this confirmation gate and go straight to phase 3 to create the table whenever the user's message lets you identify the domain and the managed objects. That covers listing fields, fields + options, or an explicit module list — and equally a one-sentence workbench ask with a clear object ("a workbench for weekly task planning and progress" → task + status + dates; "an expense tracker" → date/amount/category): design the standard fields yourself, build immediately, and note after delivery that fields can be adjusted. Minor tweaks are collected after delivery, never let the confirmation gate block delivery. Only a request whose managed object cannot be inferred at all (e.g. "build me a tool", no hint of what it manages) goes through the confirmation gate below.

**Must wait for an explicit user reply** before proceeding to phase 3 — silence ≠ confirmation. Display (field names / option labels default to Chinese, ordered per §1.3, primary identifier in the first column):

```
{{请 check 以下 Database 字段（默认中文展示，已按重要性排序，首列为主标识字段）：}}

**订单管理**
| 字段名 | 类型 | 说明 |
|--------|------|------|
| 产品名称 | 文本 | 下单的产品名（首列） |
| 状态 | 单选 | 待发货 / 已发货 / 已送达 |
| 价格 | 数字 | 订单金额 |
| 下单日期 | 日期 | 下单时间 |
| 订单编号 | 文本 | 订单唯一标识 |

{{请回复：}}
- {{确认 / OK / 可以}} → {{我开始建表}}
- 直接说明要改的地方（如「『订单编号』改成『单号』」「价格用文本类型」「用英文字段名」「加个『备注』字段」「把『下单日期』放第二列」）→ 我调整后重新展示
```

**Type-to-Chinese display mapping** (display only — the schema itself still uses the English oneof key): `text`={{文本}}、`number`={{数字}}、`select`={{单选}}、`multi_select`={{多选}}、`date`={{日期}}、`checkbox`={{是否}}、`url`={{链接}}、`email`={{邮箱}}、`phone_number`={{电话}}.

User reply → handling:
- "确认 / OK / 可以 / 好的 / 没问题" → proceed to phase 3
- Requests to change a field / type / option → adjust, redisplay, wait for confirmation again
- Requests to reorder fields → reorder the `properties` key order, then redisplay; this does not retrigger the §1.3 re-sort — respect the user's order
- "用英文字段名" (use English field names) → switch the `properties` key and option text to English, then redisplay
- Silence / off-topic reply → do not proceed to phase 3; may ask once more "{{是否确认创建？}}"

### Phase 3: Create the database

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/create_database.py" --schema '<JSON>'
```

`<JSON>` is the complete schema output from phase 1 (including `title` and `properties`).

**Existing linked table gate**: if the page being retrofitted already has a linked database with business data (from a previous delivery), don't create a second table — evolve the existing schema per `schema-evolution.md` §11.1 instead; restructuring with data present follows its data-migration rule.

- Success → stdout `{"database_id":"...","space_id":"...","property_count":N,"properties":[...]}`; `properties` is the real server-side schema after table creation (including server-generated option ids).
- Failure → exit 0 silently.

**From this phase on, the only trustworthy field list is the `properties` returned by `create_database`** (not what phase 1 remembered). All field names / field ids / option ids in phase 4 must be taken from this.

**Space alignment (mounting precondition)**: if the phase-5 upload will pass `--space-id` (user named a target space), the schema JSON passed here must carry the same `space_id` — `create_database.py` reads it from the schema (title / properties / optional `space_id`); a table created in a different space than its page cannot be mounted under it in phase 5.

### Phase 4: Retrofit HTML — inject `__SMART_PAGE__.database`

The platform auto-injects the SDK; `window.__SMART_PAGE__.database` is immediately available. Templates, value shapes, pagination safeguards, image-upload sequence, and type conversion live in `sdk-templates.md` (shared with the create branch) — read it once and work from it; `database-sdk-contract.md` only when a need goes beyond those templates.

- Hard-code `databaseId` into the HTML (the value comes from phase 3).
- **Write pre-check field whitelist**: `sorts`/`filter`/`fields[]`/`row["fieldName"]`/`properties["fieldName"]` may only reference fields present in the `properties` returned by phase 3 — never invent one; before sorting by time, confirm the field list actually has a matching date field.

Signal → retrofit action:

- Read & display: `<table>`, lists, cards, charts, `{{placeholder}}` → render via `db.query` (case 2)
- Form submission: `<form>`, `<input>`, submit button → write via `db.addRecord` (case 3)
- Mixed: both a form and a display area present → case 4

**Case 1 — SDK calls already present**: leave unchanged.

**Retrofit principles**:

- Only touch the data-interaction logic — CSS / layout / animation stay unchanged; still a single file, script inline; must not error out in an environment without the SDK.
- **Truncation must be declared in the receipt**: when the user explicitly asks for only part of the data (Top N / latest N), render that part and mark `{{数据完整=已确认截断(<reason>)}}` in the receipt `QUALITY_OK` to pass (DSDK015 still FAILs; the receipt self-declaration exempts it, see `page-quality-check.md` §4/§5); otherwise render the full set.
- Stay ES5-compatible (`function`/`var`); wrap SDK calls in try/catch; disable the button while submitting.
- database binding markers follow §1.5.5 (DSDK011/012); never hard-code `<option>` — render after `db.getSchema`.
- **Local caching of form input**: whenever `addRecord` is present, cache only the fields that actually get submitted (`form_input != null`) into `localStorage` (debounce 300ms on `input`/`change`, clear on success, keep on failure, refill after `renderSelectOptions()`); skip `password`/`data-no-cache` fields and any field matching `密码·身份证·secret·token·key`; never cache search/filter/decorative controls; degrade silently if storage is unavailable. Verified by DSDK008.
- **Pre-submit image caching**: whenever `uploadImage` is present, store the picked `File` in IndexedDB as soon as it's selected (`localStorage` only stores a reference flag); restore the preview from IndexedDB after a full page reload, and clear it only once `addRecord` succeeds (details in database-sdk-contract.md §7.1). The `file` object itself goes through IndexedDB, **not** the text-based `localStorage` cache above. Verified by DSDK008.

### Phase 4.5: Field-mapping self-check (mandatory)

Run `lint_schema.py` before producing output; run `lint_database_sdk_usage.py` after generation and before upload (see §1.6). Both must pass before uploading.

A `MINDX_LINT_FAIL` is a hard stop, not a hint: fix the schema per the rule code and rerun until `MINDX_LINT_OK`. Never answer a FAIL with a source-code walkthrough, a different check (syntax check, another lint), or a judgment that the failure is acceptable; genuinely unfixable → stop and tell the user which rule failed — never report success.

### Phase 4.6: Product quality gate (mandatory, see `page-quality-check.md`)

After the field-mapping self-check and before upload, run the product quality gate (errors / performance / security / UX):

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_page_quality.py" --html "<final.html>" --has-database
```

- `MINDX_PAGE_QUALITY_FAIL` (exit 2) → fix per rule number (PQ001/003-007) best-effort and rerun; **the gate never blocks upload** — unfixable / false-positive items pass with `--ack "<reason>"` and are stated honestly in the receipt.
- `MINDX_PAGE_QUALITY_OK` + `MINDX_PAGE_QUALITY_WARN` (exit 0) → WARN does not block, but must be listed honestly in the receipt.
- Data integrity is owned by the §1.6 second gate's DSDK014/015/016 (this phase's `--has-database` only triggers the UX gate PQ105-107).
- Mark the `QUALITY_OK` signal in the receipt afterwards (format: `page-quality-check.md` §5); `--ack` items noted on the `QUALITY_OK` line.

### Phase 5: Upload

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.html>" --file-name "<schema.title>.html" --databases '[{"id":"<database_id>"}]'
```

Follow `import-flow.md`. Success → extract `node_block_id`; failure → keep the phases already completed and generate a receipt per `error_handling.md`.

After a successful upload, mount the phase-3 tables under the new page per the tree-placement rule in `entry.md` "Relation" (same-batch rule, guardrails, and the `move-node` command live there; a failed move never blocks delivery).

### Retrofit branch receipt

```
{{全链路完成：}}
{{- Database 已创建（ID: <database_id>），含 <N> 个字段}}
{{- HTML 已改造并上传（node_block_id: <node_block_id>）}}
{{- 页面已具备动态数据读取能力}}

{{访问链接：<url>}}
{{（若脚本未返回 url，则回退为：可到资料库中查看和管理。）}}
```
