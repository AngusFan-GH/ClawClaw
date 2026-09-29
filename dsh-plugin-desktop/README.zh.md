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

`package:dir` 生成当前平台的未封装产物。`dist:mac` 生成未签名 Universal DMG；`dist:win`、`dist:win-portable` 需要原生 Windows x64。未签名产物可能触发 Gatekeeper、SmartScreen 或 Unknown Publisher。

两个平台命令都会主动移除签名、公证凭据，分别生成未签名 NSIS 与 Universal DMG。Windows 可能显示 SmartScreen/Unknown Publisher，macOS 可能要求用户在“隐私与安全性”中允许打开；这些提示是无签名发布模型的一部分，SHA-512 完整性校验不等同于系统发布者认证。

所有平台禁用 ASAR。应用与依赖以物理文件放在 `resources/app/`（macOS 为 `Contents/Resources/app/`），供 Host、DSH CLI、pnpm、native module 和 profile fallback 使用。先跑 `check`，再在目标系统运行平台打包命令。

## 更新与发布

DSH Desktop 使用 `https://clawclaw.xzinfra.com/updates/dsh/stable/`，并只消费这一目录中的 `release.json`。清单同时声明 Windows NSIS 与 macOS Universal DMG 的 HTTPS 地址、大小和 SHA-512；DSH Desktop 不使用 `latest.yml`、`latest-mac.yml` 或旧 OpenClaw 的 `/updates/stable/` 更新源。

打包后的应用在启动 60 秒后检查更新，此后每六小时检查一次。后台对每个可用版本通知一次，不自动下载。设置和托盘共用同一套手动检查及下载流程。确认后，应用会再次读取 `release.json`，把安装包下载到私有更新目录，校验声明大小、SHA-512 和 DMG/PE 容器并显示进度。Windows 只有在用户再次确认且 Host 正常关闭后才启动 NSIS；macOS 会打开 DMG，由用户退出当前应用并拖入“应用程序”完成替换。

发布清单在跨 Host 进程传输前限制为 16 KiB。Windows 发布包含未签名 NSIS，macOS 发布包含未签名 Universal DMG；二者都由同一份 `release.json` 描述。上传命令会重新计算实际安装包的 SHA-512 并核对大小，保留版本化副本，先上传安装包，最后原子切换 `release.json`。尚未实现断点续传。

GitHub Actions 的 `Release ClawClaw Desktop` 工作流会在托管的 macOS 与 Windows Runner 上从同一 commit 构建两个安装包。`clawclaw-v<version>` tag 必须与 `dsh-plugin-desktop/package.json` 完全一致；匹配的 tag 会自动发布。手动运行默认只构建和汇总，只有勾选 `publish` 输入才会正式发布。请在 GitHub 的 `stable-update` Environment 中配置 `UPDATE_SSH_PRIVATE_KEY`、`UPDATE_KNOWN_HOSTS` Secrets；在仓库 Variables 中配置 `UPDATE_HOST`、`UPDATE_USER`，并按需配置 `UPDATE_PORT`、`UPDATE_REMOTE_ROOT`、`UPDATE_BASE_URL`。

更新服务器应使用对配置目录有写权限的专用非 root SSH 用户。完成这一次服务器初始化后，日常发布由 GitHub 完成，不需要交互登录服务器。手动发布已准备好的 `release/` 目录时，通过 SSH agent 提供密钥，加载已忽略的 `.env.server.local`，再运行 `pnpm run upload:update -- --directory release --channel stable`；脚本有意不支持基于 `sshpass` 的密码发布。传输前会校验版本、HTTPS URL、文件大小和 SHA-512，并拒绝覆盖已有的 `/releases/dsh/<version>/`，先上传安装包，最后切换清单。

生产 dependency 改动后运行 `verify:notices`。产品背景见根 [README](../README.md)、[架构](../docs/architecture.md)和[用户指南](../docs/user-guide.md)。
