# filing — Creation-time Routing

Routes every create / import / upload / store that names no explicit target node. An explicit target always wins and skips this flow. It decides only where new content lands; `../../mutation.md` still governs authorization.

## Route here for

1. Create / import / upload / store with no explicit target → routing below

## Convention file

1. `~/.clawclaw/library-layouts/layout-<spaceId>.json`, one per space; format in `layout-schema.md`.
2. Written only by the organize flow (`organize.md`); this chain is read-only.
3. Missing, corrupt or invalid → treated as no convention; creation never blocks.

## Routing

1. Run `layout_route.py`:

   ```bash
   # target space known: pure local read, no network call, no token
   python3 "${CLAWCLAW_SKILL_DIR}/manage/filing/layout_route.py" --space-id "<spaceId>"
   # omit --space-id: resolves 我的资料 first
   python3 "${CLAWCLAW_SKILL_DIR}/manage/filing/layout_route.py"
   ```

2. `KS_LAYOUT_NONE` (no convention) →
   1. Eval / benchmark / batch automation run — product carries a test marker (e.g. `[eval-*]` prefix) or run generates synthetic / desensitized test data → auto-archive: `list-nodes` the space root, reuse the exact-title match of 「自动化任务归档」 or create it once, file the product under it. Never create any other directory.
   2. Normal run → keep the space named in the session; omit `--space-id` only when no space was named either (backend default = personal). After filing, one hint per session at most: organizing the space once enables automatic filing.
3. `KS_LAYOUT_FOUND\t<spaceId>\t<JSON>` →
   1. Eval / benchmark / batch automation run (rule 2.1 definition) → file straight into `fallback`, no prompt, regardless of title match.
   2. Otherwise match `nodes[]` (id / title / keywords / intent) by title + session context:
      1. Exactly one clear match → file directly with no prompt: pass that node as `--parent-id` plus its `--space-id`.
      2. No clear match, or several with no winner → file into the convention `fallback` node. Never end the turn on a location menu; asking the user to pick a directory is friction they did not request. Only ask when the request itself is ambiguous about WHAT to file, not where.
4. Filing fails (stale parent-id — the user moved / renamed / deleted the node) → never fall back to the space root; ask the user once where to file, and suggest refreshing the convention.
5. Every successful filing closes the final reply with exactly one line stating where the item landed — {{已存至 <space>/<directory>/<node>}}, plus the node link when the creation output carries one (doc and database create already print it). One line, no menu, no question: a closed-loop confirmation, not a location prompt. Authoritative source for the落位告知契约 is `../../mutation.md` Execution rule 7; this line is the filing-flow-specific implementation of that rule.

## Convention lifecycle

1. Generated when the user organizes the space (`organize.md`); refreshed by re-running that flow, by its incremental update, or by its doc-mode sync. Before any organization the script returns `KS_LAYOUT_NONE` — cold-start users notice nothing.
2. `mode: folder` — the directory tree itself is the convention; the JSON is the single source of truth.
3. `mode: doc` — 「目录索引.md」 at the space root is the human-readable master (`conventionDocId`); the JSON is the machine snapshot. The doc opens with the fixed note: {{本文档仅展示当前空间的目录整理规则。如需调整规则，请直接编辑本文件；改完后回到与 Agent 的对话中说明，触发目录约定同步后改动才会生效。}}
4. Doc-mode sync runs only when the user triggers it in a conversation (pull the md fresh → re-derive nodes / fallback → rewrite the JSON → validate); until then routing keeps using the JSON snapshot.
5. The user corrects a filing mid-session → follow the correction for this create only; never edit the convention here — suggest an incremental update (`organize.md`) instead.
6. The user says "just put it in the root / stop categorizing" → skip routing for this run.

## Boundary rules

1. Never create classification directories; the fixed-name 「自动化任务归档」 above is the only exception. A recurring topic with no matching node → suggest the user create it in the frontend and let the incremental update in `organize.md` record it into the convention.
2. Proactive staleness patrols (list-nodes cross-checks, scattered-file alerts) belong to `organize.md`; this chain handles filing failures reactively.
