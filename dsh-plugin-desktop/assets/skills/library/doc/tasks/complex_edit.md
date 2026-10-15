# Complex components and structural editing

Scope: non-basic components in an existing doc, or changing block type, children, block-level attributes, Code content/language, or Mermaid source. Tables go to `table_edit.md`.

## 1. Minimal flow

1. Pick the write mode per `../entry.md` and run `../../mutation.md`.
2. Call `get_doc_reviews.py` for the latest content and the target `blockId`.
3. Read the target component's section in `../doc_references.md`; verify component name, attributes, children, and expanded format.
4. Pick the action from the boundaries below.
5. `--dry-run` the matching submit script; on pass, submit for real and pass `KS_USER_REPLY` through.

## 2. Action boundaries

1. In-block text or inline style within the same block type — back to `text_block_edit.md`: review `update`; direct edit `insert_after` + `delete` pair.
2. Block type, children, or block-level attribute change — `delete` + `insert_before/insert_after`.
3. Code content or language change — `delete` + `insert_before/insert_after`, inserting the complete `<Code language="...">...</Code>`.
4. Mermaid source change — `delete` + `insert_before/insert_after`, inserting the complete `<Mermaid>...</Mermaid>`.
5. Change inside a table or cell — route to `table_edit.md`.

- `update` cannot change the original block type, children, or block-level attributes.
- Inside `<Mermaid>` write raw Mermaid source only — no Markdown fenced code, no token-level `<Mark ar>`.
- Review and direct-edit content fields and Mark boundaries follow `../content_contract.md`.
- Never hand-write read-back-only `id`, `readonly`, `ReviewSummary`, `ReviewCard`, `action`, or `reviewId`.
- No blank lines between adjacent children inside a container; separate top-level blocks with blank lines.

## 3. Conditional deep reads

1. Component syntax and attributes — the matching section of `../doc_references.md`.
2. Action choice, card_op, or pending cards — `../action_decision.md`.
3. content/new_content, Marks, comment anchors — `../content_contract.md`.
4. Container parse degeneration or real-submit differences — `../server_pitfalls.md`.
5. CLI, schema, dry-run, or stdout — `../edit_core.md`.
6. Script failure — `../error_handling.md`.
