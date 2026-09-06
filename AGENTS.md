# Working in this repository

- The active backend is **ClawCore** under `backend/core/`. Do not reintroduce OpenClaw/Gateway/Host-API/ClawHub modules.
- Renderer code reaches the backend only through typed channels in `src/lib/api.ts`. ESLint (`eslint.config.mjs`) bans renderer `fetch`/`WebSocket`, legacy imports and `alert/confirm`.
- Tests live in `tests/unit/`; node-environment tests use a temporary data dir and `FakeSecretBridge`. Do not read real keychain or user data.
- After changing IPC channels, update `backend/core/main.ts`, `src/lib/api.ts`, i18n and the smoke test together.
- Run `pnpm run release:check` before handing off.
