# ClawClaw

Cross-platform Tauri desktop app hosting a **local ClawCore agent**. ClawCore owns state, context, tools, the model transport (Pi @earendil-works/pi-ai), budgets, persistence (`node:sqlite`), the keychain, channels, skills and cron. There is no Electron, OpenClaw, Gateway or ClawHub dependency.

## Commands

| Task | Command |
|------|---------|
| Install | `corepack pnpm install --frozen-lockfile` (Node >= 22.5; needs `node:sqlite`) |
| Type check | `pnpm run typecheck` |
| Unit tests | `pnpm test` (Vitest; backend tests use `// @vitest-environment node`) |
| Renderer build | `pnpm run build:vite` |
| Backend build | `pnpm run build:backend` (esbuild → `dist-backend/entry.mjs`) |
| Standalone smoke | `pnpm run smoke` (temp dir, fake keychain) |
| Full gate | `pnpm run release:check` (typecheck → tests → vite → backend → smoke → cargo check) |
| Dev | `pnpm dev` (Tauri) / `pnpm dev:web` (renderer only) |

## Architecture

- Tauri host (`src-tauri/src/main.rs`) spawns Node and bridges stdio JSON frames + `secret:*` (OS keyring) + dialog/shell.
- Active entry: `backend/entry.ts` → `backend/core/main.ts` (validated command registry) → `backend/core/runtime.ts` (composition root).
- SQLite: one connection in `backend/core/db/`; idempotent schema/migrations in `db/schema.ts`; legacy 0.1.x tables are reconciled read-only and plaintext provider keys are migrated to the keychain (write → readback → delete → VACUUM).
- Renderer boundary: the ONLY backend entry is `src/lib/ipc.ts`/`api.ts` (explicit `namespace:action` channels). No loopback HTTP, no `fetch`/WebSocket, no `window.confirm`.

## Rules

- Credentials: keychain only (`provider:<ws>:<id>`, `channel:<ws>:<id>`), SQLite stores non-secrets.
- Tools: versioned JSON schema → policy → approval; low-risk runs auto, file/network tools require explicit user approval; never execute twice.
- Channels may make outbound calls only to their configured endpoint; QR/OAuth adapters register as unsupported.
- Keep docs/i18n (en/zh/ja) in sync with real behavior; never add early-returns that fake completion.
