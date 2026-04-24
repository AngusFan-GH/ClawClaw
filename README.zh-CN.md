<p align="center">
  <img src="src/assets/logo.svg" width="128" height="128" alt="ClawClaw Logo" />
</p>

<h1 align="center">ClawClaw</h1>

<p align="center">
  <strong>OpenClaw AI 智能体的桌面客户端</strong>
</p>

<p align="center">
  <a href="#功能特性">功能特性</a> •
  <a href="#为什么选择-clawclaw">为什么选择 ClawClaw</a> •
  <a href="#快速上手">快速上手</a> •
  <a href="#系统架构">系统架构</a> •
  <a href="#开发指南">开发指南</a> •
  <a href="#参与贡献">参与贡献</a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-MacOS%20%7C%20Windows%20%7C%20Linux-blue" alt="Platform" />
  <img src="https://img.shields.io/badge/electron-40+-47848F?logo=electron" alt="Electron" />
  <img src="https://img.shields.io/badge/react-19-61DAFB?logo=react" alt="React" />
  <a href="https://discord.com/invite/84Kex3GGAh" target="_blank">
  <img src="https://img.shields.io/discord/1399603591471435907?logo=discord&labelColor=%20%235462eb&logoColor=%20%23f5f5f5&color=%20%235462eb" alt="chat on Discord" />
  </a>
  <img src="https://img.shields.io/github/downloads/Xzinfra/ClawClaw/total?color=%23027DEB" alt="Downloads" />
  <img src="https://img.shields.io/badge/license-MIT-green" alt="License" />
</p>

<p align="center">
  <a href="README.md">English</a> | 简体中文 | <a href="README.ja-JP.md">日本語</a>
</p>

---

## 概述

**ClawClaw** 是连接强大 AI 智能体与普通用户之间的桥梁。基于 [OpenClaw](https://github.com/OpenClaw) 构建，它将命令行式的 AI 编排转变为易用、美观的桌面体验——无需使用终端。

无论是自动化工作流、连接通讯软件，还是调度智能定时任务，ClawClaw 都能提供高效易用的图形界面，帮助你充分发挥 AI 智能体的能力。

ClawClaw 原生支持预装本地模型、主流云端供应商以及多语言设置。当然，你也可以通过 **设置 → 高级 → 开发者模式** 来进行精细的高级配置。

---

## 截图预览

<p align="center">
  <img src="resources/screenshot/zh/聊天.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/定时任务.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/技能.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/频道.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/仪表盘.png" style="width: 100%; height: auto;">
</p>

<p align="center">
  <img src="resources/screenshot/zh/设置.png" style="width: 100%; height: auto;">
</p>

---

## 为什么选择 ClawClaw

构建 AI 智能体不应该需要精通命令行。ClawClaw 的设计理念很简单：**强大的技术值得拥有一个尊重用户时间的界面。**

| 痛点              | ClawClaw 解决方案            |
| ----------------- | ---------------------------- |
| 复杂的命令行配置  | 引导式首启流程，自动检查运行环境 |
| 手动编辑配置文件  | 可视化设置界面，实时校验     |
| 进程管理繁琐      | 自动管理网关生命周期         |
| 多 AI 供应商切换  | 统一的供应商配置面板         |
| 技能/插件安装复杂 | 内置技能市场与管理界面       |

### 内置 OpenClaw 核心

ClawClaw 直接基于官方 **OpenClaw** 核心构建。无需单独安装，我们将运行时嵌入应用内部，提供开箱即用的无缝体验。

我们致力于与上游 OpenClaw 项目保持严格同步，确保你始终可以使用官方发布的最新功能、稳定性改进和生态兼容性。
当前随包稳定运行时已对齐到 **OpenClaw 2026.4.15**，在保持桌面端集成体验不变的前提下，跟随上游当前稳定发布线。

---

## 功能特性

### 🎯 零配置门槛

从安装到第一次 AI 对话，全程通过直观的图形界面完成。无需终端命令，无需 YAML 文件，无需到处寻找环境变量。

### 💬 智能聊天界面

通过现代化的聊天体验与 AI 智能体交互。支持多会话上下文、消息历史记录以及 Markdown 富文本渲染。

### 📡 多频道管理

同时配置和监控多个 AI 频道。每个频道独立运行，允许你为不同任务运行专门的智能体。
连接页现在按 OpenClaw 的“类型优先”模型展示：每种连接类型只显示一张卡片，卡内再管理账户级配置、删除和运行状态，避免同类型多账户时页面碎裂或状态语义混乱。是否支持“新增账户”取决于上游该连接插件是否真的实现了多账户能力，而不是所有连接类型一律支持。连接配置的正确闭环是：先在连接页创建或编辑具体账户，再在分身页按账户绑定归属；多账户连接不会再被强制共享同一个分身。
对于微信，ClawClaw 现在按“插件托管二维码会话”处理接入：连接页会优先使用随包提供的 OpenClaw 微信插件镜像，只有在必要时才回退到官方安装流程；随后在应用内直接请求二维码、自动刷新过期会话、在登录成功后自动保存返回的账号，并刷新 Gateway。

### ⏰ 定时任务自动化

调度 AI 任务自动执行。定义触发器、设置时间间隔，让 AI 智能体 7×24 小时不间断工作。

### 🧩 可扩展技能系统

通过预构建的技能扩展 AI 智能体的能力。在集成的技能面板中浏览、安装和管理技能——无需包管理器。

### 🔐 安全的供应商集成

连接多个 AI 供应商（OpenAI、Anthropic、OpenCode Go 等），支持 API 密钥和已接入的 OAuth 登录方式。OpenAI Codex 登录现已对齐 OpenClaw 原生浏览器 OAuth 流程；当上游真正提供时，会优先推荐 `gpt-5.4-pro` 这类更新的 Codex 模型，但不会强制改写你已经保存的旧模型选择。其他供应商账户在条件允许时会优先使用上游接口返回的已验证模型列表，只有在无法枚举模型时才继续允许手动填写模型 ID。模型类型筛选只会在上游明确返回分类字段时显示；如果上游没有提供这类元数据，界面只保留搜索，不再做启发式猜测。对于 Ollama、vLLM、SGLang 这类自托管 OpenAI 兼容运行时，仍然作为一等 Provider 提供；现在每个自托管账户也可以单独允许访问局域网或 localhost 之类的私有网络地址。项目现有的本地模型工作流继续由独立的本地模型中心承载。凭证安全存储在系统原生密钥链中。

> vLLM 说明：ClawClaw 现在会默认把 vLLM 模型标记为 `supportsTools: false`，避免常见的 `400 "auto" tool choice` 报错。现在你也可以在 provider 设置里显式开启 vLLM 工具调用，但前提是 vLLM 服务端已经使用 `--enable-auto-tool-choice` 和 `--tool-call-parser` 启动。

### 🛡️ 细粒度安全策略

可分别配置禁止目录和按能力拆分的运行时限制。叮嘱与禁止目录会作为 standing orders 同步进 agent workspace 的 `AGENTS.md`，让新对话和历史对话里的后续回合都持续带上这些约束；行为限制则会映射到 OpenClaw 的工具 deny 层，同时保留 `openclaw.json` 里原本已有的其他 deny 项。

### 💻 灵活的模型配置

ClawClaw 不再在首次启动时强行内置默认模型。运行环境准备完成后，你可以进入 **模型** 页面手动添加本地模型端点或云端提供商，选择具体模型；也可以先跳过，稍后再完成配置。云端和自托管 Provider 走更接近 OpenClaw 的 provider-first 接入链路，而独立的本地模型中心继续保留当前本地模型的使用方式。现在如果清除本地模型提供商配置，依赖该提供商的本地模型也会一并删除，避免手动清理配置后页面里残留失效的本地模型条目。

### 🌙 自适应主题

支持浅色模式、深色模式或跟随系统主题。ClawClaw 自动适应你的偏好设置。

---

## 快速上手

### 系统要求

- **操作系统**：macOS 11+、Windows 10+ 或 Linux（Ubuntu 20.04+）
- **内存**：最低 4GB RAM（推荐 8GB）
- **存储空间**：1GB 可用磁盘空间

### 安装方式

#### 预构建版本（推荐）

从 [Releases](https://github.com/Xzinfra/ClawClaw/releases) 页面下载适用于你平台的最新版本。

#### 从源码构建

```bash
# 克隆仓库
git clone https://github.com/Xzinfra/ClawClaw.git
cd ClawClaw

# 初始化项目
pnpm run init

# 以开发模式启动
# 同时会刷新开发环境所需的 OpenClaw 受管插件镜像
pnpm dev
```

### 首次启动

首次启动 ClawClaw 时，会进入一个**引导式首启流程**。欢迎信息会固定显示在每一步顶部，系统随后会依次执行：

1. 自动检查运行环境
2. 自动启动 Gateway
3. 自动安装默认技能
4. 可选的模型配置步骤

模型配置现在改为手动完成。你可以在向导中跳转到 **模型** 页面添加本地模型或云端提供商，也可以先跳过，稍后再配置。

### 项目内置 Skills 预装

ClawClaw 也会自动预装放在 `resources/skills/<slug>/SKILL.md` 下的项目本地 skill。
应用启动时，如果受管 OpenClaw skills 目录里还不存在对应 skill，就会自动把该目录复制过去。

最小示例：

```text
resources/
  skills/
    my-skill/
      SKILL.md
```

目录结构和 `SKILL.md` 模板请参考 [resources/skills/README.md](resources/skills/README.md)。

> Moonshot（Kimi）说明：ClawClaw 默认保持开启 Kimi 的 web search。  
> 当配置 Moonshot 后，ClawClaw 也会将 OpenClaw 配置中的 Kimi web search 同步到中国区端点（`https://api.moonshot.cn/v1`）。

### 代理设置

ClawClaw 内置了代理设置，适用于需要通过本地代理客户端访问外网的场景，包括 Electron 本身、OpenClaw Gateway，以及 Telegram 这类频道的联网请求。

打开 **设置 → 网关 → 代理**，配置以下内容：

- **代理服务器**：所有请求默认使用的代理
- **绕过规则**：需要直连的主机，使用分号、逗号或换行分隔
- 在 **开发者模式** 下，还可以单独覆盖：
  - **HTTP 代理**
  - **HTTPS 代理**
  - **ALL_PROXY / SOCKS**

本地代理的常见填写示例：

```text
代理服务器: http://127.0.0.1:7890
```

说明：

- 只填写 `host:port` 时，会按 HTTP 代理处理。
- 高级代理项留空时，会自动回退到“代理服务器”。
- 保存代理设置后，Electron 网络层会立即重新应用代理；确实需要时，Gateway 仍会自动重启。
- 现在运行时配置会在后台统一合并应用，所以连续编辑不会再反复触发多次 Gateway 重启，普通 reload 也不会再全局阻断界面。
- 在“跟随系统”模式下，ClawClaw 也会解析系统代理，并传给自动启动的 OpenClaw Gateway 子进程。
- 如果启用了 Telegram，ClawClaw 还会把代理同步到 OpenClaw 的 Telegram 频道配置中。

### 记忆设置

打开 **设置 → 记忆**，可以控制 ClawClaw / OpenClaw 如何沉淀和检索跨会话信息：

- **自动归档会话记忆**：开启 OpenClaw 内置的 `session-memory` hook。在执行 `/new` 或 `/reset` 时，OpenClaw 会把刚结束的会话摘要写入工作区的 `memory/` 目录。
- **启用记忆检索**：开启 OpenClaw 的 `memorySearch` 运行时配置，让后续问答可以通过上游 `memory_search` 和 `memory_get` 工具检索 `MEMORY.md` 与 `memory/*.md`。
- **本地模型轻量运行模式**：开启 OpenClaw 的 `agents.defaults.experimental.localModelLean`，让本地模型链路优先使用更轻量的上游运行时模式。

说明：

- 当前会话的连续上下文仍然主要依赖 OpenClaw 的 session transcript。`session-memory` 是额外的跨会话归档，不是当前会话上下文的主来源。
- 修改任一记忆开关后，ClawClaw 会同步更新受管 OpenClaw 配置，并自动重启 Gateway，让上游运行时立即加载新配置。
- 这类运行时设置现在会和频道、Agent 等配置共用同一套后台应用协调器，因此在短时间内连续调整多个设置时，重启次数会显著减少。

### 配置备份与数据清理

打开 **设置 → 数据与卸载**，可以在清理数据或卸载前先导出当前配置的 JSON 备份。便携版现在会按用途默认保存到 `portable/exports/settings`、`portable/exports/images` 或 `portable/exports/general`。同一处也能先停止 Gateway，再按白名单清理受管的 ClawClaw / OpenClaw 本地数据，并在真正从系统卸载器移除应用本体之前完成“完全卸载准备”。在 Windows 上，ClawClaw 自身的缓存、存储和日志会排队到应用退出后继续清理，避免被 Chromium 文件锁占用而删除失败。

打开 **设置 → 更新**，可以控制自动检查 / 自动下载，并在打包版应用里手动触发更新检查。ClawClaw 当前只跟随稳定版发布源。
在 Windows 上，打包更新继续使用 NSIS 差分更新，但安装器现在会在复制文件前强制清理受管的 `resources/openclaw` 和 `resources/openclaw-plugins` 目录，避免升级时保留旧运行时残留。升级阶段现在也只检查目标安装目录关联的进程，因此其他目录里的 `ClawClaw.exe` 副本不再误触发“应用仍在运行”的提示。安装器在复制完成后还会额外执行一次 OpenClaw 运行时自检，如果内置 CLI 树不健康，会在安装完成前直接中止。
安装器状态文案也已细化为更具体的升级步骤，例如检查旧进程、停止内置 Gateway、清理旧运行时、复制文件和验证内置运行时。
现在从旧版 ClawClaw 或旧版随包 OpenClaw 升级后的第一次启动，会在正常 Gateway 启动前、以及自动重新检查更新前，自动执行一次性的升级维护：主动迁移旧版 provider 存储、修复受管插件镜像和较旧的 `openclaw.json` 结构，尽量避免等到启动失败后才被动修复。
Windows 安装版从 `0.1.15` 及更早版本升级时，还会走一条额外的兼容路径：安装器会在复制新文件前清理旧的内置 runtime 和 CLI 目录，首次启动也会强制执行更重的一轮 OpenClaw 修复，以兼容旧插件、旧 channel 和旧 runtime 布局。
在 **设置 → 开发者** 中，现在可以直接运行 **OpenClaw Doctor** 和 **OpenClaw Doctor Fix**，对随包运行时执行诊断或修复迁移问题，而不必离开应用。

---

## 系统架构

ClawClaw 采用 **双进程 + Host API 统一接入架构**。渲染进程只调用统一客户端抽象，协议选择与进程生命周期由 Electron 主进程统一管理：

```┌─────────────────────────────────────────────────────────────────┐
│                        ClawClaw 桌面应用                             │
│                                                                  │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              Electron 主进程                                 │  │
│  │  • 窗口与应用生命周期管理                                      │  │
│  │  • 网关进程监控                                               │  │
│  │  • 系统集成（托盘、通知、密钥链）                                │  │
│  │  • 自动更新编排                                               │  │
│  └────────────────────────────────────────────────────────────┘  │
│                              │                                    │
│                              │ IPC（权威控制面）                    │
│                              ▼                                    │
│  ┌────────────────────────────────────────────────────────────┐  │
│  │              React 渲染进程                                   │  │
│  │  • 现代组件化 UI（React 19）                                   │  │
│  │  • Zustand 状态管理                                           │  │
│  │  • 统一 host-api/api-client 调用                               │  │
│  │  • Markdown 富文本渲染                                        │  │
│  └────────────────────────────────────────────────────────────┘  │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ 主进程统一传输策略
                               │（WS 优先，HTTP 次之，IPC 回退）
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                  Host API 与主进程代理层                          │
│                                                                  │
│  • hostapi:fetch（主进程代理，规避开发/生产 CORS）                │
│  • gateway:httpProxy（渲染进程不直连 Gateway HTTP）               │
│  • 统一错误映射与重试/退避策略                                     │
└──────────────────────────────┬──────────────────────────────────┘
                               │
                               │ WS / HTTP / IPC 回退
                               ▼
┌─────────────────────────────────────────────────────────────────┐
│                     OpenClaw 网关                                 │
│                                                                  │
│  • AI 智能体运行时与编排                                          │
│  • 消息频道管理                                                   │
│  • 技能/插件执行环境                                              │
│  • 供应商抽象层                                                   │
└─────────────────────────────────────────────────────────────────┘
```

### 设计原则

- **进程隔离**：AI 运行时在独立进程中运行，确保即使在高负载计算期间 UI 也能保持响应
- **前端调用单一入口**：渲染层统一走 host-api/api-client，不感知底层协议细节
- **主进程掌控传输策略**：WS/HTTP 选择与 IPC 回退在主进程集中处理，提升稳定性
- **优雅恢复**：内置重连、超时、退避逻辑，自动处理瞬时故障
- **安全存储**：API 密钥和敏感数据利用操作系统原生的安全存储机制
- **CORS 安全**：本地 HTTP 请求由主进程代理，避免渲染进程跨域问题

---

## 使用场景

### 🤖 个人 AI 助手

配置一个通用 AI 智能体，可以回答问题、撰写邮件、总结文档并协助处理日常任务——全部通过简洁的桌面界面完成。

### 📊 自动化监控

设置定时智能体来监控新闻动态、追踪价格变动或监听特定事件。结果将推送到你偏好的通知渠道。

### 💻 开发者效率工具

将 AI 融入你的开发工作流。使用智能体进行代码审查、生成文档或自动化重复性编码任务。

### 🔄 工作流自动化

将多个技能串联起来，创建复杂的自动化流水线。处理数据、转换内容、触发操作——全部通过可视化方式编排。

---

## 开发指南

### 前置要求

- **Node.js**：22+（推荐 LTS 版本）
- **包管理器**：pnpm 9+（推荐）或 npm

### 项目结构

```ClawClaw/
├── electron/                 # Electron 主进程
│   ├── api/                 # 主进程 API 路由与处理器
│   │   └── routes/          # RPC/HTTP 代理路由模块
│   ├── services/            # Provider、Secrets 与运行时服务
│   │   ├── providers/       # Provider/account 模型同步逻辑
│   │   └── secrets/         # 系统钥匙串与密钥存储
│   ├── shared/              # 共享 Provider schema/常量
│   │   └── providers/
│   ├── main/                # 应用入口、窗口、IPC 注册
│   ├── gateway/             # OpenClaw 网关进程管理
│   ├── preload/             # 安全 IPC 桥接
│   └── utils/               # 工具模块（存储、认证、路径）
├── src/                      # React 渲染进程
│   ├── lib/                 # 前端统一 API 与错误模型
│   ├── stores/              # Zustand 状态仓库（settings/chat/gateway）
│   ├── components/          # 可复用 UI 组件
│   ├── pages/               # Setup/Dashboard/Chat/Channels/Skills/Cron/Settings
│   ├── i18n/                # 国际化资源
│   └── types/               # TypeScript 类型定义
├── tests/
│   └── unit/                # Vitest 单元/集成型测试
├── resources/                # 静态资源（图标、图片）
└── scripts/                  # 构建与工具脚本
```

### 常用命令

```bash
# 开发
pnpm run init             # 安装依赖并下载 uv
pnpm dev                  # 以热重载模式启动（同时刷新受管插件镜像）

# 代码质量
pnpm lint                 # 运行 ESLint 检查
pnpm typecheck            # TypeScript 类型检查

# 测试
pnpm test                 # 运行单元测试
pnpm run release:check    # 运行发版门禁（升级兼容与恢复检查）

# 构建与打包
pnpm run build:vite       # 仅构建前端
pnpm run package:prepare  # 共享打包前置步骤（vite + OpenClaw bundle + builder 输出清理）
pnpm build                # 准备生产打包资产
pnpm package              # 为当前平台打包
pnpm package:mac          # 为 macOS 打包
pnpm package:win          # 使用辅助打包脚本构建 Windows NSIS 安装包（同时内置 openclaw CLI 所需的 node.exe）
pnpm package:win:portable # 构建 Windows 便携目录版（win-unpacked / win-arm64-unpacked）
pnpm package:mac:portable # 构建 macOS 便携 zip（含启动脚本 + 内嵌 portable/ 数据目录）
pnpm package:desktop      # 串行打包 macOS、Windows、Linux
pnpm run package:organize # 将根目录产物整理到 release/v<version>/windows|mac|linux|metadata
pnpm package:linux        # 为 Linux 打包
pnpm run upload:update    # 上传 release/v<version>/windows/latest.yml 及其引用的 Windows 更新文件
pnpm run upload:update:portable # 上传便携包及 updates-portable/stable 下的按平台 JSON manifest
```

说明：

- `pnpm package:win` 用于构建 Windows NSIS 安装包，内部走 `scripts/package-win.mjs`。
- `pnpm package:win:portable` 用于构建 Windows 便携目录版，内部走 `scripts/package-win.mjs --dir`。
- `pnpm package:mac:portable` 用于构建 macOS 便携 zip，内部走 `scripts/package-mac.mjs --build`。会先调用 electron-builder 生成 macOS zip，再组装包含 `Start ClawClaw.command`（启动脚本，自动清除 Gatekeeper 隔离标记）和应用包内嵌 `portable/` 数据目录的便携目录，输出 `release/v<version>/mac/ClawClaw-v<version>-mac-{arch}-portable.zip`。
- `pnpm package:portable` 同时构建 Windows 和 macOS 便携包。
- `pnpm package:prepare` 是 `build`、`package` 以及所有平台打包命令共用的前置步骤，只清理 release 根目录的 builder 暂存输出，不会触碰已存在的版本目录。
- `pnpm package:organize` 会把 builder 暂存到 release 根目录的产物整理到 `release/v<package.json version>/windows`、`release/v<package.json version>/mac`、`release/v<package.json version>/linux`、`release/v<package.json version>/metadata`。
- `pnpm package:desktop` 会依次打 macOS、Windows、Linux。请保持串行执行，不要并行打各平台，因为它们共享 `dist`、`dist-electron` 和 `build/openclaw`。
- `release/` 现在采用按版本分目录模式。旧版本会保留不动，只有同版本目录下的产物会被覆盖；更新上传脚本读取 `release/v<package.json version>/windows/latest.yml`。
- `pnpm run upload:update` 会继续只负责 Windows 安装版更新发布，用来保持旧安装版依赖的 `latest.yml` 协议不变。
- `pnpm run upload:update:portable` 则是独立的便携版更新发布脚本，会上传便携包，并生成 `win32-x64.json`、`darwin-arm64.json` 这类按平台区分的 manifest 到 `updates-portable/stable/`。
- OpenClaw 受管插件镜像是在 `after-pack` 阶段复制进安装包，因此打包时不需要额外执行独立的 `bundle:openclaw-plugins`。

### 发版门禁

面向客户发版前，先执行 `pnpm run release:check`。

这组门禁关注的是升级稳定性，而不是普通功能覆盖，当前会验证：

- 旧版 provider store 到新账户模型的迁移
- 首次启动前 runtime provider 与 auth 的自动收敛
- 损坏的 `openclaw.json` 自动恢复并保留备份
- 已安装插件目录不完整时的镜像重装修复
- 多 agent 场景下升级时的 runtime auth 收敛

### 技术栈

| 层级     | 技术                     |
| -------- | ------------------------ |
| 运行时   | Electron 40+             |
| UI 框架  | React 19 + TypeScript    |
| 样式     | Tailwind CSS + shadcn/ui |
| 状态管理 | Zustand                  |
| 构建工具 | Vite + electron-builder  |
| 测试     | Vitest + Playwright      |
| 动画     | Framer Motion            |
| 图标     | Lucide React             |

---

## 参与贡献

我们欢迎社区的各种贡献！无论是修复 Bug、开发新功能、改进文档还是翻译——每一份贡献都让 ClawClaw 变得更好。

### 如何贡献

1. **Fork** 本仓库
2. **创建** 功能分支（`git checkout -b feature/amazing-feature`）
3. **提交** 清晰描述的变更
4. **推送** 到你的分支
5. **创建** Pull Request

### 贡献规范

- 遵循现有代码风格（ESLint + Prettier）
- 为新功能编写测试
- 按需更新文档
- 保持提交原子化且描述清晰

---

## 致谢

ClawClaw 构建于以下优秀的开源项目之上：

- [OpenClaw](https://github.com/OpenClaw) – AI 智能体运行时
- [Electron](https://www.electronjs.org/) – 跨平台桌面框架
- [React](https://react.dev/) – UI 组件库
- [shadcn/ui](https://ui.shadcn.com/) – 精美设计的组件库
- [Zustand](https://github.com/pmndrs/zustand) – 轻量级状态管理

---

## 社区

加入我们的社区，与其他用户交流、获取帮助、分享你的使用体验。

|                                     企业微信                                     |                                   飞书群组                                    |                                         Discord                                         |
| :------------------------------------------------------------------------------: | :---------------------------------------------------------------------------: | :-------------------------------------------------------------------------------------: |
| <img src="src/assets/community/wecom-qr.png" width="150" alt="企业微信二维码" /> | <img src="src/assets/community/feishu-qr.png" width="150" alt="飞书二维码" /> | <img src="src/assets/community/20260212-185822.png" width="150" alt="Discord 二维码" /> |

### ClawClaw 合作伙伴计划 🚀

我们正在启动 ClawClaw 合作伙伴计划，寻找能够帮助我们将 ClawClaw 介绍给更多客户的合作伙伴，尤其是那些有定制化 AI 智能体或自动化需求的客户。

合作伙伴负责帮助我们连接潜在用户和项目，ClawClaw 团队则提供完整的技术支持、定制开发与集成服务。

如果你服务的客户对 AI 工具或自动化方案感兴趣，欢迎与我们合作。

欢迎私信我们，或发送邮件至 [public@xzinfra.com](mailto:public@xzinfra.com) 了解更多。

---

## Stars 历史

<p align="center">
  <img src="https://api.star-history.com/svg?repos=Xzinfra/ClawClaw&type=Date" alt="Stars 历史图表" />
</p>

---

## 许可证

ClawClaw 基于 [MIT 许可证](LICENSE) 发布。你可以自由地使用、修改和分发本软件。

---

<p align="center">
  <sub>由 Xzinfra 团队用 ❤️ 打造</sub>
</p>
