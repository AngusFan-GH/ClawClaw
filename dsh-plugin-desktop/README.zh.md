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

DSH Desktop 使用 `https://clawclaw.xzinfra.com/updates/dsh/stable/`。静态 `release.json` 用于受限的版本检查；`latest.yml` 提供 Windows 原生安装包元数据。在配置 macOS 发布凭据前，macOS 产物是未签名、仅能手动安装的 DMG，DSH Desktop 会禁用 macOS 原生自动更新。旧 OpenClaw 产品的 Windows 更新源保留在 `/updates/stable/`，DSH Desktop 不会使用它。

打包后的应用在启动 60 秒后检查更新，此后每六小时检查一次。后台对每个可用版本通知一次，不自动下载。设置和托盘共用同一套手动检查及下载流程。确认后，原生更新器会重新检查所选版本、校验平台安装包、显示下载进度，并询问是否重启。只有 Host 正常关闭后才会开始安装；取消或关闭过程不会安装待处理更新。

发布清单在跨 Host 进程传输前限制为 16 KiB。当前 macOS 构建是用于手动安装的未签名 Universal DMG；用户需自行绕过 Gatekeeper，并手动下载每次更新。签名并公证的 macOS 发布会增加用于原生更新的 ZIP 和 `latest-mac.yml`。Windows 发布包含 NSIS 安装程序、`latest.yml` 和生成的 blockmap。发布流程会先上传安装包，再发布元数据文件，因此客户端不会先发现尚未可下载的版本。尚未实现断点续传。

两个平台构建完成后，`Release ClawClaw Desktop` 工作流会调用根目录的 `upload:update` 命令。手动发布已准备好的已签名 `release/` 目录时，加载已忽略的 `.env.server.local` 凭据文件，然后运行 `pnpm run upload:update -- --directory release --channel stable`。命令会在传输前校验 `release.json`、两份原生更新元数据、各自引用的安装包及记录的文件大小是否一致。发布未签名 macOS DMG 时加上 `--unsigned-mac`；它会保留服务器上已有的已签名 macOS 元数据，同时上传 DMG 并发布 Windows 更新源。每次发布都会在 `/releases/dsh/<version>/` 保留不可变副本，先上传安装包，最后才切换元数据。

生产 dependency 改动后运行 `verify:notices`。产品背景见根 [README](../README.md)、[架构](../docs/architecture.md)和[用户指南](../docs/user-guide.md)。
