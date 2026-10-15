# data-page-flow — Pre-Dispatch Gate & Branch Routing for Data Pages

Covers the pre-dispatch gate for database needs (parse_html invocation, level routing, prompt copy, reply recognition) and branch entry routing. The execution manuals for the two build branches (retrofit / create) and their shared schema rules live in separate files, read on demand per branch. Uploads always go through `import-flow.md`.

---

## 0. Database Need Pre-Dispatch Gate (shared)

> Trigger: whenever the user gives HTML without explicitly saying "just upload / just import / don't build a table," always pass through this gate first. The upload-only path only fires on an explicit user statement; weak / none route silently to upload-only.

### Step 1: Call parse_html.py

```bash
python3 "${CLAWCLAW_SKILL_DIR}/page/parse_html.py" --html "<path/to/page.html>"
```

> This call's result is **reused for the entire task** — if the user later chooses the retrofit branch, do **not** call parse_html.py again. Parsing strategy and output spec: `html-parse-spec.md`.

> **Degraded contract**: if the script cannot run, it outputs `{}`, equivalent to `level: "none"`, handled as the `none` branch.

### Step 2: Route by level

> **Never ask a technical-path question** ("connect to an online table or just deliver a static page?" / "should I build a table?") — the user can't answer that, and shouldn't have to. When the data-management intent is already clear, go straight to the online version; only ask a **business-level question** when it's genuinely ambiguous.

- `strong` — data-management intent is clear (has a form/table/wired-up API) → **go straight to the retrofit branch and wire up the data, no asking**; state it in one line while doing it (copy in §0.1)
- `medium` — unclear whether this is "data to manage" or "a one-off display" → **ask only the business-intent question** (does the data need ongoing edits / multi-person maintenance — copy in §0.2), the reply decides retrofit branch vs. upload-only
- `weak` — **route silently to upload-only**, don't interrupt the user
- `none` — **route silently to upload-only**, don't interrupt the user

### 0.1 strong: wire up the data directly, no asking

The HTML already has a table / form / wired-up API. Go straight to the retrofit branch; state it in one line while doing it (no need to wait for a reply):

```
{{这个页面里有表格 / 表单（<reason>），我直接帮你接上在线数据表，}}
{{这样填了能存、列表能从数据库拉、后面也能随时改数据。}}
```

### 0.2 medium: ask only the business-intent question

The HTML has repeated cards / a list, and it's unclear whether it's "data to manage" or "a one-off display":

```
{{这个页面里有一批重复的卡片 / 列表（<reason>），看起来是在展示一组数据（比如商品、报名记录）。}}
{{想确认下：这些数据以后还要随时增删改、或者要和别人一起维护吗？}}

{{· 要 → 我直接帮你做成在线版本，数据存到表里，随时能改、能多人维护}}
{{· 不用，就是这一版展示一下 → 我就把这一页原样保存成可分享的网页}}
```

### 0.3 Placeholder substitution

- `<reason>` — filled from `parse_html.py`'s `needs_database.reason` output; if missing, delete it along with its parentheses
- `N` — the largest `item_count` in the medium scenario; if there's no value, drop the "{{N 次}}" text (keep "{{重复出现的结构}}")

### Step 3: Recognize the user's reply (medium only)

- Wants to manage data (ongoing edits / multi-person) — any of these keywords: "要" / "随时改" / "要改" / "多人" / "一起维护" / "存数据" / "联数据" / "接数据" / "活的" / "能查" / "能填" / "数据库" → **retrofit branch**, reuse the existing parse_html.py result, start at `modify-branch.md` stage 1
- Just this one-off display — "不用" / "就这一版" / "只保存" / "只上传" → **upload-only**
- Described specific data to store — contains "字段" or lists ≥2 nouns (e.g. "姓名、电话、部门") → **retrofit branch**, skip the script result, build the schema from the description, enter `modify-branch.md` stage 2
- Described a page need — "做一个 / 我想 / 帮我" + a page-type word ("报名 / 签到 / 留言 / 订单" etc.) → **create branch** (`create-branch.md`)

> The keyword lists above match the user's actual Chinese input and must stay in Chinese — translating them would break the match.

---

## 1. Branch entry

- **Retrofit branch** (existing HTML) — entry condition: level=strong; or medium and the user's reply wants to wire up data; or the user described specific fields → execution manual: `modify-branch.md` (parse → build table → retrofit → upload)
- **Create branch** (no HTML) — entry condition: the user has no existing HTML, only described a page need → execution manual: `create-branch.md` (database-first, Agent writes the HTML)
- **Upload-only** (no table) — entry condition: explicit upload-only, or weak / none → execution manual: `import-flow.md` (no table building, no schema involved)

- The retrofit and create branches **share** the canonical schema rules — read `canonical-schema.md` first (§1.1 format, §1.5.5 database binding marker — sole authority, §1.6 field-mapping self-check and the two lints).
- All three branches' upload step goes through `import-flow.md` (the HTML / ZIP import flow, a standalone shared process).

**Light-weight first (check once before entering the create branch)**: if the user's ask is just a table / list / simple summary (e.g. "make me a checklist table," "list out X") — no page, visualization, dashboard, or multi-module workbench requested, and no "auto-linked figures" requested → don't enter the create branch; go to `../database/entry.md` and build the table directly with the records the user gave, reply with the table link. Come back to this flow later if the user wants a page / dashboard. Only enter the create branch when the user explicitly wants a page form (dashboard / form page / workbench / visualization).
