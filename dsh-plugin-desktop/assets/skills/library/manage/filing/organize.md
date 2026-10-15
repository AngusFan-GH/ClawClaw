# filing — Organize flow

Runs when the user asks to organize / tidy / archive a space (整理目录、归档散落文件、清理根目录). It builds a clean directory tree and writes the convention file that creation-time routing (`entry.md`) reads — this flow is its single writer; every other chain is read-only.

## Flow

1. Snapshot: `list-nodes` the space root (paginate until `hasMore` is false); record every node's id / title / kind.
2. Classify: directory nodes and guide pages stay; scattered files archive. Peek into content when the title is ambiguous — `database/get_database_content.py --database-id` for databases, `doc/get_doc_reviews.py --page-id` for docs. Eval / benchmark / desensitized-sample products archive by default; real work documents archive only when the user says so, and the report lists them separately so the user knows they can be recovered. Implicit system artifacts never archive: a `web` node titled like `*.html` that the user never mentioned in this session is likely a hidden session-share page — leave it in place and list it in the report as 疑似系统产物（未移动）; until the backend exposes a visibility marker this heuristic is the only guard, and a wrong skip costs one unarchived file while a wrong move exposes a hidden node.
3. Confirm: the user's explicit organize request already authorizes the moves — present the plan (directories to create, nodes to move) and execute it in the same turn; never stop and wait for a reply. Duplicate or same-name existing folders do not block: reuse the existing folder for this run's moves, note the duplicates in the report, and continue — do not stop to ask which one to keep.
4. Archive: create directories (`../create_folder.py`) and move nodes (`space.workspace.move-node`). Move by node id — same-title nodes differ in id. Log each move; retry failures individually.
5. Re-check late arrivals: re-run `list-nodes`; move any new scattered files (eval tasks may still be running), applying the same implicit-artifact guard; cap the loop at two passes — a node that keeps reappearing stays put and goes into the report, never loop endlessly.
6. Verify: root holds only directory nodes; the fallback directory count = before + moved.
7. Write the convention per `layout-schema.md` — every id from this run's real `list-nodes` results, `fallbackNode` points to the temporary / test directory from step 4, or to the existing 「自动化任务归档」 auto-archive directory when one is already at the root — then validate:

   ```bash
   python3 "${CLAWCLAW_SKILL_DIR}/manage/filing/layout_route.py" --validate ~/.clawclaw/library-layouts/layout-<spaceId>.json
   ```

   Only `KS_LAYOUT_VALID` counts as written.

8. Report: why the files appeared, where they went, which real work documents were archived.

## Convention form

1. No `mode` recorded yet → ask once: folder tree (`mode: folder`, JSON only) or doc index (`mode: doc`, 「目录索引.md」 as the human-readable master). Reuse the recorded choice afterwards.
2. `mode: doc` → create 「目录索引.md」 at the space root with the fixed usage note (see `layout-schema.md` §3); record its node id as `conventionDocId`.

## Doc-mode sync

Runs when the user edited 「目录索引.md」 and asks to sync — no re-organize needed:

1. Pull the md fresh from the cloud via `conventionDocId` (`doc/get_doc_reviews.py --page-id`); never use a local cache.
2. Re-derive nodes / fallback; re-verify every id with `list-nodes` (re-locate by title when the user moved it; report unfound nodes, never drop them silently).
3. Rewrite the JSON — update `nodes[]` / `fallbackNode` / `generatedAt`, keep `mode` / `conventionDocId` — and validate to `KS_LAYOUT_VALID`.
4. Sync never runs automatically; until the user triggers it, routing keeps using the JSON snapshot.

## Incremental update

Runs when the user names a recurring topic and its home ("以后这类放 X") or has just created a new directory in the frontend — no full re-organize needed:

1. Read the current JSON; verify the target node's id with `list-nodes` (re-locate by title when moved; report and abort when missing).
2. Add the node when new, otherwise extend its `keywords[]` / `intent`; touch nothing else.
3. Revalidate to `KS_LAYOUT_VALID`. This update and the flow above remain the only writers of the convention.

## Rules

1. Never write the convention outside this flow.
2. Never hard-delete content; archiving means moving into a directory.
3. Proactive staleness patrols (cross-checks, scattered-file alerts) belong here, not to the creating chain.
4. Organizing changes node positions, never visibility: any node suspected to be a system artifact (session-share pages and other implicit nodes) stays where it is, flagged in the report — moving it would surface a hidden node in the directory tree.
