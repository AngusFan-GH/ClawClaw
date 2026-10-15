# Content fields and Mark contracts

When to read: building `submit_review_edit.py` / `submit_doc_edit.py` actions and needing to confirm `old_content`, `content`, `new_content`, Marks, or comment anchors.

This file is the authority for content fields and Marks. Action and card decisions are in `action_decision.md`; table dispatch in `tasks/table_edit.md`; component syntax in `doc_references.md`; local validation is implemented in `content_validator.py`.

## 1. Common field boundaries

- `insert_before` / `insert_after`: new blocks go in `content`; multiple consecutive top-level blocks allowed, separated by blank lines.
- `update`: review mode only (in direct edit it is unusable — see §4); must carry both the complete pre-edit block `old_content` and the complete post-edit block `new_content`; `content` must be empty.
- `old_content` is used only for local before/after lost-update checking; it is not submitted with the actions.
- `new_content` must be exactly one complete component block of the same type as the original; never bare text, Markdown, multiple blocks, or a different block type.
- `delete`, `move`, `card_op`, `update_title` carry no `content`.
- `content/new_content` in the edit/revise chain uses component syntax; `create_doc.py` whole-doc creation uses Markdown only.
- Never write frontmatter, hand-written `id`, `ReviewSummary`, `ReviewCard`, `action`, or `reviewId`.

## 2. Review-mode Mark boundaries

- `update.new_content` must contain at least one legal `<Mark ar="insert|delete|format">`; unchanged text may stay bare.
- `<Mark ar>` is forbidden in `insert_before/insert_after.content`; an insert action already expresses block-level addition — write the final new content directly.
- `ar="insert"` marks added text; `ar="delete"` marks removed text; a replacement uses two adjacent delete/insert Marks.
- `ar="format"` is for format-only changes with unchanged text; carry the final style attributes — omitting style attributes means removing existing inline formatting.
- Nesting `<Mark>` is forbidden.

Example:

```xml
<Paragraph>kept text<Mark ar="delete">old text</Mark><Mark ar="insert">new text</Mark></Paragraph>
```

## 3. Comment anchors

When the original block contains `<Mark comment={...}>`:

- The only legal form is `comment={["discussion_xxx"]}`: a non-empty JSON string array; functions, variables, or other expression attributes are forbidden.
- Inserts cannot create comment anchors; `update` can only preserve comment IDs already present in `old_content` — never invent new ones.
- `new_content` must keep every original comment ID and preserve the original anchor text range where possible.
- Text carrying comment + review or style attributes at once → merge into one Mark, e.g.:

```xml
<Paragraph>lead-in<Mark comment={["disc_xxx"]} ar="format" bold>commented text</Mark>after</Paragraph>
```

Only when the user explicitly asks to delete the commented text may you set both `allow_drop_comment=true` and a non-empty `drop_comment_reason`. The script can block ID loss but cannot prove the anchor didn't drift, so still make minimal edits based on `old_content`.

## 4. Direct-edit mode

`submit_doc_edit.py`'s `content/new_content` is the final body:

- `<Mark ar>`, `card_op`, `summary`, `ReviewSummary`, `ReviewCard` are forbidden.
- `update` is unusable on text blocks in direct edit (field-tested 2026-09-05): without `<Mark ar>` the server rejects with `11607` demanding a review-style diff; with `<Mark ar>` the local validator rejects because edit mode forbids review marks. A same-block text or inline-style change is therefore an `insert_after` of the old block carrying the full final content, plus a `delete` of the old block — one submit, both actions. `update_title` is unaffected.
- Block type or structure changes use `delete + insert_before/insert_after`.

## 5. Atomic blocks and complex components

- Code content/language changes and Mermaid source changes forbid `update`; use `delete + insert_before/insert_after`.
- Inside `<Mermaid>` write raw Mermaid source only — no Markdown fenced code, no Marks.
- Legal attributes, children, and expanded formats of non-basic components follow `doc_references.md`.
- Table target types and the structure/content dispatch follow `tasks/table_edit.md`; not redefined here.
