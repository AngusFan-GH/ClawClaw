# doc — online doc task entry

Handles reading, creating, editing, and revising library online docs (`kind=doc`). `kind=web/page`, `database`, `smh/drive` do not route here.

## 1. Pick the task first

Read exactly one task file that matches; append technical references only when a task file explicitly says so. Editing an existing doc means the target is already resolved — never route to `manage/filing/entry.md` (filing is for create/import/upload with no explicit target). A plain text append or section add does not involve tables — do not read `tasks/table_edit.md` for it.

1. View, summarize, or extract text; create a brand-new doc; explicitly full-overwrite an existing doc with complete Markdown; or the user states content in conversation and asks to keep a record of it ("留个底 / 记一下 / 存个档 / 整理一下存下来", meeting conclusions, notes) — `tasks/read_create.md`. State-then-archive asks create the doc directly in the same turn — asking "要不要帮你存成文档?" first is a refusal dressed as politeness; 0-to-1 creation needs no second authorization.
2. Edit from text selection or comments, including whole-doc comment revision — `tasks/revision.md`.
3. Add or edit tables in an existing doc; target inside a table or cell — `tasks/table_edit.md`.
4. Edit non-basic components, block type, children, block-level attributes, Code or Mermaid — `tasks/complex_edit.md`.
5. Plain text-block add/edit/move/delete, direct append, batch text replace or delete — `tasks/text_block_edit.md`.
6. Script failure, empty stdout, invisible card, or retry decisions — `error_handling.md`.

Routing priority:

1. Creating a brand-new doc always goes to `tasks/read_create.md`; its tables, code, and Mermaid use Markdown, not the component-editing rules for existing docs.
2. Text-selection or comment revision always goes to `tasks/revision.md` first; on a table or complex-component hit, then append the matching task file.
3. Everything else matches table → complex component → plain text block in that order.

## 2. Global preconditions

- Write ops → run `../mutation.md` first; confirmation only for the irreversible cases listed there.
- Any answer, summary, or discussion of an existing doc's content → re-read it with `get_doc_reviews.py` this turn; content from an earlier turn is stale and must not back an answer. Writes → same fresh read before building actions.
- `nodeId` equals `pageId`; pass it as `--page-id` to Doc scripts.
- `blockId` must come from the latest read-back, or from explicit user/upstream input verified against the latest content; never guess, truncate, or reuse across docs.
- Node kind not confirmed as `doc` → do not call Doc read/write scripts; arbitrate the kind first.

## 3. Write mode

The user's phrasing decides; when it does not name a mode, the default is direct edit, because a review card needs the user to accept it in the editor before anything lands — the agent cannot accept it for them, so routing an ordinary "change this" ask to review mode leaves the requested change suspended.

1. User explicitly asks for suggestions, review, or revision-as-advice ("以修订建议的形式", "别直接改", "提个修改意见", "圈出来给我看") — review edit: `submit_review_edit.py`. Text-selection or comment revision (route 2, `tasks/revision.md`) keeps its review-card semantics by design.
2. Everything else, including mode unspecified with existing content changed, deleted, replaced, or moved ("改成 / 换成 / 删掉 / 更新 / fix / replace") — direct edit: `submit_doc_edit.py`. Action verbs mean "make it so", not "propose it".
3. Mode, scope, or risk conflicts and context can't settle it — ask first.

## 4. Unified wrap-up

- Real write succeeded → pass the script's `KS_USER_REPLY` through verbatim; never assemble links yourself or expose internal IDs.
- Review edit → say it lands after acceptance; direct edit → say it landed immediately.
- stdout is a JSON error or empty → treat as failure; do not continue submitting; go to `error_handling.md`.
