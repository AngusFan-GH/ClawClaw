# database — Structured Data Table Category Entry

Capability carrier for the library's "structured data table (database)" category (Notion-like multidimensional tables). This entry holds routing + capability contracts + interface fields + stdout protocol; scripts sit flat in `database/`. Field value / filter / sort structures (create `config`, write `properties`, query `filter`/`sorts`) and table size limits live in `params-reference.md`; capabilities below show only the invocation shape — consult it when designing schemas or payloads. Per-database QPS is in §Rate limit.

## Module scope

- **Create table**: define fields (text / number / currency / select / multi_select / date / checkbox / url / email / phone / image / attachment / person, etc.)
- **Schema query**: fetch an existing table's structure
- **Field changes**: add / modify (rename or retype) / delete columns on an existing table
- **Record writes**: batch insert, incremental update, or delete 1–100 records per call
- **Record queries**: query by filter + sort + pagination; fetch a single record by record_id
- **Content export**: get the whole table's content (CSV text)
- **CSV / Excel import**: CSV follows `csv-import-flow.md`; Excel is split into per-sheet CSVs first, then reuses the same flow
- Downstream to "data page (page)" — the page module calls this module's scripts cross-module

Any answer about an existing table's schema or records → query it fresh this turn; data fetched in an earlier turn is stale and must not back an answer.

## Scope boundary (standalone table asks stop here)

A standalone table ask — the user wants a table / list / checklist with records in it, with no page, visualization, dashboard, workbench, or publish intent — is **fully served by this module**: create the table, write the records, reply with the receipt and access link, done. Never auto-upgrade a standalone table ask into the page creation / retrofit / publish pipeline (`../page/entry.md`); only enter the page module when the user explicitly asks for a page form (dashboard / form page / workbench / visualization). This mirrors `../page/data-page-flow.md`'s light-weight-first gate.

## Relations to other modules

- `manage` — shares `library/_common.py` (runtime dispatch / token reading / HTTP / URL building / masking / exit). When a person has only name and no id, call `space.permission.collaborators` before writing to resolve the member UID.
- `page` — the page module calls this module's scripts; open the calls once the interface contract is stable.
- `doc` — embedding a data table inside a doc will be enabled by a later interlocking protocol.

## Rate limit

Server-side limit is **30 QPS per database**. Applies to every capability below (schema, records, import, export) against the same `database_id`. Exceeding it returns `50001` (and may also surface as `429` / `HTTP_429`); follow `../error_handling.md` — stop the current consecutive calls and pause, do not immediately retry, do not flood a single table. Page SDK calls (`window.__SMART_PAGE__.database`) add a second bucket: **20 QPS per page** (`../page/database-sdk-contract.md` §1.1); both buckets apply.

## Capability index

Scripts and flow docs sit flat in `database/`; `params-reference.md` is the field-structure reference. A single routing decision enters exactly one capability; if a capability chains multiple scripts (Excel → per-CSV imports, get_schema → batch_add_records), run them in flow order — each fails independently without blocking the next.

1. `create_database` — "create a table / create database" — `create_database.py` — §1
2. `get_database_schema` — "what fields does this database have / get schema" — `get_database_schema.py` — §2
3. `add_database_field` — "add a column / add a field" — `add_database_field.py` — §2.1
4. `update_database_field` — "rename a field / change a field type" — `update_database_field.py` — §2.2
5. `delete_database_field` — "remove a column / delete a field" — `delete_database_field.py` — §2.3
6. `batch_add_database_records` — "batch add rows / insert multiple records" — `batch_add_database_records.py` — §3
7. `batch_update_database_records` — "batch update record fields / update records" — `batch_update_database_records.py` — §4
8. `batch_delete_database_records` — "batch delete records / delete data rows" — `batch_delete_database_records.py` — §5
9. `get_database_record` — "get the detail of record_id=<rid>" — `get_database_record.py` — §6
10. `query_database_record` — "query records in table xxx matching conditions" — `query_database_record.py` — §7
11. `get_database_content` — "export full content / get table data CSV" — `get_database_content.py` — §8
12. `import_csv` — "import local CSV to create/update a database" — flow `csv-import-flow.md` — §9
13. `import_excel` — "import local Excel, one database per sheet" — host splits sheets, reuses `csv-import-flow.md`; per-sheet rollup of its §5 — §10

---

## 1. Capability · Create Database (create_database)

**Trigger**: "create a student info table in the space", "create a database", etc.

Precondition: commands run in a single form per `../SKILL.md` §Runtime & Auth — identity is injected by the runtime and scripts take no token. Choose the target space per `../SKILL.md` §Target Space; when creating under a `parent_id`, also pass its matching `space_id`.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/create_database.py" --schema '<JSON>'
```

- `--schema <JSON>` — required (flags mode) — full schema JSON: title, properties, optional space_id / parent_id

Each type's `properties[].config` structure and a **full create-table schema template** (12 field types) are in `params-reference.md` §PropertyConfig, plus the full create-table template in its Full table-creation schema example section. Minimal `<JSON>`:

```json
{
  "title": "学生信息表",
  "properties": [
    { "name": "姓名", "config": { "text":   "" } },
    { "name": "年龄", "config": { "number": { "decimalPlaces": 0, "useSeparate": false } } }
  ]
}
```

Add `"space_id":"<target_space_id>"` only when the top-level rules require a target space; if a folder is also specified, add the matching `"parent_id":"<target_parent_node_id>"`.

Option id rules (omit-on-create / server-generated / permanence) are defined once in `params-reference.md` §Option id rules; the final ids in the successful response's `properties` are authoritative.

**Output contract**: success → stdout JSON `{"database_id": "...", "space_id": "...", "property_count": N, "properties": [...], "url": "..."}`, then the receipt line `KS_USER_REPLY\t{{数据表「<title>」已创建，点击查看：<url>}}` (the Agent relays it verbatim; the url comes from the script — never build it yourself). `url` is relayed from the server response; when create-database omits it, the script falls back to `space.workspace.node-info` for the authoritative `data.node.url` — still never self-assembled. Only when both come back empty does the script output `"url": ""` and drop the `，点击查看：<url>` suffix. `properties` is the complete post-create field schema with server-generated field / option ids; later record writes must use these ids.

---

## 2. Capability · Get Database Schema (get_database_schema)

**Trigger**: "what fields does this database have", "get the schema / table structure", etc.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/get_database_schema.py" --database-id "<database_id>"
```

- `--database-id <id>` — required — target database ID

**Output contract**: success → stdout JSON `{"id": "...", "title": "...", "properties": [...]}` (`properties[]` contains id / name / type / config). The returned `config` is the internal config of the current `type` without the oneof wrapper; e.g. a select field returns `{"id":"f1","name":"状态","type":"select","config":{"options":[{"id":"opt_1","text":"进行中","style":0}]}}`. The `properties` returned by create / add / update / delete-field use the same structure.

---

## 2.1 Capability · Add Field (add_database_field)

**Trigger**: "add a column to this table", "add a field", etc.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/add_database_field.py" --database-id "<id>" --property '<JSON>'
```

- `--database-id <id>` — required (flags mode) — target database ID
- `--property <JSON>` — required (flags mode) — new field definition `{name, config}`; the name must not duplicate an existing field; config see `params-reference.md` §PropertyConfig

`property` is a single `{name, config}`; examples see `params-reference.md` §Add / update field property examples. Option id rules: `params-reference.md` §Option id rules; the final ids in the response `properties` are authoritative.

**Output contract**: success → stdout JSON `{"field_id": "...", "properties": [...]}`. `properties` is the complete post-add field schema with server-generated option ids.

---

## 2.2 Capability · Update Field (update_database_field)

**Trigger**: "rename the status column to phase", "change this field to single-select", etc.

**Gate**: a property change that alters the value type, or drops / rewrites existing select options, is an irreversible conversion — the §13 warn-then-wait gate applies BEFORE this command runs (same-message request is not confirmation). Pure rename is exempt.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/update_database_field.py" --database-id "<id>" --field-id "<fid>" --property '<JSON>'
```

- `--database-id <id>` — required (flags mode) — target database ID
- `--field-id <fid>` — required (flags mode) — ID of the field to modify (from `get_database_schema.py` `properties[].id`)
- `--property <JSON>` — required (flags mode) — new field definition `{name, config}`; `name` is required and non-empty; omitting `config` or passing an empty object renames only

Rename-only passes `{ "name": "阶段" }`; rename + retype / option changes pass the full `{name, config}` (examples see `params-reference.md` §Add / update field property examples). When changing the type, also pass the current or new field name.

**Output contract**: success → stdout JSON `{"properties": [...]}` — the complete post-update field schema.

Retyping a field or deleting existing select / multi_select options risks clearing data, so both carry the same stop-and-confirm gate as §2.3: before running, reply naming the table and field, warn that cells that cannot convert (or every cell referencing a deleted option) will be cleared irrecoverably, and wait for the user's explicit go-ahead — a retype requested in the same current message is NOT confirmation; never execute first and warn afterwards (§13). Renaming only is risk-free and needs no gate. When modifying select / multi_select options, existing options must reuse their current-schema ids (see `params-reference.md` §Option id rules).

---

## 2.3 Capability · Delete Field (delete_database_field)

**Trigger**: "remove a column from this table", "delete the xxx field", etc.

**Gate**: irreversible wipe — the §13 warn-then-wait gate applies BEFORE this command runs; never execute on the strength of the same message that requested the deletion.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/delete_database_field.py" --database-id "<id>" --field-id "<fid>"
```

- `--database-id <id>` — required (flags mode) — target database ID
- `--field-id <fid>` — required (flags mode) — ID of the field to delete (from `get_database_schema.py` `properties[].id`)

**Output contract**: success → stdout JSON `{"properties": [...]}` — the complete post-delete field schema.

Deleted column data is unrecoverable. Stop-and-confirm gate: before running this script, reply naming the table and the field, state that the deletion is unrecoverable, and wait for the user's explicit go-ahead — a delete requested in the same current message is NOT confirmation; never execute first and warn afterwards (§13).

---

## Person write pre-resolution (shared by add / update records)

Resolve before adding or updating a person column:

- Already has `id`: use it directly.
- Name only: call `space.permission.collaborators` with `node-id` = the current `database-id` (see `../manage/entry.md`), and look up the member by the whitespace-trimmed name.
- Unique exact hit: convert the `uid` to `id` and write.
- No exact hit: show fuzzy candidates and ask the user to confirm; fuzzy candidates must never be written automatically.
- Multiple exact hits or a query error: never submit the batch; on multiple hits, list UIDs and roles for user confirmation.

All names in a batch must have a unique exact hit or user confirmation before writing.

---

## Write pre-validation (field names and select / multi_select options; shared by add / update records)

- Run `get_database_schema.py` first: field names must exactly match the current schema — never construct them from memory, stale caches, or sample docs.
- select / multi_select option text absent from the schema fails with `11607` (options are never auto-created): add new options via `add_database_field` / `update_database_field` first, then write.
- When one write touches semantically linked fields (e.g. several checkboxes rolling up into one select status), extract the derivation into a pure function that computes all linked fields from the same input and writes them in one shot; never write only the trigger fields and leave the rollup stale.

---

## 3. Capability · Batch Add Records (batch_add_database_records)

**Trigger**: "add data to this table", "batch insert records", etc. Even a single row uses a one-element `records` array.

Run the Write pre-validation above before writing, and the Person write pre-resolution above before writing a person column; unresolved names must not enter this interface.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/batch_add_database_records.py" --database-id "<id>" --records '<JSON array>'
```

- `--database-id <id>` — required (flags mode) — target database ID
- `--records <JSON array>` — required (flags mode) — 1–100 field-value objects; each is a map<field name, PropertyValue>; structure see `params-reference.md` §PropertyValue

Each record is validated for field names and PropertyValue oneof; if any record is empty after validation, the whole batch is rejected with no request sent. select / multi_select accept option text or option id; the server resolves against the current schema.

**Output contract**: request-level success → stdout outputs the server batch-result JSON, e.g. `{"results":[{"index":0,"id":"rec_1","success":true},{"index":1,"success":false,"error":"错误信息"}]}`. Per-record failures stay in `results` and are not escalated to a whole-script failure.

**False-success defense**: `results[].success=true` does not mean committed — this interface can return success while the record was not actually written. Before claiming completion, re-verify with `get_database_record.py --record-id <rid>` (per record or sampled as delivery requires); neither `results` nor a `query_database_record` listing counts as proof of success.

---

## 4. Capability · Batch Update Records (batch_update_database_records)

**Trigger**: "update these records", "batch update records", etc. Even a single row uses a one-element `records` array.

Run the Write pre-validation above before updating (checkboxes and the rollup select must be written together); run the Person write pre-resolution before touching a person column — unresolved names must not enter this interface.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/batch_update_database_records.py" --database-id "<id>" --records '<JSON array>'
```

- `--database-id <id>` — required (flags mode) — target database ID
- `--records <JSON array>` — required (flags mode) — 1–100 `{record_id, properties}` objects; `record_id` must be non-empty and `properties` must contain at least one valid field

```json
[
  { "record_id": "rec_1", "properties": { "状态": { "select": "完成" } } },
  { "record_id": "rec_2", "properties": { "完成": { "checkbox": true } } }
]
```

`properties` format see `params-reference.md` §PropertyValue. This is an **incremental update** — omitted fields stay unchanged; any invalid item rejects the whole batch with no request sent.

**Output contract**: request-level success → stdout outputs the full `{"results":[...]}` JSON; per-record failures are not escalated to a whole-script failure.

---

## 5. Capability · Batch Delete Records (batch_delete_database_records)

**Trigger**: "delete these records", "batch delete data rows", etc. Even a single row uses a one-element `record_ids` array.

**Gate**: irreversible wipe — the §13 warn-then-wait gate applies BEFORE this command runs; same-message request is not confirmation. Exempt: the `[TEST]` probe a verification step itself created (`../page/edit-flow.md` §5.3, `../page/clone-flow.md` B11).

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/batch_delete_database_records.py" --database-id "<id>" --record-ids '["rec_1","rec_2"]'
```

- `--database-id <id>` — required (flags mode) — target database ID
- `--record-ids <JSON array>` — required (flags mode) — 1–100 non-empty record IDs

Deletion is server-idempotent: a missing record still counts as success.

**Output contract**: request-level success → stdout outputs the full `{"results":[...]}` JSON; per-record failures are not escalated to a whole-script failure.

---

## 6. Capability · Get Single Record (get_database_record)

**Trigger**: "get the detail of record_id=<rid>", "fetch this record", etc.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/get_database_record.py" --database-id "<id>" --record-id "<rid>"
```

- `--database-id <id>` — required — target database ID
- `--record-id <rid>` — required — target record ID

**Output contract**: success → stdout JSON `{"record_id": "...", "fields": {...}}` (field value shapes in `fields` see `params-reference.md` §FieldValue)

---

## 7. Capability · Query Record List (query_database_record)

**Trigger**: "query records in table xxx matching conditions", "list all records", etc.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/query_database_record.py" --database-id "<id>"
```

- `--database-id <id>` — required (flags mode) — target database ID
- `--filter <JSON>` — optional — filter condition; structure see `params-reference.md` §Filter rules
- `--sorts <JSON>` — optional — sort rules; structure see `params-reference.md` §Sort
- `--fields <JSON>` — optional — field names to return
- `--page-size N` — optional — records per page
- `--start-cursor <cursor>` — optional — pagination cursor

**Output contract**: success → stdout JSON `{"results": [{"record_id":"...", "<field name>":<FieldValue>, ...}], "next_cursor": "...", "has_more": bool}`. `results[]` keeps a flat row structure; record IDs always use `record_id`; other field value shapes see `params-reference.md` §FieldValue.

---

## 8. Capability · Get Database Content (get_database_content)

**Trigger**: "export the full content of this database", "get the table data", etc.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/get_database_content.py" --database-id "<database_id>"
```

- `--database-id <id>` — required — target database ID

**Output contract**: success → stdout JSON `{"database_id": "...", "content": "..."}` (`content` is CSV text: header row first, data rows after)

---

## 9. Capability · Import CSV (import_csv)

**Trigger**: "import this CSV as a database", "import a local CSV file", "create a table from CSV", etc.

See `csv-import-flow.md`.

---

## 10. Capability · Import Excel (import_excel)

**Trigger**: the user provides a local `.xlsx` / `.xls` file and asks to import it as a data table / database / online table / multidimensional table.

1. Enumerate **all sheets** into a manifest `{sheet_index, sheet_name, visibility, csv_path, status}` before converting; all later conversion, scheduling, and rollup follow this manifest — never infer the sheet set by scanning temp directories.
2. Convert each non-empty sheet to a standalone UTF-8 CSV: header flattened to a single row; merged cells filled as needed; formulas take computed values; filename `<sanitized sheet_name>.csv` with an increasing suffix on collision. Empty sheets are marked `skipped_empty`; hidden sheets must not be silently skipped — convert by default, or mark `skipped_hidden` when explicitly excluded.
3. Before scheduling, validate the manifest: every sheet must be one of `converted` / `skipped_empty` / `skipped_hidden` / `convert_failed`; each `converted` CSV must exist, be non-empty, and contain a header. Record conversion failures; never drop them from the manifest.
4. With exactly 1 `converted` sheet, the current agent runs `csv-import-flow.md` serially — no sub-agent needed.
5. With ≥2 `converted` sheets each creating its own table, assign one sub-agent per CSV to run `csv-import-flow.md` concurrently (suggested concurrency 3–5, batch beyond that); sub-agents must not share intermediate state.
6. When multiple sheets write the same existing database, have ordering dependencies, or the user asks for sequential handling, stay serial — concurrent writes to the same database are forbidden.
7. Each execution unit returns the structured result of `csv-import-flow.md` §5, plus `sheet_index` and `sheet_name`; fill the manifest back item by item and check `sheet total = success + partial failure + failure + skipped`. Never claim completion while any sheet is unaccounted for — list the missing items.

---

## 11. Parameter reference

Field value / filter / sort structures all live in **`params-reference.md`** (PropertyConfig / PropertyValue / FieldValue / Filter / Sort); each capability section above already points to the matching part — consult it when building payloads.

---

## 12. User receipt templates

**Receipt link rule**: any operation that creates or changes a node must include the access `url` in the receipt — never reply with a bare `database_id` / node id. The url always comes from script output; never self-assemble.

- Create database: `{{数据表「<title>」已创建，点击查看：<url>}}` (relay the `KS_USER_REPLY` line)
- Get schema: summarize field names / types / options; failure: `{{获取表结构失败。}}`
- Add field: `{{已为 Database <database_id> 新增字段「<name>」（field_id=<field_id>）。}}`
- Update field: `{{已更新 Database <database_id> 中的字段 <field_id>。}}`
- Delete field: `{{已删除 Database <database_id> 中的字段 <field_id>。}}`
- Batch insert records: run the §3 false-success re-verification first, then summarize success/failure counts and per-record errors from the verification
- Batch update records: summarize success/failure counts from `results`, listing per-record errors
- Batch delete records: summarize success/failure counts from `results`, listing per-record errors
- Get single / query: render results as a markdown table (user-facing display)
- Get database content: show the CSV text or a summary
- Import CSV: `{{文件「<file_name>」已导入为在线数据表，点击查看：<url>}}` (relay the `KS_USER_REPLY` line)
- Import Excel: per sheet, rollup database identifiers, access links, and success / failure row counts; per-sheet errors are rolled up per sheet, and other sheets still get their normal receipts
- Any failure not listed above: follow `../error_handling.md`

When called internally by another skill, **no separate receipt** — consume the script's stdout directly.

---

## 13. Safety constraints

- On L3/L4 data such as passwords / keys / ID numbers, stop immediately per the top-level `SKILL.md`; user confirmation does not override this.
- delete_database_field and batch_delete_database_records are irreversible data wipes and are never auto-executed. Even when the user's current message explicitly requests the deletion, that same-message request is not confirmation: first reply naming the table and field (or the pinned-down record set), state the deletion is unrecoverable, and wait for the user's explicit go-ahead; only then execute. Never delete first and warn afterwards. Exempt: the self-created `[TEST]` verification probe (`../page/edit-flow.md` §5.3) — cleanup, not a user-data wipe.
- Retyping a field converts existing data server-side, and cells that cannot convert are cleared; deleting an existing select / multi_select option clears every cell referencing it. Both follow the same gate as irreversible deletions: never auto-executed, same-message request is not confirmation, warn-then-wait for the user's explicit go-ahead. Renaming only is risk-free and follows the normal space branch.
- A select / multi_select `option.id` is **permanently valid** once written to the backend — never replace it; when modifying a field, existing options must reuse their ids verbatim (detail: `params-reference.md` §Option id rules).
