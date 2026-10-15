# Submission boundaries

When to read: a component passed local validation but the real submission fails to parse, a container block degenerates to plain text, or a submission times out (524) / lands partially.

This file records server-side boundaries that local schema checks cannot fully cover: parsing boundaries (§1–§2) and volume/timeout boundaries (§3). Table admission is in `tasks/table_edit.md`; field and Mark contracts in `content_contract.md`; component syntax in `doc_references.md`.

## 1. No blank lines between container children

Inside containers such as `Callout` and `BlockQuote`, adjacent child blocks must not be separated by blank lines. When a blank line precedes an indented child, the server may read the following children as an indented code block, degenerating the component tags into body text.

Once a container degenerates, it usually leaves no child-block ids for `update`. Generate a legal blank-line-free container structure before submitting, instead of relying on post-submit repair.

## 2. dry-run is not the real parse

- `submit_review_edit.py --dry-run` / `submit_doc_edit.py --dry-run` validate the local action schema, body translation, component top-level structure, Mark boundaries, and comment anchors.
- `create_doc.py --dry-run` validates non-emptiness, encoding, size, and rejects ClawClaw component tags inside the Markdown body.
- dry-run has no remote target-block types or real parsing context; passing dry-run does not guarantee the real submission succeeds.

On a real failure, classify per `error_handling.md`; don't probe syntax with repeated real submissions.

## 3. 524 timeouts are volume-triggered

Field-tested rules (2026-08/09 real sessions):

1. 524 fires on the combination of deleted-block count + insert volume in one submission. There is no single size threshold, and `--dry-run` cannot predict it.
2. Table insert quota (field-tested 2026-09): a single insert action reliably carries one whole `<Table>` up to ~3.6 KB / 12 rows including the header row. Prefer one whole-table insert per submission — do not pre-split tables inside this quota.
3. Only a table beyond that quota splits: deliver it as consecutive segments of ≤ 12 rows each (each repeating the header row so it stays readable), one insert per submission, chained by anchor — read back for segment N's real block id and use that new table as the anchor for segment N+1. Never anchor multiple segments to the same Heading: same-anchor multi-insert order is not guaranteed and can reverse the whole section.
4. `anchorBlockId` may be normalized server-side, and script success is not proof: after the last insert of a chain (or a whole-table insert), read back once via `get_doc_reviews.py`, pipe-filter to the target block id (`grep` a few lines around it) instead of loading the whole doc into context, and confirm before claiming done.
5. `create_doc.py` with a Markdown body containing GFM tables reliably 524s. Use the skeleton method: create a table-free skeleton (one distinct one-line placeholder block per table), then insert each table via `submit_doc_edit.py` under the quota above. See `tasks/read_create.md` §2, the create-side dispatch.
6. Whole-table replacement safe order: first `insert_after` the new table at a stable anchor before the old table (e.g. its preceding Heading) → read back and verify → `delete` the old table in a separate submission. Same-batch delete+insert also works, but split when the volume is large: a same-batch 524 between the delete and the insert loses the old table with no new table landed.
7. Hand-built cell-text conversions: `**bold**` must be rewritten as `<Mark bold>...</Mark>` (Markdown emphasis is not translated inside component content); raw `{}` braces and angle brackets inside cell text are known-bad — rewrite or entity-escape them (`&lt;` / `&gt;`).
8. One large single `Code` block (7 KB+) is exempt: it does not by itself trigger 524 — do not pre-split code content.
9. On a 524, the batch may have partially landed: read back first, resume from what actually landed; never re-submit the same oversized payload.
