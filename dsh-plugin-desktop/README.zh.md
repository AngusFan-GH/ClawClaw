# ClawClaw Desktop

[English](README.md)

`dsh-plugin-desktop` 是 ClawClaw Desktop 包，当前版本 `0.2.0`。它提供 Electron bootstrap、隔离 DSH Host、原生窗口/托盘、profile 与 pnpm service、工作区、恢复、更新、Market 选择和 ClawClaw Client 呈现层。安装后的产品身份是 **ClawClaw**（`com.clawclaw.desktop`）。

该包属于根 pnpm workspace，不应作为独立 npm 应用安装：它依赖根目录的 vendored DSH runtime、override、patch、同级 Market 与 Channels workspace 包。

## 运行模型

Electron main 默认通过 `startIsolatedDesktopHost()` 启动 Host；`DSH_DESKTOP_ISOLATED_HOST=0` 是同进程排查路径。Host 拥有 Cordis 和 Web 服务，Electron main 拥有原生资源。浏览器内容通过普通 loopback HTTP/WebSocket 工作，没有通用 Electron bridge。

Launcher 默认准备 `~/.clawclaw/data` 与 `~/.clawclaw/workspaces/default`；已保存的数据目录、`DSH_HOME` 或安全模式可以覆盖。仅有旧 `~/.dsh` 时会迁移；两个根目录并存时保留两者、不合并。

macOS/Windows 的兼容、扩展模式用独立 WebContentsView 隔离桌面标题栏和内容；增强模式使用集成呈现。窗口/profile 改变会重启 generation。公开插件 contract 是 `./profile-service`、`./pnpm`、`./client`，详见[插件 service](docs/plugin-services.zh.md)。

## 命令

所有命令从仓库根目录执行：

```sh
corepack pnpm --filter dsh-plugin-desktop run build
corepack pnpm --filter dsh-plugin-desktop run typecheck
corepack pnpm --filter dsh-plugin-desktop run test
corepack pnpm --filter dsh-plugin-desktop run check
corepack pnpm --filter dsh-plugin-desktop run dev
corepack pnpm --filter dsh-plugin-desktop run package:dir
```

产品快捷命令：

```sh
corepack pnpm dev
corepack pnpm build
corepack pnpm check
```

`dev` 会启动图形应用。build、typecheck、test、loader/profile/CLI smoke、runtime closure、notices 和可靠性检查必须保持 headless-safe。

## 打包

`package:dir` 生成当前平台的未封装产物。`dist:mac-smoke` 做未签名 macOS packaging smoke，`dist:mac` 是具备凭据时的 macOS release 路径。`dist:win`、`dist:win-portable` 需要原生 Windows x64。未签名本地产物可能触发 Gatekeeper、SmartScreen 或 Unknown Publisher，不能作为发布证据。

所有平台禁用 ASAR。应用与依赖以物理文件放在 `resources/app/`（macOS 为 `Contents/Resources/app/`），供 Host、DSH CLI、pnpm、native module 和 profile fallback 使用。先跑 `check`，再在目标系统运行平台打包命令。

## 更新与发布

客户端读取 `https://clawclaw.xzinfra.com/updates/stable/release.json`。manifest 必须给出规范发布版本，及带有 `url`、`sha512`、`size` 的 `darwin`/`win32` HTTPS artifact。客户端拒绝重定向、校验 SHA-512 与 DMG/PE 容器，再请求用户确认交接；不发送旧 DSH Desktop 统计 header，也不验证独立 manifest 签名。

生产 dependency 改动后运行 `verify:notices`。产品背景见根 [README](../README.md)、[架构](../docs/architecture.md)和[用户指南](../docs/user-guide.md)。
