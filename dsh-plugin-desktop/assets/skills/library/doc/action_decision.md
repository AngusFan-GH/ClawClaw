# Action and review-card decisions

When to read: the write mode is chosen per `entry.md` and the latest content is in hand; you need to decide actions, `card_op`, the summary, pending-card reuse, or `update_title`.

This file owns decisions only. Field and Mark contracts are in `content_contract.md`; table dispatch in `tasks/table_edit.md`; CLI and schema in `edit_core.md`.

## 1. Action choice

Pick the minimal change; stop at the first hit:

1. In-block text or inline style within the same block type — review: `update`; direct edit: `insert_after` (full final block) + `delete` (old block); `update` is dead there, see `content_contract.md` §4.
2. Move within the same parent — `move`.
3. Insert before / after an anchor — `insert_before` / `insert_after`.
4. Delete a whole block — `delete`.
5. Block type, children, block-level attributes, or cross-parent move — `delete` + `insert_before/insert_after`.
6. Code content/language or Mermaid source change — `delete` + `insert_before/insert_after`.
7. Change inside a table or cell — route to `tasks/table_edit.md`.

Constraints:

- `update` keeps the block id and cannot change the original block type, children, or block-level attributes.
- Several blocks inserted at one anchor → merge into one insert action, top-level blocks separated by blank lines.
- `move` is same-parent only; cross-parent moves are delete-then-insert.
- Mark boundaries, comment anchors, and the Code/Mermaid exceptions for review `content/new_content` follow `content_contract.md`.
- Table actions are not redefined here; `tasks/table_edit.md` governs.

## 2. Review card `card_op`

Review actions contain at least one block action plus exactly one `card_op` at the end:

1. A brand-new independent change — `{"type":"card_op","op":"insert","summary":"...","kind":"agent_review"}`.
2. Whole-doc summary or cross-section global change — `{"type":"card_op","op":"insert","summary":"...","kind":"agent_review_global"}`.
3. Continuing or fixing the previous card for the same intent — `{"type":"card_op","op":"update","discussion_id":"<reviewDiscussionId>","summary":"cumulative summary"}`.

`card_op=delete` exists only for protocol compatibility and is not a "close the card only" flow; do not call the submit interface without block actions.

### 2.1 review ID vs comment ID

- `reviewDiscussionId`: the review-card ID returned by the previous `submit_review_edit.py`; valid for `card_op=update/delete`.
- `commentDiscussionId`: the original comment-thread ID; used only for reading comments and internal locating, never for `card_op`.
- Continuing the same intent, fixing an omission, or adjusting the previous round's edit → reuse the original review card.
- The user starts an unrelated new task → create a new card.

### 2.2 pending-block reuse

A read-back block carrying `action="insert|delete|update" reviewId="..."` already has a pending review card. When this round edits that block again:

1. Run `update` or `delete` on the block as usual.
2. Reuse the original card via `card_op=update(discussion_id=<that block's reviewId>)`.
3. Never create a second card and never ask the user to accept/reject the old card first.

When multiple target blocks belong to different pending cards: reuse when only one card is involved; split the submit when several are. A pending block is usable as an edit target; avoid it as the `insert_after` anchor for unrelated new blocks — prefer a normal block outside the original card's scope, or use `insert_before`.

## 3. summary

`summary` is user-visible text: only "what changed / why", 1–200 chars, same semantics as the CLI `--summary`.

Allowed:

- `补充测试总结`
- `根据评论内容优化引言表述`
- `统一表格列宽说明`

Forbidden:

- Internal fields of any kind — the validator rejects `discussionId`, `blockId`, `pageId`, `nodeId`, `reviewId`, `commentId`, `anchorBlockId`, timestamps, and their snake_case/camelCase variants — plus JSON/array structures, control characters, and internal-ID prefixes like `blk_`, `discussion_`, `page_`.

When a comment revision needs to state its source, use natural language like "根据选中评论" / "根据评论内容" / "根据文档评论" — never the thread ID.

## 4. Direct edit

Direct edit reuses §1's action choice, except:

- `card_op` and `summary` are forbidden.
- `content/new_content` is the final body; forbidden fields and Marks per `content_contract.md` §4.
- Tables still route to `tasks/table_edit.md`.

## 5. `update_title`

`update_title` is only for `submit_doc_edit.py` to change the doc node's page title — not for editing body Headings:

```jsonc
{"type":"update_title","title":"new doc title"}
```

Constraints: no `id/content`; must be the last action; at most one per submit; title ≤ 200 chars; empty string allowed.

After reading the doc, proactively ask about syncing the title only when:

1. The frontmatter title is missing or empty.
2. The title is `未命名`, `Untitled`, `无标题`, `新建文档`, `新文档`.
3. This edit clearly shifts the doc's topic away from the title.

Otherwise don't ask. Only append `update_title` after the user confirms.

## 6. Decision completion checklist

Before submitting, confirm:

- Target block ids verified against the latest content.
- Actions follow the minimal-change principle; tables routed to the dedicated task.
- Review mode picked new-vs-reuse card correctly; the summary contains no internal fields.
- Fields and content built per `content_contract.md`; when unsure, `--dry-run` the matching script.

## 7. Post-submit verification

- A submit script's success output means the server accepted the action batch — it is NOT proof the content landed as intended. Never tell the user "done / 已改好" on the submit receipt alone.
- After `submit_doc_edit.py` succeeds: re-read the doc once (`get_doc_reviews.py`) and confirm the target change is present before claiming completion. Read-back economy: pipe-filter the output to the target block id or new text (`grep` a few lines around it) instead of loading the whole doc into context; when several small submits belong to one intent, close them all with one read-back at the end instead of one per submit. For whole-table replacement, confirm the new table's blocks exist and the old table is gone.
- After `submit_review_edit.py` succeeds: the change lives on a pending review card, not in the body — describe it as a submitted revision suggestion, never as landed content; no body re-read needed, but never word it as "已改好 / updated".
- If the re-read shows the change missing (524-class partial writes, anchor normalization, silent drop): retry per `server_pitfalls.md` batching rules. If it still fails, tell the user exactly what landed and what didn't — a failed or partial write is never reported as success.
