---
name: sites
description: "将生成内容发布为在线链接，或取消发布已上线的应用。适合网站、小游戏等交互式内容，支持任意可作为单端口 HTTP 服务运行的项目（静态站点 / PDF / Node.js / Python / Go），也支持微信小程序。当用户想把本地项目部署、发布、上线、发布小程序、生成分享链接、在云端预览或下线分享链接时使用。"
description_en: "Publish generated content or a local project as an online link, or unpublish an existing app. Use for websites, small games, static content, PDFs, mini programs, or any project that can run as a single-port HTTP service, including Node.js, Python, and Go applications."
license: Internal
allowed-tools:
disable: false
---

# 发布应用 / Sites

Publish a local project as an online link via the built-in `clawclaw_sites_deploy` tool.
Unlike static-only deploy, this supports any project that can run as a single-port HTTP
service: static sites, PDFs, small games, and backend HTTP apps (Node.js / Python / Go).

Mini programs are supported too, but they do not go out as a URL — read **Mini Programs** below
before working with such a directory.

## When to Use

- User asks to **deploy / publish / go live / share an online link / preview in the cloud**.
- User @-mentions **sites** / 发布应用.
- User has a project (static output or a runnable HTTP app) and wants a live, shareable URL.
- User wants to **publish a mini program** (发布小程序) they just built — see **Mini Programs**.

## Ask Before Deploying — Consent Does Not Carry Over

Deploying is a release to the outside world: it overwrites whatever is currently live behind a
link the user may already have shared with other people. Every deploy therefore needs consent
**for that turn**.

Count the user as having asked to publish only when their **latest message** does one of these:

- uses a publish verb — 发布 / 上线 / 部署 / 同步到线上 / 更新线上 / publish / deploy / go live /
  redeploy / "put it online";
- @-mentions **sites** / 发布应用;
- asks for a shareable online link.

Everything else means they have **not** asked, and you ASK first (in their language) before
calling the tool. In particular, agreeing to publish earlier in this conversation does **not**
authorize the next deploy. Do NOT silently deploy.

## Changing an App That Is Already Published

This is the common follow-up: the app is live, and the user now says 「把标题改成 X」/「按钮再大一点」/
「修一下这个 bug」. What they asked for is a **local change**, not a release. Publishing anyway
replaces the page other people may be looking at right now, and the user never got a say in it.

After you finish the edit:

1. Say what you changed and let the user check it in the local preview.
2. Ask exactly one question, in their language — e.g. 「改动已经完成，需要我把它同步更新到线上分享
   链接吗？（线上现有内容会被覆盖）」
3. **End your turn and wait.** Deploy only after an explicit yes.

If the user declines, leave the live link untouched and tell them the changes stay local.

The tool enforces this as well: deploying into a directory that still has a live link without
`userAskedToPublish: true` comes back as `{"type":"sites_deploy_needs_confirmation"}` and nothing is
published. Relay its `userMessage` and wait for the answer. Do **not** re-call the tool with the
flag flipped on just to get past the check — that flag records what the user asked for, it is not a
retry switch.

## The App Destination Comes from `directory` — Never Plan It Yourself

`directory` decides both which files to upload **and** which app gets overwritten: the tool looks up
which app that directory belongs to, and that lookup is the only rule. You never ask the user which
app to publish to, and you never need `appId` for a publish.

1. No app recorded yet → the first app is created automatically.
2. An app is found → publishing overwrites it, keeping its link and display name.

The lookup is deliberately **deterministic rather than clever**: existing workspaces often carry
several app ids for what is really one project (they were created by repeated publishes, not by the
user), so the tool always converges on the same one for a given directory. That is what keeps the
share link stable. Asking the user to pick each time would do the opposite.

Publishing is **always an overwrite**. There is no parameter for starting a second app alongside an
existing one, so never offer "create a new app and link" as a choice — a brand-new app is created by
the user from **Settings - Data Management - Published Apps**. Never try to steer the destination
with directory names, app-name similarity, or an `appId` copied from earlier in the conversation.

### Apps activated via cloud service

An app that was already activated through `clawclaw_cloud_service` publishes to that same app
automatically. Its reserved domain and cloud-service Origin are preserved, so its cloud login keeps
working — a different domain would break it (the server enforces an exact Origin match).

## Multiple Apps in One Directory — Always Pass `entryHtml`

One directory can hold several independent apps (each keeps its own sandbox and link even when the
upload directory is the same). When that happens, the directory ends up with several
pages side by side — `a.html`, `b.html` — and **the server cannot tell which page belongs to which
app**: scanning the directory only sees both files. That mapping exists solely in what the user
asked you to publish this time.

So whenever a static directory holds more than one app, pass `entryHtml` with the page for THIS
app, relative to `directory`:

```json
{ "directory": "/abs/path/site", "appId": "wbapp_xxx", "entryHtml": "b.html",
  "appName": "第二个应用", "domainPrefix": "second-app", "userAskedToPublish": true }
```

Omitting it degrades the product in a way the user will read as data loss: the app card falls back
to “address unavailable”, or — for the app published earlier — keeps pointing at the page it
already had. Neither is recoverable without re-publishing with the flag.

A single-app directory does not need it (the entry is auto-detected, `index.html` preferred),
node/python/go projects never do (their entry is the HTTP root, not a file), and mini programs
never do either (they have no entry html at all).

## Unpublish (take offline)

To unpublish / take a published site offline / cancel a publish, use the built-in
`clawclaw_sites_deploy` tool with `action: "unpublish"` and the same project `directory`
that was deployed. After unpublishing, the shared link stops working. This is destructive —
if the user was not explicit, confirm first. If the directory was never published or is
already offline, tell the user that instead of pretending it was taken offline.

**Which app goes offline is not inferred from the directory.** When the directory has several
live apps, the tool refuses and returns `{"type":"sites_unpublish_needs_app_selection"}` with
`candidates`: list them, ask which one, end your turn, then call again with `action:"unpublish"`
plus the chosen `appId`. Never pick one yourself — not by name similarity, and especially not by
"the one published most recently"; unpublishing kills a link other people may be using right now.
When the user @-mentions an app, that app is used directly and no question is needed.

### Mini programs do not go offline through this tool

This tool only takes **web publishes** offline — what it cancels is a share link, and a mini
program never had one. A mini program is released from its application panel (see
**Mini Programs**), so it is also withdrawn from there.

Do NOT call `action:"unpublish"` for a mini-program directory. The tool blocks it and returns
`{"type":"sites_unpublish_miniprogram_not_supported"}` with a ready-to-use `userMessage`: relay
that and stop. It is not a parameter problem, so retrying with or without an `appId` will not
produce a different answer.

That guard exists because without it the call reaches the publish-record lookup, finds nothing
(no record is kept for that path by design) and reports `not_found` — and relaying "never
published, or the record was cleaned up" to a user who just published from the panel tells them
their release is gone.

When the user asks to take a mini program offline, tell them it is managed from that mini program
application's own panel, the same place they published it.

## What Can Be Published

Only projects reachable as a **single public port** HTTP service (via a reverse-proxied
domain) can be published:

- **Static site / PDF / assets** — served automatically with an internal HTTP server; no
  build required beyond producing the files.
- **Runnable HTTP app** (Express / FastAPI / Go http, etc.) — source is uploaded,
  dependencies are installed in a sandbox, and the server is started on one port.

The sandbox gives the app **one HTTP port and nothing else** — no database, cache or message
queue runs alongside it. So when an app needs to persist data and you are the one writing it,
keep the storage inside the app: **SQLite**, a JSON file, or browser-side storage all publish
fine. Reaching for MySQL / PostgreSQL / Redis / MongoDB makes the project unpublishable here.

If the project genuinely CANNOT be exposed as an HTTP service, tell the user the current
directory does not support publishing — do NOT force a deploy. See **Unsupported Projects &
No Silent Downgrade** below for the exact types that are rejected and how to respond.
Mini programs are not in that category at all: they are supported, they just ship as an app
rather than a link — see **Mini Programs** below.

## Mini Programs — Supported, Shipped in Two Steps

Mini-program publishing **is available** in ClawClaw. It just does not go out as a URL, so it
takes two steps and only the first one is yours:

| Step | Who | What |
|---|---|---|
| 1 | **this tool** | create (or reuse) the mini program application and register the project with it |
| 2 | **the user** | click publish in that application's panel |

When the directory — **or any of its immediate subdirectories** — carries `project.config.json` /
`app.wxss` / `app.acss` / `app.ttss`, or an `app.json` with a `pages` array, the tool automatically
does step 1 and returns

```json
{ "type": "sites_miniprogram_app_created", "deployed": false, "appId": "wbapp_…" }
```

with a ready-to-use `userMessage`. `deployed: false` means **step 2 has not happened yet** — the
result carries no sandbox, no port and no share link because a mini program has none of those. It
does NOT mean publishing failed or is unavailable.

What to do:

1. Relay `userMessage` to the user. It is finished prose meant to be shown as-is — keep the bold
   sentence naming where to publish (the mini program application's preview panel, Share button in
   its top-right corner); translate it when your reply is not in Chinese, but do not rewrite or
   summarize it, and do NOT add a navigation path of your own — there is no "app list in the left
   sidebar" route, and a made-up one sends the user hunting through the wrong screens. Naming the
   app so they know which one to open is fine.
2. **STOP.** Step 2 is the user's; do not call the tool again for this directory.

Step 2 in full: the user opens that mini program application and clicks **Share** in the top-right
corner of its preview panel (that is the real control — the "发布小程序 / Publish mini program"
dialog opens from it). Binding an account by QR code (a trial mini program needs no AppID), upload,
audit submission and release all happen inside ClawClaw. Do NOT tell the user to upload from
WeChat DevTools or submit for review on 微信公众平台 themselves; that is a manual detour, not the
supported route.

Two things to get right when you describe this:

- **Do not say mini-program publishing is unsupported / 暂不支持.** It is supported; the user just
  finishes it in the panel. Saying otherwise sends them looking for another product.
- **Do not say it is already published.** Step 2 has not run yet. Claiming otherwise makes the user
  think their mini program is live when it is not.

**NEVER produce a web link to stand in for the mini program.** Writing an HTML/H5 version and
deploying that — or deploying a sibling `index.html` next to the mini-program directory — is
strictly forbidden, even though it makes something "succeed". The user asked for a mini program; a
web link is not one, and handing them one reads as if the request was fulfilled. The path is decided
by what is on disk, so retrying with a different `language` / `startCmd` will not turn it into a web
publish either. If the user afterwards explicitly asks for a web version as well, that is a new
request they have to make.

## Unsupported Projects & No Silent Downgrade

The publishing sandbox natively supports **Node.js / Python / Go / static sites** as a single
public HTTP port. It does **NOT** support:

- **Java / Maven / Gradle** projects (no JVM/Maven/Gradle build in the sandbox).
- Projects that need **external services** the sandbox does not provide — MySQL, PostgreSQL,
  Redis, MongoDB, Kafka, RabbitMQ. Only a single HTTP port is exposed; there is no database,
  cache or message queue alongside it. A directory is rejected when it declares one through a
  connection string in `.env*` pointing at localhost or a compose service name, a
  `prisma/schema.prisma` provider other than `sqlite`, external service containers in
  `docker-compose.yml`, a Spring datasource, or a driver package in its dependency manifest
  (`mysql2` / `pg` / `mongoose` / `ioredis` / `psycopg2` / `go-sql-driver/mysql`, …).
  **SQLite is fully supported** — it ships with the project and runs inside the sandbox — and a
  connection string pointing at a public managed database (e.g. Supabase) is allowed too,
  because the sandbox can reach the internet.

The `clawclaw_sites_deploy` tool runs this **pre-check before uploading anything**. An
unsupported project comes back as `{"type":"sites_deploy_unsupported"}` carrying a
ready-to-use `userMessage` (plus an internal `agentGuidance`). When that happens:

- **Relay `userMessage` to the user** — translated into the reply language, keeping every point
  it makes — and then **STOP**. Do not invent a different explanation, and do not read
  `agentGuidance` out to them; that field is instructions for you.
- **NEVER silently fall back to a static placeholder / "project overview" page.** This was the
  #1 complaint: the Skill quietly downgraded a Go/Java project to a static page and the user
  had to cancel. If a static-page downgrade might genuinely help, **ASK the user first** with a
  clear yes/no question (e.g. "Deploying this project directly isn't supported. Do you want me
  to publish a static page showing its structure/docs instead?") and only proceed on explicit
  approval.
- **Never retry to force it through** — not with a different `language`, `installCmd` or
  `startCmd`, and not by stripping the project's database on your own. Switching the storage to
  SQLite or browser-side storage does make such a project publishable, so it is a good thing to
  *propose*, but rewriting someone's project unasked is not.
- If dependency install fails **during** deploy (e.g. a Go project whose modules can't be
  downloaded), report the failure and the likely cause — **do not** switch strategies on your
  own. Suggest concrete fixes (e.g. run `go mod vendor` so deps ship with the source) or ask
  the user how to proceed.
- A project that slips past the pre-check and then fails to start because it cannot reach a
  database is reported the same way (`sites_deploy_unsupported` with a `userMessage`) instead of
  as a raw startup timeout. Relay it and stop; the same no-downgrade, no-retry rules apply.

## Requirements the Project Must Meet

- The service MUST listen on the `PORT` environment variable and bind `0.0.0.0`.
- Pure static / PDF: no hand-rolled fragile server needed — the tool serves it with an
  internal HTTP server (or `python3 -m http.server "$PORT" --bind 0.0.0.0`).
- Vite-based frameworks (Vite / Vue / React / Svelte): the dev/preview server MUST allow the
  reverse-proxy host — set `server.host = "0.0.0.0"` and add the deploy domain to
  `server.allowedHosts` (or `allowedHosts: true`, or `--host 0.0.0.0`), otherwise
  Vite rejects the request with "Blocked request. This host is not allowed."

## How to Deploy

Use the built-in tool `clawclaw_sites_deploy`. It accepts:

- `action` (optional) — `deploy` (default) / `unpublish`.
- `directory` (required) — absolute path to the local project source directory.
- `language` (deploy only) — `node` / `python` / `go` / `static` / `auto` (default `auto`).
- `port` (deploy only) — the single public port (injected as `PORT`), auto-detected or 3000.
- `installCmd` (deploy only) — override the auto-detected install command; empty string skips.
- `startCmd` (deploy only) — override the auto-detected start command; must listen on `$PORT`.
- `entryHtml` (deploy only, static sites) — the entry page of THIS app, relative to `directory`
  (e.g. `b.html`). **Required when the directory holds more than one app** — see
  **Multiple Apps in One Directory** below. Omit it for a single-app directory (auto-detected)
  and for node/python/go projects (their entry is the HTTP root, not a file).
- `appName` (deploy only) — a short human-friendly display name for the app list, which YOU
  summarize from what the app actually is (e.g. 「A股行业轮动监控看板」, 「快速排序可视化」). Keep it
  under ~12 characters, in the user's language. Not the directory name, not the conversation
  title. Always provide it; it falls back to the directory name when omitted.
- `userAskedToPublish` (deploy only) — set to `true` **only** when the user asked to publish in
  their **latest** message. See **Step 0** below.
- `miniProgramRequested` (deploy only) — set to `true` **only** when the user asked for a mini
  program somewhere in this conversation. See **Report result** below.
- `appId` — rarely needed. For `deploy` leave it out entirely (the target comes from `directory`);
  it exists for `action: "unpublish"`, to name which app to take offline when a directory has
  several live apps.

## Workflow

Be **conservative** — only proceed with build/deploy when you have high confidence.

### Step 0: Do you have consent for THIS turn?

Before anything else, check the user's latest message against **Ask Before Deploying** above.

- Asked to publish → pass `userAskedToPublish: true` and continue.
- Did not ask → finish the local work, then ask whether to publish and **stop there**. Continue
  from Step 1 only after they say yes.

This is a gate, not a formality. A conversation that already published once still has to pass it
again before the next deploy.

### Step 1: Identify the deploy target

If the user specified a directory, verify it looks deployable. Otherwise infer the project
root or the relevant build/source directory from the conversation.

The directory is only the upload source. Do not use it to decide whether this is the same app.
The tool's app-selection result controls that decision.

### Step 1.5: Ensure files are written to disk FIRST

Only deploy AFTER every project file has been fully written to the target directory on disk.
The tool compresses and uploads the directory as-is — if you deploy before the code is saved
(or while files are still being written), an empty/partial directory gets uploaded and the
site will be empty/broken. Finish writing all files and confirm they exist under the
directory before calling the tool.

### Step 2: Empty directory → develop first

If the target directory is empty (nothing built yet), the tool returns dev guidance. Do NOT
deploy — develop the project first as a single-port HTTP service, then deploy again.

### Step 3: Deploy

Call `clawclaw_sites_deploy` with the identified directory (plus optional overrides):

```json
{ "directory": "/absolute/path/to/project", "userAskedToPublish": true }
```

The tool probes the project, uploads the source (compressed, excluding `node_modules`/`.git`/
build output), installs dependencies inside the sandbox, starts the server on one port, and
returns the access URL.

Publishing reuses the target app's recorded sandbox when available, so its share link stays the same
and the content behind it is replaced. The app's display name is kept as it is — `appName` only
applies when an app is first created, so re-summarizing it each turn cannot make the name drift.

### Step 4: Report result

A successful deploy returns JSON with `shareLink`, `verified`, `deployedAs` and `manageGuidance`.

- Present the `shareLink` as the **分享链接** to the user.
- Follow `manageGuidance`: right after the link, tell the user in bold where to manage the app they just
  published — 中文用「设置—数据管理—发布的应用」，English uses "Settings - Data Management - Published Apps".
  Say it on every successful deploy, re-publishes included.
- Do NOT mention expiration, spaceKey, data plane URL, webIDE URL, or other internal details.
- If `verified` is `false`, suggest waiting a few seconds and retrying the link.

A mini-program directory returns `sites_miniprogram_app_created` instead — the app was created
(step 1 done) and there is no `shareLink` / `manageGuidance` because a mini program has no URL.
Handle it per **Mini Programs** above: relay its `userMessage` and stop. Do not read the missing
link as a failure.

### The mini program notice is conditional — do not volunteer it

This section is only about **web publishes** (`deployedAs` is `web-page` / `http-service`). If the
directory was a mini-program project, the tool already took the app-creation path above and this
section does not apply — do NOT also relay the notice below.

What a web publish produces is always a web page / HTTP service at a URL, never a mini program.
That fact only needs saying when the user expected a mini program:

- **If the user mentioned 小程序 / 微信小程序 / mini program / miniprogram anywhere in this
  conversation** and what you published is a web page, pass `miniProgramRequested: true`. The result
  then carries a
  `miniProgramNotice` that you MUST relay alongside the link — translated into their language,
  keeping every point it makes. It already contains the accurate wording (the route that works is
  **代码开发 (Coding) → 小程序 (Mini Program)**, which publishes from its own application space;
  the current HTML cannot be converted or reorganized into a mini program; WeChat DevTools cannot
  help because it only opens an existing mini-program project), so do NOT rewrite the explanation
  yourself. In particular, do not turn it into 「小程序发布暂不支持」 or tell the user to upload
  from WeChat DevTools themselves — mini-program publishing is available, just not through this
  web-publish path. This matters most when the artifact was just an `index.html`: without it the user
  is left thinking the publish failed, or that the link somehow *is* the mini program. Never state or
  imply that a mini program was published.
- **Keep passing the flag and keep relaying the notice on re-publishes and content updates** in
  that same conversation. Do NOT drop it because you already said it in an earlier turn — a user
  who republishes still needs to know the new link is a web page, and skipping it the second time
  reads as if the situation changed.
- **If the user never mentioned a mini program, leave the flag out and do not raise the topic at
  all.** No notice, and no unsolicited remark that the link is "a web page, not a mini program".
  Someone who asked for a small game or a dashboard does not need to be told what they did not
  ask about; saying it anyway is noise.

## Important Rules

- Only show the `shareLink`, referred to as **分享链接**. Hide all internal details.
- Be conservative in build attempts — never fabricate or guess build commands. If the setup
  is complex (monorepo, unconventional build), stop and ask the user.
- The tool handles workspace creation, upload, dependency install, server start, and link
  generation internally.
