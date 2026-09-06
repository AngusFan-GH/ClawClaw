# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

ClawClaw is a cross-platform Tauri desktop app (React 19 + Vite + TypeScript + Rust) providing a GUI for the OpenClaw AI agent runtime. It uses pnpm as its package manager.

## Dev Commands

| Task | Command |
|------|---------|
| Install deps + download uv | `pnpm run init` |
| Dev server (Vite + Tauri) | `pnpm dev` |
| Lint (ESLint, auto-fix) | `pnpm run lint` |
| Type check | `pnpm run typecheck` |
| Unit tests (Vitest) | `pnpm test` |
| Build frontend only | `pnpm run build:vite` |
| Full production build | `pnpm run build` |

**pnpm version**: The exact pnpm version is pinned via `packageManager` in `package.json`. Use `corepack enable && corepack prepare` to activate it before installing.

## Architecture

### Dual-Process Layout
- `src-tauri/` — Tauri native host (window/tray/menu management and Node backend lifecycle)
- `backend/` — Node backend (Host API handlers and Gateway lifecycle)
- `src/` — React renderer process (UI, Zustand stores, API client)

### Renderer/Main API Boundary (enforced by ESLint)
- Renderer **must** use `src/lib/host-api.ts` and `src/lib/api-client.ts` as the single entry for backend calls.
- Do **not** add direct Tauri `invoke(...)` calls in pages/components; expose them through host-api/api-client.
- Do **not** call Gateway HTTP endpoints (`http://127.0.0.1:18789/...`) directly from renderer. Use Main-process proxy channels (`hostapi:fetch`, `gateway:httpProxy`) to avoid CORS issues.
- Transport policy is Main-owned (`WS -> HTTP -> IPC fallback`); renderer should not implement protocol switching.

### State Management
Zustand stores in `src/stores/`: `agents.ts`, `chat.ts`, `channels.ts`, `cron.ts`, `skills.ts`, `providers.ts`, `settings.ts`, `gateway.ts`, `update.ts`.

### Main Process API Routes
Route modules under `backend/api/routes/`: `/app`, `/channels`, `/logs`, `/providers`, `/settings`, `/usage`.

### Gateway Process
OpenClaw Gateway runs as a supervised subprocess (port 18789). Lifecycle is managed by `backend/gateway/`. It takes ~10–30s to start; the app works without it (shows "connecting" state).

### Storage
JSON settings files + OS keychain. No database.

## Key Caveats

- **Gateway startup**: Not required for UI development. App functions without it.
- **Build warnings**: `pnpm install` may warn about `@discordjs/opus` and `koffi`. These are optional messaging-channel deps — safe to ignore.
- **Lint after uv:download**: ESLint may fail with `ENOENT` temp directory race if run right after `pnpm run uv:download`. Re-run lint after the download script finishes.
- **Doc sync**: After architecture/functional changes, update `README.md`, `README.zh-CN.md`, and `README.ja-JP.md` in the same PR.
