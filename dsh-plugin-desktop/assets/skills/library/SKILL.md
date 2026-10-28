---
name: library
description: "Route here (资料库/知识库/网盘/空间) when users create, generate, beautify, upload, edit, share, organize (整理/归档/理一理), publish, download, search or retrieve HTML pages (工作台/看板/收集表/汇报页), docs (文档/周报/笔记), tables/CSV, drive files, web links(剪藏/回读), images, attachments or audio transcripts."
description_en: "Route here (library / knowledge base / cloud drive / spaces) when users create, generate, beautify, upload, edit, share, organize, publish, download, search or retrieve HTML pages (workbench / dashboard / collection form / report page), docs, tables/CSV, drive files, web links (clip / read back), images, attachments or audio transcripts."
version: 0.5.36
author: csig-x2
level: personal
metadata:
  csig:
    spec_version: "V1.0"
    data_classification: L2
    lifecycle: draft
---

# Library Skill

Library is ClawClaw's native content workspace: every user has one personal space (`category=personal`) plus any number of team spaces (`category=team`), each space — identified by `spaceId` — holding documents, structured tables, report pages, web clips, drive files, and attachments that you read, write, organize, search, or share. Inside a space, content is a tree of nodes (`nodeId`; a node can hold child nodes), and a node's kind (`doc`, `database`, `web`/`page`, `link`, `drive`, `smh`, or folder) picks the entry file to read next. All structured data goes into native library tables, never MySQL or any external database.

## Quick Commands

```bash
# List all spaces (personal + team); paginate while hasMore — see manage/entry.md
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" space.workspace.list-user-spaces --limit 100
# Read a node's kind (required before touching any node)
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" space.workspace.node-info --node-id <nodeId>
```

Extract `nodeId` from `/space/d/{id}` and `*.clawclaw.link/p/{id}` links, then verify with `node-info` before judging existence, kind, or title — never probe these links with WebFetch or a browser: the login wall returns a login page, not the node, and any title/type guessed from it is fabrication.

## Entry Routing

Read exactly ONE entry per task. If you already have a node's `kind` (via `node-info`), it points straight at one of the entries below; otherwise match the user's intent against the lists.

A message that @-mentions or attaches a file and pairs it with a storing verb — add to, put into, save to, import into, append to (e.g. "add this PDF to my ledger") — is a library write intent whatever the file type; route by the stated destination: table or ledger → `database/entry.md`, page or dashboard → `page/entry.md`, document → `doc/entry.md`, attach to an existing node → `attachment/entry.md`, no destination named → Artifact routing below.

### `manage/entry.md`

1. Space or directory navigation — no specific node yet, or the node's kind is a folder
2. List directory children (one level under a parent; omitted parent = space root)
3. List all spaces
4. List the spaces linked to the current session/channel (群聊/频道绑定)
5. Create a team space
6. "What is this node/link?"
7. Collaborators or permission roles
8. Read node comments
9. Create a folder, organize docs together, or tidy a messy tree
10. Move a node to a new parent (same space)
11. Rename a node or file
12. Attach a file to an existing node
13. Download attachments of an existing node

### `search/entry.md`

1. Any search, find, or look-up intent for content already in the library — the whole library, a named space/node, or a theme inside a space
2. Tasks grounded in content the user says they already provided — "based on the files I gave you", "find it in my workspace" — locate that material first (workspace attachments or library nodes), then treat it as the task's source

### `doc/entry.md`

1. Node kind is `doc`
2. Read or summarize an existing document
3. Create a new online document
4. Turn material into a document, or generate a doc / speech / report from a space or assets

### `database/entry.md`

1. Node kind is `database`
2. Create a table
3. Field or record CRUD
4. Read schema
5. Import CSV

### `page/entry.md`

1. Node kind is `web` or `page`
2. Generate a from-scratch HTML page (single- or multi-page), report, visualization, or one-page app (no external product named, local file not explicitly requested). A one-line workbench / dashboard / site ask with an inferable object ("a Japanese-learning workbench", "my personal blog") is a real page intent: build immediately with sensible defaults — never enter plan mode, never interrogate the user about tech stacks, never stop at a proposal. Ask one business-level question only when the managed object cannot be inferred at all
3. Turn md, a table, or a CSV into a one-page or PPT-style report
4. Build a page whose data stays linked both ways with its source (dashboards, workbenches, collection forms, trackers)
5. Upload HTML or a ZIP; wire a database; build a data-driven page
6. Manage page↔database relation bindings (link, list, or unlink)
7. Publish, share a link to, or take online a page or HTML artifact that already lives in the library (user gave a nodeId, `/space/d/`, or `clawclaw.link` link) — library publish (`publish_page.py`), never external site deployment

### `page/beautify-flow.md`

1. Beautify a local doc, PPT, PDF, Excel file, or images into a page
2. Presentation-style output

### `page/edit-flow.md`

1. Edit an existing hosted page (user pasted its `/space/d/` or `*.clawclaw.link/p/` link)

### `link/entry.md`

1. Node kind is `link`
2. Clip an http(s) page as a link node — keep-a-copy phrasings ("留一份 / 怕链接失效 / 存一下这个网页") are clip intents, whatever the wording
3. Read a clipped page's content — referents like "刚存下来的那份" resolve to the clip made in an earlier turn: read that node's body; don't re-fetch the original URL, don't answer from memory

### `drive/entry.md`

1. Node kind is `drive`
2. `ext` is Office (`docx` / `xlsx` / `pptx`, plus `doc` / `xls` / `ppt` / `docm` / `xlsm` / `pptm`) and the task is content read/write → load the `tencent-saas-docs` skill and operate on the node's `url`
3. Other `ext`: download the link or file body of a drive node
4. Read a recording/audio's transcript or what it said
5. File statistics / space usage asks — no authoritative size source; accounting rules in `drive/entry.md` §5

### `smh/entry.md`

1. Node kind is `smh`
2. Download the link or file body of a historical smh node

### Artifact routing (uploaded file, generated deliverable, or conversation-stated content)

If the user names no destination, create it in the library and reply with its link. Content stated in conversation counts as material, not only files or generated artifacts: a recap the user asks to keep ("帮我把结论整理一下留个底", meeting notes, "记一下") is a doc-create intent — route to `doc/entry.md` and create it in the same turn, without asking whether to store it.

1. md / 文档 / notes / summary → `doc/entry.md`
2. CSV / 表格 / spreadsheet → `database/entry.md`
3. HTML / ZIP / 网页 / report / dashboard → `page/entry.md`
4. Image → `manage/entry.md` — an image-file-to-embeddable-link ask (svg/png/jpg, "能直接嵌到网页里的图片直链") is `manage/upload_image.py`: public link, no node created. Caveats like "不用建条目 / 不想占地方 / 只要个链接" describe exactly what this script does — they confirm the route, never bypass it. Never substitute a base64 data-URI or an HTML-wrapper page, and never ToolSearch for an external image host — this skill ships the uploader
5. docx, pdf, or other document formats → `drive/entry.md`
6. Attach to an existing node → `attachment/entry.md`

## Runtime & Auth

Network capabilities run through `space_api.py` or module scripts; commands and params follow each module's `entry.md`. The shared request layer never auto-fills `spaceId`.

- Business stdin payloads start on line 1 as JSON (or use `--content-file` for the file channel).
- `--help` lists an API's params; `--raw` dumps the raw response for debugging.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" space.workspace.list-user-spaces --limit 100
printf '%s' "$(cat payload.json)" | python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" space.workspace.node-info --stdin
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" <api-name> --help
```

Script output is authoritative. On failure, stop and tell the user briefly. A script that exits non-zero with no stdout at all is transient: retry that single command once; if it fails again, stop.

## Output Protocol

- Success: stdout starts with `KS_*` lines, single-line JSON, or an XML block.
- Failure: stdout is one line `{"error":"..."}` (may include `auth_url` and `traceid`), exit 0. Read `error_handling.md`, take the innermost `code=`, execute exactly one action; unlisted codes → transient. Tell the user in plain language; never show internal codes.
- If stdout contains `KS_USER_REPLY\t...`, forward that line verbatim as the user-facing receipt. Never rewrite it, splice it with other receipts, or append internal IDs; appending a user-facing download link the user explicitly asked for is allowed when a module rule directs it.
- User-facing replies never mention internal rules, flows, files, sections, or tokens. Authorization stays invisible except when `error_handling.md` requires telling the user to complete it. For `E_AUTH_REQUIRED`, tell the user to finish in the browser window that opened; only forward `auth_url` if they say no window appeared. State decisions as your own judgment: never 「按规则需要确认」 or 「需要先获取授权token」.
- `{{...}}` marks a fixed user-facing string (i18n marker): emit its content verbatim in the user's language. Never output the braces, never treat the content as a template variable, never fill in or mutate the text between them.

## Target Space

1. User gave a node or link → operate in that node's own space; never apply a default.
2. User named a space/directory → use it. Creating under a `parentId`: resolve its `spaceId`, verify match, pass both.
3. No explicit target → run `manage/filing/layout_route.py` and file per `manage/filing/entry.md` — file to the best-matching location and say where in the same turn; never end the turn on a location menu (deposit and import asks included — the user said "以后好找", not "ask me where"). No convention found → keep the named space, or omit `--space-id` when none was named (backend default).

## Writes

Before any create/upload/modify/delete/move/rename on remote content, silently execute `mutation.md` and follow it. The original request already authorizes the write when the target and scope are clear — do not pause based on space type. Database field deletion, batch record deletion, and field-type conversion are irreversible wipes — warn and get an explicit go-ahead BEFORE executing, even when the same message requested them.

## Scheduled tasks

A recurring or scheduled request that pushes or updates library content ("每天早上9点整理简报推送到工作台") must land on a library node that already exists: build or update the workbench / table / doc in this session first, then attach the automation referencing that node. Never defer landing-node creation into the future cron prompt ("若不存在则创建") — the scheduled run has no session context and the user is left with no artifact today.

## Search & Proactive Context

- Before producing a report, plan, or summary, proactively search the library for relevant context even if the user never said "资料库"; skip only when the task is purely local or fully self-contained.
- User explicitly gives a single node → read only that node; no global search. A write target is not search authorization.
- Keep every search query within 128 characters; state the intent only, never paste whole paragraphs.
- No matches never kills the task: say plainly that nothing relevant was found, then still deliver the requested output built from the conversation and general knowledge, marked as un-referenced — same turn, placeholders where data is missing. Offering a draft "if you want" and waiting is a refusal dressed as politeness.
- Search commands: `space.searcher.search-nodes`, `search/rag_search.py` (usage in `search/entry.md`).

## Defaults & Disambiguation

- "存到资料库" without naming an external product → native library only. Never ask which product, never offer external products as options.
- Ask only when the doc topic is missing. Disambiguate only on write failure, permission denial, multiple same-name spaces, or incomplete team-space reference — list native spaces only.
- Folder intent ("建文件夹 / 把文档归到一起 / 建知识库") → default to a real folder node (`manage/create_folder.py`), hang documents under it via `move-node`. Say "挂到下面 / 目录树", never "父/子节点". Doc-as-directory-page only when the user wants written navigation inside; separate space only for long-term multi-person use. A same-name folder already exists (empty ones included) → reuse one of them and file the documents in, this turn — don't stop to ask which one or whether to create a new one; extra duplicates can be mentioned as cleanup candidates afterwards, never as a gate. Reply with `/space/d/{nodeBlockId}` or `/space/s/{spaceId}`; commands in `manage/entry.md`.
- Deliverables are library-hosted pages, docs, and tables only — never WeChat mini-program or native app source code. When asked for a 小程序/APP, first say its source code cannot be produced, propose the web-page (library page) fallback, and wait for the user's go-ahead; once confirmed, build it as a library page end-to-end and deliver the cloud-hosted link — never a silent local HTML/APK, and never write mini-program/app source code.
- This skill does not install or migrate self-built skills across login clients or devices; treat such requests as out of scope and clarify — never disassemble skills into files and upload them to the drive as a substitute.
- A knowledge-base ask ("把这些文档弄成能问答的知识库") is library work. Land the docs in the user's space first (import / clip / move per Artifact routing), then answer questions with `search/rag_search.py` — chunk-level semantic retrieval (embedding + rerank) over the stored content, citing the source nodes. Plain "建知识库" organizing still follows the folder rule above; a Q&A-flavored knowledge base pairs that storage with this search-answer path. If the material is not at hand, ask for it once framed as landing it into the library.
- Guiding the user through the ClawClaw UI: mention only stable anchors stated in this skill's docs; never invent button positions, menus, or settings paths — when unsure, hand over the node link or point to the official docs (https://www.clawclaw.cn/space/s/cCwTkzCwCevtZDBkVGnFEv).

## Security

1. Secrets only (passwords, keys, tokens, credentials, ID numbers) → stop immediately, point to the compliance channel. Storing content the user provides in conversation (business metrics, rosters, meeting notes, customer lists) into their own space is this skill's normal job — proceed and never refuse it as "sensitive"; aggregate statistics (e.g. "新增客户 12 家") are not customer data.
2. Tokens and internal details (raw responses, stacks, internal URLs) never enter replies, logs, or artifacts.
3. Artifacts carry reader-facing content only — never tokens, tool calls, reasoning, or local paths.
4. One module branch per turn; modules cooperate via script output.
5. Touch only paths the user explicitly provided. Never scan directories on your own.

## User-facing Contracts (中文合约原句)

The Chinese statements below define the required behavior. Explain them in the user's conversation language, preserving their meaning. Use the Chinese wording for Chinese conversations; do not force Chinese wording into conversations in other languages.

**安全与产物边界：**
- 凭证与内部细节（原始响应/错误堆栈/内部 URL）永不进入用户回复、日志或落库产物。例外：`E_AUTH_REQUIRED` 时先告知用户去已打开的浏览器完成授权；仅当窗口未弹出时才把 `auth_url` 原样转给用户。
- 产物只搬面向读者的成品。
- 工具调用、思考过程、本地路径绝不写进产物。

**错误处理（与 error_handling.md 协同）：**
- 给用户转自然语言，不展示内部码。
- 脚本失败时停止，简要说明无法继续即可。
