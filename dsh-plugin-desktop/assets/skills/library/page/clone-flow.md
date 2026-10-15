# page · HTML Artifact Clone Flow (clone-flow)

> **Responsibility**: clone an equivalent page into the library from a "source artifact". The source can be a detail-page link
> `/space/d/{nodeId}`, a bare nodeId, or a published-state short link `/p/{nodeId}`. Pure display pages go through Branch A (direct HTML upload); data pages
> bound to a database go through Branch B (copy the tables first, remap ids, then mount; if the source table is unreadable, go through the §3.5 fallback gate first).
>
> Orchestrated by `entry.md`; the upload step reuses `import-flow.md`; table creation / data import reuse `../database/entry.md`.
>
> **Execution principle**: clone = equivalent copy. **Do not interpret what the HTML content is, do not analyze page functionality, do not describe what the page does.**
> Unless the user explicitly asks to "understand / summarize / retrofit the page content", execute strictly along §1→§4/§5 through to artifact delivery,
> with no extra content interpretation, functional explanation, or design commentary. Only when the user explicitly asks to "explain this page", "summarize the content",
> "modify a certain part", etc., handle it with the corresponding capability (read / edit) after the artifact has landed.
>
> **Publishing is forbidden**: cloning only produces a draft-state page — **never call `publish_page`**. Unless the user **explicitly** asks in this turn to
> "publish / go live", cloning ends once the artifact lands — no publish action is taken.

## 0. Capability boundary and decoupling point

Cloning depends on one **unified artifact-fetch entry point** (`{artifact base url, artifacts[].path}`):

- Editing state: `/space/d/{nodeId}`, bare nodeId (`download_page_artifacts.py` defaults to `--source edit`, backed by `list-page-artifacts`).
- Published state: `/p/{nodeId}` short link or an already-published page (`--source publish`, backed by `list-page-publish-artifacts`, always reads `meta.publishVersion`).

> **Contract**: both states share the same output shape (`data.url` + `data.artifacts[].path`); `download_page_artifacts.py` unifies them via `--source`.

**Source-data reachability boundary**: anyone can download a published `/p/` page's rendered artifacts, but the underlying table is an independent node following its own sharing settings. When a cross-account source table is unreadable, node-info / get_database_content returns `12607` (generic permission denied; per `../error_handling.md`: report directly, do not retry). Whether source data can be migrated is decided by the §3 pre-check, not by "the source being published".

## 1. Input normalization

- `.../space/d/{id}?source=2` → extract `/space/d/([^/?#]+)`, ignoring the query string automatically.
- `.../p/{id}` → extract `/p/([^/?#]+)` (published-state short link, any domain, including `clawclaw.link`).
- Bare nodeId → use as is.

Normalization is built into the fetch script; the agent does not need to handle it manually. The `{id}` in `/p/{id}` must be the full 22-character nodeId; a truncated slice is not a valid node ID — when encountered, ask the user for the full nodeId or a `/space/d/<nodeId>` link.

## 2. Fetch artifacts to a local directory

> **The working directory must persist**: `/tmp` (including `/private/tmp`) is not guaranteed to persist across Bash calls.
> **Always pass `--out-dir` explicitly, pointing to a subdirectory under the project working directory** (e.g. `$CWD/clone_work`); **never rely on the script's default `/tmp`**.
>
> ```bash
> export WORK="$(pwd)/clone_work"   # under the project cwd, persists across Bash calls
> mkdir -p "$WORK"
> ```

```bash
# Editing state (default): source is a detail-page link / bare nodeId
python3 "${CLAWCLAW_SKILL_DIR}/page/download_page_artifacts.py" \
  --node-id "<link or nodeId>" --out-dir "$WORK/src" [--version <n>] [--concurrency 4]

# Published state: source is a /p/<id> published-state short link or an already-published page (always uses publishVersion, ignores --version)
python3 "${CLAWCLAW_SKILL_DIR}/page/download_page_artifacts.py" \
  --node-id "<link or nodeId>" --source publish --out-dir "$WORK/src" [--concurrency 4]
```

- Internally: selects `list-page-artifacts` (editing state) / `list-page-publish-artifacts` (published state) via `--source`, reads `data.url` + `data.artifacts[].path` → **parallel GET** (default concurrency 4, 30s per-file timeout, 1 retry on failure) → writes to disk by relative path, preserving the css/js/img subdirectory structure.
- Completeness hard gate: the entry HTML must exist and the downloaded count must equal the manifest count; a missing file raises an error, never silently. Omit `--path` and `--list-only` — those flags are for edit/read selective fetch; clone must pull the whole package.
- Path safety: rejects absolute paths / `..` traversal.
- Success: `KS_ARTIFACTS_OK {"work_dir","entry_html","files":[...]}`; failure: `{"error":...}` with exit 0.
- All subsequent file reads must use the `work_dir` returned by `KS_ARTIFACTS_OK` as the base (the script has already normalized it to a native absolute path). On Windows Git Bash, `$(pwd)` is MSYS-style (`/c/...`); the script has a normalization fallback for this, but never pass a manually-built MSYS path to other scripts.
- Published-state specific: if the target page has never been published, the backend returns `Code_ERR_PAGE_NOT_PUBLISHED`; guide the user to publish first or switch to the editing-state source.
- Never echo back signed URLs / tokens.

## 3. Dependency-probe branching (local only, no network requests)

Scan the downloaded **entry HTML** locally. The evidence is split into two tiers. **Every grep must use `-a`** (minified / overly-long lines / HTML containing special bytes get silently skipped by grep as binary — a missed match directly leads to a misjudged branch):

- **Tier 1 (any match → Branch B; the deduplicated union of matches is the full old-table set `db_old_set`)**:
  1. `databaseId:` literal (single or double quotes, tolerant of a space after the colon);
  2. `data-sp-database-id="..."` binding attribute;
  3. `DB_*` constant definitions (`const/let/var DB_X = '...'` constant-relay pattern — literal-scan misses often come from this).
- **Tier 2 (exclusion evidence — a match means Branch A must NOT be judged; must cross-check with parse_html)**:
  `__SMART_PAGE__` / `data-sp-bindable` / SDK method names (`.query|.addRecord|.getRecord|.getSchema|.updateRecord|.deleteRecord`).
- **The only valid path to judging Branch A**: both tiers have zero matches AND `parse_html.py --html`'s `existing_databases` is also empty — only then judge Branch A. **An empty literal scan ≠ Branch A** — minification, constant relaying, and attribute binding can all empty out the literal scan.

**Detect directly with grep (most reliable, recommended)**:

```bash
ENTRY="$WORK/src/index.html"   # entry_html returned by §2
# Tier 1: extract ids from the union of the three forms (any match → Branch B; the deduplicated union is db_old_set)
grep -aoE "(databaseId[[:space:]]*:|data-sp-database-id[[:space:]]*=|DB_[A-Z0-9_]+[[:space:]]*=)[[:space:]]*[\"'][^\"']*[\"']" "$ENTRY" \
  | grep -aoE "[\"'][^\"']*[\"']" | tr -d "\"'" | sort -u
# Tier 2: exclusion evidence (a match means Branch A must NOT be judged; must cross-check with parse_html)
grep -aoE '__SMART_PAGE__|data-sp-bindable|\.(query|addRecord|getRecord|getSchema|updateRecord|deleteRecord)\b' "$ENTRY" | sort -u
```

> `parse_html.py` (**must run** for cross-check whenever Tier 1 is empty or Tier 2 has a match; the argument must be `--html <path>` — a missing `--html` reads empty and causes a false Branch-A judgment):
> ```bash
> python3 "$CLAWCLAW_SKILL_DIR/page/parse_html.py" --html "$ENTRY"
> ```
> Outputs `existing_databases` / `sdk_calls_found`.

> **Also completes the source-table pre-check + fetches the original title along the way** (both Branch A and Branch B need the title, used as `--file-name` in step A4 / B9; the pre-check result decides whether Branch B can enter the copy path):
> - **Page title**: use `data.title` returned by `download_page_artifacts.py` in §2 (present for both editing and published state); if missing, additionally call `space_api.py space.workspace.node-info --node-id <page_node_id>` to fetch `data.title`.
> - **Database title**: for each `db_old_i`, call `space_api.py space.workspace.node-info --node-id <db_old_i>` **in parallel** to fetch `data.title`, used as the display name for that csv's clone artifact.
> - **Batch-parallel "pre-check + fetch title" pattern** (one call serves two purposes: gathers all db_old titles for B5's DBS array, and completes the source-table reachability pre-check at the same time):
>   ```bash
>   # use an array; never `for db in $STR` (zsh does not word-split — the whole string would be treated as 1 element → node-info raises KeyError)
>   DB_OLD_ARR=(db_old_1 db_old_2 db_old_3)   # ...N tables
>   > "$WORK/titles.tsv"; > "$WORK/denied.tsv"
>   for db in "${DB_OLD_ARR[@]}"; do
>     (
>       out=$(python3 "$CLAWCLAW_SKILL_DIR/space_api.py" space.workspace.node-info \
>               --node-id "$db" 2>&1)
>       # success criterion = contains "api" and does not contain "error" (same as B10); failure (12607 permission denied / node not found) is recorded to denied.tsv
>       if ! echo "$out" | grep -q '"api"' || echo "$out" | grep -q '"error"'; then
>         echo "$db|$out" >> "$WORK/denied.tsv"
>       else
>         title=$(echo "$out" | python3 -c "import sys,json;print(json.load(sys.stdin)['data']['node']['title'])")
>         echo "$db|$title" >> "$WORK/titles.tsv"
>       fi
>     ) &
>   done
>   wait
>   # each line of titles.tsv is "db_old|title"; B5's DBS array can read it directly: DBS=($(cat "$WORK/titles.tsv"))
>   # a non-empty denied.tsv → immediately triggers the §3.5 fallback gate; never retry node-info or switch interfaces to keep probing a denied db
>   ```
> - **Never call node-info separately again inside the B5 script**: titles are gathered once in §3 and passed into B5 via the DBS array; B5 itself only exports and imports.
> - **Always iterate with arrays `"${ARR[@]}"`**: never use the word-split-dependent `for x in $STR` — under zsh, the lack of splitting causes the whole string to be treated as one element, leading to a downstream KeyError.

## 3.5 Fallback gate (source table unreadable)

Triggered when `denied.tsv` is non-empty — any source-table node-info call failed (cross-account permission denied `12607` / node not found). In this case, "copy source table → remap" does not hold: for a published data page owned by someone else, only the appearance can be cloned — **source data cannot be migrated across accounts**.

- **The user's message already carries a fallback spec** (e.g. "if that capability is unavailable, build it this way instead" followed by concrete requirements) → do not ask; follow the given spec directly (`create-branch.md`, or Branch A appearance-only clone), and state in the receipt that「源数据不可跨账号迁移，已按你的规格新建」.
- **No fallback spec given** → pause and ask once, offering these default recommendations:
  1. Infer a schema from the source HTML and create an **equivalent empty table** + remap (default recommendation: same appearance and structure, empty data, can import your own data later);
  2. Clone appearance only, without the table (Branch A);
  3. Abandon.
- **Forbidden**: retrying the same interface or switching interfaces to keep probing a table with no permission (`12607` is "report directly, do not retry" per `../error_handling.md`); exhaustively reverse-engineering minified HTML; passing off a self-built empty table as an "equivalent" deliverable without asking first.
- When taking option 1: infer the schema from `parse_html.py --html`'s `tables` output (see `../database/entry.md` for table creation); remap / import / mount reuse B6–B10, and **B11 verification is mandatory before delivery**.

## 4. Branch A · Pure HTML clone

```
A1 Download directory ready (§2), original page title page_title obtained (§3)
A2 Image-hosting self-check (image-hosting.md hard gate; host any third-party external images first)
A3 Multiple files → zip with python3 -m zipfile (a single html can be passed directly, see import-flow.md §2)
A4 import_html.py <zip|html> --file-name "<page_title>.html" \
                  [--space-id <target space>]   # do not pass --databases, do not pass --node-block-id
     → KS_IMPORT_OK {node_block_id, url, file_name}
     file_name must be passed explicitly and match the source page name; without it, the basename fallback produces a meaningless name
A5 Wrap-up: rm -rf "$WORK" (single-step cleanup)
     Forbidden: present_files preview / writing a report file / extra verification runs / publish (same wrap-up constraints as §5)
     Keep the receipt concise: give the library link for the new page + the hint {{可在资料库中查看}} — do not narrate the intermediate flow
```

Fully reuses `import_html.py` + `import-flow.md`; no new capability added.

## 5. Branch B · Data-page clone

> **Breaking the circular dependency (method 1)**: "editing the HTML depends on db_new" (B6←B5) → create the csv first; "mounting the csv depends on the page nodeId" (B10←B9) → mounting goes last. The two "×N" loops run in parallel and don't block each other.
>
> **Filename-preservation hard gate**: every clone artifact (csv / html) in the library must display a name **identical** to its source node. The original title is gathered once in §3; B5.2 / B9 pass it explicitly via `--file-name` — never rely on the script's fallback (the fallback name is the path basename, producing a title-less string like `<db_old>.csv`).

> **Data-fill decision point (decided once, before entering B-Ⅰ)**:
> - **Sample data** (a small number of example rows, generic/placeholder values, no real identity markers) → copy along with the structure as-is; the "equivalent copy" semantics is unchanged.
> - **Real business records** (historical transactions, real names / contact info, etc.) where the page belongs to someone else, or the user's intent is "build my own / for personal use" → default to copying structure only: B5.1 exports then keeps only the header row to build an empty table (truncate with `head -1` before importing); state in the receipt that「数据未复制、已建等价空表」— only fill in actual data if the user explicitly asks for it.
> - **Identity-marker anonymization**: before delivery, run a one-time structural scan of the copied data and page for source-owner names / forms of address / contact info; in a self-use scenario, replace them with the current user or anonymize them; if the source data contains private content, notify the user first.

### Stage B-Ⅰ: Parallel-copy the csv, produce the mapping

> **Mandatory parallelism + get it right in one pass (avoid retries)**:
> - B5.0 / B5.1 / B5.2 must run N-way concurrently within **a single shell command**, joined with `&` + `wait`.
> - **Never execute step by step** (fetching titles alone first, checking `--help` first, testing a single table first).
> - **Avoid retries**: if a B5 script invocation fails, check `errors.log` first to locate the cause, then re-run only the failed tables — don't blindly re-run everything.

> **Script-writing hard constraints (zsh/bash compatible)**:
> - **Never use `declare -A`** (bash associative arrays): use plain arrays separated by `|`.
> - **Never write a separate `fetch_titles.py` first**: titles were already gathered in §3; B5 does not re-fetch them.
> - **Never run `--help` first**: the script usage is already inlined in this document.
> - `--space-id` is **optional**: omit it to use the default space; pass it only when the user explicitly specifies a target space.

```
B5.0+B5.1+B5.2  a single parallel pipeline (N-way concurrency, joined with wait, get it right in one pass):

  export CLAWCLAW_SKILL_DIR="<absolute path to the library skill>"
  export WORK="<working directory>"
  mkdir -p "$WORK/csv"
  > "$WORK/mapping.tsv"; > "$WORK/errors.log"

  # each DBS item is "db_old|title", read directly from the titles.tsv produced in §3 (bash/zsh compatible, no declare -A)
  DBS=($(cat "$WORK/titles.tsv"))

  for pair in "${DBS[@]}"; do
    db="${pair%%|*}"; title="${pair#*|}"
    (
      # B5.1 export CSV (must extract the content field, not the whole JSON)
      python3 "$CLAWCLAW_SKILL_DIR/database/get_database_content.py" \
              --database-id "$db" \
        | python3 -c "import sys,json; sys.stdout.write(json.load(sys.stdin)['content'])" \
        > "$WORK/csv/${db}.csv" 2>>"$WORK/errors.log"
      # B5.2 import: create table + fill data (one step)
      new_id=$(python3 "$CLAWCLAW_SKILL_DIR/database/import_csv.py" \
              "$WORK/csv/${db}.csv" --file-name "${title}.csv" \
        | sed -n 's/.*KS_IMPORT_OK .*"node_block_id":"\([^"]*\)".*/\1/p')
      if [ -z "$new_id" ]; then
        echo "IMPORT_FAIL $db" >> "$WORK/errors.log"
      else
        printf '%s\t%s\n' "$db" "$new_id" >> "$WORK/mapping.tsv"   # tab-separated, consistent with what B6 reads
      fi
    ) &
  done
  wait
  # after joining, check: mapping.tsv line count == N and errors.log is empty → success; otherwise consult errors.log to locate the issue, don't blindly re-run
```

**Constraints**:
- `&` + `wait` is native shell parallelism — N subprocesses run simultaneously, `wait` blocks until all complete.
- Each table writes its own `mapping.tsv` line (`printf >> file` is an atomic single write even under shell concurrency), **tab-separated uniformly** (`db_old<TAB>db_new`), for B6 / B10 to read directly.
- `get_database_content`'s output is JSON-wrapped as `{"database_id":...,"content":"<raw CSV>"}` — the `content` field must be extracted before writing to disk; redirecting the whole JSON would make import_csv upload JSON as CSV, corrupting the header and misaligning data.
- Empty cells appear as empty strings in `content` — keep them as-is, do not substitute placeholders.
- `--file-name` must be passed = the original table title (passed via the DBS array); omitting it produces `<db_old>.csv`, breaking the "same name" semantics.
- `import_csv` lands in the target space root first; `parent-id` mounting is deferred to B10 (the new page doesn't exist yet at this point).
- **Failure handling**: check `errors.log` for `IMPORT_FAIL` entries, fix the cause, then **re-run only the failed tables** — do not re-run everything.

### Stage B-Ⅱ: Remap HTML → import → mount

```
B6  # first assemble MAPPING_JSON from mapping.tsv (tab-separated db_old<TAB>db_new)
    MAPPING_JSON=$(python3 -c "import json,sys;print(json.dumps(dict(l.split() for l in open('$WORK/mapping.tsv'))))")
    python3 "$CLAWCLAW_SKILL_DIR/page/remap_database_ids.py" --html "$WORK/src/<entry HTML>" --mapping "$MAPPING_JSON"
      → full-text exact replacement db_old→db_new (with id-boundary matching, preventing substring collateral damage); local only, no
      Double hard gate: (a) no remaining db_old; (b) each db_new's added-occurrence count == the corresponding db_old's original occurrence count
      If not satisfied → error and stop, do not import a broken page
B7  Image-hosting self-check (image-hosting.md hard gate)
B8  Zip it (HTML + same-directory css/js/img); a single html can be passed directly
B9  # --databases is assembled from the db_new column of mapping.tsv
    DB_JSON=$(python3 -c "import json;print(json.dumps([{'id':l.split()[1]} for l in open('$WORK/mapping.tsv')]))")
    python3 "$CLAWCLAW_SKILL_DIR/page/import_html.py" \
      "$WORK/src/<entry HTML or zip>" --file-name "<page_title>.html" --databases "$DB_JSON" [--space-id]
      → KS_IMPORT_OK {node_block_id=nodeId_B, url}; import writes the page↔db_new relation binding along the way, so no separate link call is needed
      file_name must be passed = the original page title; omitting it produces <entry_html>, breaking the "same name" semantics
B10 ‖ parallel ×N move-node (N-way concurrency, joined with wait, get it right in one pass):

  export NODE_ID_B="<node_block_id returned by B9>"
  # DB_NEW_ARR read from column 2 of mapping.tsv (array iteration, never the for x in $STR word-split trap)
  DB_NEW_ARR=($(awk '{print $2}' "$WORK/mapping.tsv"))
  > "$WORK/move_errors.log"
  for new_id in "${DB_NEW_ARR[@]}"; do
    (
      out=$(python3 "$CLAWCLAW_SKILL_DIR/space_api.py" space.workspace.move-node \
            --node-id "$new_id" --target-parent-id "$NODE_ID_B" 2>&1)
      # space_api.py outputs {"api":...,"data":{...}} on success, {"error":...} on failure
      # success criterion = contains "api" and does not contain "error"; never use KS_API_OK / "code":0 (that's a different script's format)
      if ! echo "$out" | grep -q '"api"' || echo "$out" | grep -q '"error"'; then
        echo "MOVE_FAIL $new_id: $out" >> "$WORK/move_errors.log"
      fi
    ) &
  done
  wait
  → restores the "csv nested under the page" parent-child structure
  → check move_errors.log is empty for full success; do not additionally run a node-info verification (the success criterion is already accurate)

B11 (only for the §3.5-option-1 fallback-rebuild path) Delivery verification: for every newly-created empty table, read back get_database_schema
    and compare field names / types against the schema inferred by parse_html; fix any mismatch before delivering. Then prove the write channel on one
    table: batch_add_database_records a single minimal record → get_database_record --record-id to confirm it persisted → batch_delete_database_records
    to remove it; a failed or unconfirmed round trip blocks delivery — never assume SDK writes work just because the schema read back fine. The receipt
    must explicitly state {{数据为空表模板}},{{页面为草稿态，访问形态与源发布态的差异}}, and the CRUD round-trip result.
B12 Wrap-up: rm -rf "$WORK" (a single command cleans everything up — no per-file deletion, no confirm-before-delete) → receipt follows the wrap-up block format below
```

> **B10 mandatory parallelism + get it right in one pass**: move-node uses `&` + `wait`.
> Success criterion = stdout contains `"api"` and does not contain `"error"` (**not** `KS_API_OK` / `"code":0`).
> An empty `move_errors.log` means full success — **no extra node-info verification needed**; only re-run for failed items.

> **Wrap-up (keep it concise)**:
> - **A single `rm -rf "$WORK"` cleans everything up**: all intermediate artifacts live under `$WORK`; delete them in one shot — never delete file-by-file, and never `ls` to double-check before deleting.
> - **Forbidden: `present_files` preview**, **forbidden: writing a report file**, **forbidden: extra Bash verification runs** (the move result is already determined by B10's `move_errors.log`; **exception: the §3.5 fallback-rebuild path** — B11 verification is a delivery precondition and must be completed), **forbidden: publish**.
> - **Receipt format (concise, no narration of the intermediate flow)**: give only three things —
>   1. the library link to the cloned page (the new page's `/space/d/{nodeId}`);
>   2. 提示{{可在资料库中查看}};
>   3. one simple statement that{{该 HTML 页面与 N 张子 csv 数据表已建立关联}}。
>   Do not recount the fetch / table-creation / remap / mounting steps, do not list the databaseId mapping table, do not comment on functionality.

## 6. Concurrency and safety fallback

- **Two layers of concurrency**:
  - Script-internal concurrency: `download_page_artifacts.py --concurrency 4` (artifact download, default 4, max 8).
  - Shell-level concurrency: B5 (fetch titles + export + import) and B10 (move-node) use `&` + `wait`, running N subprocesses simultaneously. When N ≤ 6, run fully in parallel; when N > 6, throttle with `xargs -P 6` to avoid overloading the backend QPS.
- `remap_database_ids.py` defaults to a **full-text replacement** (most reliable, prevents omissions), with an id-boundary assertion so it never collaterally matches a substring like `db_xxxSuffix`.
- Never echo tokens / signed URLs / COS headers / raw responses anywhere in the chain.

## 7. Reuse and additions checklist

- `download_page_artifacts.py` — new — lists the manifest and downloads artifacts to local disk in parallel
- `remap_database_ids.py` — new — global databaseId remapping in HTML + count verification
- `import_html.py` / `import_csv.py` / `get_database_content.py` / `get_database_schema.py` / `parse_html.py` / `space.workspace.node-info` / `space.workspace.move-node` — reused — zero changes (`--file-name` is passed through explicitly by this flow, carrying the "same-name clone" semantics; `get_database_schema` is used by B11 for verification)
