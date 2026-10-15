# One-Click Beautify: Non-HTML Node → HTML Node (Mounted Under the Source Node)

> **Responsibility**: turn a **non-html node** in the library into a single visual html page, mounted as a **child node of the source node**. Routed by the source node's `kind`:
>
> - Document (md body text) — `kind = doc` → **Branch 1 · md→html** — database: **not created, not linked**; output is a self-contained html under the source doc.
> - Table (csv-imported data table) — `kind = database` → **Branch 2 · csv→html** — **read-only dynamic link to the original table** (write operations forbidden); the link is a separate `page_database_relation.py --action link` call (see `entry.md` §Relation), **not** `import_html --databases`. `DATABASE_ID` hardcodes the original table's id; the html reads data at runtime via the read-only `__SMART_PAGE__.database` SDK and **never writes back** (no `addRecord`).
>
> **Beautify covers all three intents** (§3): every generated html must be enriched per `beautify/beautify-guide.md`; the reporting intent additionally builds each slide per `wbp-presentation-contract.md` §7.10 / §12.

---

## 0. Trigger and branch arbitration

### Entry points (matching either qualifies; requires both "beautification intent" AND "a library-node target")

- **Entry A · the "One-Click Beautify" button**: the host forces `skill="library"` + `autoSend`, and the prompt contains "one-click beautify/visualize into … HTML" + `spaceId:` / `nodeId:` / `kind:`.
- **Entry B · a link pasted in chat + beautification intent**: the user gives a `clawclaw.cn/space/...` link (or `staging...` / a nodeId) plus a clear ask to "beautify / visualize / turn into a report page / turn into a presentation".

> Missing either condition means it is **not this document's responsibility**: a generic "make a page / write some html" with no library-node target, or a source node that is not a non-html node, are both out of scope.

### kind arbitration + fetching node identifiers (`manage`'s `space.workspace.node-info`)

> **Fetch all three values in one call**: `node-info --url <source document link>` (only accepts the `/space/d/{nodeId}` form; `/space/s/{spaceId}` is a space, not a node) returns `kind` / `nodeId` / `spaceId` in a single response (see `manage/entry.md`). **`spaceId` is required for the later `import_html.py` mount** — `parentId` must be submitted together with its owning `spaceId`; without it the server cannot locate the parent and falls back to the default My Library directory (mount fails).

- `kind = doc` → **Branch 1** (§1).
- `kind = database` (a csv table) → **Branch 2** (§2).
- `kind = web` / `page` → already an html page; style changes go through `edit-flow.md` — out of scope.
- Anything else / a directory → handle per `manage/entry.md`.

---

## 1. Branch 1 · md → html (kind=doc, no database involved)

### Mandatory execution sequence

```
① Sanitization gate: confirm the md master copy contains only reader-facing final content; strip tokens / tool traces / local absolute paths
② Intent routing (see §3); default is pure view-conversion — only reporting intent invokes the panel
③ Read the source node's body text: the doc module reads the body by nodeId and lands it as a local md master copy
④ md_to_html.py generates the baseline html (reporting intent maps panel selections to --scene/--audience/--style and uses --format presentation; other intents use --format page — see §4)
⑤ Beautify — mandatory for all intents (see §4.2): apply the beautify-guide, emit the BEAUTIFY_OK signal; reporting builds each slide per wbp-presentation-contract.md §7.10 / §12
⑥ import_html.py --parent-id=<source doc node id> --space-id=<source node's spaceId>; the html is mounted under the source node
   (--space-id comes from the §0 node-info response; without it the mount falls back to the default My Library directory and fails)
```

> Stop once this is done: **no** hosted-page download / edit, **no** database creation, **no** SDK injection, **no** binding back. The artifact is a single, purely static, self-contained html page as a child node of the source doc.

### Resulting library structure

```
doc (source node, md body text)
└── html (page node)   ← import_html --parent-id=<source doc node id> --space-id=<source node's spaceId>
```

### Self-check before the receipt

- [ ] Intent routing per §3 (default: pure view-conversion; panel only for reporting intent)?
- [ ] Baseline html generated with `md_to_html.py` (not hand-written)?
- [ ] §4.2 beautify gate passed — receipt contains `BEAUTIFY_OK` (for reporting: every slide built, `data-wbp-source` residue = 0)?
- [ ] §4.0 content requirements followed (zero image loss, no unrelated content)?
- [ ] `image-hosting.md` image-hosting flow run before delivery?
- [ ] Mounted with `import_html.py --parent-id + --space-id` (both together) and `KS_IMPORT_OK` + url obtained?

---

## 2. Branch 2 · csv → html (kind=database, read-only dynamic link to the original table)

> The source csv node is itself a `database` node, whose **nodeId is the databaseId**. This branch never creates a new table; at runtime the html pulls data from the original table and renders it via the **read-only** `__SMART_PAGE__.database` SDK.

### Mandatory execution sequence

```
① Sanitization gate: same as §1①
② Intent routing (see §3): same as §1②
③ Read the original table's structure and a small sample (not the whole table):
     ../database/get_database_schema.py --database-id=<source node id>                → field names/types/options
     ../database/query_database_record.py --database-id=<source node id> --page-size 5 → a few sample rows (only to pick the visualization form: table/dashboard/chart)
   Build a "visualization master copy" from these — an md skeleton for a chart/dashboard/card layout carrying field semantics, with no hardcoded data rows
④ md_to_html.py generates the baseline html skeleton (format per §3; see §4)
⑤ Beautify — mandatory for all intents (see §4.2): apply the beautify-guide to the visualization layout, emit BEAUTIFY_OK; reporting builds each slide per wbp-presentation-contract.md §7.10 / §12
⑥ The agent injects a read-only rendering script (see §4/§5):
     hardcode DATABASE_ID = <source node id>; render via db.query / db.getSchema;
     read-only — addRecord and any write/edit/delete on the original table are forbidden;
     all data comes from runtime reads; mock/fallback data is forbidden — on read failure show an empty-state hint (see §5)
⑦ Lint: ../page/lint_database_sdk_usage.py validates SDK usage; manually confirm no addRecord (see §5)
⑧ import_html.py --parent-id=<source node id> --space-id=<source node's spaceId>; do not pass --databases
     read node_block_id and url from KS_IMPORT_OK
⑨ After ⑧ succeeds with node_block_id, establish the csv ↔ html link separately (see entry.md §6):
     page_database_relation.py --action link --page-id=<node_block_id> --database-id=<source node id>
```

### Resulting library structure

```
database (source node, csv table)
└── html (page node, read-only visualization)   ← ⑧ --parent-id decides its tree position
        ├─ ⑨ --action link registers pageId=<html node id> / databaseId=<source node id>
        └─ at runtime, db.query({databaseId:<source node id>}) dynamically reads and renders the original table
```

### Self-check before the receipt

- [ ] Intent routing (§3), `md_to_html.py` generation, and `import_html.py --parent-id + --space-id` mounting all completed?
- [ ] §4.2 beautify gate passed — receipt contains `BEAUTIFY_OK` (for reporting: every slide built, `data-wbp-source` residue = 0)?
- [ ] §4.0 content requirements followed (zero image loss, no unrelated content)?
- [ ] `image-hosting.md` image-hosting flow run before delivery?
- [ ] `DATABASE_ID` hardcoded to the **source node's id**, data read **dynamically at runtime via `db.query`**?
- [ ] **Read-only calls only** (`query`/`getSchema`/`getRecord`), **no `addRecord`** or any write operation?
- [ ] All html data from runtime reads, no mock/fallback data; empty-state hint on read failure (not fake data)?
- [ ] Data completeness met: `db.query` pulls the full set via `hasMore`/`nextCursor` pagination (DSDK014)? If only part of the data is intentionally shown (Top N etc.), mark `数据完整=已确认截断(<原因>)` in the `QUALITY_OK` receipt to pass (DSDK015, see `page-quality-check.md` §4/§5)?
- [ ] Import passed only `--parent-id` + `--space-id`, then `page_database_relation.py --action link` established the csv ↔ html link?

---

## 3. Intent routing (shared by §1/§2)

> Step "②" in both execution sequences lands here: **route by user intent first, then generate**.
>
> Terminology: **"branch"** = §1 md→html / §2 csv→html, split by the source node's kind; **"intent"** = pure view-conversion / reporting / other, split here by the user's ask. Default intent is pure view-conversion.

### 3.0 Intent determination (first match decides)

- **Pure html view-conversion** (default) — trigger: no reporting/presentation ask; the user only asks "one-click visualize into an HTML page / turn into a webpage / make into html / beautify into a webpage" — generation: `--format page` + **apply `beautify/beautify-guide.md`** for a magazine-grade layout, tone routed by the source material (see §3.1).
- **html report** — trigger: the user explicitly mentions reporting / a presentation / PPT-ification / a demo / slides / a roadshow / a pitch / a performance review / a retrospective — generation: `--format presentation` empty frame + **apply `beautify/beautify-guide.md`**, building each slide per `wbp-presentation-contract.md` §7.10 / §12 (see §3.2).
- **Other intent** — trigger: a clear ask outside the above (e.g. "make it a product-intro page / landing page / data dashboard / resume page / in a certain style") — generation: `--format page`, **satisfy the user's ask first**, then apply `beautify/beautify-guide.md` (see §3.3).

> Priority: the user's explicit intent > the default. When unclear, default to pure view-conversion; you may mention in one line "this could also be made into a paged presentation — let me know", never apply the reporting skeleton unasked.
>
> **Beautify covers all intents**: intents ①/③ enrich a scrolling long page on the baseline; intent ②'s baseline is an empty frame, built slide by slide.

### 3.1 Pure html view-conversion (default intent · beautified)

> ⚠️ "Pure" only means **not routed to paged reporting** — it does **not** mean skipping beautify.

**Goal**: convert the source (doc body / csv data) into a single **magazine-grade, visually refined** readable html page, making up for the baseline generator's plain quality.

- Never invoke the panel; `--format page`; no `--scene`/`--audience` passed.
- **Beautify per `beautify/beautify-guide.md`** (long pages have no per-slide constraint, so the full guide applies); pass the §4.2 gate before importing.
- Follow the §4.0 content requirements.
- The csv branch under this intent likewise produces a read-only visualization of the original table (§2 red line); the beautify guide applies equally to the visualization layout.

### 3.2 html-report intent (outer presentation frame + magazine-grade layout per slide)

> Whenever §3.0 resolves to "report", the artifact is a paged presentation (`--format presentation`).
>
> **Key**: `presentation` only decides the **outer frame** (page-turning, 16:9, speaker notes); **each slide is still a magazine-grade web page**, not a traditional PPT layout.

- `md_to_html.py --format presentation` emits an **empty frame**: auto-split pages, per-page md raw material in `data-wbp-source`, hidden verbatim notes, no visible DOM (see §4.1).
- **Build each slide per beautify**: read that slide's raw material, pick section semantics per `beautify/beautify-guide.md`, apply the 5-level layout and visual techniques, and produce **one magazine-grade screen**; 16:9 fit and structural red lines per `wbp-presentation-contract.md` §7.10.
- Follow §4.0; import only after the §4.2 `BEAUTIFY_OK` gate.

> If the content is really a dense long-form report (reading-oriented, no demo ask), it belongs to intent ① (long page) — pagination is never forced onto long content.

### 3.3 Other intent

A clear page ask outside reporting (product-intro / landing / dashboard / resume / specified style, etc.): `--format page` — **satisfy the user's independent ask first** (their form/style/structure), **then apply `beautify/beautify-guide.md`**; on conflict the user's ask wins, elsewhere the guide applies. Still follow §4.0 and the safety boundary (§7).

---

## 4. Baseline generator md_to_html.py (local only, no network access, no token reads)

> ⚠️ **`md_to_html.py` does structure, not design**: `page` emits a structurally correct semi-finished page; `presentation` emits only an **empty frame** (no visible DOM). Both fill `:root` with **achromatic placeholder gray** (zero hue, zero saturation, deliberately plain) — real colors/fonts are applied only in §4.2 by overwriting `:root` per the beautify-guide style routing. **Leftover placeholder gray = not beautified.**

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/md_to_html.py" --md "<source.md>" \
  --out "<out.html>" --title "<topic>" --scene report --audience 领导 --style business --format page
```

> `--scene`/`--audience` are reporting-intent only; §3.1 pure view-conversion **does not pass them** (omitting them renders no scene/audience meta — see §4.0 requirement 2).

Parameters:

- `--md <path>` — required — local path to the md master copy.
- `--out <path>` — optional — output html; defaults to `<stem>.html` in the same directory.
- `--title <str>` — optional — defaults to the front-matter `title` / the first H1 / the filename.
- `--scene <str>` — optional — reporting intent only: `report`/`align`/`pitch`/`review`.
- `--audience <str>` — optional — reporting intent only: an audience hint (written to the footer, does not change structure).
- `--style <str>` — optional — `business` (default)/`tech`/`fresh`/`warm`, changes only the color scheme.
- `--format <str>` — optional — `page` (default, scrolling long page) / `presentation` (WBP paged empty frame).

- Parses front-matter → inline md → block md, splits H1/H2 into cards, and inlines all css/js to produce a **self-contained** html. In `presentation` format it only splits pages and does not render in-page body text (raw material stored in `data-wbp-source`).
- **mermaid code blocks** (` ```mermaid ` fences) render as `<div class="mermaid">` with a loading placeholder; on page load, mermaid.js is dynamically loaded on demand from a pinned-version CDN (whitelist domain `cdn.jsdelivr.net`); it falls back to the raw code-block text only on no network / load failure / timeout (`data-mermaid-src` keeps it lossless; `<noscript>` covers no-JS environments). Diagram colors/connectors/fonts are applied at runtime via `themeVariables` reading the page's `:root` (`--accent`/`--panel`/`--text`, etc.), so they follow the overwritten theme with no extra setup.
- `:root` is filled only with achromatic placeholder gray (`#8f8f8f` / `#121212` / `#1c1c1c`) — **not a design choice**; scroll-reveal animation degrades gracefully under `prefers-reduced-motion`.
- Output contract: success is `KS_MD2HTML_OK <JSON>` (`{html_path,title,sections,format}`); failure is `{"error":...}` with exit 0.
- The `:root` variable list is in `wbp-presentation-contract.md` §7; the beautify methodology is in `beautify/beautify-guide.md` (flow wiring in `beautify-flow.md`); the baseline must pass §4.2 before delivery.

### 4.0 Content requirements (common to all three intents · mandatory)

1. **Zero loss of assets such as images**: image and attachment references in the source text must be fully preserved and correctly rendered after conversion — never dropped or replaced with a placeholder. Images are converted to inline links via the `image-hosting.md` image-hosting flow and written back — never silently left blank.
2. **Never mix in content unrelated to the source text**: only present information from the source itself. For the reporting intent, panel-selected parameters (**audience / scenario / theme**) are written **only into the designated footer metadata area**, never folded into body headings, paragraphs, or the narrative; for the other intents it is even more strictly forbidden to add paragraphs, conclusions, or data not in the source.
3. **Visual tone follows the beautify-guide style routing**: tone, palette, and layout are matched to the source material's subject via `beautify/beautify-guide.md` (implemented by overwriting `:root`), not a blind default to business blue. For the reporting intent, follow the user-selected `--style`.
4. **Respect the user's explicit requests**: when the user has supplementary/add/remove/explicit generation requirements (a certain paragraph, emphasized data, a structure/style), the user's instruction wins over requirements 1–3 where they conflict; requirements 1–3 still apply to anything unmentioned.

### 4.1 --format presentation (WBP presentation form · always for reporting intent)

> **When to use**: §3.0 resolves to "report". If the content is really a dense long-form report, it belongs to intent ① instead.

- Artifact is an **empty frame**: `<main data-wbp-deck>` + per-page `<section data-wbp-slide>` shells + per-page invisible `<script data-wbp-source>` (that page's md raw material) + hidden `<aside data-wbp-notes>` (verbatim script); **no visible DOM inside pages**. Root marker `<html data-wbp ...>`; no page-turning JS (the container's responsibility).
- Splitting: H1→cover; H2→section, auto-paginated by the 16:9 box height (a long section splits into continuation slides); a CTA on the last slide.
- **In-page layout is produced by §4.2**: the agent reads each page's raw material, decides the layout, writes the in-page DOM and CSS, then deletes that page's material. Constraints and how-to per `wbp-presentation-contract.md` §7.10 / §12.
- CSS animation is triggered by `.is-active`, and **elements are never pre-hidden** (the editing state has no `.is-active`; pre-hiding would blank the screen).
- **Import hard gates** (fix before importing):
  - `data-wbp-source` count = **0** and every `data-wbp-slide` contains visible DOM — residue means an unbuilt page.
  - No baseline placeholder gray left in `:root` (`#8f8f8f` / `#121212` / `#1c1c1c`) — residue means the skin wasn't applied.
  - `[data-wbp-notes] { display: none }` still present, and no visible "speaker notes / 备注" blocks in the body (see contract §5.1).
- Full contract: `wbp-presentation-contract.md`.

### 4.2 Beautify / slide-building · output signal and acceptance (hard gate for all three intents)

> **Why this section exists**: every other step has a verifiable signal (`KS_MD2HTML_OK`, `KS_IMPORT_OK`, the image-hosting grep gate) — beautify used to be a one-line jump with **no completion signal**, the easiest step to skip with "the baseline looks fine, import it". This section supplies that contract.

**Long page (intents ①/③) — mandatory actions**:

1. **Read the spec**: `beautify/beautify-guide.md` (and `beautify/visual-techniques.md` as needed) — never apply from memory.
2. **Pick the style**: per the guide's style routing, judge tone/palette from the source material yourself (do not ask the user); overwrite `:root`'s placeholder gray.
3. **Apply techniques**: pick 2–3 from `visual-techniques.md` and land them (replacing placeholder values with real colors).
4. **Re-layout**: per the guide's content principles, do narrative reordering and density control — do not keep the baseline's naive stacking.
5. **Pass the red lines**: check yourself against the guide's anti-pattern red lines one by one.

**Report (intent ②) — the baseline is an empty frame; the work is building every slide into a magazine-grade page**:

1. **Read the spec**: `beautify/beautify-guide.md` + `wbp-presentation-contract.md` §7.10 / §12.
2. **Pick the style**: per the guide's routing, judge palette/fonts from the source material yourself; overwrite `:root`.
3. **Build each slide**: read that slide's `data-wbp-source` material → pick section semantics (`DocHero`/`DataHighlight`/`QuoteBlock`/`TimelineList`/`ComparisonGrid`…) and visual techniques → write the in-page DOM and styles (**target: one magazine-grade screen, not a PPT layout**) → fill that slide's verbatim notes → **delete that page's material**.
4. **Pass the checks**: the guide's beautify self-check list + contract §7.10 post-build checks (`data-wbp-source`=0, placeholder gray=0, no PPT look, pages differ).

**Output signal (written into the receipt)** — after completing the above, explicitly add one line; `accent=` must be the **actual `--accent` value in the produced `:root`** (grep-verifiable, never placeholder gray):

```
# long page (intents ①/③)
BEAUTIFY_OK form=page style=<tone tag> accent=<#actual value> techniques=<2–3 used> redline-check=pass
# report (intent ②)
BEAUTIFY_OK form=presentation style=<tone tag> accent=<#actual value> slides=<count> material-residue=0 redline-check=pass
```

- **No `BEAUTIFY_OK` line = the step is not done**: the §1/§2 self-check gates fail, and **import is forbidden**.
- `accent=` mismatching the produced `:root` (or still placeholder gray) = not beautified; import equally forbidden.
- For reports, `redline-check=pass` must cover both the guide's anti-pattern red lines (incl. "no PPT look") and contract §7.10.3's shell/timing constraints.
- The signal is a **process self-check only** — never written into the html content or shown to final readers.

---

## 5. csv branch · read-only dynamic-data contract (Branch 2 only)

- **SDK injection and methods / parameters / `FieldValue`**: see `database-sdk-contract.md` (§1 injection, §2 methods, §4 Query, §6 FieldValue).
- **Dynamic read-and-render pattern**: reuse the `db.getSchema` + `db.query` rendering template from `modify-branch.md` stage 4 **case 2 (data-display type)** — this branch is a specialization of it: `DATABASE_ID` is hardcoded to the **source csv node's id**, and it only renders, never submits.
- **Schema / lint verification**: per `canonical-schema.md` §1.6, fetch the real schema via `../database/get_database_schema.py` (`--database-id=<source node id>`), then run `../page/lint_database_sdk_usage.py`.

### The read-only red line (this branch's one strong constraint)

- **Read-only methods**: only `db.query` / `db.getSchema` / `db.getRecord` / `db.onUpdated` (`onUpdated` only subscribes to changes and never writes — read-only); **`db.addRecord` is forbidden**, along with any call that writes/edits/deletes the original table.
- **databaseId = the source node's id**: hardcoded; never create a new table or assemble the id from elsewhere.
- **Data / schema read dynamically**: pull the latest data and fields from the original table at runtime, never hardcode rows; **register `db.onUpdated` once** to subscribe to table changes (especially when others maintain the table) — how to respond (re-query and re-render, refresh charts only, or notify) is the page's choice, sparing users a reload (see `database-sdk-contract.md` §8).
- **Data authenticity (no mock/fallback)**: all displayed data comes exclusively from a runtime `db.query`/`db.getSchema`; mock sample data or fallback dummy values are forbidden — on a read failure / no data, show an empty-state hint (e.g. "暂无数据"), never pad with fake data.

> `lint_database_sdk_usage.py`'s allowlist includes `addRecord`, so **this branch must enforce read-only itself**: even after lint passes, manually confirm there is no `addRecord` in the html, and no hardcoded sample data rows or fallback dummy values backfilled in a `catch` block.

---

## 6. Output-contract quick reference

- `md_to_html.py` — success: `KS_MD2HTML_OK <JSON>` — failure: `{"error":...}` exit 0
- **Beautify / slide-building (all-intent hard gate)** — success: receipt contains `BEAUTIFY_OK form=… style=… … redline-check=pass` (format in §4.2) — failure: no `BEAUTIFY_OK` = not done; import forbidden
- `import_html.py` — success: `KS_IMPORT_OK <JSON>` (includes `node_block_id`/`url`) — failure: silent exit 0
- `get_database_schema.py` — success: `{"id","title","properties":[...]}` — failure: `{"error":...}` exit 0
- `query_database_record.py` — success: `{"results":[...],"next_cursor","has_more"}` — failure: `{"error":...}` exit 0
- `lint_database_sdk_usage.py` — success: `MINDX_DBSDK_LINT_OK` — failure: `MINDX_DBSDK_LINT_FAIL <rule> <target>: <reason>` exit 2
- `page_database_relation.py` — success: a server-side JSON envelope (`link` includes `linked=true`) — failure: `{"error":...}` exit 0

---

## 7. Safety boundary

- `md_to_html.py` is local only, with no network access and no token reads; it only processes paths the user has explicitly given — never traverses a directory, never accepts wildcards.
- **The mermaid exception**: the generation script itself remains local-only; only the resulting html, at **runtime** in the browser, loads mermaid.js on demand from a pinned-version CDN (whitelist domain `cdn.jsdelivr.net`), using mermaid's default security level (strict) with `htmlLabels` disabled, falling back to the code block on failure. Aside from this, the artifact loads no other external resources.
- md→html rendering HTML-escapes text; the html retains no tokens / secrets whatsoever.
- Branch 2 only injects a **read-only** SDK (`query`/`getSchema`/`getRecord`), only hardcodes `databaseId`, and never writes back to the original table; DOM writes never use `innerHTML`.
- Networked scripts follow `../SKILL.md` §Runtime & Auth.
