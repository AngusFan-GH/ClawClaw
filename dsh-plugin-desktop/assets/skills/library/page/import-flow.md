# page · HTML / ZIP Import Flow

> The general flow for uploading a local HTML / ZIP to the library. Any scenario that needs to "import a local page file" — upload-only, stage 5 upload in the retrofit/create branch, importing a demo deck or long page — goes through this flow.
> Invoked by `entry.md`'s routing; sub-branches like `modify-branch.md` / `create-branch.md` reference this flow at their "upload" step.

## 1. Preconditions

> **Mandatory precondition · image-hosting self-check (the single choke point for import, no side path around it)**: for any artifact headed for an online page, before calling `import_html.py` the final HTML must have already cleared `image-hosting.md`'s image-hosting orchestration + self-check hard gate — no `<img>` `src`/`srcset` may retain an http/https link to a third-party domain (platform-internal links under `clawclaw`/`clawclaw` excepted). Calling the import script is forbidden until this gate is cleared. Execution order, self-check commands, and failure reporting: `image-hosting.md`.

- Accepts only a **single file path**, with a `.html` / `.htm` / `.zip` extension, capped at 50 MiB.
  - `.html` / `.htm`: single-file path.
  - `.zip`: must contain at least one `.html` / `.htm` entry point plus its bundled resources; the backend unpacks it and pushes the files to COS in bulk.
- **Directories aren't accepted** (the script checks with `os.path.isfile`; a directory fails silently with `exit 0`). If the user gives a folder, zip it first per §2.
- Handles one file per call — no traversing directories, no wildcards.
- The backend identifies zip vs. html by the byte-stream magic number, independent of the extension; even so, the filename's extension should still match its actual content.
- Local parsing/lint tools (`parse_html.py` / `lint_schema.py` / `lint_database_sdk_usage.py`) run offline; network scripts follow `../SKILL.md` §Runtime & Auth.
- **Lint scope**: static pages skip the Database SDK lint; a page linked to a database must first run both lints against the backend's real schema (see `canonical-schema.md` §1.6) before importing.

## 2. Directory → zip packaging (required whenever the user gives a folder)

Zip the directory first, then pass the zip path to the script:

```bash
python3 -m zipfile -c "<out.zip>" "<dir>/"
```

Constraints:

- The zip must contain at least one `.html` / `.htm` entry point; if it has none, confirm with the user first — don't zip up an entry-less package.
- Every css / js / font / image the html references must be packed into the same zip, keeping relative paths consistent (otherwise they 404 once pushed to COS).
- Give `<out.zip>` a semantic name (`<schema.title>.zip` or the directory's basename), not `tmp.zip`.
- `<out.zip>` is an intermediate artifact — after import, the Agent should `rm -f` it itself.

Full workflow:

```bash
INPUT_DIR="/Users/xxx/dist"
OUT_ZIP="${TMPDIR:-/tmp}/mindx-import-$$.zip"
python3 -m zipfile -c "$OUT_ZIP" "$INPUT_DIR/"
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "$OUT_ZIP" --file-name "<显示名.zip>"
rm -f "$OUT_ZIP"
```

If the user already gave a zip, skip packaging and call the script per §3 directly.

## 3. Calling the import script

```bash
# Default (recommended): omit --file-name, the script falls back to auto-naming
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.html>"

# zip path: used the same way as html
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.zip>" --file-name "<显示名.zip>"

# Linking a database (required for the full chain / create-branch stage 5)
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.html>" --file-name "<schema.title>.html" --databases '[{"id":"<database_id>"}]'

# Re-import: with --node-block-id, overwrites an existing node
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.html>" --node-block-id "<existing_node_block_id>"

# Re-import + re-mount databases
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.html>" --node-block-id "<existing_node_block_id>" --databases '[{"id":"<database_id>"}]'

# Targeting a specific space (only takes effect on first import)
python3 "${CLAWCLAW_SKILL_DIR}/page/import_html.py" "<path-to-file.html>" --file-name "<schema.title>.html" --space-id "<target_space_id>"
```

> Target-space resolution follows the top-level `SKILL.md` call precondition. `--space-id` only takes effect on first import and is ignored on re-import; when explicitly passing `--parent-id`, you must also pass the matching `--space-id` it belongs to.

## 4. `--file-name`

- **Default: omit it**. When the filename has no semantic content (`index`/`default`/`untitled`/`temp`/`page`/pure hash/pure digits/an extremely short name), the script auto-extracts a semantic name from the HTML's `<title>`/`<h1>`.
- **Only pass it when you have an explicit semantic name to override with** — e.g. if stage 5 already has `schema.title`, pass `--file-name "订单管理.html"`.
- Don't pass the basename just to "match the local filename" — doing so disables the fallback.
- Zip paths get no semantic extraction — the given name / basename is kept as-is; to get a semantic name, pass `--file-name "<semantic name>.zip"` explicitly.

## 5. `--databases`

- A JSON array string, each element containing `id` (the id returned by table creation).
- **Required** for the retrofit-branch / create-branch stage-5 upload; optional for an upload-only that isn't building a table.
- Re-import (with `--node-block-id`): omit it / pass an empty array → keep the existing relations; a non-empty array → mount incrementally (never overwrites, never unlinks anything not listed).
- **Field consistency check before re-import**: if the new HTML reuses a `databaseId` linked to the previous version, and the new HTML's field references (`sorts`/`filter`/`row["field name"]`/`properties["field name"]`) have been added/removed/changed relative to the previous version (i.e. the schema structure is expected to have changed) → before importing, query that database's current real fields via `database/entry.md`'s schema-query capability, and check that every field the new HTML references actually exists; build any missing fields first per `database/entry.md` — don't let the new HTML go live and only fail at runtime. If the field structure genuinely needs to change (fields added/removed) and the existing table already has business data, follow the data-migration rule in `schema-evolution.md` §11.1 — never just drop columns / build a new table and discard the existing data.

## 6. `--node-block-id` (re-import targeting)

- **Omitted** → first import, creates a new node, returns a new `nodeBlockId`.
- **Included** → re-import, overwrites and updates that node, reusing the existing node_block_id.

**Should include it** when this round's HTML retrofit stems from "the same original HTML that a previous round's `import_html.py` call already successfully returned a node_block_id for":

- The user says "change it to XXX and send it again" after the retrofit/create branch's stage 4 finished editing the HTML → include the most recent `node_block_id`
- In an upload-only scenario, the user says "I changed it, send it again" → include it if context has a previous `node_block_id`
- The user explicitly gives a node_block_id → include it per their instruction

**Should NOT include it**:

- Any HTML from a different source (even with the same filename / similar content) → would overwrite the user's original page and cause data loss
- First mention, and context has no node_block_id → treat it as a first import

### 6.1 Permission threshold for re-import (admin and above)

> Re-import **generates a new version of the page from the whole HTML package** (the new version becomes the current display content, with history versions kept and revertible) — it's a full replacement of the page's content, more destructive than a normal incremental edit. The backend requires the current user to have **"admin"/owner or above** permission on the page's space — **editor permission alone is not enough for re-import** (and passing someone else's node_block_id by mistake is also rejected, even outside this rule).

- **A user with only editor permission gets rejected on re-import**: the backend returns the **dedicated error code `56161`** (re-import requires admin permission — a code the `import-local-file` endpoint issues specifically for "the re-import action," distinct from the generic permission-denied codes `403`/`12607`). In this case, **don't** just drop a "no permission" reply — instead, guide the user to **AI editing** (`edit-flow.md`) instead: editor permission is enough to incrementally edit and commit a new page version through the transaction protocol, no admin permission needed (unlike re-import's full-package replacement, AI editing only touches what was actually changed).
- Determinant: **key off error code `56161` specifically** — receiving it means "an editor-permission user was rejected on re-import," go straight to §7.1's "guide to AI editing" below (no need to infer it from `--node-block-id` anymore). Other permission codes (the generic `403`/`12607`, e.g. no permission on a first import) still follow `../error_handling.md`'s generic permission-denied handling, and don't get guided to AI editing.

## 7. Result determination

- stdout containing `KS_IMPORT_OK <JSON>` → success.
  - `<JSON>` is a single-line object containing `node_block_id`, `file_name`, `url`, `publish_url`.
  - Only parse the JSON after the prefix — don't split fields by whitespace (`file_name` may contain spaces).
  - Extract `node_block_id` and, if present, `url` for the receipt.
- No such output → failure.
- Never echo the token / uploadUrl / cos header / raw response.

### 7.1 Insufficient permission on re-import (error code `56161`) → guide to AI editing (not a repeat import)

`56161` means an editor-permission user was rejected on re-import (see §6.1). Don't just reply "you don't have permission" — guide them to **AI editing** (`edit-flow.md`, via `entry.md`'s edit route), where editor permission suffices for incremental edits through the transaction protocol:

- Reply reference: {{你对这个页面只有编辑权限，**重新导入（整包替换、生成新版本）需要管理员权限**。不过你可以直接让我**帮你编辑这个页面**（在原页面上改内容并提交新版本），编辑权限就够用。要我按你的需求改哪些地方？}}
- Once you have the user's edit request, follow `edit-flow.md`'s incremental edit flow — **don't retry the re-import**.

## 8. Post-success action (auto-open the url)

- Once a non-empty `<url>` is parsed, you **must** open it with the host's preview component (`present_files` preferred, `preview_url` for older hosts), completing this before the round's reply ends — don't wait for the user to confirm.
- Pass only the single `<url>` parameter; never append a token / node_block_id to the URL, and never fall back to a system browser command.
- If the host provides no preview component → skip this step, output the receipt normally, and don't report a degradation.
- If no `<url>` was parsed → don't preview, and use the "receipt copy for when no url is returned" instead.

## 9. Notes

- Multiple files aren't supported in one call: if the user gives multiple paths, call the script once per file in order, and give a separate receipt for each.
