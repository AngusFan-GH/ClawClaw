# Page Edit Flow

Edit flow for an already-hosted Page (imported into or published on the ClawClaw Page platform): pull the artifact through the Page Agent transaction protocol, modify the downloaded files, upload only the changed files, and commit a new version.

> This flow also executes `../mutation.md` alongside it.

## 1. Trigger conditions

Use this flow when the user asks to modify a page already hosted on the Page platform, and gives any of the following:

- a `nodeId`, a `/space/d/<nodeId>` link, or a Page node ID already resolved by an upstream module
- an upstream `node-info` call that returned `kind=web` or `kind=page`
- a request to "edit the page based on comments / handle the page's comments," with the Page `nodeId` and optionally a `discussionId`
- a user reporting a problem with a hosted page (broken / messed up on mobile / data missing / white screen / too slow) → diagnose first via §6.6, then edit

### 1.1 Routing by intent

- Page link + change content / read content / locate text / edit copy → this flow
- Database link + change data → edit the database (record/field); the linked page reflects it on its next load
- Edit based on comments → pull comments with `manage/get_node_comments.py` first, then edit the HTML through this flow
- Fault fix → diagnose first via §6.6, then the standard edit flow (§5)

## 2. Protocol-to-implementation mapping

- Control flow: `create_page_transaction.py` opens the transaction **and** lists this baseline's artifacts in one call (`url` is the CDN directory prefix; `files` / `html` are relative paths). `commit_page_transaction.py` commits. Uploads go through `upload_page_artifact.py` (get-page-upload-url + PUT inside the script)
- CDN artifact URLs are public directory prefixes — GET `url + path` is allowed. Never print or curl a COS **presigned** `uploadUrl` / signed query string
- Lazy-copy: only changed files are uploaded; the backend's `commit` fills in unchanged files based on `baseVersion`
- No protocol-level `confirm` step: the protocol flow is `create → GET selected CDN files → upload → commit`; the user-facing publish-state confirmation is in §5.1

## 3. Call sequence

```bash
# 1. Open a transaction and list this baseline's artifacts.
#    stdout: KS_PAGE_TX_OPEN {transactionId,baseVersion,url,files,html}
#    url is a CDN prefix (trailing /). Do not call list/download scripts again.
python3 "${CLAWCLAW_SKILL_DIR}/page/create_page_transaction.py" --node-id "<page_node_id>"

# 2. GET only the files this round will edit (url already includes the version directory)
mkdir -p "<tmp_dir>"
curl -fsSL "<url>about.html" -o "<tmp_dir>/about.html"

# 3. After editing and §5.2 self-check: upload each modified file (script fetches the PUT URL and uploads; no uploadUrl in stdout)
python3 "${CLAWCLAW_SKILL_DIR}/page/upload_page_artifact.py" \
  --transaction-id "<tx_id>" --path "about.html" --file "<tmp_dir>/about.html"

# 4. Commit + delete this round's <tmp_dir> (only after a successful commit; omit --pnid when none)
python3 "${CLAWCLAW_SKILL_DIR}/page/commit_page_transaction.py" \
  --transaction-id "<tx_id>" --pnid "<data_page_node_id>" --message "更新页面" \
  --cleanup-dir "<tmp_dir>"
```

## 5. Standard edit flow

- Stage 1 — Agent action: open a transaction with `create_page_transaction.py` — decision: record `transactionId`, `baseVersion`, CDN `url`, and the `html` / `files` lists. Do not call `download_page_artifacts.py`
- Stage 2 — pick the artifact(s) this round will actually edit from `html` (user named a page / only one html / match by filename). Create `<tmp_dir>` and GET `url + <rel>` into it (repeat for css/js this round will change). Copy the downloaded files as-is into `<tmp_dir>/.baseline/` and never touch the baseline again — it is the sole reference for the §5.2 self-check. See §7 for baseVersion. Never pull every html in a multi-page package just to edit one page
- Stage 3 — Agent action: analyze and modify the working copy — decision: only touch files relevant to the user's need; leave unmodified files as-is; locate the target element and record this round's `pnid` per "HTML element location and pnid recording rules," leaving it empty if none is found
- Stage 3.5 — Agent action: run image hosting per `image-hosting.md` + the pre-delivery self-check (checkpoint 2) — decision: if the self-check fails, go back and redo it; never silently commit a page with a lingering external-link risk
- Stage 3.6 — Agent action: run the "two-way diff self-check" per §5.2, comparing the baseline copy against the working copy (checkpoint 3) — decision: if the self-check fails, go back and redo it; **never** commit a transaction carrying out-of-scope changes or leftover context content
- Stage 3.7 — Agent action: when this round's change touches the page's record-write path (form submit → `__SMART_PAGE__.database` writes), run the §5.3 write-read-back verification (checkpoint 4) — decision: a failed assertion blocks upload; never commit a write path that lands in the wrong field or with values the table views can't render
- Stage 4 — Agent action: call `upload_page_artifact.py` once per modified file — decision: `--path` must be the artifact-relative path, never an absolute path or `..`; `--file` is the working-copy local file (not `.baseline/`); only upload files that passed the §5.2 self-check. Do not fetch upload URLs or PUT to COS yourself.
- Stage 5 — Agent action: `commit_page_transaction.py --cleanup-dir <tmp_dir>` — decision: before committing, generate a Chinese `message` of 50 characters or fewer describing this round's change, e.g. "更新文案"/"调整样式"; include `--pnid` when you have one, omit it otherwise; always pass `--cleanup-dir` (the script deletes it after a successful commit, and also after a `19901` version conflict so the stale working copy cannot be reused). On success, read the returned `url` and reply {{Agent已为您完成相应的修改，[点击查看](<url>)}}; see §7 for conflict handling. Do not start a second turn to `rm` the temp dir

### 5.1 Publish-state awareness: ask whether to sync the change to the published state (need)

Committing a new version only updates the **online editing version**. After a successful commit, if the page is published, ask the user whether to sync the change to the published state — never silently leave the published state on stale content.

- Step a — published = `node-info` returning a non-empty `publishUrl` or a publish flag
- Step b — if published → **ask the user**: {{这个页面已经发布过了，要不要把这次修改也同步更新到发布版本？}}
- Step c — user confirms → trigger the published-state update (re-publish / sync to the version behind the publishUrl); user declines → only the online version updates
- Step d — not published → don't ask; reply with the online-version link

Skip the ask when this round made no actual content change, or the user has already said to just update the draft/online version. The exact publish-sync endpoint follows the platform's publish capability; `commit` only produces a new online version.

### 5.1.5 Retrofitted controls keep their original interaction pattern

When retrofitting an existing control (single-select → multi-select, adding a filter or sorting), keep the control's original interaction form — never swap in a different component type on your own initiative. For a multi-select need, default to a dropdown panel + checkbox list or a native `<input type="checkbox">` group, never `<select multiple>`. Filter/sort controls follow the dropdown, tag, or button-group pattern the original page already used. If the user explicitly asks for a specific interaction form, follow that instead.

### 5.2 Two-way diff self-check on the change scope (checkpoint 3 · hard gate)

Before uploading, diff the working copy against the baseline copy saved in §5 stage 2; both directions must pass before stage 4.

```bash
# Compare the files actually downloaded this round (not the whole package)
diff -u "<tmp_dir>/.baseline/<rel>" "<tmp_dir>/<rel>"
# Or run a recursive diff over the whole temp dir; the baseline copy lives inside <tmp_dir> and must be excluded
diff -ruN --exclude=.baseline "<tmp_dir>/.baseline" "<tmp_dir>"
```

- **Direction A (`-` lines)** — every deleted/replaced piece of original text must be something this round's need actually asked to change; everything else in the original (formatting, indentation, comments) stays untouched
- **Direction B (`+` lines)** — every added piece of content must trace back to this round's need or this round's downloaded content; text/fields/`__SMART_PAGE__.database` calls/`databaseId`s/DOM that were rolled back or deleted in a previous round count as untraceable additions
- Both directions pass → proceed to stage 4 upload. Out-of-scope change / untraceable addition → restore that spot to the baseline content and re-run. Still failing after repeated attempts → stop committing and get the user's call.

Direction B is mandatory: direction A alone won't catch old content written back, and a leftover `__SMART_PAGE__.database.*` call pollutes the §6.5 reference-set diff, causing an unlinked table to get `link`ed again by mistake.

### 5.3 Write-read-back verification on the record-write path (checkpoint 4 · hard gate)

When this round's change adds or modifies logic that persists records through `__SMART_PAGE__.database` (form submit → `addRecord`/`updateRecord`, image/attachment upload chains), verify the write target end-to-end before Stage 4 upload:

1. Pull the schema via `database/get_database_schema.py --database-id <id>` and state explicitly which field(s) the user's view (table column / kanban card) displays for this data.
2. Insert one `[TEST]` record via `database/batch_add_database_records.py`, using the same field names and value structures the edited page code produces (structure per `database/params-reference.md` §PropertyValue; image/attachment values carry a hosted `https` URL per `database-sdk-contract.md`, never `data:` / `blob:`).
3. Read back via `database/get_database_record.py` on the new record id and assert: the record exists; the key value landed in the **expected field**, not a different field of overlapping semantics (image vs attachment, old column vs new column); an image `imageUrl` is an `https` URL.
4. Delete the `[TEST]` record via `database/batch_delete_database_records.py` on both the pass and fail paths — a self-created test record, so the `database/entry.md` §13 gate does not apply; if verification aborts, clean the leftover on next contact and before delivery.

Any assertion fails → the write path is wrong: fix the page code and redo §5.3 before Stage 4.

### HTML element location and pnid recording rules

`pnid` comes from an HTML element's `data-page-node-id` attribute and tells the backend which page node this round's change corresponds to. Locate the target element per the priority below and record this round's `pnid` (omit it if none is found):

1. Explicit `pnid=<id>` / `data-page-node-id=<id>` from the user, an upstream module, or a comment → the matching element is the edit target.
2. Comment-based revision → read `pnid` from `thread.props.pageAnchors[]`, preferring the first that matches an element in the HTML.
3. Plain CSS selector → use it to find the element, but read the real `data-page-node-id` from the matched element or its nearest ancestor for `--pnid`; a CSS selector itself is never the `pnid`.
4. Text / screenshot description / natural-language location → search the HTML for the target text or structure, then take the matched element or its nearest ancestor carrying `data-page-node-id`.
5. Deleting an element → record its `data-page-node-id` (or the nearest ancestor's) before deleting.
6. CSS/JS-only change → take the first clearly affected target HTML element, or its nearest ancestor carrying `data-page-node-id`.
7. Global styles, global script logic, dynamically generated DOM, or no locatable `data-page-node-id` → don't pass `--pnid`; commit directly.

## 6. Comment-based revision flow

The user asks to edit the page based on comments; the input includes the Page `nodeId`, optionally a `discussionId`. This is an input branch of the standard edit flow: pull the comments first, then enter §5.

Pull the comments:

```bash
# a specific comment thread
python3 "${CLAWCLAW_SKILL_DIR}/manage/get_node_comments.py" --node-id "<page_node_id>" --discussion-id "<discussion_id>"
# all comments on the node
python3 "${CLAWCLAW_SKILL_DIR}/manage/get_node_comments.py" --node-id "<page_node_id>"
```

Stdout is a `KS_DOC_COMMENTS` receipt line followed by a JSON array; each thread carries `discussionId`, `resolved`, `props.pageAnchors[]` (each anchor has `pnid` / `tag` / `textContent`), and `comments[].plainText`.

For each comment to process:

1. Take `pnid` from `thread.props.pageAnchors[]` and locate the target element per "HTML element location and pnid recording rules."
2. Modify that element or its necessary child elements based on `comments[].plainText` and `anchorText`.
3. No `pnid` matches the HTML → search by `textContent` / `anchorText`; still nothing → don't edit blindly — tell the user the comment anchor is stale or the page version has changed.

Then continue with §5 stages 3.5–5 (self-checks, upload, commit). For `--pnid`, pass the `pnid` of the first `pageAnchors[]` entry successfully matched and edited this round; `--message` is a Chinese description of 50 characters or fewer.

Key rules:

- With a `discussionId`, only process that thread; without one, process every active comment on the node together.
- `discussionId` is only used to pull comments and trace the receipt — it's not a transaction ID, and is never passed to `commit_page_transaction.py`.
- A comment revision commits a new Page version directly — it never generates a doc review card.
- Multiple comments default to merging into a single transaction commit, unless the user asks to split them or the asks conflict.
- Resolved threads aren't returned by default; pass `--include-resolved` to include them.

## 6.5 Relation sync: register page ↔ database relation changes made during an edit (need)

If this round's edit changes the set of databases the page references (adding or removing an `__SMART_PAGE__.database.*` SDK call for some `databaseId`, or the user asks to link/unlink a table), `commit` does not sync the backend relation table — register it separately. Reference set unchanged → don't touch the relation.

Sequence: after committing the new version (§5 stages 1–5), pull registered relations via `entry.md`'s "Relation" `list` action, diff them against the `databaseId` set actually referenced in the edited HTML, `link` newly referenced ones, `unlink` no-longer-referenced ones. Commands, params, and idempotency semantics follow `entry.md`'s "Relation" section. When unsure whether a `databaseId` is still referenced, confirm via the list + HTML comparison first — never unlink from memory.

## 6.6 Fault-fix branch (user reports a problem with the page)

The user reports a problem with a hosted page (messed up / squeezed on mobile / data missing / stats wrong / white screen / errors on open / too slow / images broken) and gives the `nodeId` / link. This is an input branch of the standard edit flow: diagnose first, then edit via §5. Only the diagnosis orchestration is added here:

```
1. Pull the artifact per §5 stages 1-2
2. Diagnose: run lint on the working-copy HTML (commands below); map each FAIL/WARN to the user's symptom per §6.6.1
3. Fix per the matched rule's reason (each lint error's reason carries its own fix)
4. Re-run lint until FAILs reach zero (or an --ack declaration)
5. Continue with §5 stages 3.5–5 (self-checks, upload, commit)
6. If the page is published → ask about syncing to the published state per §5.1
```

Diagnosis commands (artifact already in `<tmp_dir>`):

```bash
# All pages (errors / performance / security / UX / mobile)
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_page_quality.py" --html "<tmp_dir>/index.html" --has-database
# Pages linked to a database (data integrity): take the schema from the real table
python3 "${CLAWCLAW_SKILL_DIR}/database/get_database_schema.py" --database-id "<database_id>"
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_database_sdk_usage.py" --schema '<schema JSON>' --html "<tmp_dir>/index.html"
```

### 6.6.1 Symptom → problem-class mapping

The user speaks in symptoms; lint outputs rule numbers. Lock the class here first, then find the matching rule in the lint output:

1. Messed up / squeezed on mobile / horizontal scrolling — Mobile compat (PQ201-205) → add viewport / `@media` single-column collapse / `img max-width` (patterns: `beautify/beautify-guide.md` "Mobile adaptation hard rules")
2. Data missing / stats wrong / others' additions invisible — Data integrity (DSDK014/015) → add `hasMore`/`nextCursor` follow-up paging to pull the full set
3. White screen on open / nothing shows — Robustness (PQ001-004) → fix syntax / add `.catch` / add the `__SMART_PAGE__` existence guard
4. Errors on open — JS errors (PQ001-003) → locate the syntax / chain problem from the error
5. Slow to load — Performance (PQ101-104/109) → lazy loading / async-defer / large base64 → hosted direct links / batch-render large lists
6. Images broken — Dead resources (PQ007 + image hosting) → local paths and third-party hotlinks re-hosted per `image-hosting.md`
7. Content shown is fake / sample data — Mock fallback (DSDK016) → delete the fake data in catch; show an empty state instead

### 6.6.2 Two exits from the diagnosis

- Lint has hits → fix per the rule, then steps 4–6 above.
- Lint passes but the symptom persists → compare published vs. editing artifacts (`download_page_artifacts.py --source publish --path <rel>` vs this round's working copy); if the published state is stale, guide the sync per §5.1; if they match, treat it as a runtime problem outside lint coverage — explain to the user and investigate; never change things blindly.

The fix commit's `--message` states what was fixed, in ≤50 Chinese characters.

## 7. Concurrency and versioning rules

- `create_page_transaction.py`'s `baseVersion` is the backend's current latest version; its `url` is that version's CDN directory. GET `url + path` so the working copy matches the transaction baseline. Do not list or download via another script.
- Every transaction re-downloads the files this round will edit: only files fetched from this transaction's `url` may serve as the edit baseline. Other html files in the package stay on the server and are filled in by commit from `baseVersion`.
- The Nth edit within the same round is still a complete edit: redo from §5 stage 1 (reopen the transaction → re-download → re-save the baseline). The previous local directory, baseline copy, or artifact text carried in context must never be treated as the baseline. `--cleanup-dir` physically enforces this after a successful commit and after a `19901` version conflict.
- Content is authoritative from what was downloaded this round — when it disagrees with context memory or a previous round's artifact, the download wins (covers the user rolling the page back).
- What carries across rounds: the user's confirmed intent and agreed terms, already-hosted image COS direct links, knowledge of `databaseId` and the schema; `pnid` is only a lead, re-verified against this round's HTML. Never carry forward file-content copies or what the page looked like.
- Version fields exist for transactional consistency only — there is no user-facing version rollback / history restore. Asked to roll a page back to a previous version → say the library does not support it.
- Capability claims need grep evidence: only commands actually found in this skill's docs count as supported; a grep that returns nothing means not supported — never infer support from version numbers, artifacts, or API shapes.
- `commit` hits a status/version conflict code from `SKILL.md` → the current transaction can no longer be used; `--cleanup-dir` is already gone; redo the entire edit flow from §5 step 1 (new temp dir, re-download from the new transaction `url`).
- Concurrent-edit circuit breaker: 3 consecutive version conflicts within the same task → stop retrying, tell the user concurrent edits were detected and editing is paused to avoid overwriting their changes; wait for their go-ahead, then redo from §5 step 1.
- `upload` / `commit` fails on transaction expiry → handle as a failure and restart the edit flow.

## 8. Security and boundaries

- Never output a token, cookie, raw endpoint response, COS header, or COS **presigned** `uploadUrl` / signed query string. CDN artifact prefixes from `create_page_transaction.py` (`url`) may be used to GET files. Uploads stay inside `upload_page_artifact.py`.
- Only upload files that were actually modified and passed the §5.2 two-way self-check; don't upload unmodified files just to have a "complete version."
- `<tmp_dir>` (including `.baseline/`) is round-local only: never uploaded as an artifact, never in `upload_page_artifact.py --path`, never a deliverable or preview; pass it as `commit_page_transaction.py --cleanup-dir`. The receipt only gives the remote `url` returned by the commit — never a local path.
