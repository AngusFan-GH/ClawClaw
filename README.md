# ClawClaw

A cross-platform desktop AI agent built on **Tauri + a local ClawCore runtime (Node)**.

ClawCore owns the agent loop, context, tools, budgets, persistence and scheduling.
It talks to model providers directly through the Pi transport; model keys live in
the OS keychain. There is no bundled OpenClaw/Gateway/ClawHub runtime and no local
HTTP proxy — the renderer talks to the backend over an allowlisted Tauri IPC surface.

## Features

- Local-first runs persisted in SQLite (`node:sqlite`) with an immutable event log
- Provider accounts with OS-keychain secrets, per-workspace default and one-click validation
- Agents with system prompt, provider/model override, tool policy and budgets
- Versioned, permissioned tools: `core.time.getCurrentTime` (auto) and workspace-scoped
  `core.artifact.readText` / `core.fs.listDirectory` (approval required)
- Local skill library (bundled read-only + installed from a folder), no remote marketplace
- Channel accounts: a real token/webhook adapter for outbound delivery and inbound
  routing; WeChat/WhatsApp QR/OAuth are shown as unsupported (never faked)
- Five-field cron (IANA timezone) with a durable fire cursor — no replay after downtime
- Artifact staging with size/MIME/path-escape controls and image pixel cap
- Conversation summaries (exact source cursor) and FTS5 keyword memory, workspace-isolated

## Develop

```bash
corepack pnpm install --frozen-lockfile   # Node >= 22.5
pnpm run typecheck
pnpm test
pnpm run build:backend && pnpm run smoke
pnpm run build:vite
pnpm dev
```

`pnpm run release:check` runs the full ordered gate (typecheck, tests, both builds,
standalone smoke, cargo check).

## Architecture

```
React renderer
   └─ src/lib/ipc.ts → Tauri host_request (explicit channels, no network)
Tauri host (src-tauri) ── stdio frames ── Node ClawCore (backend/core)
                                              ├─ SQLite (single connection)
                                              ├─ OS keychain (secret:*)
                                              ├─ Pi model transport
                                              └─ tools / skills / channels / cron
```

Security boundaries and data flows are documented in
[`docs/migration-inventory.md`](docs/migration-inventory.md) and
[`docs/migration-completion-report.md`](docs/migration-completion-report.md).

## License

MIT
