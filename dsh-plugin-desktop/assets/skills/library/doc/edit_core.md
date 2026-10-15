# Doc script API

When to read: unsure about CLI params, the actions schema, dry-run, or the stdout protocol. Action decisions are in `action_decision.md`; field and Mark contracts in `content_contract.md`; component syntax in `doc_references.md`.


## 1. Read the latest doc

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/get_doc_reviews.py" \
  --page-id "<pageId>"
```

Success:

```text
KS_DOC_REVIEWS	<pageId>	<byteSize>	<url>
<content text>
```

Failure: single-line JSON `{"error":"<sanitized reason>"}` on stdout; empty stdout is also treated as failure.

## 2. Submit a review

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_review_edit.py" \
  --page-id "<pageId>" \
  --summary "<user-visible summary>" --actions-file actions.json
```

- `--page-id` — required; page-ID mapping per `entry.md`.
- `--summary` — required, 1–200 chars; same semantics as `card_op.summary`.
- `--actions-json` / `--actions-file` / `--actions-stdin` — pick one.
- `--dry-run` — local validation and body translation only; no HTTP, no review card.

Success:

```text
KS_DOC_REVIEW_SUBMIT	<discussionId>	<anchorBlockId>	<affectedCount>
{"discussionId":"...","anchorBlockId":"...","anchorUrl":"...","affectedBlockIds":[...]}
KS_USER_REPLY	<user receipt>
```

Dry-run:

```text
KS_DOC_REVIEW_DRYRUN	<N>	actions=ok
{"dryRun":true,"actionsCount":N,"pageId":"...","createReviewCard":true}
```

After a real success, pass `KS_USER_REPLY` through verbatim. Never assemble links, leak `discussionId`, or describe a review suggestion as already landed in the body.

## 3. Direct edit

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_doc_edit.py" \
  --page-id "<pageId>" --actions-file actions.json
```

Same params as the review script minus `--summary`. Direct edit produces no review card; content contract in `content_contract.md` §4.

Success:

```text
KS_DOC_EDIT_SUBMIT	<anchorBlockId>	<affectedCount>
{"anchorBlockId":"...","anchorUrl":"...","affectedBlockIds":[...]}
KS_USER_REPLY	<user receipt>
```

Dry-run:

```text
KS_DOC_EDIT_DRYRUN	<N>	actions=ok
{"dryRun":true,"actionsCount":N,"pageId":"...","mode":"edit"}
```

Failure: single-line JSON error on stdout; empty stdout is also failure.

## 4. Create a whole doc

`create_doc.py` takes Markdown only — ClawClaw components are forbidden inside. Task boundaries in `tasks/read_create.md`.

```bash
# default creation location
python3 "${CLAWCLAW_SKILL_DIR}/doc/create_doc.py" \
  --title "<title>" --content "<complete Markdown>"

# explicit space or parent node
python3 "${CLAWCLAW_SKILL_DIR}/doc/create_doc.py" \
  --title "<title>" --space-id "<spaceId>" --parent-id "<parentId>" \
  --content-file /path/to/doc.content

# local self-check
python3 "${CLAWCLAW_SKILL_DIR}/doc/create_doc.py" \
  --title "<title>" --content "<complete Markdown>" --dry-run
```

- `--title` — optional; empty on create falls back to {{未命名文档}}; omitted on overwrite keeps the existing title.
- `--space-id` / `--parent-id` — optional; default creation location when omitted.
- `--content` / `--content-file` — pick one; content is complete Markdown.
- `--dry-run` — local checks: non-empty, encoding, size, forbidden components; no HTTP.

```text
KS_DOC_CREATE	<nodeBlockId>	<nodeKind>	<url>	<failedCount>	<fatalCount>
KS_DOC_CREATE_DRYRUN	<contentBytes>	content=ok
```

`failedCount` or `fatalCount` > 0 means the doc was created but content may be incomplete — must prompt the user to open and verify.

## 5. actions schema

- `insert_before` — `id`, `content`.
- `insert_after` — `id`, `content`; `id=""` means doc end.
- `delete` — `id`.
- `update` — `id`, `old_content`, `new_content`; optional `allow_drop_comment`, `drop_comment_reason`. Review mode only — direct edit has no usable `update`; use `insert_after` + `delete` (`content_contract.md` §4).
- `move` — `id` + exactly one of `after_id`/`before_id`.
- `card_op` — `op` plus branch fields; review mode only, must be last and exactly one.
- `update_title` — `title`; direct-edit mode only, must be last and at most one.

Detailed field contracts in `content_contract.md`; action, `card_op`, summary, and `update_title` decisions in `action_decision.md`; table-target limits in `tasks/table_edit.md`.

## 6. dry-run boundaries

Dry-run validates the local schema, body translation, component top-level structure, Mark boundaries, and comment-anchor loss protection — but has neither the remote target types nor the parsing context of a real submit. Complex components still follow `doc_references.md`; tables dispatch per `tasks/table_edit.md`; real-parse anomalies are in `server_pitfalls.md`.
