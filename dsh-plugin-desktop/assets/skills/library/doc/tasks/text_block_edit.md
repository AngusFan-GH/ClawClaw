# Plain text-block editing

Scope: add / edit / move / delete plain `Paragraph`, `Heading`, list, and Todo blocks in an existing doc, direct appends, and batch text replace or delete.

## 1. Minimal flow

1. Pick review or direct-edit mode per `../entry.md` and run `../../mutation.md`.
2. Call `get_doc_reviews.py` for the latest content; locate and verify the target `blockId`.
3. Pick the minimal action:
   - Edit in-block text or style → review mode: `update`; direct edit: `insert_after` (full final block) + `delete` (old block) per `../content_contract.md` §4.
   - Insert before / after → `insert_before` / `insert_after`; appending at the doc end may use `insert_after(id="")`.
   - Delete a whole block → `delete`.
   - Move within the same parent → `move`.
   - Block type, children, or block-level attribute change → route to `complex_edit.md`.
4. When unsure, `--dry-run` the matching submit script first.
5. Submit for real; on success pass `KS_USER_REPLY` through verbatim.

## 2. Building actions

`update` must carry:

```jsonc
{"type":"update","id":"<blockId>","old_content":"<full block before>","new_content":"<full block after>"}
```

- `old_content` must come from the latest read-back; used only for local lost-update checking.
- `new_content` must be one complete component block of the same type; never a text fragment, and never use `update` to change block type.
- `insert_before` / `insert_after` `content` uses component blocks; when adding several blocks at one position, put them in a single action separated by blank lines.
- `delete`, `move`, `update` carry no `content`.

### Review mode

- Actions and the review card follow `../action_decision.md`.
- `content/old_content/new_content`, Marks, and comment anchors follow `../content_contract.md`.
- Read-back blocks carry `action="..." reviewId="..."`, or this turn continues adjusting the previous card → reuse that card per `../action_decision.md` §2.2.

### Direct edit

- `card_op`, `summary`, and `<Mark ar>` are forbidden; `content/new_content` is the final body.
- `update` is unusable here: the server demands review-style `<Mark ar>` diff for it while edit mode forbids those marks. A same-block text or style change is one submit with `insert_after` (old block id, full final content) + `delete` (old block id) — see `../content_contract.md` §4.
- Only when the doc page title must change too, decide per `../action_decision.md` §5 whether to append `update_title` at the end.

## 3. Batch replace or delete

- Search the full content first, excluding hits in frontmatter, `ReviewSummary`, `reviewId`, `action=` and other metadata.
- Unclear replace target or delete semantics → ask first; never guess the replacement or the scope.
- Multiple body blocks hit → one submit with a block action per hit; review mode still appends exactly one `card_op`.
- Whole-doc or multi-section changes → read `../batch_replace_sop.md`.

## 4. Conditional deep reads

1. Unsure about action, card_op, pending cards, or title update — `../action_decision.md`.
2. Unsure about field boundaries, Marks, or comment anchors — `../content_contract.md`.
3. Unsure about CLI, schema, dry-run, or stdout — `../edit_core.md`.
4. Non-basic components, Code/Mermaid, block structure change — `complex_edit.md`.
5. Target inside a table or cell — `table_edit.md`.
6. Script failure — `../error_handling.md`.
