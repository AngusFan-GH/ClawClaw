# Batch replace and global delete

When to read: the user asks "replace every X with Y", "delete all X", "X should not appear in the doc", or a unified change spanning many sections.

## 1. Flow

1. Pick review or direct-edit mode per `entry.md` and read the latest content.
2. Search the full content, excluding hits in frontmatter, `ReviewSummary`, `reviewId`, `action=` and other metadata.
3. List body candidate locations; ask first when the replace target, replacement, or delete scope is unclear.
4. For each hit block pick the minimal action per `action_decision.md`; build fields and Marks per `content_contract.md`.
5. Put multi-block edits into one submit; review mode appends exactly one `card_op` at the end — cross-section global edits may use `kind=agent_review_global`.
6. For complex content, dry-run first, then submit for real and pass `KS_USER_REPLY` through.

## 2. Action dispatch

1. Edit text or style inside a block — review: `update`; direct edit: `insert_after` + `delete` pair (`content_contract.md` §4).
2. Delete an entire obsolete block — `delete`.
3. Block type or structure change — `delete` + `insert_before/insert_after`.
4. Table or cell hit — route to `tasks/table_edit.md`.
5. Code, Mermaid, or complex component hit — route to `tasks/complex_edit.md`.

Batch operations still require the latest block ids; never build actions from titles, summaries, or stale caches alone.
