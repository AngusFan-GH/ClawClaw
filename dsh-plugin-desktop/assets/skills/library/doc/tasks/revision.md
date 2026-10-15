# Text-selection and comment revision

Scope: edit a doc based on selected text, a named comment, or whole-doc comments. This task takes priority over table and complex-component routing.

## 1. Terminology boundaries

- Page-ID convention follows `../entry.md`.
- `commentDiscussionId` is the original comment-thread ID — used only for reading comments and internal locating.
- `reviewDiscussionId` is the review-card ID — the only one valid for `card_op=update/delete`.
- Never use a comment-thread ID as a review-card ID; summary construction follows `../action_decision.md` §3.

## 2. Text-selection revision

Input should carry `nodeId/pageId + blockId + revision intent`:

1. Call `get_doc_reviews.py` for the latest content.
2. Verify the `blockId` exists and read the full target block.
3. Do not call the comment-reading script.
4. For local text edits prefer `update`: carry complete `old_content/new_content`, using `<Mark ar>` only on the changed part.
5. Check pending cards before submitting, then call `submit_review_edit.py`.

## 3. Comment revision

1. A specific comment-thread ID is given → `get_node_comments.py --node-id <nodeId> --discussion-id <commentDiscussionId>`; otherwise pull all active comments.
2. Understand intent from the comment body; take the anchor from `thread.blockId`.
3. Call `get_doc_reviews.py` to verify the block still exists in the latest content.
4. Build review actions and the summary per `../action_decision.md`.
5. Call `submit_review_edit.py`; on success pass `KS_USER_REPLY` through.

Never skip reading the comment and guess its intent. Resolved comments are skipped by default unless the user explicitly asks.

## 4. Review actions

- Check the target block's pending state before submitting; card creation/reuse and summary follow `../action_decision.md`.
- `content/old_content/new_content`, Marks, and comment anchors follow `../content_contract.md`.
- On tables, Code, Mermaid or complex components, switch to the corresponding task file.
- User reports the card cannot be seen or accepted on their side → stop the card path: rebuild the edit as a direct action (no `<Mark ar>`; `insert_after` + `delete` pairs per `../content_contract.md` §4), land it with `submit_doc_edit.py`, and say it takes effect immediately.

## 5. Conditional deep reads

1. Comment types, whole-doc comments, anchors, or multi-comment merging — `../revision_flows.md`.
2. card_op, pending cards, action or summary — `../action_decision.md`.
3. Comment Mark merging, anchor preservation, field contracts — `../content_contract.md`.
4. Table or cell hit — `table_edit.md`.
5. Code, Mermaid, or complex component hit — `complex_edit.md`.
6. Script failure or invisible card — `../error_handling.md`.
