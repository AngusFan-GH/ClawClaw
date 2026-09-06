# ClawCore 全量迁移完成报告

基线：`71747b0`。范围：Electron / OpenClaw / Gateway / ClawHub 全量迁移到 Tauri + 本地 ClawCore。

## 1. 删除的遗留运行时

| 区域 | 删除内容 |
| --- | --- |
| 后端 | `backend/api/**`（loopback HTTP/Host API、SSE、任意 fs/zip）、`backend/gateway/**`（OpenClaw 子进程、ws-client、clawhub.ts、config-sync、process-launcher、supervisor）、`backend/main/**`（2199 行旧 IPC、hostapi:fetch、proxy）、`backend/services/**`（明文 JSON 密钥服务、draft 会话、ClawHub sync）、`backend/shared/**`、`backend/utils/**`（uv/device-oauth/channel-config 等）、旧 `sqlite-store.ts`、`host/auth.ts`、`vendor.d.ts` |
| 前端 | `src/stores/{gateway,runtime-apply,update}.ts`、旧 5096 行 `chat.ts` 与全部 legacy `stores/*`、`src/lib/{host-api,host-events,api-client,provider-*,channel-*,gateway-*}.ts`、旧 `pages/{Setup,Dreams,Security,Reminders,Chat}`、`components/{channels,common(Gateway/Runtime banners),layout,settings}`、`types/channel.ts`、`shared/security-policy.ts` |
| 包/脚本 | npm 依赖 `clawhub`、`ws`、`undici`、`tar`、`ms`；`scripts/download-bundled-{uv,python,node}.mjs`、`crop_qr.py`；`resources/context`、`resources/scripts`、OpenClaw/Python 技能（替换为 2 个纯 Markdown 技能）；`skills-lock.json`、含泄露 key 的 `config/local-model-presets.json`、根测试脚本、二维码资源 |
| 打包 | `prepare-tauri.mjs` 移除 uv/python 注入，仅保留 `dist-backend` + `resources/{skills,icons}` + `bin/node`；CI 重写（去 ELECTRON env / electron release pipeline） |

## 2. 新架构（活跃入口）

`backend/entry.ts` → stdio JSON 帧 → `backend/core/main.ts`（参数校验 + 白名单命令注册表）→ `runtime.ts`（组合根，单一 SQLite 连接 + 钥匙串 + 各子系统）。

- **数据**：`db/database.ts`（幂等 migration）、`db/schema.ts`（canonical 表 + 旧 0.1.x 只读 reconcile）。所有实体 `id/created_at/updated_at`，工作区隔离，跨表写入使用同一连接的 SAVEPOINT 事务。
- **凭据**：`secrets/keychain.ts`（写入→读回比对→失败清理）、`native/secret-bridge.ts`（可注入 fake 供测试）。账号命名 `provider:<ws>:<id>`、`channel:<ws>:<id>`。
- **Provider/Agent/Skill/Artifact/Channel/Cron/Memory/Run** 各自独立模块；模型传输仅 `pi-model-adapter.ts`（Pi）。
- **工具**：版本化注册表 + JSON Schema；`core.time.getCurrentTime`（low/auto）、`core.artifact.readText`、`core.fs.listDirectory`（medium/always，canonical 路径校验、字节上限）。未知/越权/参数非法一律拒绝且不执行。
- **渠道**：真实 token/Webhook 适配器（GET 探活 + POST 投递），WeChat/WhatsApp 注册为 unsupported（UI 如实禁用）。
- **调度**：5 字段解析器、IANA 时区、`(jobId,scheduledAt)` 持久游标、单实例 tick、停机不补跑、终态后投递且失败隔离。

## 3. 密钥迁移（安全闭环）

旧明文 `api_key` 仅在首次启动时被读入私有暂存表 `core_secret_migration`（规范实体表不含可逆密钥列）；迁移 = 钥匙串写入成功且读回一致后删除暂存行，并执行 `wal_checkpoint(TRUNCATE); VACUUM; wal_checkpoint`。验证：迁移后直接读取 `clawcore.sqlite` 字节不含原明文；钥匙串拒绝/读回不一致时 `hasSecret` 保持 false、暂存保留但任何 IPC 不返回。

## 4. 前端

`src/lib/{ipc,api,types}.ts` 为唯一后端入口（显式 `namespace:action`）。新页面：Chat（游标分页、流式、拖拽/粘贴/选择器附件、**正式审批卡片**，无 `window.confirm`）、Providers（CRUD、密钥、验证、默认/启用）、Agents（提示词、覆盖、预算、绑定）、Skills（本地库、启停、文件夹安装、内置保护）、Channels（webhook + 不支持标识 + 入站模拟）、Cron、Settings。i18n 精简为 en/zh/ja 单命名空间，键与功能一致。

## 5. 测试矩阵

`pnpm test`：**81 passed (11 files)**。

- Core Run/状态机/工具循环/审批执行一次/拒绝/重启恢复/预算：`core-run-runtime`
- Provider 与钥匙串（读回、拒绝、默认唯一、稳定错误码）：`core-provider`
- Artifact 与受限工具（MIME/大小/符号链接/逃逸/像素）：`core-artifact-tool`
- Cron 解析与持久游标：`core-cron`
- Channel webhook/入站幂等/路由/删号解绑：`core-channel`
- Agent/Skill（manifest、symlink 逃逸、bundled 保护）：`core-agent-skill`
- FTS 记忆、摘要游标、context plan 裁剪审计：`core-memory-context`
- 旧库 reconcile + 密钥暂存/VACUUM/幂等：`core-database-migration`
- 前端：IPC 错误码、API 仅走 core 通道、安全 markdown（3 文件 11 测试）
- 独立冒烟：`scripts/smoke-backend.mjs`（临时目录、假钥匙串，20 项断言，验证 SQLite 不含 channel secret）。

## 6. 打包与门禁

- `build:backend`（esbuild 单文件 5.6 MB，包含 Pi 与其模型 SDK）、`build:vite`、`smoke` 均绿；bundle 中无 `openclaw/clawhub/hostapi/18789`。bundle 出现的 `gateway` 字样仅来自 Pi SDK 内置的 Cloudflare AI Gateway 模型提供方，非本应用运行时。
- `release:check` 顺序：typecheck → vitest → vite build → backend build → smoke → cargo check。
- ESLint 边界：渲染端禁止裸 `fetch`/`WebSocket`、`alert/confirm`，仅 `src/lib/desktop.ts` 可引用 Tauri bridge，禁止 host-api/gateway 旧模块导入。当前 0 error。

## 7. 已知限制 / 刻意取舍

- 模型真实联调需用户自带 Key（CI/测试使用脚本化 ModelAdapter，不触网）。
- 摘要由同默认模型在超阈值时生成；失败时保留原文为唯一事实来源，绝不字符串截断。
- Webhook 适配器对 GET 探活宽松（404/405 可接受），send 仅 POST 配置端点。
- `@earendil-works/pi-ai` 内置多家云模型 SDK 使 bundle 偏大；未做分包（不影响安全边界）。
