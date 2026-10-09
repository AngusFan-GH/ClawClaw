# ClawClaw Desktop

[English](README.md)

`dsh-plugin-desktop` 是 ClawClaw Desktop 包，当前版本 `0.2.5`。它提供 Electron bootstrap、隔离 DSH Host、原生窗口/托盘、profile 与 pnpm service、工作区、恢复、更新、Market 选择和 ClawClaw Client 呈现层。安装后的产品身份是 **ClawClaw**（`com.clawclaw.desktop`）。

该包属于根 pnpm workspace，不应作为独立 npm 应用安装：它依赖根目录的 vendored DSH runtime、override、patch、同级 Market 与 Channels workspace 包。

## 运行模型

Electron main 默认通过 `startIsolatedDesktopHost()` 启动 Host；`DSH_DESKTOP_ISOLATED_HOST=0` 是同进程排查路径。Host 拥有 Cordis 和 Web 服务，Electron main 拥有原生资源。浏览器内容通过普通 loopback HTTP/WebSocket 工作，没有通用 Electron bridge。

Launcher 默认准备 `~/.clawclaw/data` 与 `~/.clawclaw/workspaces/default`；已保存的数据目录、`CLAWCLAW_HOME` 或安全模式可以覆盖。它不会读取、移动或修改其他应用的 `~/.dsh` 数据。

ClawClaw 从 `<CLAWCLAW_HOME>/skills`（默认 `~/.clawclaw/data/skills`）发现用户 Skill，从当前所选 Workspace 的 `.clawclaw/skills` 发现项目 Skill。默认不会扫描 `.dsh/skills`、`.agents/skills`、`.codex/skills` 或其他应用的 Skill 目录。用户可以在技能页面显式添加只读扫描目录；这些路径只保存在 ClawClaw 自有配置中，ClawClaw 不会修改外部文件。

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

## 完整构建与发布流程

### 1. 准备工作区

需要 Node.js `^22.19.0` 或 `>=24.0.0`、Corepack、Git，以及根 workspace 固定的 pnpm `11.8.0`。从仓库根目录执行：

```sh
git submodule update --init --recursive
corepack enable
corepack pnpm install --frozen-lockfile
corepack pnpm run upstream:prepare-runtime
corepack pnpm install --frozen-lockfile
```

准备固定的上游 runtime 后，第二次 install 会刷新 Desktop 依赖链接。Desktop feature 分支不得修改 `deepseek-harness/`。

### 2. 运行发布门禁

```sh
corepack pnpm check
```

该命令未通过时不要打包或创建 tag。它覆盖 owned package、类型检查、单元测试、runtime closure、Loader/profile/CLI smoke、许可证、operation、双语文档一致性和上游 pin 布局。

### 3. 按需进行本地打包

在原生 macOS 上执行：

```sh
corepack pnpm --filter dsh-plugin-desktop run dist:mac
```

产物：`dsh-plugin-desktop/dist/mac-smoke/ClawClaw-<版本>-universal.dmg`。

在原生 Windows x64 的 PowerShell 或命令提示符中执行：

```sh
corepack pnpm --filter dsh-plugin-desktop run dist:win
```

产物：`dsh-plugin-desktop/dist/ClawClaw-<版本>-x64-Setup.exe`。

两个命令都会运行对应平台的 package gate、为 Electron 准备 native module、构建未签名安装包并 smoke-test 打包后的 runtime。由于 native module 的限制，本地不支持可靠的跨平台打包；需要两个平台产物时使用 GitHub Actions。

### 4. 一次性配置发布环境

在更新服务器创建专用的非 root SSH 账号。该账号需要上传到 `/tmp`、写 stable 目录、创建版本归档，并能在以下自有目录中创建 staging 目录：

```text
/var/www/xzinfra/updates/dsh/stable
/var/www/xzinfra/releases/dsh
```

创建 GitHub Environment `stable-update`，添加 Environment Secrets：

```text
UPDATE_SSH_PRIVATE_KEY  无密码的发布专用 OpenSSH 私钥
UPDATE_KNOWN_HOSTS      经过独立核验的 SSH known_hosts 记录
```

添加 Environment Variables：

```text
UPDATE_HOST             SSH 域名或 IP，不包含协议、用户名
UPDATE_USER             专用非 root 发布账号
UPDATE_PORT             可选，默认 22
UPDATE_REMOTE_ROOT      可选，默认 /var/www/xzinfra
UPDATE_BASE_URL         可选，默认 https://clawclaw.xzinfra.com/updates/dsh/stable
```

必须保留 `StrictHostKeyChecking`。不要把 root 密码、个人 SSH 私钥或未经核验的 `ssh-keyscan` 结果放入 GitHub。

### 5. 执行不发布的预构建

先推送发布 commit，再构建和汇总，但不访问服务器：

```sh
git push origin dsh-desktop
run_url="$(gh workflow run release.yml --repo AngusFan-GH/ClawClaw --ref dsh-desktop -f publish=false)"
run_id="${run_url##*/}"
gh run watch "$run_id" --repo AngusFan-GH/ClawClaw --exit-status
gh run download "$run_id" --repo AngusFan-GH/ClawClaw --name desktop-release --dir release
```

必须确认同一 commit 上的 `Build macos`、`Build windows` 和 `Assemble release` 全部成功。下载该次运行的 `desktop-release`，确认其中只有一个 DMG、一个 EXE 和 `release.json`；manifest 的版本、大小和 SHA-512 必须与两个安装包一致。

### 6. 正式发布版本

同时更新 `dsh-plugin-desktop/package.json` 与根 README 中的版本，运行完整门禁、提交，并再次执行不发布的预构建。随后给这个已经验证的准确 commit 创建 tag：

```sh
version=0.2.5
git tag -a "clawclaw-v$version" -m "Release ClawClaw $version"
git push origin "clawclaw-v$version"
```

tag 必须与 Desktop package 版本完全一致。匹配的 tag 会从同一 commit 重新构建 macOS 和 Windows，汇总 `desktop-release`，上传安装包，保存 `/releases/dsh/<版本>/` 归档，并在最后原子替换 `release.json`。不要复用或移动已经发布的版本 tag。

### 7. 验证发布结果

对外宣布前检查 workflow 和公网 manifest：

```sh
gh run list --repo AngusFan-GH/ClawClaw --workflow release.yml --limit 3
curl --fail --show-error --silent \
  https://clawclaw.xzinfra.com/updates/dsh/stable/release.json
```

确认 manifest 是目标版本和 `stable` channel，两个安装包 URL 都返回 HTTP 200，`Content-Length` 一致，并且服务器文件符合 manifest 中的 SHA-512。`release.json` 是唯一更新指针，不要添加 `latest.yml` 兼容文件。

### 8. 恢复失败的部署

如果两个构建和 `Assemble release` 已成功，但部署失败，应下载该次运行的 `desktop-release`；不要混用不同 commit 的产物，也不要只重建一个平台。将专用密钥载入 SSH agent，设置 `UPDATE_HOST`、`UPDATE_USER`、`UPDATE_PORT`、`UPDATE_REMOTE_ROOT`，然后执行：

```sh
corepack pnpm run upload:update -- --directory /path/to/desktop-release --channel stable
```

上传器会校验三个文件，拒绝覆盖已有的版本归档，先上传安装包、最后切换 manifest，并在失败时清理 staging。发现 `/releases/dsh/<版本>/` 已存在时应先调查，不要删除归档或强制二次发布。

## 更新与发布

DSH Desktop 使用 `https://clawclaw.xzinfra.com/updates/dsh/stable/`，并只消费这一目录中的 `release.json`。清单同时声明 Windows NSIS 与 macOS Universal DMG 的 HTTPS 地址、大小和 SHA-512；DSH Desktop 不使用 `latest.yml`、`latest-mac.yml` 或旧 OpenClaw 的 `/updates/stable/` 更新源。

打包后的应用在启动 60 秒后检查更新，此后每六小时检查一次。后台对每个可用版本通知一次，不自动下载。设置和托盘共用同一套手动检查及下载流程。确认后，应用会再次读取 `release.json`，把安装包下载到私有更新目录，校验声明大小、SHA-512 和 DMG/PE 容器并显示进度。Windows 只有在用户再次确认且 Host 正常关闭后才启动 NSIS；macOS 会打开 DMG，由用户退出当前应用并拖入“应用程序”完成替换。

发布清单在跨 Host 进程传输前限制为 16 KiB。Windows 发布包含未签名 NSIS，macOS 发布包含未签名 Universal DMG；二者都由同一份 `release.json` 描述。上传命令会重新计算实际安装包的 SHA-512 并核对大小，保留版本化副本，先上传安装包，最后原子切换 `release.json`。尚未实现断点续传。

GitHub Actions 的 `Release ClawClaw Desktop` 工作流会在托管的 macOS 与 Windows Runner 上从同一 commit 构建两个安装包。`clawclaw-v<version>` tag 必须与 `dsh-plugin-desktop/package.json` 完全一致；匹配的 tag 会自动发布。手动运行默认只构建和汇总，只有勾选 `publish` 输入才会正式发布。发布配置统一放在上文说明的 `stable-update` GitHub Environment 中。

更新服务器应使用对配置目录有写权限的专用非 root SSH 用户。完成这一次服务器初始化后，日常发布由 GitHub 完成，不需要交互登录服务器。手动发布已准备好的 `release/` 目录时，通过 SSH agent 提供密钥，加载已忽略的 `.env.server.local`，再运行 `pnpm run upload:update -- --directory release --channel stable`；脚本有意不支持基于 `sshpass` 的密码发布。传输前会校验版本、HTTPS URL、文件大小和 SHA-512，并拒绝覆盖已有的 `/releases/dsh/<version>/`，先上传安装包，最后切换清单。

生产 dependency 改动后运行 `verify:notices`。产品背景见根 [README](../README.md)、[架构](../docs/architecture.md)和[用户指南](../docs/user-guide.md)。
