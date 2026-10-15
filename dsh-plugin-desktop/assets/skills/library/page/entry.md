# page — Data Page Category Entry

Routing only: this file points a task to the right flow doc; execution detail lives there — don't work from this file alone. Cross-module: table building / schema / record read-write are owned by `../database/entry.md` (never duplicate its logic here); image-hosting orchestration is in `image-hosting.md`; shared scripts are in `manage/entry.md`.

## Routing (one task, one route)

1. Generating a page from scratch — "build me a webpage / report / dashboard / one-page app / a workbench / a collection form / an intro or showcase page," or a data-persistence / sync need (the page and its data source stay linked both ways) — unless another product is named or the user explicitly wants only a local file, the end state is an online library page; stopping at a local HTML file is an unfinished task. Display pages, data apps, and pure-frontend multi-page sites all land here — multi-page routing is completed by the package's own config (a router / config file inside the artifact, no server side): package the whole site as one zip (multiple `.html` entries + assets, relative paths intact) and import per `import-flow.md` §2. Only a full front-end engineering project with its own build/deploy toolchain, or any ask needing a backend, goes to the main agent. Static vs. dynamic is decided by intent, not wording ("a page for the team to see" isn't dynamic; "a list I can add to anytime" is). One-line build asks (workbench / dashboard / site / tracker) with an inferable object execute directly: pick sensible defaults (personal space, standard schema, clean modern style), build end-to-end (table → HTML → upload → link), and iterate after delivery — never enter plan mode, never ask tech-stack questions, never stop at a proposal waiting for a confirmation reply; schema design confirmation is owned by `create-branch.md`'s strong-skip rule, not re-gated here. Dispatch:
   - Pure display (no ongoing add/edit/delete needed) → existing library node → 7; local material or a generic ask → 8; existing HTML → 9
   - Data persistence / sync → 9; dynamic fields, image-field pipeline → `schema-evolution.md`
   - Can't tell → any signal of "will edit data / swap images / add entries later" means dynamic, otherwise static (mention the page can be upgraded to a data-backed dynamic version later)
2. Read / summarize a hosted page's content → see "Read"
3. Edit a hosted page (nodeId or a `/space/d/` link) → `edit-flow.md`; also route here when re-import is rejected with `56161` (requires an admin) — don't just answer "no permission"; a user **reporting a problem with a hosted page** ("broken on mobile / data missing / white screen / too slow") also enters here — diagnose first per `edit-flow.md` §6.6, then run the standard edit flow
4. Clone a hosted page ("do the same thing / clone / copy this," given a nodeId, `/space/d/` link, or a short link at any domain's `/p/<id>`) → `clone-flow.md`; a clone match always takes priority over 7 / 8 / 9; for someone else's published page, default to cloning the appearance only, without source data (read-permission pre-check and fallback gate: `clone-flow.md` §3.5)
5. Publish / unpublish, or "put a node online / get me a link" → see "Publish" (format decision is consolidated there — never route out to site deployment)
6. Register / query / remove a page ↔ database relation → see "Relation"
7. One-click beautify of a non-html node (the "one-click visualize" button, or a library link plus a beautify/report intent) → `md-to-html-flow.md`; needs both a beautify intent and a library node — either missing goes to the main agent; CSV gets read-only visualization here, a data page needing add/edit/delete goes to 9
8. A visualization ask with no existing node, or a page built from local material (doc / ppt / pdf / excel / images) → `beautify-flow.md`; if a library node already exists, go to 7 instead
All 0-1 generation routes (7 / 8 / 9's generate branches) end with the product quality gate (`page-quality-check.md`: errors / performance / security / UX + data integrity when a database is linked; receipt signal `QUALITY_OK`). It triggers only on 0-1 generation — plain upload and plain edit never trigger it.

9. Data-page flow → `data-page-flow.md`: parse_html gives a strong / medium / weak / none pre-read, dispatching to the retrofit / upload-only / create branches; "upload-only" = the user said just upload, or the level is weak / none → straight to `import-flow.md`, don't build a table; no HTML, only a stated need → `create-branch.md`

## Read

Pull a hosted page's (kind=web) artifact files, download them, then search the HTML/CSS/JS:

```bash
# Paths only (no download, no CDN URL). Use when a multi-html package needs a target file first.
python3 "${CLAWCLAW_SKILL_DIR}/page/download_page_artifacts.py" --node-id "<page_node_id>" --list-only
python3 "${CLAWCLAW_SKILL_DIR}/page/download_page_artifacts.py" --node-id "<page_node_id>" --source publish --list-only

# Download: latest editing-state (add --version <n> for a specific version); repeat --path for selected files
python3 "${CLAWCLAW_SKILL_DIR}/page/download_page_artifacts.py" --node-id "<page_node_id>" --out-dir "<tmp_dir>" [--path "<rel>"]
# Published state (frozen public version; --version is ignored)
python3 "${CLAWCLAW_SKILL_DIR}/page/download_page_artifacts.py" --node-id "<page_node_id>" --source publish --out-dir "<tmp_dir>" [--path "<rel>"]
```

`--list-only` stdout is `KS_ARTIFACTS_LIST` (`source`, `url`, `files`, `html`, `entry_html`). Download stdout is `KS_ARTIFACTS_OK` (`work_dir`, `entry_html`, `files`) — search those local files. `url` is a CDN prefix; GET `url + path` is allowed. Querying the published state of a never-published page returns `Code_ERR_PAGE_NOT_PUBLISHED` (not published, not "resource missing") → guide the user to publish first, or read the editing state.

Before treating content as static, check for dynamic signals: if the HTML/JS matches `__SMART_PAGE__.database`, `databaseId`, or other runtime data signals, the page's real data lives in database records — query via `../database/entry.md` instead of searching HTML text (static content may be a pre-load placeholder or stale cache). No signal → purely static, search HTML/CSS/JS directly.

If the user reports the page offline / a control dead / data not showing → a server-side check alone isn't enough: verify the runtime — download the artifact, confirm `__SMART_PAGE__` injection and that filter/todo-style controls have their event bindings wired up (contract: `database-sdk-contract.md`) — before concluding; never answer "just refresh" on a server-side check alone.

Any answer about a hosted page's content → re-pull its artifacts this turn; content from an earlier turn is stale and must not back an answer.

## Import

Local HTML / ZIP import all goes through `import-flow.md` (commands, params, size / packaging / naming constraints, result criteria, receipts live there). Two hard gates:

- Before `import_html.py`, the final HTML must have cleared `image-hosting.md`'s flow and self-check — no leftover http/https links to third-party image sources. Single choke point; no import path bypasses it.
- `--node-block-id` is only for overwriting an existing node; editing a hosted page doesn't use it — route 3 instead.

A local HTML file the user wants viewable or shareable ("弄成能直接点开看的样子 / 发给同事 / 变成一个链接") is an import task: upload it as a library page and reply with its link — that link already serves the share need. It never goes to site deployment (that is for full projects with a build/deploy toolchain or a backend, not a lone HTML file), and never falls back to a local `open` command — opening the file locally on this machine shares nothing with the colleague.

## Publish

"Publish / go online / get a link / let others see it" is decided by the artifact's form, not the wording: already in the library (nodeId, `/space/d/` link, or `clawclaw.link`) → this capability's `publish_page.py` (versions kept, editing continues, data stays linked) — **never hand it to the main agent for external site deployment**; a lone local HTML file goes to Import above, not deployment. Site deployment is only for a local project that outlives the page form — its own build/deploy toolchain or a backend — with no library node.

```bash
# Publish; on success outputs KS_PAGE_PUBLISH<TAB><publishUrl>; reply with both links per the dual-link receipt rule below
python3 "${CLAWCLAW_SKILL_DIR}/page/publish_page.py" --node-id "<page_node_id>"
# Unpublish; on success outputs KS_PAGE_UNPUBLISH<TAB>OK
python3 "${CLAWCLAW_SKILL_DIR}/page/unpublish_page.py" --node-id "<page_node_id>"
```

Requires admin permission.

**Dual-link receipt (publish never replies with the publish link alone)**: even when the user explicitly asked to publish / share, the receipt carries **both** links, and tells the user which is which — the editing-state link (`clawclaw.cn /space/d/...`: collaborative editing; from `space.workspace.node-info`'s `data.node.url`, never self-assembled) and the published-state link (`clawclaw.link`: send it directly to others to view and experience; from the `KS_PAGE_PUBLISH` output). Both stay in the reply; the user picks the channel.

**Audience resolution**: "for my new colleagues / for the team" → team-space collaboration, not the personal space ("我的资料"); confirm or create a team space per `manage/entry.md` if needed. "Post it in a WeChat group / share with a client / a non-ClawClaw user" → non-ClawClaw users have no login session: the published link stays viewable without auth, but write-type interactions (form submission, etc.) will be blocked — say so before publishing, don't promise they can submit successfully.

## Relation

Records "which databases a page references" — the same record `import_html.py --databases` writes as an import side effect, also readable/writable independently. Single script `page_database_relation.py`:

```bash
# link / unlink: both pageId and databaseId required, idempotent; list: pass at least one
python3 "${CLAWCLAW_SKILL_DIR}/page/page_database_relation.py" --action link --page-id "<page_node_id>" --database-id "<database_id>"
python3 "${CLAWCLAW_SKILL_DIR}/page/page_database_relation.py" --action list --page-id "<page_node_id>"
python3 "${CLAWCLAW_SKILL_DIR}/page/page_database_relation.py" --action unlink --page-id "<page_node_id>" --database-id "<database_id>"
```

`--page-id` accepts a nodeId or `/space/d/` link; `list` with only `--page-id` returns every database that page references, only `--database-id` returns every page referencing it; success outputs the backend's JSON envelope, failure `{"error":...}`. Covers new entries going forward only, not legacy data.

A `link`/`unlink` receipt should include the page's access link (editing-state `/space/d/{pageId}`, or the publish link if published) — don't just say "linked/unlinked" and leave the user to find the page.

**Tree placement (same-batch creation + binding → mount; everything else stays put)**: a table created in the current task and bound to its page via that task's `import_html.py --databases` moves under the page node once the upload succeeds; a table linked afterwards, created in an earlier task, or bound by another flow stays where it is.

```bash
# success = stdout contains "api" and no "error" (clone-flow.md B10 pattern)
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" space.workspace.move-node \
  --node-id "<database_id>" --target-parent-id "<node_block_id>"
```

Guardrails: ① the user explicitly named a location (folder / space) → user intent wins, no auto-mount; ② one table, multiple pages → ask which page it should sit under (candidates via `page_database_relation.py --action list --database-id`); no clear answer → leave it in place; ③ `unlink` never moves a table back; ④ csv→html (`md-to-html-flow.md` §2) keeps its inverted mounting — the page mounts under the table as its read-only view, never the reverse. A failed move never blocks delivery: data flow depends on the `--databases` binding, not tree placement; state any failure in the receipt.

## Red lines

- Writing `__SMART_PAGE__.database.*` into HTML requires a hard-coded `databaseId` (from the table-creation script's output); the minimal working templates (query pagination / addRecord / uploadImage / type conversion) live in `sdk-templates.md`; read `database-sdk-contract.md` only when a need goes beyond them; cross-module script protocol: `../database/entry.md`
- Dynamic field add/remove/edit sync, image-field pipeline → `schema-evolution.md`
- The artifact must never leak plaintext secrets / cookies / tokens; when a schema is ambiguous, never guess — offer candidates for the user to pick; never reuse a stale transactionId after an edit-transaction conflict
- Conflict-resolution order (highest to lowest): safety and fallback constraints > script stdout contract (`KS_*` / canonical schema structure) > the user's explicit instruction > self-check checklist (`canonical-schema.md` §1.6) > schema default rules > experience-level detail
- Receipts: forward the `KS_USER_REPLY` line verbatim, never rewrite or splice; for an import, reply with the url — the full chain replies "Database created (ID: …) + HTML uploaded + access link"; on failure, follow `../error_handling.md`'s error-code action table
