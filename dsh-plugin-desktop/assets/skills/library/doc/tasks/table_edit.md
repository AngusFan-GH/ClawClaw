# Table editing

Scope: add a table to an existing doc, edit cell content, or change table structure. Tables inside a brand-new doc: create via the skeleton method in `read_create.md` §2, then insert each table through this file.

## 1. Minimal flow

1. Pick the write mode per `../entry.md` and run `../../mutation.md`.
2. Call `get_doc_reviews.py` for the latest content.
3. First decide whether the user is changing cell content or table structure, then confirm the target block type.
4. Build actions per §2; for complex-component syntax read `../doc_references.md` §6.
5. `--dry-run` the matching submit script first, then submit for real and pass `KS_USER_REPLY` through.
6. After any table insert or whole-table replacement, read back per §2 rule 9 — script success output alone is not proof.

## 2. Admission and actions

Mode split first (`../entry.md`): review mode = `submit_review_edit.py`, direct edit = `submit_doc_edit.py`. Table behavior differs by mode.

1. **Cell-content change, review mode**: locate the child block inside the cell that has its own `blockId`; `update` it as a normal block following the Mark `ar` diff contract in `../content_contract.md`. Do not escalate to whole-table replacement just because of anchor or implementation difficulty.
2. **Cell-content change, direct edit**: there is no in-cell path — the server rejects any action on a block inside a `TableCell` (`11607`). Always replace the whole table: `delete` + `insert_after` with the fully rebuilt `<Table>`, in the safe order of rule 6. On `11607` here, do not "fix params" and retry; switch strategy.
3. **Add a table** (within quota: one whole `<Table>` up to ~3.6 KB / 12 rows including the header — field-tested): a single `insert_before` / `insert_after` whose `content` writes the whole `<Table>...</Table>` at once. Do not pre-split inside the quota.
4. **Add a table beyond quota**: split into consecutive segments of ≤ 12 rows each, each repeating the header row, inserted one per submission and chained by anchor — read back segment N's real block id and anchor segment N+1 to that new table (never to the same Heading; same-anchor multi-insert order is not guaranteed). Read `../server_pitfalls.md` §3, only if a real submission fails.
5. **Structure change** (add/remove rows or columns, column widths, header, 2-D re-layout): `delete` + `insert_after` on the outermost `<Table>`, inserting the fully replaced `<Table>`, same safe order and quota as rules 3–4.
6. **Whole-table replacement safe order**: first `insert_after` the new table at a stable anchor before the old table (e.g. its preceding Heading) → read back and verify → `delete` the old table in a separate submission. Same-batch delete+insert also works, but split when the volume is large: a same-batch 524 between the delete and the insert loses the old table with no new table landed.
7. **Target is a `<Table>`**: only `delete` / `insert_before` / `insert_after`; `update` / `move` forbidden. **Target is a `<TableRow>` / `<TableCell>`**: no action at all; re-locate to the outermost Table, or to a child block inside the cell in review mode only.
8. **Header-row style loss**: `rowHeader` is a read-back-only attribute — the write contract's `Table` attribute set cannot set it, so every whole-table replacement drops the header-row shading. Compensate by wrapping the new first row's cell text in `<Mark bold>...</Mark>`, and tell the user the exact header style must be re-enabled in the table toolbar ("header row") if the old table had it.
9. **Read-back requirement**: after a whole-table insert or whole-table replacement, re-run `get_doc_reviews.py` once and confirm the target block exists — `anchorBlockId` may be normalized server-side. Pipe-filter the output to the target block id (`grep` a few lines around it); never load the whole doc into context per read-back. For chained segment inserts, the per-segment read-back (needed as the next anchor) doubles as this check; after the final segment, one read-back closes the whole chain.

Review and direct-edit `content/new_content`, Marks, and comment anchors follow `../content_contract.md`.

## 3. Structure-change helper

For row/column matrix changes only, `table_edit_helper.py`'s `insert_row`, `delete_row`, `insert_column`, `delete_column`, `set_table` can generate the new table. The helper is a local transform — no network, no submit.

Column widths, headers, and other attribute changes need a hand-built complete `<Table>`; do not use the helper for single-cell content edits.

## 4. Conditional deep reads

1. Full table component syntax, merged cells, helper details — `../doc_references.md` §6.
2. Container parse degeneration, dry-run vs real submit, or 524 volume limits and batching — `../server_pitfalls.md`.
3. Marks, old/new content, or comment anchors — `../content_contract.md`.
4. action, card_op, or pending cards — `../action_decision.md`.
5. Script params and dry-run — `../edit_core.md`.
