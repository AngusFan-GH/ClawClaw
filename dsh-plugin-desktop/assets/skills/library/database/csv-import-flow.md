# database · CSV import flow

Field-type semantics and config structures live in `params-reference.md` §PropertyConfig; write-value structure in §PropertyValue. This file describes path decision and execution only.

## 1. CSV check and field analysis

### 1.1 Basic checks

- File exists, ends in `.csv`, non-empty.
- **Encoding detection (before any parsing)**: try decoding as UTF-8 first; on decode failure the file is likely GBK / GB18030 (Excel's default for Chinese CSV). Decode as GB18030 (a superset covering GBK) and re-save a UTF-8 copy first, then run all checks and imports against that copy — importing a GBK file as-is garbles every Chinese header and cell, and a garbled header poisons §1.2 inference and every field name written to the server. Never "fix" garbled text after import — re-encode and redo.
- CSV has a single header row, field names non-empty and unique. Parse failure, inconsistent column counts, or no valid data rows → stop processing this CSV and return error.
- Record file size; consumed by §2 for path decision.

### 1.2 Field-type inference

Read CSV header + first N sample rows (recommended N=20–50). Infer type from field-name semantics and non-empty sample values. Type semantics are defined in `params-reference.md` §PropertyConfig.

- Low-cardinality single-value column → `select`; multi-value → `multi_select`.
- Uncertain inference, type conflict in same column, or mixed formats → fall back to `text`.

Per-column judgment list is required before §2. Skipping is forbidden — one line per column, filled from the samples actually read:

- `<column name>` — samples: `<up to 3 sample values>` → `<inferred type>`

A user request to drop a column ("这一栏不要了，删掉") is a destructive intent, not a schema hint: even though the table does not exist yet and "skipping" the column looks free, the column's data is silently discarded. Apply the `entry.md` §13 warn-then-wait gate BEFORE importing — reply naming the column, state its data will be gone irrecoverably, and wait for an explicit go-ahead. Never silently skip column creation and present a finished table with the field missing.

## 2. Path decision

User explicit spec wins; otherwise the §1.2 judgment list is the sole basis. Evaluate top-down, first match wins:

1. CSV > 50 MiB → Path B (§4), or split the CSV first (`import_csv` single-file limit is 50 MiB).
2. Any column inferred outside `text` / `number` / `date` → Path B (§4) — pin schema, backend would lose types.
3. All columns are `text` / `number` / `date` → Path A (§3) — one-shot import, backend infers.

Row count alone does not trigger Path A.

## 3. Path A · import_csv direct import

Hand CSV to `import_csv.py`; title is the file name (extension stripped).

```bash
python3 "${CLAWCLAW_SKILL_DIR}/database/import_csv.py" "<path-to-local.csv>"
python3 "${CLAWCLAW_SKILL_DIR}/database/import_csv.py" "<path-to-local.csv>" --database-id "<existing_database_id>"
python3 "${CLAWCLAW_SKILL_DIR}/database/import_csv.py" "<path-to-local.csv>" --space-id "<target_space_id>" --parent-id "<target_parent_node_id>"
```

## 4. Path B · create_database + batched batch_add

Build the database first, then write records.

### 4.1 Schema

Construct from the §1.2 judgment list. `select` / `multi_select` options come from deduplicated values across the full CSV. For person columns, resolve names to uids per `entry.md` §Person write pre-resolution; on unique-resolution failure, ask the user or downgrade the column to `text` before building.

### 4.2 Create

Call `create_database` per `entry.md` §1; the response's `database_id`, final field ids, and option ids are the source of truth.

### 4.3 Write

Map CSV data rows to `records`; write via `batch_add_database_records` per `entry.md` §3. Each batch max 100, batches run serially. `select` / `multi_select` accept option text or id per active schema. Per-record failures stay in `results`; continue remaining records and aggregate failure detail.

## 5. Result contract

Each CSV returns one structured result:

- Path A success: `{file_name, path:"A", node_block_id, url, publish_url}`
- Path B success: `{file_name, path:"B", database_id, url, total_count, success_count, failed_count, failures}`
- Failure: `{file_name, error}`

User-visible deliverable is the online database `url` or `id` only. Never return a local CSV path or temp directory. `url` always comes from script output; never self-assembled.

## 6. Failure and idempotency

- Path A retry: reuse returned `database_id` / `node_block_id` to overwrite the same node; do not rebuild.
- Path B after build succeeded but write interrupted: reuse `database_id`, only re-write rows that did not previously succeed, do not rebuild.
- Preserve prior batch and per-record results across retries; do not blindly replay the whole table.
