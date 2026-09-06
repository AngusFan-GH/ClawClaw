# ClawCore 全量迁移清单（Migration Inventory）

- 基线提交：`71747b0919c2520b1409b14c808a44d934946aff`（`feat: migrate desktop runtime to Tauri ClawCore`）
- 工作分支：`clawcore-full-migration`
- 范围：Electron / OpenClaw / Gateway / ClawHub 不得作为任何活跃运行、安装、打包、前端业务或测试依赖。仅保留**只读迁移导入器**（不写入任何第三方运行时配置）。

本文先给出启动路径与打包路径的结论，再逐域枚举引用、入口、处理方式与验证命令。

---

## 1. 启动 / 打包路径核对（结论）

### 1.1 活跃运行路径只能追踪到 ClawCore composition root

```text
src-tauri/src/main.rs                 # Tauri 宿主：spawn node dist-backend/entry.mjs
  └─ backend/entry.ts                 # stdio 换行分隔 JSON 协议
       └─ (dynamic) backend/core/main.ts        # ClawCore composition root（initialize/register/shutdown）
            ├─ backend/host/{desktop,transport,json-store}.ts
            └─ backend/core/{runtime,sqlite-store,run-*,model-adapter,pi-model-adapter,
                             provider-*,cron-*,scheduler,agent-store,skill-store,artifact-store,contracts}.ts
```

- esbuild 打包入口唯一：`scripts/build-backend.mjs` → `backend/entry.ts` → `dist-backend/entry.mjs`（bundle，仅 `node:*` 外置）。运行时可达集 = 从 `entry.ts` 静态/动态可达的文件。
- 审计时活跃可达集为 **20 个文件**（见 §2）；**无任何边**从活跃集进入 `backend/gateway`、`backend/api`、`backend/main`、`backend/services`、`backend/utils`、`backend/shared`。
- 验证命令：

  ```bash
  # 活跃闭包内不得出现对遗留目录的相对导入
  grep -RnE "\.\./(gateway|api|main|services|utils|shared)(/|')" backend/core backend/host backend/entry.ts
  # 期望：无输出
  ```

- 活跃闭包中 `openclaw/gateway/clawhub/electron/18789/127.0.0.1` 仅出现在注释（迁移后注释也清理）。

### 1.2 打包脚本不得有旧 runtime 资源输入

- 当前 `scripts/prepare-tauri.mjs` 会把 `resources/skills`、`resources/icons`、`dist-backend`、**构建机 node** 复制进 `src-tauri/runtime/`；并复制 **uv**（所有平台）和 **Windows Python**（`prepare-tauri.mjs:17-28`）。
- `src-tauri/tauri.conf.json` 以 `"resources": {"runtime/": "runtime/"}` 整体发布；无 `externalBin`/sidecar。
- 目标处理：删除 uv/python 复制与下载脚本（见 §5），runtime 仅保留 `bin/node`、`dist-backend`、`resources/{skills,icons}`。**不发布** OpenClaw / Electron / CLI / plugin mirror。
- 验证命令：

  ```bash
  grep -RniE "uv|python|openclaw|clawhub|electron" scripts/prepare-tauri.mjs   # 期望：仅 node/dist-backend/resources
  grep -RniE "openclaw|gateway|clawhub|electron|18789" dist-backend/entry.mjs # 构建后：无输出（Pi 为唯一模型传输）
  ```

---

## 2. 活跃可达集（20 个文件，迁移中保留并强化）

| 文件 | 角色 | 处置 |
| --- | --- | --- |
| `src-tauri/src/main.rs`, `native.rs` | Tauri 宿主、stdio 桥、`secret:*` keychain、dialog、window、shell | 保留；`gateway:error` 事件名改为中性事件；收紧 native 白名单 |
| `backend/entry.ts` | 协议入口 | 保留 |
| `backend/host/transport.ts` | stdio 帧、nativeRequest、handler 注册、dispatch | 保留；dispatch 增加参数校验/错误码边界 |
| `backend/host/desktop.ts` | app/path/dialog/shell 适配 | 保留 |
| `backend/host/json-store.ts` | 仅设置类 JSON | 保留（仅非秘密设置）；移除 `.pre-tauri.bak` 对含密文件的复制语义 |
| `backend/core/main.ts` | composition root / IPC 注册 | 大幅扩展（channels、validation、memory、tools、artifact 读取等） |
| `backend/core/runtime.ts` | 运行时装配 | 重写（恢复、预算、真实工具、context plan） |
| `backend/core/contracts.ts` | 领域契约 | 扩展（tool invocation、artifact、channel、memory、context plan） |
| `backend/core/run-state.ts` | Run 状态机 | 保留并强化非法转移原子性 |
| `backend/core/run-service.ts` | Run/事件持久化 | 强化（事务、tool invocation、审批人/理由） |
| `backend/core/run-engine.ts` | 单轮执行核 | 强化（预算、异常不悬挂、终态保证） |
| `backend/core/model-adapter.ts` / `pi-model-adapter.ts` | 模型传输抽象 / Pi 实现 | 保留 Pi 仅作传输；实现 ClawCore 自有的工具循环 |
| `backend/core/provider-store.ts` / `provider-resolver.ts` | Provider 元数据 + keychain | **重写**：统一 DB、workspace、`hasSecret`、读回验证迁移、默认唯一、错误码 |
| `backend/core/sqlite-store.ts` | Run/事件/消息表 | **重写为统一数据层 + 幂等迁移**（全实体） |
| `backend/core/{agent,skill,cron,artifact}-store.ts` / `scheduler.ts` | 初版桩 | **重写**为安全、持久化、workspace 隔离实现 |

> `backend/core/in-memory-store.ts` 仅测试引用：保留为测试替身（不作为活跃入口）。

---

## 3. 后端遗留清单（物理删除 / 提取逻辑 / 保留）

> 下列 116 个文件均**不从活跃入口可达**（约 34.5k LOC）。除明确「提取」外一律物理删除；删除后改写引用它们的测试。

### 3.1 整目录删除

- `backend/api/**`（20）：loopback HTTP Host API（`server.ts` 监听 `127.0.0.1:3210`、bearer、CORS `*`）、SSE、全部 routes（含任意 fs 的 `routes/files.ts`、spawn powershell/CLI 的 `settings.ts`、动态加载 OpenClaw dist 的 `sessions.ts:701`、wechat/whatsapp/oauth）。
- `backend/gateway/**`（25）：OpenClaw 子进程监管、`ws://127.0.0.1:<port>/ws`（`ws-client.ts`）、端口扫描 18789–18799、`config-sync.ts` 写 `~/.openclaw/openclaw.json` 且 token 入 argv、`clawhub.ts` spawn CLI、`process-launcher.ts` 全局 fetch 注入。
- `backend/main/**`：`ipc-handlers.ts`（2199，定义 `hostapi:fetch` 任意外发 `:171-192`）、`index.ts`（458，gateway+clawhub+uv+upgrade-maintenance 引导）、`proxy.ts`、`provider-model-sync.ts`、`app-state.ts`、`quit.ts`、`updater.ts`（native 命令在当前 `native.rs` 不存在）。**保留** `host/`（不在该目录）。
- `backend/services/**`（14）：draft/snapshot、ClawX provider 栈、`secrets/secret-store.ts`（**明文 JSON 存密钥**，违规，删除）、`provider-runtime-sync.ts`（934）、`provider-model-catalog.ts`（spawn OpenClaw CLI）、oauth/草稿。
- `backend/utils/**` 中 41 个遗留文件：全部 `openclaw-*`、`device-oauth/gemini-cli-oauth/browser-oauth/device-auth-store/device-identity`、`uv-*`、`wechat-*`、`whatsapp-login`、`bundled-plugin-installer`、`plugin-sdk-compat`、`channel-config/channel-alias`、`agent-config/skill-config/skill-list/skill-metadata`、`secure-storage/provider-keys/provider-registry`、`proxy/proxy-fetch/openclaw-proxy/openrouter-headers-preload.cjs`、`token-usage*/`、`upgrade-maintenance`、`store/config/paths/logger`、`session-util`、`config.ts`（端口探测）。

### 3.2 提取/复用（迁入 core 或 src，脱离 gateway/network/明文）

| 来源 | 复用内容 | 目标 |
| --- | --- | --- |
| `backend/shared/providers/registry.ts`（402，纯） | vendor 预设（baseUrl、默认 authMode、协议、模型） | `backend/core/provider-catalog.ts`（剔除 localhost 预设或标注 local） |
| `backend/shared/providers/types.ts`（209，纯） | provider 类型/常量 | 合并进 core 契约 |
| `services/providers/provider-validation.ts` | `maskSecret`、URL/profile 归一化 | core `provider-validation.ts`（网络层重写：仅打用户 endpoint，稳定错误码） |
| `services/providers/local-model-presets.ts` | 只读预设 JSON 加载 | core catalog（去掉 `GatewayManager`/sync） |
| `utils/skill-metadata.ts` | SKILL.md 解析 | core skill-store（强化 manifest 校验/逃逸防护） |
| `src/shared/security-policy.ts` | 策略模型 | core tool approval policy（去掉 denyGateway 等旧规则） |
| `utils/win-shell.ts`、`utils/fs-path.ts` | 纯平台工具 | 如需要再迁；当前无活跃消费者 |

### 3.3 关键 token 引用枚举（节点：处理方式）

- `electron`：`backend/` 下 **0** 处运行引用（残留仅 `.github/workflows/check.yml` 的 `ELECTRON_SKIP_BINARY_DOWNLOAD`、release.yml、`.env.example`）→ 删除/改写。
- `openclaw`/`gateway`/`clawhub`：集中于 §3.1 全删目录；活跃闭包仅注释。`clawhub` npm 包（`package.json` 依赖）无任何 src/backend 直接 import，仅 `gateway/clawhub.ts` 与 `/api/clawhub/*` 使用 → 删依赖。
- `hostApiFetch`：仅前端 `src/lib/host-api.ts:128`（`hostapi:fetch`）→ 删除（见 §4）。后端 `hostapi:fetch` 定义在待删 `main/ipc-handlers.ts`。
- `127.0.0.1`/`18789`/`ws://`：后端仅待删 api/gateway；前端仅 `host-api.ts:32`(3210) 与设置默认值/文案。模型 provider 的 localhost/local endpoint 是用户配置，保留但仅在显式 Channel/Provider service 使用。
- `child_process/spawn/exec`：活跃 Node 代码 **0**（宿主 Rust spawn node 除外，native.rs 的 explorer/open 为受控命令）。违规点全部在待删文件。
- wechat/whatsapp/QR/OAuth：后端待删 utils/api；前端 Channels/Setup/ProvidersSettings/Skills/Dreams → 删除 QR/OAuth 调用，未实现能力显式标注「未支持」。

---

## 4. 前端清单（`src/`）

现状：渲染层**无任何直接网络 I/O**（无 fetch/WebSocket/EventSource/XHR），全部经 Tauri IPC（`src/lib/desktop.ts` 仅此处 import `@tauri-apps/*`）。迁移是「删旧 + 全量接到 core」。

### 4.1 物理删除

- stores：`gateway.ts`（816）、`runtime-apply.ts`、`chat/history-transcript-fallback.ts`（及仅其消费的 `hydrate/merge/types` 死支）。
- lib：`host-api.ts`（`hostApiFetch`/3210）、`gateway-recovery.ts`、`gateway-lifecycle-presentation.ts`、`gateway-connect-error.ts`、`use-gateway-page-refresh.ts`、`channel-alias.ts`、`channel-runtime-status.ts`。
- components：`common/GatewayLifecycle{Banner,Overlay}.tsx`、`common/RuntimeApplyBanner.tsx`、channels 旧 QR 组件。
- pages：`pages/Dreams/`（OpenClaw doctor/control-ui）。
- types：`types/gateway.ts`；精简 `types/agent.ts`（去 gateway/local 双形）、`types/channel.ts`（去 QR/OAuth 字段）、`types/skill.ts`（去 loadedInGateway）。
- `pages/Chat/openclaw-command-catalog.generated.ts`（913）。
- 全局清理：`App.tsx`/`MainLayout.tsx`/`Sidebar.tsx` 中 `useGatewayStore`、lifecycle overlay、gateway 状态徽标与「running 才恢复会话」门禁；`lib/host-events.ts` 中 `gateway:*`/`oauth:*`/`channel:*-qr` 映射。

### 4.2 重写/接到 ClawCore

- Chat（`stores/chat.ts` 5096 行 + `pages/Chat/*`）：以 `core:conversation:*` / `core:run:*` 事件游标为**唯一数据源**。物理删除 gateway send/history/queue/transcript/steer/compact/BTW 分支与 `if (true)`（`chat.ts:4098`）；删除发送前的 `sessions.patch` RPC（`:3275,3893`）。会话列表稳定 cursor 分页、发送/停止/流式/事件补齐/刷新恢复/附件/审批。
- 工具审批：删除唯一的 `window.confirm`（`chat.ts:4113-4117`），实现正式审批 UI（待处理列表、名称、风险、参数摘要、批准/拒绝/理由、幂等）。
- Providers/Models：账号已基本走 `provider:*` IPC；删除 `/api/provider-model-options`、runtime-apply、usage 旧仪表盘、OAuth device/browser；OAuth 显示「未支持」；新增 `provider:validate`。
- Agents：已走 `agent:*`；去 gateway 徽标/refresh/workspace 概念；补 system prompt、provider/model override、tool/memory/budget policy、绑定、默认保护、Run 配置快照。
- Skills：已走 `skill:*`；去 ClawHub 外链/`/api/clawhub/open-readme`/gateway 门禁；改称「本地技能库」；manifest 校验、配置、Agent 关联，instruction 真实进入 context plan。
- Cron：接 `cron:*`；删除 `/api/channels/targets`、`/api/cron/session-history`、runtime/gateway 门禁；channel delivery 仅在 core 支持时保留。
- Channels：以新建 `channel:*` core API 重做账户/适配器；提供一个真实可测本地/token-webhook 适配器；QR/OAuth（wechat/whatsapp）禁用并标注未支持。
- Setup/Settings/Security：Setup 去掉 OpenClaw/uv/gateway 安装步，引导到 Provider 配置；Settings 去 gateway/代理/CLI/doctor/control-ui/logs/dreaming/backup(旧)；Security 收敛为 core 工具策略展示；空 Provider/keychain 失败/等待审批给本地化可行动反馈。
- Update：移除旧 updater IPC（无 native 实现）或在真正实现前从导航/设置移除入口。

### 4.3 i18n / 文档

- 3 语言各 10 个命名空间（共约 6.8k 行）：删除 `dreams.*`、common/settings 中 `gateway.*`、setup `runtime.*`、channels QR、各处 `gatewayWarning`；新增 core 审批/channel/artifact/memory/setup 文案。
- `CLAUDE.md`、`AGENTS.md`、`README{,.zh-CN,.ja-JP}.md`、架构图、命令全部改为 ClawCore/Tauri 描述，与 `package.json`/tauri 配置/bundle 一致。
- 验证：`grep -RniE "hostApiFetch|useGatewayStore|openclaw|clawhub|gateway:|18789|127\.0\.0\.1:3210" src` → 除迁移文档/只读导入器外无匹配。

---

## 5. 打包 / 依赖 / CI 清单

- 删除脚本：`download-bundled-uv.mjs`、`download-bundled-python.mjs`、`crop_qr.py`；`download-bundled-node.mjs` 改为 prepare-tauri 真正消费（可复现）或保留「复制构建机 node」并文档化。
- `prepare-tauri.mjs`：去 uv/python（`:17-28`）；仅 dist-backend + resources(skills/icons) + node。
- `package.json`：去依赖 `clawhub`、`ws`（若 pi-ai/openai 非 realtime 可去）、`undici`、`tar`；devDeps 去 `zx`（下载脚本）、`@types/ws`；脚本去 `init` 中 `uv:download`、`uv:download*`、`python:download:win`；`dev` 不再拉起 gateway（本就由 tauri 启动 node）。
- `pnpm-workspace.yaml`：删占位 `allowBuilds`（openclaw/tree-sitter-bash 等）与不存在的 `packages/*`；保留 onlyBuiltDependencies=esbuild。
- `.env.example`：删 OpenClaw/electron-builder 变量。
- CI：重写 `.github/workflows/release.yml`（当前引用不存在的 package 脚本与 electron-updater 产物）；`check.yml` 去 `ELECTRON_SKIP_BINARY_DOWNLOAD`，统一 Node 版本（node:sqlite 需 Node ≥22.5；release 不得固定 Node 20），build job 增加 backend build + smoke + cargo check。
- resources：删 `resources/context`（OpenClaw 品牌系统提示，无消费者）、`resources/scripts/*`、`resources/skills/bundles.json`、`resources/skills/README.md`(openclaw 路径)、根 `skills-lock.json`（无消费者）、`src/assets/community/*` 二维码；保留 icons 与 skills 数据（重写 README，不随附 python 运行时；python 脚本为惰性技能资产，不被执行）。
- 安全事故：`config/local-model-presets.json` 提交了**明文 API key**（`:9,:18`）→ 删除该文件/脱敏（legacy-only 消费者随 services 删除）。
- 根 `test-anthropic*.js` 临时脚本删除。
- 新增 ESLint 边界：禁止 `backend/core` 导入 gateway/api/utils；前端禁止 gateway/hostApiFetch/直接 loopback。

---

## 6. 密钥/网络/越权审计（红线）

- 正确 sink（保留）：`secret:set/get/delete` → `src-tauri/src/native.rs:72-87` keyring（service `app.clawclaw.desktop`）。当前 account=`provider:<id>`，目标 `provider:<workspaceId>:<providerId>`，channel 用 `channel:<workspaceId>:<accountId>`。
- 违规明文 sink（全部随 §3 删除）：`services/secrets/secret-store.ts`、`utils/secure-storage.ts`、`device-auth-store.ts`、`~/.openclaw/**` 系列、gateway token 入 argv/control-ui URL。
- 活跃迁移债（本迁移修）：`core_providers.api_key` 明文字列（读→写 keychain→**读回验证**→事务清空；最终移除列）；`hasApiKey` 不得因残留明文误报；`json-store` 的 `.pre-tauri.bak` 不复制含密文件；keychain 缺失/拒绝/NoEntry 返回可行动错误码。
- 活跃越权面（本迁移修）：`core/artifact-store.ts:8` `stagePaths` 对任意渲染端绝对路径 `copyFileSync` → 限定 dialog 选择/白名单、canonical 校验、workspace 隔离、MIME/大小限制。
- 网络：活跃 Node 仅 Pi 模型传输（用户配置 endpoint）。新规则：工具无网络；仅 Channel service 可网络且只能用账户配置 endpoint；Provider 校验只打用户 endpoint。
- 唯一数据库连接：当前各 store 各自 `new DatabaseSync`，无法跨表事务 → 统一为单连接 + 幂等 migration（所有实体 `id/created_at/updated_at`，跨表写事务）。

---

## 7. 验证命令（迁移完成后必须全过）

```bash
# 1) 后端活跃闭包无遗留导入 / 无旧 runtime 标识（README/docs 除外）
grep -RnE "\.\./(gateway|api|main|services|utils|shared)(/|')" backend/core backend/host backend/entry.ts
grep -RniE "openclaw|clawhub|electron|18789|hostapi:|child_process" backend/
# 2) 前端无活跃旧通道
grep -RniE "hostApiFetch|useGatewayStore|gateway:|clawhub|openclaw|18789|127\.0\.0\.1:3210" src/
# 3) 打包产物不携带旧 runtime
node scripts/build-backend.mjs && grep -c -iE "openclaw|gateway|clawhub" dist-backend/entry.mjs   # 期望 0
grep -RniE "uv|python3?|openclaw|clawhub|electron" scripts/prepare-tauri.mjs                     # 期望无旧 runtime
# 4) 密钥不落库：schema 无 *_key/secret 明文列，smoke 断言 sqlite 内无 sk-
node scripts/smoke-backend.mjs
# 5) 全量门禁
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm run typecheck
corepack pnpm run build:vite
corepack pnpm run build:backend
cargo check --manifest-path src-tauri/Cargo.toml
corepack pnpm run release:check
```

## 8. 执行顺序

1. 统一 SQLite 数据层 + 幂等迁移 + IPC 校验/错误码骨架（不动 UI 亦可测试）。
2. Provider/keychain/workspace/默认唯一/验证；只读旧 JSON 导入器（读入即迁 keychain）。
3. Run/工具/恢复/预算 + 持久化 tool invocation + 真实 3 个受限工具 + context plan/memory(FTS5)/summary。
4. Agents/Skills/Artifacts 强化；Channels 契约 + 本地适配器 + inbound。
5. Cron 解析/时区/持久 fire cursor/重入。
6. 物理删除遗留后端与前端，Chat/审批/Setup/Settings/Models/Cron/Skills/Channels 收敛。
7. i18n/README/CI/打包/依赖清理；测试按当前功能重写；release gate；完成报告。
