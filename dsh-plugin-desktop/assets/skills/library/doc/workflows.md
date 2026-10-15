# Workflow examples (library doc)

When to read: the rules are settled and you only need copyable commands, action templates, or the example index.

This file is not a source of rules; the examples live in `scripts/examples/*.json` and are dry-run self-checked by `verify_examples.py`. Action, field, component, and table rules are governed by `action_decision.md`, `content_contract.md`, `doc_references.md`, and `tasks/table_edit.md` respectively.

## 1. Example index

1. Whole-block rewrite — `scripts/examples/example_C_rewrite_block.json`.
2. Partial text replace inside a block — `scripts/examples/example_C2_partial_replace.json`.
3. Change block type — `scripts/examples/example_D_change_block_type.json`.
4. Edit a heading block — `scripts/examples/example_E_edit_heading.json`.
5. Reuse the previous review card — `scripts/examples/example_F_reuse_card.json`.
6. Global summary card — `scripts/examples/example_G_global_review.json`.
7. Text-selection revision — `scripts/examples/example_word_selection.json`.
8. Comment revision — `scripts/examples/example_comment_revision.json`.

Self-check:

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/scripts/examples/verify_examples.py"
```

Success prints `KS_EXAMPLES_SELFCHECK_OK`.

## 2. Common command templates


### 2.1 Read a doc

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/get_doc_reviews.py" \
  --page-id "<pageId>"
```

### 2.2 Review submit

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_review_edit.py" \
  --page-id "<pageId>" \
  --summary "<user-visible edit summary>" --actions-file /tmp/actions.json
```

### 2.3 Review dry-run

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_review_edit.py" \
  --page-id "<pageId>" \
  --summary "verify actions" --actions-file /tmp/actions.json --dry-run
```

### 2.4 Direct-edit submit

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_doc_edit.py" \
  --page-id "<pageId>" --actions-file /tmp/actions.json
```

### 2.5 Direct-edit dry-run

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_doc_edit.py" \
  --page-id "<pageId>" \
  --actions-file /tmp/actions.json --dry-run
```

## 3. Minimal action templates

### 3.1 Review: in-block update

```jsonc
[
  {
    "type": "update",
    "id": "<blockId>",
    "old_content": "<Paragraph>old text</Paragraph>",
    "new_content": "<Paragraph><Mark ar=\"delete\">old text</Mark><Mark ar=\"insert\">new text</Mark></Paragraph>"
  },
  {"type": "card_op", "op": "insert", "summary": "rewrite the outdated description", "kind": "agent_review"}
]
```

### 3.2 Review: add a block

```jsonc
[
  {"type": "insert_after", "id": "<anchorBlockId>", "content": "<Paragraph>added note.</Paragraph>"},
  {"type": "card_op", "op": "insert", "summary": "add a note", "kind": "agent_review"}
]
```

### 3.3 Review: reuse the previous card

```jsonc
[
  {
    "type": "update",
    "id": "<blockId>",
    "old_content": "<Paragraph>previous text</Paragraph>",
    "new_content": "<Paragraph><Mark ar=\"delete\">previous text</Mark><Mark ar=\"insert\">corrected text</Mark></Paragraph>"
  },
  {"type": "card_op", "op": "update", "discussion_id": "<reviewDiscussionId>", "summary": "continue fixing this paragraph"}
]
```

### 3.4 Direct edit: append content

```jsonc
[
  {"type": "insert_after", "id": "", "content": "<Paragraph>new entry.</Paragraph>"}
]
```

### 3.5 Direct edit: update the title

```jsonc
[
  {"type": "insert_after", "id": "", "content": "<Heading level=\"1\">Project background</Heading>\n\n<Paragraph>This project aims to...</Paragraph>"},
  {"type": "update_title", "title": "Quarterly product plan"}
]
```

`update_title` is direct-edit only, must be the last action, at most one per submit.

## 4. Text-selection / comment revision skeletons

### 4.1 Text-selection revision

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/get_doc_reviews.py" \
  --page-id "<pageId>"

python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_review_edit.py" \
  --page-id "<pageId>" \
  --summary "polish the wording per the selection" --actions-file /tmp/actions.json
```

Note: text-selection revision does not call `get_node_comments.py`; the `blockId` must still be verified by read-back. Full rules in `revision_flows.md`.

### 4.2 Comment revision

```bash
python3 "${CLAWCLAW_SKILL_DIR}/manage/get_node_comments.py" \
  --node-id "<pageId>" --discussion-id "<commentDiscussionId>"

python3 "${CLAWCLAW_SKILL_DIR}/doc/get_doc_reviews.py" \
  --page-id "<pageId>"

python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_review_edit.py" \
  --page-id "<pageId>" \
  --summary "polish the wording per the comment" --actions-file /tmp/actions.json
```

Note: the `discussionId` here is the original comment-thread ID, used only to pull comments; `card_op=update` accepts only the review card's `reviewDiscussionId`. Full rules in `revision_flows.md`.
