# Layout convention schema (v1)

Contract for `~/.clawclaw/library-layouts/layout-<spaceId>.json` — the directory convention consumed by `layout_route.py` (creation-time routing). The interface is defined here by the reader (library skill); the writer (`organize.md`) must comply and validate on every write.

## 1. File contract

- Path: `~/.clawclaw/library-layouts/layout-<spaceId>.json`, exactly one file per space.
- Writer: the organize flow (`organize.md`), single writer; every other chain is read-only.
- Write timing: only after the organize flow's verification passes; refreshed by re-running the flow (folder mode) or by the conversation-triggered sync (doc mode).
- Runtime behavior: missing / corrupt / schema-invalid → `KS_LAYOUT_NONE`; creation is never blocked.

## 2. Fields

### Top level

- `version` (string, required): fixed `"1"` for this schema.
- `spaceId` (string, required): bare ID (no URL); must equal the `<spaceId>` in the filename.
- `mode` (string, required): `"folder"` or `"doc"`.
  - `folder`: the directory tree itself is the convention; this JSON is the single source of truth.
  - `doc`: a human-readable master copy 「目录索引.md」 lives at the space root; this JSON is the machine snapshot derived from it.
- `conventionDocId` (string, required iff `mode` = `"doc"`): node ID of 「目录索引.md」; must not duplicate any `nodes[].id` or the `fallbackNode.id`; must be absent when `mode` = `"folder"`. Ignored at routing runtime — it exists for the doc-mode sync flow.
- `generatedAt` (string, required): `YYYY-MM-DD`, the day the convention was last written.
- `nodes` (array, required): 1–50 entries, one per first-level directory node.
- `fallbackNode` (object, required): the catch-all node for eval / batch / low-confidence items.

Extra top-level fields (e.g. `spaceName`, `source`, `rootTerminalState`) are allowed as provenance but ignored at runtime. `storagePolicy` is deprecated: the runtime rules live only in `entry.md`; keep it at most as a provenance record, never as a second source of routing rules.

### `nodes[]` entry

- `id` (string, required): real node ID from `list-nodes`, non-empty, unique within the file.
- `title` (string, required): exact node title as shown in the space.
- `intent` (string, required): one sentence, ≤ 80 chars: what kind of content belongs here.
- `keywords` (string[], optional): 0–8 entries; each 1–24 chars, trimmed, no duplicates; English lowercase.
- `kind` (string, optional): `doc` / `folder` / `web` …; provenance only, ignored at runtime.

### `fallbackNode`

- `id` (string, required): real node ID, must not duplicate any `nodes[].id`.
- `title` (string, required): exact node title.
- Extra fields (any, optional): ignored at runtime.

## 3. Generation rules (how the writer fills the fields)

- Organize form: when first writing the convention, the organize flow asks the user once which form to use — folder tree (`mode` = `"folder"`) or doc index (`mode` = `"doc"`) — and reuses the recorded `mode` on later runs unless the user asks to switch.
- doc mode: create 「目录索引.md」 at the space root. It opens with a fixed usage note (Chinese, verbatim): {{本文档仅展示当前空间的目录整理规则。如需调整规则，请直接编辑本文件；改完后回到与 Agent 的对话中说明，触发目录约定同步后改动才会生效。}} Below the note, its content lists the first-level nodes with their intents and the filing rules. Record its node ID as `conventionDocId` and exclude the doc itself from classification targets.
- doc-mode sync: runs only when the user triggers it in a conversation after editing 「目录索引.md」 — never automatically. The sync pulls the md fresh from the cloud, re-derives `nodes[]` / `fallbackNode` (every id re-verified against a real `list-nodes` result), rewrites the JSON and validates. Until the sync runs, routing keeps using the JSON snapshot.
- Coverage: `nodes[]` covers every first-level directory node of the final root state. A permanent guide page may be listed with empty `keywords` and an `intent` stating it is not a filing target.
- `intent`: written as "〈content types〉 for 〈purpose〉" (e.g. "PRD and requirement docs for md/csv/html editors"); it is the primary matching signal.
- `keywords`: title tokens + core words of `intent` + common Chinese/English synonyms; skip when the title alone is unambiguous.
- `fallbackNode`: points to the "temporary / test" directory created (or confirmed) during the organize flow.
- Never invent node IDs; every `id` (incl. `conventionDocId`) must come from a real `list-nodes` result in the same run.

## 4. Validation

The writer must validate immediately after writing:

```bash
python3 "${CLAWCLAW_SKILL_DIR}/manage/filing/layout_route.py" --validate ~/.clawclaw/library-layouts/layout-<spaceId>.json
```

`KS_LAYOUT_VALID` on stdout → accept the write. A single-line JSON `{"error":"schema validation failed","issues":[...]}` lists every violation → fix and rewrite before finishing the organize flow.
