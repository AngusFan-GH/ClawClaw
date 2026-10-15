# create-branch — Create Branch · No HTML (database-first, Agent writes the HTML)

Entry conditions and the pre-dispatch gate are in `data-page-flow.md`. In this file, §1.x refers to sections of `canonical-schema.md`; SDK templates live in `sdk-templates.md`; uploads always go through `import-flow.md`. You do NOT need `modify-branch.md` on this branch — it governs retrofitting an existing HTML only.

## 5. Create Branch · No HTML (database-first, Agent writes the HTML)

**Trigger**: the user has no existing HTML and described a page need ("build me a registration page," "make a message board people can post to and view").

- Multi-module workbench (the user lists ≥2 heterogeneous modules, e.g. "todos + scheduling + expense tracking") → confirm the page's organization before starting, defaulting to "an overview page + a separate page per module"; don't cram heterogeneous modules into one long page.
- Staged progress receipts for a long chain: build the table → write the HTML → upload — sync one line of progress to the user after each stage (e.g. "table's ready, now writing the page…"); never leave the user waiting in silence through the whole thing.
- **Visual-direction confirmation**: if the user's description includes a visual reference (a screenshot, "like XX style," specific colors/fonts) → follow it directly; with only a functional description and no visual reference → default to a clean, modern style without asking; don't submit a separate visual proposal for confirmation before generating — that would interrupt a lightweight delivery. If the user isn't happy with the visuals after seeing it, one revision round is enough; don't pre-emptively solicit multiple design options.
- **Platform constraints stated up front**: if the need implies "real-time data" (stock prices, weather, live location, or other external live sources) → state clearly up front that "the page's data comes from your library table and can't connect to an external real-time source," then build the table against whatever data source the user confirms — don't let the user discover post-generation that the data isn't live. If the need is a public form for non-logged-in users to fill out (a survey, a registration page shared externally) → state up front that "writing data requires login authorization, and submissions from users who aren't logged in will be blocked"; if login-free submission is actually needed, point them to `database/entry.md`'s public-form capability if it supports that — don't promise the SDK layer can bypass login.

### Stage 1: Analyze the need → distill a schema

The Agent produces the canonical schema itself (same format as §1.1). Decide `page_type` first: display (`display`, query: lists/rankings/announcements); form (`form`, addRecord: registration/check-in/feedback); mixed (`mixed`: message boards / check-in + records).

```json
{
  "title": "员工报名",
  "page_type": "form",
  "properties": {
    "姓名": { "text": "" },
    "邮箱": { "email": "" },
    "部门": { "select": { "options": [{ "text": "研发", "id": "<16-char alphanumeric>" }, { "text": "产品", "id": "<16-char alphanumeric>" }] } }
  },
  "field_mapping": {
    "姓名": { "value_type": "text", "form_input": "[name=\"name\"]", "display_selector": null, "render_signal": "label[for]:contains('姓名')" },
    "邮箱": { "value_type": "email", "form_input": "[name=\"email\"]", "display_selector": null, "render_signal": "label[for]:contains('邮箱')" },
    "部门": { "value_type": "select", "form_input": "[name=\"dept\"]", "display_selector": null, "render_signal": "label[for]:contains('部门')", "options_value_key": "value" }
  },
  "options_map": {
    "部门": { "rd": { "text": "研发", "id": "<same id as in properties>" }, "pm": { "text": "产品", "id": "<same id as in properties>" } }
  },
  "source": "agent_analysis",
  "sdk_calls_found": false
}
```

**Constraints unique to this branch**: ① a selector is a commitment you'll actually write into the HTML in stage 4 (fix the selector first, then write `[name=...]`/`[data-field=...]` to match); ② option IDs are Agent-generated (`Math.random().toString(36).slice(2, 10) + Date.now().toString(36)`), and `options_map` ids must match the ids in `properties.select.options`; ③ for the `OPTIONS_MAP` second-level key, use the value for `<option value>` when there is one (preferred), otherwise use the text; ④ ordering follows §1.3, with form pages ordered by fill-in flow.

### Stage 2 / 3: confirm the schema, create the database

The strong-skip rule for the confirmation gate, inlined so this branch never depends on the other file: **skip the gate whenever the domain and the managed objects are identifiable.** A one-sentence workbench ask with a clear object — "a workbench for weekly task planning and progress" (task + status + dates), "an expense tracker" (date/amount/category) — is already strong: design the standard fields yourself, build immediately, and note after delivery that fields can be adjusted. Only a request whose managed object cannot be inferred at all ("build me a tool") goes through the gate. Never stop at a field proposal waiting for a "确认 / OK" reply on a typical workbench ask.

Then create the table (this is a brand-new page — the existing-linked-table gate does not apply):

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/create_database.py" --schema '<JSON>'
```

`<JSON>` is the complete schema from stage 1 (including `title` and `properties`). Success → stdout `{"database_id":"...","space_id":"...","property_count":N,"properties":[...]}`; failure → exit 0 silently. **From here on, the only trustworthy field list is the returned `properties`** (including server-generated option ids) — all field names / ids / option ids in stage 4 come from it, never from what stage 1 remembered.

**Space alignment (mounting precondition)**: if the stage-5 upload will pass `--space-id` (user named a target space), the stage-3 schema JSON must carry the same `space_id` — `create_database.py` reads it from the schema (title / properties / optional `space_id`); a table created in a different space than its page cannot be mounted under it in stage 5.

### Stage 4: write the HTML directly

The difference from the retrofit branch: the HTML has `__SMART_PAGE__.database.*` built in from the start — there's no "retrofit" step. The field list's sole authority is the `properties` returned by stage 3.

- Single file (CSS/JS/HTML inlined); ES5-compatible; degrades to static/empty state with no SDK environment; clean and responsive.
- Database binding markers follow §1.5.5 (DSDK011/012).
- `select`/`multi_select` are written as empty containers (just `<option value="">请选择</option>`), populated on init via `db.getSchema`.
- Every field reserves a stable selector; `addRecord`/`renderData` use the same selector; `properties`/`row[xxx]` keys use the schema's Chinese field names.
- Local caching for form input follows the DSDK008 rules in `sdk-templates.md`; when `uploadImage` is involved, images are cached in IndexedDB before submission.

Pick a template by `page_type` from `sdk-templates.md`: display = case 2, form = case 3, mixed = case 4. Read `database-sdk-contract.md` only when a need goes beyond those templates.

### Stage 4.5 / 5: self-check, upload

Self-checks: §1.6 (`lint_schema.py` + `lint_database_sdk_usage.py`, including data integrity DSDK014/015/016), then the Phase 4.6 product quality gate (same as `modify-branch.md`): `lint_page_quality.py --html <final.html> --has-database` — FAILs fixed best-effort and rerun; **the gate never blocks upload**; unfixable items pass with `--ack "<reason>"` and are stated honestly in the receipt (see `page-quality-check.md` §7); upload after producing the `QUALITY_OK` signal.

Deep-check deferred: once the three self-checks in §1.6 pass, upload and deliver — external-link reachability, JS syntax/DOM checks, call-chain-loop checks, jsdom smoke tests, and other extended checks move to after the delivery receipt and are budget-capped (≤2 rounds); delivery (upload + receipt link) takes priority over any extended check. Upload:

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.html>" --file-name "<schema.title>.html" --databases '[{"id":"<database_id>"}]'
```

After a successful upload, mount the stage-3 tables under the new page per the tree-placement rule in `entry.md` "Relation" (same-batch rule, guardrails, and the `move-node` command live there; a failed move never blocks delivery).

### Create-branch receipt

```
{{页面已创建：}}
{{- Database 已建（ID: <database_id>），含 <N> 个字段}}
{{- HTML 已生成并上传（node_block_id: <node_block_id>）}}
{{- 页面在当前交付形态下支持数据读写（已过两道 lint；协作态 / 发布态及各访问端的写入均依赖登录授权，未在真实访问端逐一验证，异常请反馈）}}

{{访问链接：<url>}}
{{（若脚本未返回 url，则回退为：可到资料库中查看和管理。）}}
```
