# One-Click Beautify · Material/Intent → Polished HTML Page Generation Flow

> Detailed spec for the **"beautify a document/material → generate a polished HTML page"** capability referenced from `page/entry.md`. It covers entries broader than md→html: **the user holds local documents / PPT / PDF / Excel / images as material, or only expresses the intent "make a visual HTML / report page / briefing page"**, and wants a magazine-grade, shareable, online-editable page.
>
> **Relationship to `md-to-html-flow.md`**: that file owns one-click beautify for an **already-existing library node** (nodeId given) plus the underlying `md_to_html.py` generation + `import_html.py` mount sequence. This file owns the **upstream entry layer + design-spec layer**: new entries (local material / generalized visualization intent) are extracted into an md master copy, run through the **beautification design spec (body lives in `beautify/beautify-guide.md`)**, then **reuse** md-to-html-flow's generation and import. One-line positioning: this file = "entry expansion + design spec + player routing"; md-to-html-flow = "generator + import/mount" — chained into one pipeline, no duplication.

---

## 0. Trigger and entry points

> `md-to-html-flow.md`'s entry is tightened to "must point to an existing library node" so it doesn't compete with the main agent for generation work. **This document is that restriction's legitimate complement**: no existing node, but the user explicitly wants a visual HTML page. With a nodeId → md-to-html-flow entry A/B; without one (material given or visualization intent stated) → here.

Enter this flow on **any one** of:

- **Entry A · "Make a visual HTML" intent (not a site/app build)** — the user wants a single visual HTML page, e.g. "make a visual HTML / a report page / an analysis page / a briefing page / beautify this into a webpage". Pure-frontend multi-page sites stay in this module but not this flow — route to `entry.md` route 1 (whole-site zip import per `import-flow.md` §2); only engineering-style asks (a frontend project with its own toolchain / a backend system) go to the **main agent**. This flow only produces a **single-file HTML page**.
- **Entry B · Local material → generate HTML (single or combined set)** — material types: documents `.md` / `.doc` / `.docx` / `.txt`; presentations `.ppt` / `.pptx`; `.pdf`; spreadsheets `.xls` / `.xlsx` / `.csv`; images `.png` / `.jpg` / `.jpeg` / `.webp`; or a **combined material set** of the above ("these files plus a few images — make one report page").
- **Entry C · Explicit reporting/sharing scenario** — "make a report / a weekly-monthly-quarterly summary / a retrospective / a performance review / a roadshow / a pitch / a presentation" with a shareable page as output (§1 then picks long page vs. PPT deck).

**Not this flow**: an existing library node (nodeId / `clawclaw.cn/space` link) + visualization intent → `md-to-html-flow.md` entry A/B; multi-page site → `entry.md` route 1; engineering project / backend system → main agent; editing an already-hosted page → `edit-flow.md`.

---

## 1. Intent routing: static visual long page vs. dynamic data page vs. PPT deck

**The first step picks the artifact form**, decided by the AI reading the material/intent — **technical judgment is never exposed to the user** (never ask "static or dynamic?" / "should I create a table?").

```
                       ┌─ Clear "manage data / forms / add-edit-delete data" intent (strong/medium, user confirms)
                       │      → 【Dynamic data page】: modify-branch.md retrofit branch (wires a database, fields addable/editable/removable)
User material/intent ──┤
                       ├─ Clear "PPT / presentation / paged / slides" intent, or content segments into short dense narrative beats
                       │      → 【PPT deck】: --format presentation (see md-to-html-flow §4.1)
                       │
                       └─ Any other "visualize / report / analyze / display" ask (no data-management need)
                              → 【Static visual long page】: --format page + §3 beautification spec
```

- **Dynamic data page** — evidence (any match qualifies): material contains a form/table and the user wants "edit data anytime / multi-person maintenance / persist data"; or the user describes fields to manage (≥2 data nouns); or explicitly asks for "a data page / dashboard that can be entered into / edited" → pipeline: `modify-branch.md` retrofit branch (parse_html → create database → retrofit → upload); fields stay addable/editable/removable in sync with the html (`schema-evolution.md`).
- **PPT deck** — evidence: explicit "PPT / presentation / slides / paged / roadshow"; or short dense narrative ("H1 + 3–8 short sections, each ≤150 characters"); or the audience is leadership and the scenario is reporting upward → pipeline: `md_to_html.py --format presentation`, slides built one by one per `wbp-presentation-contract.md` §7.10 / §12; player takes the **professional presentation state** (§5).
- **Static visual long page** (default) — none of the above; a general "visualize / report / analyze / display" page, high information density, read-first, no data management → pipeline: `md_to_html.py --format page` (scrolling long page) + the §3 beautification spec; player takes the **full-screen scroll state** (§5).

> The default landing spot is always a native library online page: regardless of form, the terminal state is **importing into the library as an online page node** (§6), never stopping at a local html file. Umbrella entry: `entry.md` route 1.

### 1.1 Restraint on asking about data-management intent (from data-page-flow.md §0)

- Clear (strong) → go straight to the dynamic data page; a one-line heads-up while acting is enough — **do not ask**.
- Genuinely unclear (medium, only repeated cards/lists observed) → ask only a **business-level question** ("will this data need editing anytime / multi-person maintenance?"), **never** a technical-path question.
- No signal (weak/none) → silently go with the static visual long page.

---

## 2. Material → md master copy (host capability)

> **This skill writes no material-parsing scripts**: doc/ppt/pdf/excel/image reading is done by the **host agent's** multimodal / file-reading capability (host Read handles pdf/images directly; Office text and structure are extracted by the agent). This skill only mandates the process contract: extract into an md master copy first, then enter the generation pipeline.

- md / txt / doc / docx → read the body, keep heading levels / lists / tables → used directly as the md master copy.
- ppt / pptx → extract per-slide title + key points + notes; slide order = narrative order → each slide becomes one H2 section.
- pdf → extract body text + heading structure (host Read supports page-by-page pdf) → split into H1/H2 by chapter.
- xls / xlsx / csv → extract table structure + key data; if it is "data to be managed" → route to the §1 dynamic data page → md table / data highlights.
- Images → host multimodal recognition extracts the information + serves as `ImageFrame` material; the image itself becomes a page asset → caption + image reference.
- Combined material set → extract each item individually, then **merge and re-sequence** into a single narrative thread (§3) → one md master copy.

### 2.1 Sanitization gate after extraction (inherits md-to-html-flow §①.5)

The md master copy **must not** mix in any process information (tokens / credentials / raw tool calls / agent intermediate reasoning / local absolute paths). Strip before generating if found — `md_to_html.py` has a built-in credential scan that aborts generation outright on such patterns.

### 2.2 Image material (database image-field pipeline)

If the material contains images and the page needs to **display them**: never hardcode images into the html — map them through a **database image field** (see `schema-evolution.md`), so images can keep being swapped later via conversation.

---

## 3. Document-beautification design spec → `beautify/beautify-guide.md`

> **Single source of truth**: the sole authority for the beautification spec is `beautify/beautify-guide.md` + `beautify/visual-techniques.md` (technique library) in the same directory. **This section does not restate it — no copies, no forks.**

Before generating, `read_file` `beautify/beautify-guide.md` (and `visual-techniques.md` as needed), and restructure the narrative / tune density for the audience / enrich visuals accordingly. `md_to_html.py` outputs structure only, no design — `:root` variables are filled with **colorless placeholder gray**. Actual colors/fonts land in the beautify stage by **overwriting `:root` variables** (`--accent` / `--bg` / `--panel` / `--text` …); **placeholder-gray residue = not beautified**.

Supplementary conventions (on top of beautify-guide.md):

- **Style routing lands by `:root` overwrite** on the `md_to_html.py` output; presentations (`--format presentation`) additionally build slides one by one per `wbp-presentation-contract.md` §7.10 / §12.
- **Combined-material fusion**: multiple materials must merge into **one narrative thread**, never file-by-file concatenation — reorder per the beautify-guide narrative skeleton, then generate.

---

## 4. Cross-device hard constraints (PC + mobile)

> **Mandatory**: every page from this flow (static long page / dynamic data page / PPT deck) **must render correctly on both PC and mobile**. This is an acceptance criterion, not optional.

- **viewport** — `<head>` must include `<meta name="viewport" content="width=device-width, initial-scale=1">` (built into the `md_to_html.py` template; never remove it during enrichment/manual edits).
- **Fluid layout** — widths use `%` / `min()` / `clamp()` / `fr`, never a fixed px width; container gets `max-width` + centering with safe margins.
- **Responsive breakpoints** — cover mobile (<640px, single-column stack), tablet (640–1024px), desktop (>1024px, multi-column); multi-column grids collapse to single column on narrow screens.
- **Adaptive font size** — Hero/Heading sizes use `clamp()` (e.g. `clamp(28px, 5vw, 56px)`), never overflowing on mobile.
- **Images / tables** — images `max-width:100%; height:auto`; wide tables on narrow screens scroll via `overflow-x:auto` instead of breaking the layout.
- **Touch-friendly** — clickable elements ≥44×44px touch target; hover states have a non-hover alternative on touch devices.
- **PPT deck on mobile** — the 16:9 design box scales **proportionally** (`data-design-w/h` + player scaling), no horizontal overflow.
- **Safe area** — adapt to notched screens via `env(safe-area-inset-*)` (footers / fixed bars).

Self-check: no horizontal overflow on narrow screens, multi-column collapsed to single column, Hero font size not overflowing (§7).

**Automated**: viewport (PQ201), multi-column collapse (PQ202), `img max-width` (PQ203) are auto-checked by `lint_page_quality.py` (§4.5); fixed px widths (PQ204) and large font sizes without `clamp()` (PQ205) raise WARN. Standard multi-column collapse patterns: `beautify/beautify-guide.md` "Mobile adaptation hard rules".

## 4.5 Product quality gate (errors / performance / security / UX)

Pages generated 0-1 by this flow must pass the product quality gate before import (§6) — in addition to the beautify hard gate `BEAUTIFY_OK`. Full spec: `page-quality-check.md`. **Core principle: the gate never blocks upload** — FAIL is a strong fix signal, not an import ban.

Static long pages have no database, so run `lint_page_quality.py` without `--has-database`:

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_page_quality.py" --html "<final.html>"
```

- `MINDX_PAGE_QUALITY_FAIL` (exit 2) → fix per rule number (PQ001/003-007: JS errors / missing catch / missing SDK guard / XSS / credentials / local paths) and rerun; if unfixable or a false positive, pass with `--ack "<reason>"` and state it honestly in the receipt.
- `MINDX_PAGE_QUALITY_OK` + `MINDX_PAGE_QUALITY_WARN` (exit 0) → WARN (performance / UX / ES6 compat) does not block, but must be listed honestly in the receipt.
- Mark the `QUALITY_OK` signal in the receipt afterwards (format: `page-quality-check.md` §5); `--ack` items are noted on the `QUALITY_OK` line.
- Dynamic data pages (via `data-page-flow.md`) additionally run the data-integrity gate DSDK014/015/016 — see that file's §1.6 and `page-quality-check.md`.

---

## 5. Player-intent routing (presentation state vs. full-screen scroll state)

> Once imported, when the user clicks "Play", the player routes **automatically by the html root marker** written by `md_to_html.py` at generation time.

- **PPT paginated report** — flag `--format presentation`; root marker `<html ... data-wbp data-wbp-version="1.1" data-aspect="16:9" ...>` → **professional presentation player**: page-by-page turning, `.is-active` entrance animations, teleprompter/verbatim script (`data-wbp-notes`), transitions.
- **General visual long page** — flag `--format page` (default); root marker `<html ... data-sp-mode="scroll">` → **full-screen scroll browsing**: straight to full screen, pure top-to-bottom scroll reading, **no pagination, no teleprompter, no page-turn controls**.

**Routing contract**: `data-wbp` present → presentation state; otherwise `data-sp-mode="scroll"` → full-screen scroll state; neither (legacy/external html) → conservative default (full-screen scroll), never mistakenly entering the paged state. The marker only affects the player's playback routing, not how the html renders in the editing state (see `md-to-html-flow.md` §4.1).

---

## 6. Post-generation ingestion (reuses md-to-html-flow's import/mount)

> ⚠️ **Beautify hard gate before import**: static long pages / presentations must have completed the §3 beautification and obtained the `BEAUTIFY_OK` signal from `md-to-html-flow.md` §4.2 — never import the `md_to_html.py` baseline output directly.

- **Static visual long page** — `import_html.py` import completes it; self-contained static html. **No database created, no SDK injected, no bind-back**.
- **PPT deck** — `--format presentation` produces a WBP-native artifact, imported via `import_html.py`.
- **Dynamic data page** — `modify-branch.md` retrofit branch: parse_html → create database (business fields, addable/editable/removable) → retrofit the HTML (inject read/write SDK) → upload; field changes stay in sync via `schema-evolution.md`.

> **Terminal state is mandatory**: imported into the library with an access url. Stopping at "local html generated" = task unfinished. Generation details and self-checks follow `md-to-html-flow.md`.

---

## 7. Self-check checklist (confirm every item before the receipt)

- [ ] Entry determination correct: local material / visualization intent → this flow; existing node → md-to-html-flow; multi-page site → `entry.md` route 1; engineering project → main agent; hosted-page edit → edit-flow.
- [ ] Exactly one of static long page / dynamic data page / PPT deck chosen; the dynamic page only on clear data-management intent.
- [ ] Clean md master copy; no leaked process information / credentials.
- [ ] §3 spec applied via `beautify/beautify-guide.md`, and the §6 beautify hard gate passed (receipt carries `BEAUTIFY_OK`).
- [ ] Cross-device meets the bar: viewport present, no horizontal overflow on narrow screens, multi-column collapsed, Hero clamped, wide tables scroll horizontally.
- [ ] Product quality gate passed: `lint_page_quality.py` run; FAILs fixed as far as possible (unfixable ones passed with `--ack` and stated in the receipt); WARNs listed in the receipt; receipt carries the `QUALITY_OK` signal (see `page-quality-check.md`).
- [ ] Dynamic data pages data-complete: database-linked pages passed DSDK014/015/016 (pagination pulls full set / no illegal truncation / no mock fallback).
- [ ] Player-routing markers correct: presentation carries `data-wbp`; long page carries `data-sp-mode="scroll"`.
- [ ] The `image-hosting.md` image-hosting flow has been run before delivery.
- [ ] Imported into the library with an access url (dynamic data page: database created + linked per `data-page-flow.md`).
- [ ] Pages with image-display needs follow the §2.2 database image-field pipeline (images keep swappable).
- [ ] Receipt gives the user a shareable link; host preview tool opens it if a url exists.

---

## 8. Safety boundary (inherits SKILL.md Security / entry.md red lines)

- Material reading only touches local paths the user **explicitly gave** — never traverse directories, never use wildcards.
- The md master copy and the resulting html **contain no** tokens / cookies / credentials / local absolute paths / raw tool output / agent intermediate reasoning.
- HTML-escape text to avoid injection; never concatenate stored content via `innerHTML`.
- External CDN/font links pinned to exact version numbers; `@latest` forbidden; only whitelist domains (`cdn.jsdelivr.net` / `cdnjs.cloudflare.com` / `unpkg.com` / `esm.sh`) — see `beautify/beautify-guide.md`.
- This flow only produces a **single-file HTML page** — a multi-page site goes to `entry.md` route 1; backend code goes to the main agent.
