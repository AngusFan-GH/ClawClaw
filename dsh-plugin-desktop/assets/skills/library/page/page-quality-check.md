# page-quality-check — pre-import quality gate for 0-1 generated HTML

Trigger: user does 0-1 HTML page generation. Run pre-import quality check covering errors / performance / security / experience, plus data-integrity rules when the page binds a database. This is the second quality gate after `BEAUTIFY_OK`.

Core principle: the gate NEVER blocks user upload. FAIL is a strong-fix signal (agent should fix and rerun), not a ban; when repair is impossible or the finding is a known false positive, pass with `--ack "<reason>"` and surface the unfixed items in the receipt. ES6 compatibility (PQ110) is WARN, never blocks.

Boundary: triggered only by the three 0-1 generation paths (see Trigger scope below). Standalone upload (`entry.md` §Import) and editing a hosted page (`edit-flow.md`) do NOT trigger.

Positioning: lint catches what static analysis can prove (FAIL); receipt signal `QUALITY_OK` covers what lint cannot; soft items (performance / experience / compatibility) stay WARN and never block. Built-in anti-false-positive (regex literal recognition, escape-function whitelist, explicit exemption) prevents the "false positive → endless fix loop → upload stuck" failure mode.

## 0. Trigger scope

1. **Static visualization long page** — entry `beautify-flow.md`; triggers, database rules off (only `lint_page_quality.py`).
2. **Create branch (no HTML, Agent writes)** — entry `create-branch.md`; triggers, database rules on.
3. **Retrofit branch (existing HTML + data binding)** — entry `modify-branch.md`; triggers, database rules on.
4. **Standalone HTML/ZIP upload** — entry `entry.md` §Import; does NOT trigger.
5. **Edit hosted page** — entry `edit-flow.md`; does NOT trigger.

## 1. Two check scripts

### 1.1 `lint_page_quality.py` (static, no database read)

Errors / performance / security / experience. Pure local, no network, no token, no database schema.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_page_quality.py" --html "<final.html>"
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_page_quality.py" --html "<final.html>" --has-database
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_page_quality.py" --html "<final.html>" --strict
python3 "${CLAWCLAW_SKILL_DIR}/page/lint_page_quality.py" --html "<final.html>" --ack "<reason>"
```

Output protocol:

1. `MINDX_PAGE_QUALITY_OK` (exit 0): all pass (may include `MINDX_PAGE_QUALITY_WARN` lines).
2. `MINDX_PAGE_QUALITY_OK` + several `MINDX_PAGE_QUALITY_WARN <PQxxx> <target>: <reason>` (exit 0): WARN only — does not block but must appear in receipt.
3. `MINDX_PAGE_QUALITY_FAIL <PQxxx> <target>: <reason>` (per line) + `MINDX_PAGE_QUALITY_NOTE` ack hint (exit 2): strong fix signal, does NOT block upload; fix and rerun; on unfixable pass with `--ack`.
4. `MINDX_PAGE_QUALITY_ACK ...` (unfixed items honestly listed) + `MINDX_PAGE_QUALITY_OK` + `NOTE: ack=<reason>` (exit 0): ACK pass — unfixed items listed in receipt.
5. stderr + exit 1: input error (`--html` missing / unreadable).

### 1.2 `lint_database_sdk_usage.py` (extension, data integrity)

Data-integrity lives here (it already reads database schema and manages query usage). Usage and output protocol unchanged (`canonical-schema.md` §1.6 second check). This release adds DSDK014 / 015 / 016.

## 2. Rule list

### 2.1 `lint_page_quality.py` strong signals (FAIL, exit 2; non-blocking, `--ack` can pass)

1. **PQ001 (error)** — inline business script has unbalanced parens / unclosed string (definite runtime error) → fix syntax (regex literals are recognized, no false positive).
2. **PQ003 (error)** — SDK Promise chain missing `.catch` (or `then` onRejected) → add `.catch` for fallback; `onUpdated` is exempt.
3. **PQ004 (robustness)** — uses `__SMART_PAGE__` without existence guard (blank page when SDK absent) → add `typeof` / `if` guard, fall back to static / empty state.
4. **PQ005 (security)** — `innerHTML` / `outerHTML` / `insertAdjacentHTML` with unescaped variable (XSS) → use `textContent`, or wrap with `escapeHtml` / `DOMPurify.sanitize` / `encodeURI`.
5. **PQ006 (security)** — artifact retains credentials / keys (JWT / `op_` / `tk_` / Bearer / API Key) → strip and regenerate (security red line, must strip).
6. **PQ007 (security)** — `src` / `href` uses local absolute path (`/Users/` / `C:\` etc.) → local images route through `image-hosting.md`.
7. **PQ201 (mobile)** — missing viewport meta (`width=device-width`) → add `<meta name="viewport" ...>` to `<head>` (template built-in, must not delete).
8. **PQ202 (mobile)** — multi-column grid layout without `@media` single-column fallback (most common mobile squeeze) → inside `@media (max-width:640px)` set `grid-template-columns: 1fr`, or use `repeat(auto-fit, minmax(...))`; inline-style multi-column grid is a direct violation (cannot media-query-degrade); see `beautify/beautify-guide.md` "Mobile Adaptation".
9. **PQ203 (mobile)** — `<img>` without `max-width:100%` (large image breaks mobile layout) → CSS must include `img { max-width:100%; height:auto; }` (do not drop baseline rule when rewriting CSS).

Presentation exemption: pages with root marker `data-wbp` are 16:9 fixed design boxes (mobile adapts via player scaling), PQ202 / 204 / 205 are exempt; only PQ201 / 203 are checked.

### 2.2 `lint_page_quality.py` WARN (non-blocking, must appear in receipt)

1. **PQ101 (perf)** — non-first-screen (3rd and beyond) `<img>` missing `loading="lazy"` → add `loading="lazy"`; first 2 images are auto-exempt, no annotation needed.
2. **PQ102 (perf)** — external `<script>` missing `async` / `defer` → `type="module"` is auto-exempt.
3. **PQ103 (perf)** — new large base64 inline image (>50KB) → convert to COS direct link via image hosting.
4. **PQ104 (perf)** — `<img>` missing explicit `width` / `height` (CLS risk) → set width / height / aspect-ratio in CSS.
5. **PQ105 (ux)** — bound database but no loading state (loading / skeleton) → only checked with `--has-database`.
6. **PQ106 (ux)** — bound database but no empty state ("暂无数据" / no-data) → only checked with `--has-database`.
7. **PQ107 (ux)** — bound database but catch has no user-visible error (only console) → only checked with `--has-database`.
8. **PQ108 (ux)** — form submit button without `disabled` (repeatable submit).
9. **PQ109 (perf)** — suspected loop `innerHTML +=` incremental large-list render (no batching / virtual scroll) → use DocumentFragment / virtual scroll.
10. **PQ110 (compat)** — inline script uses ES6+ (`let` / `const` / arrow / template / `async` / spread / `class`); old webview may not support → convert to `var` / `function` if max-compat needed; modern environment may ignore.
11. **PQ204 (mobile)** — `width` / `min-width` hardcoded >480px, narrow screen may overflow horizontally → use `max-width` + `%` / `min()` / `clamp()`.
12. **PQ205 (mobile)** — large font (≥40px) hardcoded px without clamp, small screen overflow / oversized → hero / large heading use `clamp(28px, 5vw, 56px)`.
13. **PQ402 (CDN)** — external link points to overseas original domain (`fonts.googleapis.com` / `gstatic` / `jsdelivr` / `cdnjs.cloudflare`) → switch to a whitelisted domain per `beautify/beautify-guide.md` "CDN Whitelist".
14. **PQ401 (CDN)** — external `<script>` / `<link>` uses `@latest` (version drift breaks page) → pin version (`lib@1.2.3`); `beautify-guide` red line.

### 2.3 `lint_database_sdk_usage.py` new data-integrity rules (FAIL)

1. **DSDK014** — pagination incomplete: `db.query` renders a list without `hasMore` + `nextCursor` / `startCursor` continue-paging signal → FAIL; query-only (no DOM render) is exempt.
2. **DSDK015** — illegal truncation: scope of result access shows `slice(0,N)` / `splice` / fixed `for`-cap rendering database data → FAIL; render full, or for user-explicit truncation (Top N) record in receipt `QUALITY_OK` with `数据完整=已确认截断(<reason>)`.
3. **DSDK016** — mock / fake-data fallback: `catch` block fills an object-literal array (`[ {...} ]`) as real data → FAIL.

## 3. Why "pagination incomplete" loses data (DSDK014)

`db.query` contract: a single call returns one page only (`pageSize` default 50, max 200, see `database-sdk-contract.md` §2 / §4).

```
CSV with 500 rows
  │
db.query({ databaseId, pageSize: 200 })   ← single call
  │
  └→ Server returns first 200 only; remaining 300 not fetched
       Page renders 200 only → user thinks there are 200 in the table
       "共 N 条" counter also shows 200 → wrong number
```

Correct approach (template in `modify-branch.md` Phase 4 `loadData`): use `hasMore` + `nextCursor` recursive continuation, fetch all before rendering. DSDK014 checks for the continuation signal.

UI paginator is not truncation: a paginator fetches the full set first, then displays page by page; the chain carries `hasMore` continuation, so it does NOT trigger DSDK014 / 015. Search / filter showing only matches, charts taking only aggregate values, are also not truncation.

## 4. Two forms of truncation (DSDK015)

Distinguish **"implicit — bug"** (agent skipped render) from **"implicit — user intent"** (Top N leaderboard / latest N):

- Bug-style truncation (agent lazy-renders first N) → DSDK015 FAIL, fix to render full.
- User-explicit truncation (Top N) → DSDK015 still reports FAIL (script cannot statically read intent); do NOT force-fix — annotate `数据完整=已确认截断(<reason>)` in the receipt `QUALITY_OK` (see §5). User truncation is a legitimate scenario; let the receipt self-declare it. Do not introduce extra annotation attributes that add agent cognitive load.

## 5. `QUALITY_OK` receipt self-declaration signal

Static lint cannot fully cover truncation (dynamic `LIMIT` variables, implicit loop limits, etc.); agent explicitly declares in the receipt. Aligned with `BEAUTIFY_OK`: append a line in the receipt after the check completes (NOT written into HTML, NOT exposed to end reader).

```
# Static page, no database
QUALITY_OK 报错=pass 性能=pass(WARN:2) 安全=pass

# Database-bound data page (data complete)
QUALITY_OK 报错=pass 性能=pass 安全=pass 数据完整=pass

# User explicitly requested truncation
QUALITY_OK 报错=pass 性能=pass 安全=pass 数据完整=已确认截断(Top10,用户要求)
```

- No `QUALITY_OK` annotation = step not done, MUST NOT enter import (aligned with `BEAUTIFY_OK` hard gate).
- `数据完整=` field: static lint passed → `pass`; user-explicit truncation → `已确认截断(reason)`.
- `性能=` with WARN → `pass(WARN:N)` and list specific WARN lines in receipt.

## 6. Detection strategy and boundaries (avoid false-positive stuck loops)

1. Core principle: gate NEVER blocks user upload. FAIL = strong fix signal (try hard), not upload ban; unfixable / known false positive → `--ack "<reason>"` (lint_page_quality.py) or honest disclosure in receipt (DSDK), no infinite loop.
2. False positive → downgrade to WARN: ES6 compat (PQ110), huge DOM (PQ109), mock detection (DSDK016) — static analysis cannot be 100% certain; take conservative signal, prefer under-report to over-report.
3. Built-in anti-false-positive: regex literal recognition (`/a=>b/`, `/[(]/` no longer trigger paren / arrow check); XSS escape whitelist (`escapeHtml` / `DOMPurify.sanitize` / `encodeURI` wrappers are passed; objective, not relying on agent subjective claim).
4. Only check agent-written business scripts: `lint_page_quality.py` error / compat checks exclude external `src` scripts and third-party libs (mermaid / tailwind / font / cdn), no false-positive on third-party code.
5. No duplicate reports: DSDK014 (missing continuation) vs DSDK015 (explicit slice) have different semantics, each reports its own; PQ and DSDK are separate scripts, no cross.
6. Backward compat: new scripts / rules mount only on the three 0-1 generation paths; standalone upload / edit unaffected.

## 7. Failure handling (does not block flow)

- FAIL → follow the rule-id hint, fix HTML best-effort, rerun the corresponding script. Fix priority: PQ006 credentials (security red line, must strip) > DSDK014 / 015 (data correctness) > others.
- Unfixable / suspected false positive → pass with `--ack "<reason>"` (ACK line honestly lists unfixed items); DSDK side honestly discloses in receipt and continues. NEVER silently ignore FAIL without disclosure.
- WARN → does not block, MUST honestly list in receipt so the user knows; fix opportunistically (add `loading=lazy`, `defer`).
- Same FAIL unfixable 2 times in a row → pass with `--ack` directly and disclose in receipt, no infinite retry (avoid stuck upload).
