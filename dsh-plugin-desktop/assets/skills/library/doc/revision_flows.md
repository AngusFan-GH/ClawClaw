# Comment revision flows

When to read: `tasks/revision.md` has confirmed a comment-driven revision and you need to handle comment types, anchors, or multi-comment merging. The minimal text-selection flow lives in the task entry and is not repeated here.

## 1. Reading comments

When "edit per the comments", "handle the comments", or a comment-thread ID appears, read the comments first, then the latest doc:

```text
1. commentDiscussionId given: get_node_comments.py --node-id <nodeId> --discussion-id <commentDiscussionId>
2. no commentDiscussionId:    get_node_comments.py --node-id <nodeId>
3. Understand intent from comments[].plainText; take the anchor from thread.blockId.
4. Call get_doc_reviews.py; verify the blockId still exists and the content matches expectations.
5. Build and submit review actions.
```

Never skip reading the comment and guess the intent. Resolved comments are skipped by default unless the user explicitly includes them.

## 2. Comment response fields

- `discussionId` — original comment-thread ID, i.e. `commentDiscussionId`; only for reading comments and internal locating.
- `blockId` — comment anchor; must be verified against the latest content before submitting.
- `commentType` — `inline` = text-selection comment, `block` = whole-block comment.
- `anchorText` — the selected text of an inline comment.
- `props.pageAnchors[]` — page-comment extended anchors; may carry `pnid`, `selector`, `tag`, `textContent`.
- `comments[].plainText` — comment body, the source of the edit intent.

`commentDiscussionId` cannot serve as `card_op.discussion_id`; review-card choice, summary, and pending reuse follow `action_decision.md`.

## 3. Action dispatch

### inline comments

- Plain text → `update` on the complete target block, editing exactly the range `anchorText` points to.
- Delete the selected text → delete only that text; do not delete the whole block unless the user asks.
- The selection already has a comment Mark → preserve the comment ID and merge Mark attributes per `content_contract.md`.
- Code, Mermaid, or table targets → route to `tasks/complex_edit.md` or `tasks/table_edit.md` respectively.

### block comments

- Same-type in-block text or style change → `update`.
- Delete the whole block → `delete`.
- Insert before / after the block → `insert_before/insert_after`.
- Block type, children, block-level attributes, Code, or Mermaid change → route to `tasks/complex_edit.md`.
- Table or cell → route to `tasks/table_edit.md`.

`old_content/new_content` specifics and Mark boundaries are governed by `content_contract.md`.

## 4. Multi-comment merging

- Multiple comments on the same `blockId` → merge into one `update` that addresses every intent.
- Multiple comments on different blocks → default to one submit, one review card; split only when the user explicitly asks or the intents are fully unrelated.
- The summary states business intent only; the full blacklist is in `action_decision.md` §3.
- Target block already has a pending card → reuse it per `action_decision.md` §2.2.

## 5. Success and failure

After a real submit succeeds, pass `KS_USER_REPLY` through verbatim. When comment reading, doc reading, or submitting returns a JSON error / empty stdout, stop further actions and go to `error_handling.md`.
