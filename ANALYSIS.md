# ClawClaw 项目详细分析

> **ClawClaw** — 基于 OpenClaw 的跨平台 Electron 桌面 AI 助手
> **技术栈**: Electron 40+ / React 19 / Vite / TypeScript / Zustand / Tailwind CSS / pnpm
> **版本**: 基于最新代码（2026-04-16）
> **仓库**: `/Volumes/ISANSTAN/xzinfra/projects/clawx`

---

## 一、项目定位与概述

ClawClaw 是一个跨平台 Electron 桌面应用，为 OpenClaw AI Agent 运行时提供图形化界面。它是 **OpenClaw 的官方桌面客户端**（类似 ClawX，但由不同团队维护或为分支版本），旨在让非技术用户也能方便地：

- 配置 AI 模型提供商（OpenAI、Anthropic、Google 等）
- 管理消息渠道（Telegram、Discord、WhatsApp、微信等）
- 使用聊天界面与 Agent 交互
- 管理 Skills（技能扩展）
- 配置定时任务（Cron）
- 监控 Token 使用量
- 管理安全策略

**核心设计理念**：
- 双进程架构（Electron 主进程 + React 渲染进程）
- 严格的前后端通信边界（通过 IPC + Host API）
- 支持便携模式（Portable Mode）
- 完整的 Gateway 生命周期管理
- 多语言界面（英文/中文/日语）

---

## 二、顶层目录结构

```
clawx/
├── electron/                   # ★ Electron 主进程（Node.js/TypeScript）
│   ├── main/                   # 主进程核心模块
│   │   ├── index.ts            # 主进程入口（应用生命周期管理）
│   │   ├── ipc-handlers.ts     # IPC 处理函数注册表
│   │   ├── menu.ts             # 应用菜单配置
│   │   ├── tray.ts             # 系统托盘
│   │   ├── window.ts           # 窗口管理
│   │   ├── updater.ts          # 自动更新（electron-updater）
│   │   ├── app-state.ts        # 应用状态（isQuitting 标志）
│   │   ├── quit.ts             # 退出/重启逻辑
│   │   ├── proxy.ts            # 代理设置
│   │   └── provider-model-sync.ts  # 模型同步
│   ├── api/                   # ★ Host API 服务器（HTTP，端口 3210）
│   │   ├── server.ts           # HTTP 服务器主入口
│   │   ├── context.ts          # Host API 上下文类型
│   │   ├── event-bus.ts        # 事件总线（HostEventBus）
│   │   ├── gateway-lifecycle.ts # Gateway 生命周期事件分发
│   │   ├── gateway-refresh.ts  # Gateway 刷新编排器
│   │   ├── route-utils.ts      # 路由工具（parseJsonBody、sendJson）
│   │   └── routes/            # 各业务路由处理器
│   │       ├── app.ts          # /api/app — 应用信息
│   │       ├── gateway.ts      # /api/gateway — Gateway 状态代理
│   │       ├── settings.ts     # /api/settings — 设置读写
│   │       ├── providers.ts    # /api/providers — AI 提供商
│   │       ├── agents.ts       # /api/agents — Agent 配置
│   │       ├── channels.ts     # /api/channels — 渠道管理
│   │       ├── skills.ts       # /api/skills — Skill 管理
│   │       ├── cron.ts         # /api/cron — 定时任务
│   │       ├── logs.ts         # /api/logs — 日志读取
│   │       ├── usage.ts        # /api/usage — Token 使用量
│   │       ├── security.ts     # /api/security — 安全策略
│   │       ├── files.ts        # /api/files — 文件操作
│   │       └── sessions.ts     # /api/sessions — 会话管理
│   ├── gateway/               # ★★★ Gateway 进程管理（核心）
│   │   ├── manager.ts         # GatewayManager — 主控制器
│   │   ├── lifecycle-controller.ts  # 生命周期阶段控制
│   │   ├── restart-controller.ts   # 重启队列与防抖
│   │   ├── restart-governor.ts      # 重启节流Governor（断路器）
│   │   ├── startup-orchestrator.ts  # 启动序列编排器
│   │   ├── startup-preflight.ts     # 启动前检查（Python、配置等）
│   │   ├── startup-recovery.ts      # 启动失败恢复策略
│   │   ├── startup-stderr.ts         # stderr 行分类与记录
│   │   ├── supervisor.ts       # 进程监督（查找、终止、清理）
│   │   ├── process-launcher.ts # 进程启动（spawn 配置）
│   │   ├── process-policy.ts  # 重连策略（指数退避）
│   │   ├── ws-client.ts       # WebSocket 客户端（Gateway 连接）
│   │   ├── protocol.ts        # OpenClaw 协议格式定义
│   │   ├── request-store.ts   # _pendingRequests Map
│   │   ├── event-dispatch.ts   # 协议事件分发到 chat store
│   │   ├── state.ts           # GatewayStateController
│   │   ├── connection-monitor.ts # 连接监控（ping/pong）
│   │   ├── config-sync.ts     # 配置同步（provider/workspace）
│   │   ├── apply-coordinator.ts # 配置变更时的刷新协调器
│   │   ├── clawhub.ts         # ClawHub Skill 市场客户端
│   │   ├── client.ts          # Gateway 客户端工具
│   │   └── ...
│   ├── preload/               # ★ 预加载脚本
│   │   └── index.ts           # contextBridge API 暴露（白名单 IPC）
│   ├── services/             # 主进程服务层
│   │   ├── providers/         # 模型提供者服务
│   │   │   ├── provider-service.ts   # 提供者 CRUD 服务
│   │   │   ├── provider-store.ts     # electron-store 持久化
│   │   │   ├── provider-runtime-sync.ts # 同步到 Gateway 运行时
│   │   │   ├── provider-validation.ts  # API Key 验证
│   │   │   ├── provider-migration.ts  # 配置迁移
│   │   │   ├── store-instance.ts      # 单例
│   │   │   └── local-model-presets.ts # 本地模型预设
│   │   └── secrets/           # 密钥服务
│   │       └── secret-store.ts # OS Keychain 集成
│   ├── shared/               # 跨进程共享
│   │   ├── providers/         # 提供者类型定义
│   │   │   ├── types.ts        # ProviderConfig 等类型
│   │   │   └── registry.ts     # 提供者注册表
│   │   ├── reminders.ts       # 提醒类型
│   │   ├── security-policy.ts # 安全策略定义
│   │   └── update-feed.ts     # 更新源
│   └── utils/                 # 工具函数（~50 个文件）
│       ├── logger.ts          # 日志系统（electron-log）
│       ├── store.ts           # electron-store 封装
│       ├── config.ts          # 端口常量（18789、3210 等）
│       ├── paths.ts           # 路径解析（数据目录、配置目录等）
│       ├── openclaw-cli.ts    # OpenClaw CLI 调用封装
│       ├── openclaw-config.ts # openclaw.json 读写/修复
│       ├── openclaw-workspace.ts # workspace bootstrap 文件
│       ├── openclaw-doctor.ts  # openclaw doctor 命令调用
│       ├── openclaw-auth.ts    # OpenClaw 认证
│       ├── openclaw-proxy.ts   # OpenClaw 代理设置
│       ├── openclaw-control-ui.ts # Gateway 控制 UI URL
│       ├── uv-setup.ts         # Python uv 环境管理
│       ├── uv-env.ts          # uv 环境优化
│       ├── skill-config.ts    # Skill 配置管理
│       ├── skill-list.ts      # Skill 列表
│       ├── skill-metadata.ts  # Skill 元数据
│       ├── provider-registry.ts # 提供者注册表
│       ├── provider-keys.ts   # API Key 管理
│       ├── agent-config.ts    # Agent 配置
│       ├── channel-config.ts  # 渠道配置
│       ├── channel-alias.ts   # 渠道别名
│       ├── device-identity.ts  # 设备身份（JWT）
│       ├── device-auth-store.ts # 设备认证存储
│       ├── device-oauth.ts    # 设备 OAuth 流程
│       ├── browser-oauth.ts   # 浏览器 OAuth 流程
│       ├── secure-storage.ts   # 安全存储（Keychain）
│       ├── token-usage.ts     # Token 使用量
│       ├── token-usage-core.ts # Token 使用量核心逻辑
│       ├── wechat-login.ts    # 微信登录
│       ├── whatsapp-login.ts  # WhatsApp 登录
│       ├── wechat-installer.ts # 微信安装
│       ├── gemini-cli-oauth.ts # Gemini CLI OAuth
│       ├── bundled-plugin-installer.ts # 捆绑插件安装
│       ├── upgrade-maintenance.ts # 升级维护
│       ├── proxy.ts           # 代理配置
│       ├── proxy-fetch.ts     # 代理感知的 fetch
│       └── ...
│
├── src/                      # ★★★ React 渲染进程
│   ├── main.tsx              # React 入口
│   ├── App.tsx               # 根组件 + 路由配置
│   ├── pages/                # 页面组件
│   │   ├── Chat/              # 聊天页面
│   │   │   ├── index.tsx       # 主聊天页面
│   │   │   ├── ChatThread.tsx # 消息线程
│   │   │   ├── ChatInput.tsx  # 输入框
│   │   │   ├── ChatToolbar.tsx # 工具栏
│   │   │   ├── message-utils.ts # 消息工具
│   │   │   ├── markdown.ts    # Markdown 渲染
│   │   │   ├── slash-commands.ts # 斜杠命令
│   │   │   ├── text-direction.ts # RTL 文本方向
│   │   │   └── openclaw-command-catalog.generated.ts # OpenClaw 命令目录
│   │   ├── Models/            # 模型配置页面
│   │   ├── Agents/            # Agent 配置页面
│   │   ├── Channels/          # 渠道管理页面
│   │   ├── Skills/            # Skill 管理页面
│   │   ├── Cron/              # 定时任务页面
│   │   ├── Reminders/         # 提醒页面
│   │   ├── Security/          # 安全策略页面
│   │   ├── Settings/          # 设置页面
│   │   └── Setup/             # 首次设置向导
│   ├── stores/                # ★ Zustand 状态管理
│   │   ├── gateway.ts         # Gateway 状态（核心）
│   │   ├── chat.ts            # 聊天状态
│   │   ├── agents.ts          # Agent 状态
│   │   ├── channels.ts        # 渠道状态
│   │   ├── skills.ts          # Skill 状态
│   │   ├── providers.ts       # 模型提供者状态
│   │   ├── settings.ts        # 应用设置状态
│   │   ├── cron.ts            # Cron 任务状态
│   │   └── update.ts          # 更新状态
│   ├── lib/                   # ★ 渲染进程工具库
│   │   ├── host-api.ts        # Host API 客户端（HTTP 代理）
│   │   ├── api-client.ts      # ★★★ 传输层抽象（IPC/WS/HTTP）
│   │   ├── gateway-client.ts   # Gateway WebSocket 客户端
│   │   ├── gateway-connect-error.ts # 错误归一化
│   │   ├── gateway-recovery.ts # 连接恢复逻辑
│   │   ├── host-events.ts     # Host 事件订阅
│   │   ├── channel-runtime-status.ts # 渠道运行时状态
│   │   ├── channel-alias.ts   # 渠道别名（渲染进程）
│   │   ├── providers.ts       # 提供者工具
│   │   ├── provider-accounts.ts # 账户管理
│   │   ├── error-model.ts    # 错误模型（AppError）
│   │   ├── telemetry.ts       # UI 事件遥测
│   │   ├── utils.ts          # 通用工具
│   │   └── use-gateway-page-refresh.ts # 页面刷新 Hook
│   ├── components/            # 可复用组件
│   │   ├── ui/                # 基础 UI（shadcn/ui 风格）
│   │   │   ├── button.tsx, input.tsx, select.tsx, ...
│   │   ├── common/            # 通用组件
│   │   │   ├── ErrorBoundary.tsx
│   │   │   ├── GatewayLifecycleOverlay.tsx # Gateway 状态遮罩
│   │   │   ├── GatewayLifecycleBanner.tsx  # 状态横幅
│   │   │   ├── FeedbackState.tsx
│   │   │   ├── LoadingSpinner.tsx
│   │   │   ├── RefreshButton.tsx
│   │   │   └── StatusBadge.tsx
│   │   ├── layout/            # 布局组件
│   │   │   ├── MainLayout.tsx  # 主布局（侧边栏+内容）
│   │   │   ├── Sidebar.tsx     # 侧边栏导航
│   │   │   ├── PageHeader.tsx  # 页面头部
│   │   │   └── TitleBar.tsx    # 自定义标题栏
│   │   ├── channels/          # 渠道组件
│   │   │   ├── ChannelConfigModal.tsx
│   │   │   └── ChannelLogo.tsx
│   │   └── settings/          # 设置组件
│   │       ├── ProvidersSettings.tsx
│   │       ├── GatewayPortsSettings.tsx
│   │       ├── BackupRestoreSettings.tsx
│   │       └── UpdateSettings.tsx
│   ├── i18n/                  # 国际化
│   │   ├── index.ts           # i18next 初始化
│   │   └── locales/
│   │       ├── en/            # 英文翻译
│   │       │   ├── common.json, agents.json, channels.json, ...
│   │       ├── zh/            # 中文翻译
│   │       └── ja/            # 日语翻译
│   ├── styles/                # 全局样式
│   │   └── globals.css        # Tailwind 入口
│   ├── types/                 # TypeScript 类型定义
│   │   ├── gateway.ts         # Gateway 类型
│   │   ├── agent.ts, channel.ts, cron.ts, skill.ts
│   │   └── electron.d.ts     # window.electron 类型声明
│   ├── shared/               # 渲染进程共享
│   │   ├── menu-items.tsx    # 菜单项组件
│   │   ├── reminders.ts       # 提醒相关
│   │   └── security-policy.ts # 安全策略
│   ├── assets/               # 静态资源
│   │   ├── logo.svg, logo-full.svg
│   │   ├── channels/          # 渠道图标（SVG）
│   │   │   └── telegram.svg, discord.svg, whatsapp.svg, ...
│   │   ├── providers/         # AI 提供商图标
│   │   │   └── openai.svg, anthropic.svg, google.svg, ...
│   │   └── community/         # 社区图片
│   └── vite-env.d.ts         # Vite 环境类型
│
├── resources/                # 构建资源
│   ├── icons/                # 应用图标
│   │   ├── icon.png, icon.ico, icon.icns
│   ├── screenshot/           # 截图（多语言）
│   └── ...
│
├── build/                    # 构建脚本
│   ├── afterPack.cjs         # electron-builder afterPack 钩子
│   ├── portable/             # 便携模式处理
│   └── ...
│
├── scripts/                  # 辅助脚本（~15 个）
│   ├── uv-download.ts        # 下载 uv (Python 包管理器)
│   ├── build-electron.ts     # 构建 Electron
│   ├── codesign-*.ts         # macOS 代码签名
│   └── ...
│
├── tests/                    # 测试
├── docs/                     # 文档
├── config/                   # 配置文件
│
├── package.json              # 项目配置
├── electron-builder.yml      # electron-builder 配置
├── vite.config.ts           # Vite 配置
├── tsconfig.json            # TypeScript 配置
├── tailwind.config.js       # Tailwind 配置
├── eslint.config.mjs        # ESLint 配置
├── vitest.config.ts         # Vitest 配置
├── CLAUDE.md                 # Claude Code 开发指南
├── AGENTS.md                # Claude Code 代理指南
├── README.md / README.zh-CN.md / README.ja-JP.md
├── electron-builder.yml      # electron-builder 配置
├── skills-lock.json         # Skill 锁定文件
├── branding.config.json     # 品牌配置
└── test-anthropic*.js        # 测试脚本
```

---

## 三、核心模块逐文件分析

### 3.1 Electron 主进程入口：`electron/main/index.ts`

这是应用的主入口（约 630 行），负责整个 Electron 应用的初始化。

**核心职责**：

```
1. 应用生命周期管理
   app.whenReady() → initialize() → app.on('activate') → app.on('before-quit')

2. 单实例锁
   app.requestSingleInstanceLock() — 防止多实例同时运行

3. GPU 硬件加速
   app.disableHardwareAcceleration() — 全局禁用，VS Code 同款策略

4. 窗口创建
   createWindow() — 1280×800，最小 960×600
   - preload: ../preload/index.js
   - 标题栏：macOS hiddenInset，其他平台 hidden
   - show: false（ready-to-show 后才显示，防止闪烁）

5. CSP 头覆盖
   - 针对 Gateway (127.0.0.1:18789): 移除 X-Frame-Options，允许 iframe 嵌入
   - 开发模式：宽松的 localhost CSP

6. Gateway 生命周期集成
   - gatewayManager 实例创建
   - 事件桥接（gateway → hostEventBus → renderer）
   - autoStart 决策（attach existing 或 start new）

7. Host API Server 启动（端口 3210）
   startHostApiServer() — 提供 HTTP REST API

8. 各种管理器初始化
   - ClawHubService — Skill 市场
   - GatewayApplyCoordinator — 配置刷新协调
   - Provider 同步调度器
   - Device OAuth / Browser OAuth
   - WhatsApp Login
   - 自动更新（appUpdater）

9. 预启动任务（非阻塞）
   - ensureClawXContext() — 合并 ClawClaw 上下文
   - ensureBuiltinSkillsInstalled() — 预装内置 Skill
   - performUpgradeMaintenanceIfNeeded() — 升级维护
   - autoInstallCliIfNeeded() — CLI 自动安装
   - generateCompletionCache() / installCompletionToProfile()

10. 便携模式支持
    getPortableBase() — 检测 app 同级 portable/ 目录
    自动端口切换（18789 被占用 → 18890+）
```

**关键设计决策**：
- GPU 禁用策略：跨所有硬件一致，避免不同显卡驱动的兼容性问题
- 单实例锁：防止两个实例互相杀死对方的 Gateway 进程
- ready-to-show：防止窗口闪烁
- 非阻塞初始化：预启动任务都是 fire-and-forget

### 3.2 预加载脚本：`electron/preload/index.ts`

通过 `contextBridge.exposeInMainWorld` 安全暴露 API 给渲染进程。

**暴露的 API 分类**：

| 类别 | IPC 通道 | 说明 |
|------|---------|------|
| **Gateway** | `gateway:status/start/stop/restart/rpc/httpProxy/health` | Gateway 生命周期 |
| **App** | `app:version/name/getPath/platform/quit/relaunch` | 应用信息 |
| **Shell** | `shell:openExternal/showItemInFolder/openPath` | 系统 shell |
| **Dialog** | `dialog:open/save/message` | 原生对话框 |
| **Window** | `window:minimize/maximize/close/isMaximized` | 窗口控制 |
| **Settings** | `settings:get/getAll` | 设置读写 |
| **Provider** | `provider:list/get/save/delete/setApiKey/validateKey` | AI 提供者 |
| **Cron** | `cron:list/create/update/delete/toggle/trigger` | 定时任务 |
| **Skill** | `skill:updateConfig/getConfig/getAllConfigs` | Skill 配置 |
| **Log** | `log:getRecent/readFile/getFilePath/listFiles` | 日志读取 |
| **File** | `file:stage/stageBuffer/media:getThumbnails` | 文件操作 |
| **Update** | `update:check/download/install/setChannel` | 自动更新 |
| **ClawHub** | `clawhub:search/install/uninstall/list` | Skill 市场 |
| **UV** | `uv:check/install-all` | Python uv |
| **Channel** | `channel:requestWhatsAppQr/cancelWhatsAppQr` | 渠道登录 |

**事件订阅**（`ipcRenderer.on`）：
- `gateway:status-changed/lifecycle-changed/chat-message/notification/error`
- `channel:whatsapp-qr/success/error`、`channel:wechat-qr/output/success/error`
- `update:status-changed/progress/downloaded`
- `oauth:code/success/error`
- `navigate`（路由导航）

**安全设计**：所有 IPC 通道都有白名单校验，`validChannels.includes(channel)` 检查。

### 3.3 Gateway 管理器：`electron/gateway/manager.ts`

这是最核心的模块之一（约 1314 行），管理 OpenClaw Gateway 进程的完整生命周期。

#### 3.3.1 核心状态机

```
GatewayManager
├── status: GatewayStatus
│   ├── state: 'stopped' | 'starting' | 'running' | 'reconnecting' | 'error'
│   ├── port: number (默认 18789)
│   ├── pid?: number
│   ├── uptime?: number
│   ├── error?: string
│   ├── connectedAt?: number
│   └── restartExpectedMs?: number
├── process: ChildProcess | null
├── ws: WebSocket | null
├── stateController: GatewayStateController
├── connectionMonitor: GatewayConnectionMonitor
├── lifecycleController: GatewayLifecycleController
├── restartController: GatewayRestartController
└── restartGovernor: GatewayRestartGovernor
```

#### 3.3.2 启动流程（`start()`）

```
1. startLock 锁定（防止并发启动）
2. resolveStartPort() — 找空闲端口（18789-18899）
3. initDeviceIdentity() — 加载/创建设备身份 JWT
4. 清理遗留进程
5. runGatewayStartupSequence() — 编排启动序列
   ├── 预检查（Python、端口、配置）
   ├── 查找已存在的 Gateway
   ├── 启动新进程或连接到已有进程
   ├── 等待就绪
   ├── 启动健康检查
   └── 配置自愈（malformed config 修复、doctor --fix）
6. startLock 解锁
7. flushDeferredRestart() — 处理队列中的延迟重启
```

#### 3.3.3 端口自动选择（多实例支持）

```typescript
// resolveStartPort() 逻辑：
// 1. 尝试 18789（默认）
// 2. 如果占用，扫描 18789-18899 找第一个空闲端口
// 这使得"已安装版 + 便携版"可以同时运行
```

#### 3.3.4 WebSocket 协议通信

OpenClaw Gateway 使用自定义 JSON 协议：

```typescript
// 请求: { type: 'req', id: 'uuid', method: 'methodName', params: {...} }
// 响应: { type: 'res', id: 'uuid', ok: true, payload: {...} }
// 响应(错误): { type: 'res', id: 'uuid', ok: false, error: { message: '...' } }
// 事件: { type: 'event', event: 'eventName', payload: {...} }
// 兼容 JSON-RPC 2.0: { id, method, params, result?, error? }
```

#### 3.3.5 重连策略

```typescript
// 指数退避：base=1000ms, max=30000ms, maxAttempts=10
// 服务器端主动关闭时：
//   - 接收 'shutdown' 事件
//   - restartExpectedMs 由服务器指定（精确的 reconnect 时机）
//   - 客户端在指定延迟后快速重连
```

#### 3.3.6 重启防抖与节流

- **RestartController**：防抖（debounce）多个连续重启请求，合并为一次
- **RestartGovernor**：断路器模式，限制重启频率，防止抖动循环
- **Force Restart**：绕过所有防抖/节流，立即重启

#### 3.3.7 配置热重载

- **SIGUSR1 信号**（Unix）：通知 Gateway 进程重新读取配置
- **fallback**：Windows 或 SIGUSR1 不支持时，完整 stop/start
- **debouncedReload**：1200ms 防抖

#### 3.3.8 生命周期事件

```typescript
// emit('status', GatewayStatus) — 状态变化
// emit('notification', JsonRpcNotification) — 来自 Gateway 的通知
// emit('channel:status', { channelId, status }) — 渠道状态
// emit('chat:message', { message }) — 聊天消息
// emit('exit', code) — 进程退出
```

### 3.4 Gateway 启动编排器：`electron/gateway/startup-orchestrator.ts`

`runGatewayStartupSequence()` 是启动的核心编排逻辑。它接受一个包含所有步骤回调的配置对象：

```
runGatewayStartupSequence(配置对象):
  1. runOpenClawStartupPreflightRepair() — 预检查修复
  2. findExistingGatewayProcess() — 查找已存在的 Gateway
  3a. 如果找到 → connect() → waitForReady()
  3b. 如果未找到 → waitForPortFree() → startProcess() → connect() → waitForReady()
  4. recoverMalformedConfig() — 配置自愈（如需要）
  5. runDoctorRepair() — doctor --fix（如需要）
```

### 3.5 配置同步：`electron/gateway/config-sync.ts`

负责将 ClawClaw 的配置同步到 OpenClaw Gateway：

- **provider 配置同步**：将 UI 中配置的 provider 写入 `openclaw.json`
- **workspace 上下文**：合并 ClawClaw 特定的上下文到 bootstrap 文件
- **preflight 检查**：启动前验证环境完整性

### 3.6 应用协调器：`electron/gateway/apply-coordinator.ts`

当配置发生变化时（provider 保存、渠道配置等），协调器决定是 `reload` 还是 `restart`：

- **reload**：热重载配置（SIGUSR1），快速
- **restart**：完整重启，保守但可靠

### 3.7 Host API 服务器：`electron/api/server.ts`

HTTP 服务器（端口 3210），为渲染进程提供 REST API 访问主进程数据。

**路由列表**：
```
handleAppRoutes       → GET  /api/app
handleGatewayRoutes   → GET  /api/gateway/status, /api/gateway/control-ui
handleSettingsRoutes  → GET/PUT /api/settings, /api/settings/export, /api/settings/import
handleProviderRoutes  → GET/POST/PUT/DELETE /api/providers
handleAgentRoutes    → GET/POST /api/agents
handleChannelRoutes  → GET/POST/PUT/DELETE /api/channels
handleSkillRoutes    → GET/POST/DELETE /api/skills
handleCronRoutes     → GET/POST/PUT/DELETE /api/cron
handleLogRoutes      → GET  /api/logs/recent, /api/logs/files
handleUsageRoutes    → GET  /api/usage/token-history
handleSecurityRoutes → GET/PUT /api/security/policy
handleFileRoutes     → POST /api/files/stage, GET /api/files/thumbnails
handleSessionRoutes → DELETE /api/sessions/:key
```

### 3.8 IPC 处理器：`electron/main/ipc-handlers.ts`

将所有 IPC 通道映射到具体处理函数。大约处理 80+ 个 IPC 通道，分为：

1. **Gateway 生命周期**：`gateway:start/stop/restart/status/health/rpc/httpProxy`
2. **设置**：`settings:get/getAll/set/reset`
3. **Provider**：`provider:list/get/save/delete/setApiKey/validateKey/requestOAuth`
4. **Agent**：`agent:list/get/save`
5. **Channel**：`channel:list/save/delete/requestWhatsAppQr`
6. **Skill**：`skill:list/install/uninstall/getConfig/updateConfig`
7. **Cron**：`cron:list/create/update/delete/toggle/trigger`
8. **ClawHub**：`clawhub:search/install/uninstall/list`
9. **文件**：`file:stage/stageBuffer/media:getThumbnails`
10. **日志**：`log:getRecent/readFile/listFiles/getDir`
11. **App**：`app:version/name/platform/quit/relaunch`
12. **Update**：`update:check/download/install/setChannel`
13. **Env**：`env:getConfig/setApiKey/deleteApiKey`

### 3.9 WebSocket 客户端：`electron/gateway/ws-client.ts`

Gateway WebSocket 连接的核心实现：

```
connectGatewaySocket(配置):
  1. ws://127.0.0.1:{port}/ws — 连接 WebSocket 端点
  2. 设备身份握手（Device Identity JWT）
  3. onHandshakeComplete — 连接成功回调
  4. 返回 WebSocket 实例
```

### 3.10 Provider 服务：`electron/services/providers/`

完整的 AI 模型提供者管理系统：

```
provider-service.ts   — CRUD 服务（单例模式）
provider-store.ts     — electron-store 持久化
provider-runtime-sync.ts — 同步到 Gateway 运行时
provider-validation.ts — API Key 验证（调用 provider API）
provider-migration.ts — 配置迁移（老版本 → 新版本）
local-model-presets.ts — 内置模型预设
```

### 3.11 渲染进程入口：`src/main.tsx`

```typescript
ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </React.StrictMode>,
);
// 初始化默认传输层（WS/HTTP invoker 注册）
initializeDefaultTransports();
```

### 3.12 App 根组件：`src/App.tsx`

- ErrorBoundary 包装
- React Router 路由配置
- GatewayLifecycleOverlay 全局遮罩
- Toaster（sonner 通知）
- 初始化 Gateway store
- 应用 Gateway 传输偏好（WS 诊断模式）

**路由配置**：
```
/ → Chat
/settings → Settings
/settings/providers → Models (Models 子路由)
/agents → Agents
/channels → Channels
/skills → Skills
/cron → Cron
/reminders → Reminders
/security → Security
/setup → Setup（首次配置向导）
```

### 3.13 API 客户端传输层：`src/lib/api-client.ts`

这是渲染进程最核心的模块之一（约 1070 行），实现了灵活的传输层抽象。

#### 3.13.1 传输层架构

```
invokeApi(channel, args)
  ↓
resolveTransportOrder(channel) — 根据规则确定传输顺序
  ↓
invokeViaTransport(kind, channel, args)
  ├── 'ipc' → invokeViaIpc() → window.electron.ipcRenderer.invoke()
  ├── 'ws'  → createGatewayWsTransportInvoker() → WebSocket 直连 Gateway
  └── 'http' → createGatewayHttpTransportInvoker() → HTTP POST /rpc
  ↓
trackUiEvent() — 遥测记录
```

#### 3.13.2 传输规则配置

```typescript
transportConfig = {
  enabled: { ws: false, http: false }, // 默认只启用 IPC
  rules: [
    { matcher: /^gateway:rpc$/, order: ['ws', 'ipc'] },   // WS 优先（但默认禁用）
    { matcher: /^gateway:/, order: ['ipc'] },             // Gateway 状态走 IPC
    { matcher: /.*/, order: ['ipc'] },                    // 其他全走 IPC
  ],
};
```

#### 3.13.3 WS 诊断模式

通过 `localStorage.setItem('clawclaw:gateway-ws-diagnostic', '1')` 启用 WS 传输：
- `gateway:rpc` → `['ws', 'http', 'ipc']`
- 用于调试 Gateway WebSocket 连接

#### 3.13.4 统一请求格式（UNIFIED_CHANNELS）

```typescript
// 通过 app:request 发送统一格式请求
{
  id: 'timestamp-random',
  module: 'provider',    // channel 前缀
  action: 'list',       // channel 后缀
  payload: args[0],     // 参数
}
// 响应：
// { ok: true, data: {...} }
// { ok: false, error: { code: '...', message: '...' } }
```

#### 3.13.5 Gateway WebSocket 传输

```typescript
createGatewayWsTransportInvoker():
  1. 连接 ws://127.0.0.1:{port}/ws
  2. 接收 connect.challenge 事件
  3. 发送 connect 请求（带 token 和客户端信息）
  4. 等待 connect 响应（握手完成）
  5. 发送 RPC 请求：{ type: 'req', id, method, params }
  6. 接收响应：{ type: 'res', id, ok, payload/error }
  7. 复用 WebSocket 连接（连接池）
```

#### 3.13.6 错误处理

- `AppError` 类型，带错误代码（`AUTH_INVALID`、`TIMEOUT`、`RATE_LIMIT` 等）
- `normalizeAppError()` — 统一错误归一化
- `toUserMessage()` — 错误代码 → 用户友好消息
- 传输失败自动 fallback 到下一个传输

### 3.14 Host API 客户端：`src/lib/host-api.ts`

```typescript
hostApiFetch(path, init):
  1. invokeIpc('hostapi:fetch', { path, method, headers, body })
  2. 主进程处理：HTTP 请求 + 代理响应
  3. 解析响应（支持新旧两种格式）
  4. fallback: 如果主进程不支持 hostapi:fetch，直接 fetch 本地
```

### 3.15 Gateway Store：`src/stores/gateway.ts`

Zustand store，管理 Gateway 连接状态和生命周期事件。

**状态**：
```typescript
interface GatewayState {
  status: GatewayStatus;
  lifecycle: GatewayLifecycle;
  health: { ok: boolean; uptime?: number; error?: string };
  isInitialized: boolean;
  lastError: string | null;
  overlaySuppressed: boolean;
}
```

**关键功能**：

1. **init()** — 订阅 Host 事件 + 启动轮询
   - 订阅 `gateway:status-changed`、`gateway:lifecycle`、`gateway:notification`
   - 定时轮询（活跃期 2s，空闲期 10s）
   - 页面可见性事件触发刷新

2. **Gateway 通知处理** `handleGatewayNotification()`
   - `agent` 事件 → chat store 事件
   - `chat.side_result` → BTW（Background-to-Worker）事件
   - `channel:status` → 渠道状态更新

3. **生命周期状态机**
   ```
   idle → scheduled → applying → completed/failed
   ```

4. **reconcileGatewayStatus()** — 等待 Gateway 状态达到目标（最多 15s）

5. **Debounced/Deferred Restart** — 渲染进程也维护重启队列

### 3.16 Chat Store：`src/stores/chat.ts`

管理聊天消息和 Agent 运行时事件。

**关键方法**：
- `sendMessage()` — 发送消息（通过 `gateway:rpc`）
- `handleAgentEvent()` — 处理 Agent 运行时事件
- `handleChatEvent()` — 处理聊天事件（消息、状态变化）
- `handleBtwEvent()` — Background-to-Worker 事件
- `loadHistory()` — 加载历史消息
- `handleGatewayStatusChange()` — Gateway 断连时清空发送状态

**消息类型**：
- `user` — 用户消息
- `assistant` — AI 回复
- `tool` — 工具调用
- `tool-result` — 工具结果
- `started` — Agent 开始运行
- `completed`/`done`/`finished`/`end` — Agent 完成

### 3.17 其他重要 Stores

| Store | 职责 |
|-------|------|
| `agents.ts` | Agent 配置列表、模型选择 |
| `channels.ts` | 渠道列表、配置、状态 |
| `skills.ts` | Skill 列表、安装状态 |
| `providers.ts` | AI provider 列表、API Key、验证状态 |
| `settings.ts` | 应用偏好（主题、语言、autoStart 等） |
| `cron.ts` | Cron 任务列表、启用/禁用、触发 |
| `update.ts` | 更新状态、下载进度、安装 |

### 3.18 聊天页面：`src/pages/Chat/`

```
index.tsx — 主聊天页面
  ├── ChatThread.tsx — 消息线程渲染
  │   ├── 消息气泡（user/assistant/tool/tool-result）
  │   ├── Markdown 渲染（marked + highlight.js）
  │   ├── 代码块高亮
  │   ├── 工具调用卡片
  │   └── 复制按钮
  ├── ChatInput.tsx — 输入框
  │   ├── 多行文本输入
  │   ├── 斜杠命令菜单（/开头的命令）
  │   ├── 文件上传
  │   └── 发送按钮
  └── ChatToolbar.tsx — 工具栏
      ├── 模型选择器
      ├── 会话历史
      └── 清空会话
```

**Slash Commands**：`slash-commands.ts` 定义了 `/` 开头的命令，如 `/model`、`/agent`、`/help` 等，映射到 OpenClaw 的命令目录。

### 3.19 设置页面：`src/pages/Settings/`

- **General**：主题、语言、启动项
- **AI Providers**（Models 子页面）：API Key 配置、模型参数
- **Channels**：渠道配置（弹窗）
- **Advanced** → **Gateway Ports**：端口配置、autoStart
- **Developer Mode**：直接编辑 JSON、运行 doctor
- **Backup/Restore**：导出/导入配置
- **About**：版本信息、检查更新

### 3.20 组件库：`src/components/ui/`

基于 shadcn/ui 风格的组件集：
- `button.tsx` — 按钮（variants: default/destructive/outline/ghost）
- `input.tsx` — 输入框
- `textarea.tsx` — 多行文本
- `select.tsx` — 下拉选择
- `switch.tsx` — 开关
- `checkbox.tsx` — 复选框
- `dialog.tsx` / `sheet.tsx` — 对话框/侧边抽屉
- `tabs.tsx` — 标签页
- `badge.tsx` — 徽章
- `card.tsx` — 卡片
- `label.tsx` — 标签
- `separator.tsx` — 分隔线
- `tooltip.tsx` — 工具提示
- `progress.tsx` — 进度条
- `confirm-dialog.tsx` — 确认对话框

### 3.21 日志系统：`electron/utils/logger.ts`

使用 `electron-log` 库：
- 文件日志：`getLogsDir()/clawclaw.log`
- 控制台日志（开发模式）
- 全局 `logger` 实例，在主进程初始化时调用 `logger.init()`

### 3.22 配置存储：`electron/utils/store.ts`

```typescript
// electron-store 封装
interface AppSettings {
  gatewayPort: number;
  gatewayAutoStart: boolean;
  gatewayToken?: string;
  theme: 'light' | 'dark' | 'system';
  language: 'en' | 'zh' | 'ja';
  autoCheckUpdate: boolean;
  updateChannel: 'stable' | 'beta';
  // ... 更多
}
```

### 3.23 路径管理：`electron/utils/paths.ts`

```typescript
getDataDir()        // 便携: portable/data/ | 默认: app.getPath('userData')
getLogsDir()        // dataDir/logs/
getOpenClawConfigDir() // dataDir/.openclaw/
getPortableBase()   // 检测便携模式
getDefaultExportDir() // 默认导出目录
expandPath()        // ~ → homeDir 等路径展开
```

### 3.24 OpenClaw CLI 封装：`electron/utils/openclaw-cli.ts`

```typescript
getOpenClawCliCommand()     // 获取 openclaw CLI 路径
autoInstallCliIfNeeded()    // 自动安装 CLI
generateCompletionCache()   // 生成 shell 补全
installCompletionToProfile() // 安装到 shell profile
verifyWindowsBundledCliRuntime() // Windows CLI 验证
```

### 3.25 UV（Python）环境：`electron/utils/uv-setup.ts`

```typescript
checkUvInstalled()    // 检查 uv 是否安装
installUv()           // 下载安装 uv
setupManagedPython()  // 设置托管 Python 环境
```

OpenClaw Gateway 底层使用 Python（通过 uv 管理），所以主进程需要确保 Python 环境就绪。

### 3.26 Skill 管理

**主进程**：`skill-config.ts`、`skill-list.ts`、`skill-metadata.ts`
- Skill 配置读写
- Skill 列表获取
- 内置 Skill 预安装

**ClawHub**：`clawhub.ts`（主进程）、`src/pages/Skills/`（渲染进程）
- 搜索 ClawHub 市场
- 安装/卸载 Skill
- Skill README 预览

### 3.27 渠道登录管理器

```
electron/utils/whatsapp-login.ts   — WhatsApp QR 码登录
electron/utils/wechat-login.ts      — 微信登录
electron/utils/wechat-installer.ts  — 微信安装
```

### 3.28 OAuth 管理

```
electron/utils/device-oauth.ts  — 设备 OAuth 流程（Provider API Key 获取）
electron/utils/browser-oauth.ts — 浏览器 OAuth 回调
electron/utils/gemini-cli-oauth.ts — Gemini CLI OAuth
```

### 3.29 自动更新：`electron/main/updater.ts`

使用 `electron-updater`（支持 GitHub Releases）：

```typescript
// macOS: Sparkle (appcast.xml)
// Windows: NSIS 内置更新
// Linux: AppImage
```

### 3.30 系统托盘：`electron/main/tray.ts`

- 托盘图标（macOS 模板图标）
- 右键菜单：显示/隐藏窗口、启动/停止 Gateway、设置、退出
- 单击：显示/隐藏主窗口

### 3.31 应用菜单：`electron/main/menu.ts`

- macOS：标准 macOS 应用菜单
- Windows/Linux：自定义菜单
- 包含：文件、编辑、视图、窗口、帮助

### 3.32 便携模式处理：`build/portable/` + `electron/utils/paths.ts`

```typescript
// 检测便携模式
getPortableBase() // 检查 app 同级是否有 portable/ 目录
// 便携模式数据目录：app 同级 portable/data/
// 便携模式配置目录：app 同级 portable/data/.openclaw/
// 自动端口切换避免与已安装版本冲突
```

---

## 四、进程间通信架构

```
┌─────────────────────────────────────────────────────────────┐
│              React Renderer Process (src/)                  │
│                                                              │
│  pages/Chat/index.tsx                                        │
│    ↓ useChatStore.getState().sendMessage()                   │
│  stores/chat.ts                                              │
│    ↓ gatewayStore.rpc('chat.send', ...)                      │
│  stores/gateway.ts                                          │
│    ↓ invokeIpc('gateway:rpc', ...)                          │
│  lib/api-client.ts (invokeApi)                               │
│    ↓                                                        │
│  ┌───────────────────────────────────────────────────────┐  │
│  │  Transport Layer (IPC / WS / HTTP)                     │  │
│  │  ├── IPC: window.electron.ipcRenderer.invoke()         │  │
│  │  ├── WS:  createGatewayWsTransportInvoker()           │  │
│  │  └── HTTP: createGatewayHttpTransportInvoker()        │  │
│  └───────────────────────────────────────────────────────┘  │
└──────────────────────────┬──────────────────────────────────┘
                           │ IPC (contextBridge)
┌──────────────────────────┴──────────────────────────────────┐
│              Electron Main Process (electron/)                │
│                                                              │
│  preload/index.ts                                            │
│    ↓ ipcMain.handle(channel, handler)                         │
│  main/ipc-handlers.ts                                        │
│    ├── gateway:rpc → gatewayManager.rpc() → WebSocket 发送    │
│    ├── settings:get → electron-store                         │
│    ├── provider:save → electron-store + sync to runtime       │
│    └── ...                                                   │
│                                                              │
│  api/server.ts (HTTP, port 3210)                             │
│    ↓ HTTP 请求路由                                            │
│  api/routes/*.ts → 返回 JSON                                  │
│                                                              │
│  gateway/manager.ts                                           │
│    ├── process: ChildProcess (spawn)                         │
│    ├── ws: WebSocket (ws 库)                                 │
│    └── 管理 Gateway 生命周期                                  │
└──────────────────────────┬──────────────────────────────────┘
                           │ TCP (WebSocket / HTTP)
┌──────────────────────────┴──────────────────────────────────┐
│              OpenClaw Gateway (子进程，端口 18789)           │
│                                                              │
│  openclaw.mjs (Node.js v22+)                                 │
│    ↓                                                         │
│  Gateway HTTP Server (Express/原生)                          │
│    ↓ WebSocket / REST                                        │
│  Agent Runtime                                               │
│    ↓                                                         │
│  Model Providers (OpenAI / Anthropic / ...)                  │
└─────────────────────────────────────────────────────────────┘
```

---

## 五、主要工作流程

### 5.1 应用启动流程

```
Electron app.whenReady()
  → initialize()
    1. logger.init() — 初始化日志
    2. 便携模式检测 — getPortableBase()
    3. warmupNetworkOptimization() — 网络优化
    4. applyProxySettings() — 应用代理设置
    5. createMenu() — 创建应用菜单
    6. createWindow() — 创建 BrowserWindow
    7. createTray() — 创建系统托盘
    8. registerIpcHandlers() — 注册 IPC 处理函数
    9. registerGatewayRefreshScheduler() — 注册刷新调度器
    10. startHostApiServer(port 3210) — 启动 Host API HTTP 服务器
    11. appUpdater.initializeFromSettings() — 初始化更新器
    12. repairClawXOnlyBootstrapFiles() — 修复 bootstrap 文件
    13. ensureBuiltinSkillsInstalled() — 预装内置 Skill
    14. performUpgradeMaintenanceIfNeeded() — 升级维护
    15. 事件桥接（gateway → hostEventBus → renderer）
    16. gatewayManager.attachIfRunning() — 尝试连接已有 Gateway
    17. gatewayAutoStart ? gatewayManager.start() : N/A
    18. ensureClawXContext() — 合并上下文
    19. autoInstallCliIfNeeded() — 自动安装 CLI
```

### 5.2 渲染进程初始化

```
src/main.tsx
  → ReactDOM.createRoot().render()
    → App.tsx
      → ErrorBoundary
        → useEffect: gatewayStore.init()
          → 订阅 Host 事件
          → fetchGatewayStatusSnapshot()
          → 启动轮询定时器
        → applyGatewayTransportPreference()
```

### 5.3 聊天消息发送流程

```
用户输入消息 → ChatInput.tsx
  ↓
chatStore.sendMessage(content, attachments)
  ↓
gatewayStore.rpc('chat.send', { sessionKey, content, attachments })
  ↓
invokeIpc('gateway:rpc', 'chat.send', params)
  ↓
window.electron.ipcRenderer.invoke('gateway:rpc', 'chat.send', params)
  ↓
ipc-handlers.ts: gateway:rpc handler
  → gatewayManager.rpc('chat.send', params)
  → WebSocket 发送到 Gateway
  ↓
Gateway 处理：Agent 推理 → 工具调用 → 流式响应
  ↓
WebSocket 收到事件：{ type: 'event', event: 'agent', payload: {...} }
  ↓
gatewayStore.handleGatewayNotification(payload)
  → chatStore.handleAgentEvent() — 更新 UI
  → chatStore.handleChatEvent() — 显示消息
```

### 5.4 Provider 配置保存流程

```
用户在 ProvidersSettings.tsx 保存 API Key
  ↓
providerStore.saveProvider(config)
  ↓
invokeIpc('provider:save', config)
  ↓
主进程：provider:save handler
  → ProviderService.save(config)
  → SecretStore.saveApiKey()
  → syncSavedProviderToRuntime() — 同步到 Gateway
  ↓
gatewayApplyCoordinator.enqueue({ source: 'provider.save', requires: 'reload' })
  ↓
GatewayApplyCoordinator 执行刷新
  → gatewayManager.reload() 或 restart()
```

### 5.5 配置备份/恢复流程

```
Settings → Backup/Restore → Export
  ↓
invokeIpc('settings:getAll')
  ↓
getAllSettings() → buildBackupPayload()
  ↓
electron dialog.showSave()
  ↓
writeFile(backup.json)
```

---

## 六、端口与网络约定

| 端口 | 用途 | 说明 |
|------|------|------|
| 18789 | OpenClaw Gateway HTTP/WebSocket | 默认 Gateway 端口 |
| 18789-18899 | Gateway 端口扫描范围 | 多实例共存 |
| 3210 | ClawClaw Host API HTTP | 渲染进程 → 主进程的 HTTP 代理 |
| 18789 (Portable) | 便携版 Gateway | 被占用时自动切换 |

---

## 七、存储架构

```
electron-store (AppSettings):
  gatewayPort, gatewayAutoStart, gatewayToken, theme, language,
  autoCheckUpdate, updateChannel, ...

OS Keychain (API Keys):
  macOS: Keychain Services
  Windows: Credential Manager
  Linux: libsecret

OpenClaw Config (openclaw.json):
  Gateway 配置、渠道配置、Provider 配置、Agent 配置

ClawClaw Device Identity:
  dataDir/clawclaw-device-identity.json
```

---

## 八、与 OpenClaw / ClawX / U-Claw 的关系

```
OpenClaw（上游核心）
  ├── Gateway 运行时（端口 18789）
  ├── CLI 工具（openclaw 命令）
  └── Plugin/Skill 系统

ClawClaw（桌面客户端 — 本项目）
  ├── electron/main/ — 主进程（Gateway 管理、IPC、窗口）
  ├── electron/preload/ — contextBridge 安全桥接
  ├── electron/api/ — Host API HTTP 服务器
  ├── electron/gateway/ — Gateway 生命周期管理（比 ClawX 更复杂）
  ├── src/pages/ — React UI
  ├── src/stores/ — Zustand 状态管理
  └── src/lib/ — API 客户端（IPC/WS/HTTP 多传输层）

差异 vs ClawX:
  - 更完整的 Gateway 生命周期管理（启动编排、自愈、重连）
  - Provider 管理系统更完整
  - 多传输层支持（IPC/WS/HTTP）
  - 便携模式支持
  - 设备身份认证
  - Python uv 环境管理
```

---

## 九、关键设计亮点

1. **多实例共存**：端口自动扫描（18789-18899），便携版和安装版可同时运行
2. **启动自愈**：malformed config 自动修复、doctor --fix fallback
3. **重启防抖**：多个连续配置变更合并为一次重启
4. **重连策略**：指数退避 + 服务器端精确延迟 + 断路器模式
5. **传输层抽象**：IPC/WS/HTTP 可切换，WS 诊断模式
6. **事件桥接**：Gateway → HostEventBus → Renderer 的清晰事件流
7. **非阻塞初始化**：预启动任务全部 fire-and-forget
8. **便携模式**：完整的便携支持（数据、配置、日志全在 U 盘）

---

*本文档基于 ClawClaw 仓库源码分析生成，最后更新：2026-04-16*
