# Error handling and receipts (library doc)

When to read: script stdout is empty, the user reports not seeing the card after a submit, or a retry decision is needed.

## 1. stdout protocol

Unified failure protocol: stdout prints a single-line JSON `{"error":"<sanitized error>"}` then `exit 0`. Remote/HTTP failures use `code=<error-code>; msg=<safe business note>`; local param validation with no remote code keeps explicit text. Only the envelope's `code` and the common-layer sanitized, truncated `msg` may be passed through; never expose other response fields, requestId, request bodies, tokens, cookies, stack traces, internal paths, or full signed URLs. Legacy compatibility: empty stdout is also treated as failure.

1. `get_doc_reviews.py` — success first line `KS_DOC_REVIEWS\t<pageId>\t<byteSize>\t<url>`; failure: JSON error, exit 0; empty stdout tolerated.
2. `get_node_comments.py` — success first line `KS_DOC_COMMENTS\t<nodeId>\t<totalThreads>`; failure: JSON error, exit 0; empty stdout tolerated.
3. `submit_review_edit.py` — success first line `KS_DOC_REVIEW_SUBMIT\t<discussionId>\t<anchorBlockId>\t<affectedCount>`; failure: JSON error, exit 0; empty stdout tolerated.
4. `submit_review_edit.py --dry-run` — success first line `KS_DOC_REVIEW_DRYRUN\t<N>\tactions=ok`; failure: JSON error, exit 0; empty stdout tolerated.
5. `create_doc.py` — success first line `KS_DOC_CREATE\t<nodeBlockId>\t<nodeKind>\t<url>\t<failedCount>\t<fatalCount>`; failure: JSON error, exit 0; empty stdout tolerated.
6. `create_doc.py --dry-run` — success first line `KS_DOC_CREATE_DRYRUN\t<contentBytes>\tcontent=ok`; failure: JSON error, exit 0; empty stdout tolerated.
7. `submit_doc_edit.py` — success first line `KS_DOC_EDIT_SUBMIT\t<anchorBlockId>\t<affectedCount>`; failure: JSON error, exit 0; empty stdout tolerated.
8. `submit_doc_edit.py --dry-run` — success first line `KS_DOC_EDIT_DRYRUN\t<N>\tactions=ok`; failure: JSON error, exit 0; empty stdout tolerated.

Classification, next steps, and retry counts after an error follow only the root `error_handling.md`; this file keeps no second mapping.

## 2. User receipt templates

On success, pass the script's `KS_USER_REPLY` through verbatim first; the table below is a fallback only when the script gave no `KS_USER_REPLY` or manual explanation / error recovery is needed.

1. Read failed / comment read failed / submit failed / direct edit failed / doc creation failed — build per the root `error_handling.md`.
2. Submit succeeded — {{已生成 <N> 处修订建议，点击查看并接受 / 拒绝：<anchorUrl>（接受后才会落到正文）}}.
3. Text-selection submit succeeded — {{已按划词内容生成 <N> 处修订建议，点击查看并接受 / 拒绝：<anchorUrl>}}.
4. Comment submit succeeded — {{已按评论生成 <N> 处修订建议，点击查看并接受 / 拒绝：<anchorUrl>}}.
5. Direct edit succeeded — {{已直接修改文档正文，影响 <N> 个块。修改已即时生效，无需审阅。}}.
6. Title-only update succeeded — {{已更新文档标题。修改已即时生效，无需审阅。}}.
7. Whole-table replacement succeeded — {{已完成整表替换，修改已生效。若原表开启过『表头行』样式，替换后需在表格工具栏手动重新开启（新表首行已用加粗补偿）。}}.
8. Doc created — {{已创建文档：<url>}}.
9. Doc created, partial content incomplete — {{已创建文档：<url>，但有 <N> 个内容块未完成（其中 <M> 个需人工复核），建议打开核对并补充。}}.
10. User asks when it takes effect — {{你接受审阅卡片之后，改动会立即出现在正文中；在那之前，正文保持不变。}}.
11. token / permission invalid — {{当前无法访问该资料库文档，请确认登录态或文档权限。}}.

Placeholder notes:

- `<anchorUrl>` = the `anchorUrl` field of `submit_review_edit.py`'s success JSON (looks like `…/space/d/{pageId}#{anchorBlockId}`; opening it jumps to the revision).
- `<N>` = affected block count (4th field `affectedCount` of the KS line, or the length of JSON `affectedBlockIds`).
- When only `update_title` was submitted, there may be no `anchorUrl` and `affectedCount=0` — use the title-only receipt; do not claim affected body blocks.
- Never put card IDs (`discussionId` / `reviewDiscussionId`) into user receipts; give the user the view entry and anchor link.
- Fallback: if the script returned no `anchorUrl` (`anchorBlockId` missing, `anchorUrl` empty), switch the receipt to {{已生成 <N> 处修订建议，请在文档右侧审阅栏查看并接受 / 拒绝}} — never assemble a broken link.

## 3. Agent self-handling

1. `get_doc_reviews.py` / `get_node_comments.py` JSON error or empty stdout — do not submit; handle per the root `error_handling.md`.
2. `submit_review_edit.py` param error right after complex content — re-check the local schema with `--dry-run`, then read `doc/doc_references.md` and rewrite the content; max 1 retry after fixing.
3. `create_doc.py` JSON error or empty stdout — never pretend creation succeeded; handle per the root `error_handling.md`.
4. `create_doc.py` returns `failedCount/fatalCount > 0` — the doc exists but content may be incomplete; use the partial-incomplete receipt and prompt the user to verify.
5. User says the card is gone / not visible — re-run `get_doc_reviews.py` for the latest content; if the target block still carries `action="..." reviewId="..."` soft marks → the card is still pending, take the "continue adjusting this round" path and reuse it; if the block has no review soft marks (possibly resolved by the author) → only then may a new card be created. User says the card cannot be accepted (no accept entry, cannot open the review panel, or acceptance never lands) or reports the change never landed (「没生效 / 没反应 / 怎么没改」) while a card from this conversation is still pending — their client cannot consume cards: land the same change via direct edit (`submit_doc_edit.py`, actions rebuilt per `../content_contract.md` §4 — no `<Mark ar>`), tell the user it takes effect immediately, and default to direct edit for later asks in this conversation; never resubmit or create another card for the same ask.
6. Previous round's card `discussionId` known, this round continues — treat that ID as `reviewDiscussionId` and reuse via `card_op=update`; never create parallel cards. Note: a comment revision's original thread `discussionId` is a `commentDiscussionId` and cannot reuse review cards.
7. Submit msg contains `block soft-mark conflict` / `already attached to pending review card` / `block-level.*conflict` (logical conflict, not transient) — do not retry verbatim; re-read the latest content via `get_doc_reviews.py`, take the target block's `reviewId`, reuse that card per `action_decision.md` §2.2, then resubmit.
8. Target block id stale — re-read the doc and rebuild actions on the latest ids.
9. `submit_doc_edit.py` returns `11607` on an `update` action — two distinct shapes: (a) target inside a `TableCell`: direct edit has no in-cell path; switch to whole-table replacement per `tasks/table_edit.md` §2, safe order; (b) any other text block: direct-edit `update` is dead end-to-end (server demands `<Mark ar>` the edit mode forbids); switch to `insert_after` + `delete` pair per `content_contract.md` §4. Neither is a param-format error; no verbatim retry.
10. Any doc submit returns `524` / `HTTP_524` / gateway timeout — volume-triggered, may have partially landed: read back what landed via `get_doc_reviews.py`, resume in smaller batches per `server_pitfalls.md` §3; never re-submit the same oversized payload.
11. Any table insert or whole-table replacement reported success — not proven: read back via `get_doc_reviews.py` and grep the target block id; `anchorBlockId` may be normalized and same-anchor repeated inserts have no guaranteed order; take real ids from the read-back before the next insert.

## 4. Hard prohibitions

- Never give the user raw stderr, safe `msg`, error codes, requestId, tokens, or cookies; rewrite into business language.
- Never blindly retry the same call repeatedly after failure.
- Never edit or guess ids without reading the latest content.
- Never use a real submit as a content-syntax probe; use `--dry-run`.
