# ClawClaw 用户指南

[English](user-guide.en.md)

## 安装与首次启动

安装包以 [ClawClaw Releases](https://github.com/AngusFan-GH/ClawClaw/releases) 实际发布内容为准。Windows x64 使用 NSIS 安装程序或便携 ZIP；macOS 使用 DMG。安装包包含 Electron、Node、pnpm 和 DSH runtime，无需另装这些开发工具。自行构建见[贡献指南](../CONTRIBUTING.md)。

未初始化的 profile 会先显示 Setup Wizard，可选择窗口模式、材质、市场、通知、浏览器和网络范围，也可以跳过。向导结束前不启动主 Host 和窗口。每个 Profile 第一次关闭主窗口时会提示应用仍在后台运行；确认后，后续关闭通常仅隐藏。从托盘可重新打开，选择退出才会结束应用；需要重新显示该提示时，可在桌面设置中重置“后台驻留提示”。

## 数据目录

| 内容 | 默认位置 |
| --- | --- |
| Harness 数据、profiles、settings、sessions | `~/.clawclaw/data` |
| 默认工作区的实际文件 | `~/.clawclaw/workspaces/default` |
| 应用状态和日志（macOS） | `~/Library/Application Support/ClawClaw` |
| 应用状态和日志（Windows） | `%APPDATA%\ClawClaw` |

`~` 指当前用户主目录。ClawClaw 不读取、移动或修改其他应用的 `~/.dsh`；如需继续使用其中的数据，请在确认内容和备份后通过应用的数据目录设置显式选择，ClawClaw 不会自动合并目录。设置中保存的数据目录选择优先于启动默认值；未保存选择时，`CLAWCLAW_HOME` 可以覆盖默认数据目录。安全模式使用单独的临时数据和工作区。启动完成后，ClawClaw 会把最终选择的数据目录作为 `DSH_HOME` 传给 Host、内置终端和插件；外部 `DSH_HOME` 不是 Launcher 的数据目录选择入口。

数据目录和工作区是不同概念：更改 Harness 数据位置不会自动搬移默认工作区的文件。便携 ZIP 也不是自包含的数据目录。

卸载桌面应用时，ClawClaw 采用保守的数据保留策略：

| 数据 | 卸载行为 |
| --- | --- |
| 安装目录中的程序文件、卸载入口和快捷方式 | 删除 |
| 应用缓存、更新状态和日志 | 保留 |
| Harness 数据、Profile、设置、会话和插件状态 | 保留 |
| 工作区及其中的用户文件 | 保留 |

因此卸载不等于删除本地数据。需要彻底清理时，应先备份，再由用户明确删除上述数据目录；不要依赖安装程序代为删除工作区。

## 工作区

应用会注册名为“默认”的工作区；它的注册不能删除。已有工作区会保留，新会话选择会结合持久化的活动工作区、当前选项及默认工作区。

在会话首页或侧栏添加工作区时，可浏览文件夹、输入绝对路径、回到主目录、新建文件夹、显示隐藏文件夹，或使用系统选择器。选择目录后再创建或切换工作区。工作区决定任务操作的文件位置；profile 决定加载哪些插件，两者互不替代。

## Channels

从 Channels 入口选择平台并按对应页面完成凭据或扫码配置。当前界面提供微信、企业微信、飞书、钉钉、QQ、iMessage、Telegram、WhatsApp、Discord 和 Slack；iMessage 仅适用于 macOS。是否能够连接取决于平台账号权限、配置和网络，内置入口不代表已授权账号。

渠道工作目录依次使用渠道自身的 `workspace`、插件的 `defaultWorkspace`、`CLAWCLAW_DEFAULT_WORKSPACE`，最后回退到 `~/.clawclaw/workspaces/default`。归档或已失效的绑定会话收到新消息时会建立可用会话。平台消息和回复会经过对应平台，详见[数据处理说明](../PRIVACY.zh.md)与 [Channels 参考](../channels/dsh-im/README.zh.md)。

## Profile 与恢复

Profile 是 bundle、依赖和 patch 的组合。托盘可发现现有 profile 以及可按需创建的 `desktop`、`web`。切换先持久保存目标，再有序重启；不会把旧 profile 插件复制过去。

启动失败不会自动换成上一次 profile。使用恢复窗口的插件管理、回滚、切换配置或诊断功能处理。健康启动维护三个轮换检查点，覆盖当前 profile 的声明文件及共享 Harness home 的 `settings.yaml`、`cordis.patch.yml`。恢复需要明确选择槽位；检查点不含凭据、`.env`、会话、storage、缓存或工作区文件，也不是完整备份。

## 窗口与本地访问

- **兼容模式**保留上游默认客户端布局。macOS/Windows 的 36 像素标题栏位于独立的 Desktop WebContentsView，内容页面不会被插件 CSS 带着改动标题栏。
- **扩展窗口**使用独立标题栏与 Desktop 布局，承载上游 sidebar、conversation 和 details。
- **增强模式**使用独立 root 与紧凑内置 caption。

macOS 支持透明材质；Windows 11 build 22621 及以上按能力提供 Mica；Linux 仅兼容模式。模式和材质切换需要重启。

Web 服务默认回环访问，端口默认为 `0`（系统分配）。需要固定浏览器 origin 的插件可在桌面设置中指定空闲端口，或设置：

```yaml
dsh-desktop:
  port: 43189
```

浏览器打开选项不等于向局域网开放。局域网访问需要单独启用；页面显示实际 URL。不要将网络可达性视为用户鉴权：被允许连接的客户端可能通过会话和工具操作本机文件。仅在可信网络中使用。

## 插件和终端

左侧“插件”是统一入口：管理已安装 bundle，并在启用市场时显示“插件市场”用于发现、搜索和安装。桌面设置只负责选择 `dsh-market` 提供方或关闭市场；不会再出现第二个市场页面。第三方插件以本机用户权限运行。

从桌面终端入口打开终端后，以下命令默认作用于当前 profile：

```sh
dsh plugin add <plugin>
dsh plugin remove <plugin>
dsh plugin update
```

使用 `--profile <name>` 可显式指定。插件改变后重启应用。终端带有私有 `dsh`、`pnpm`、`node` shim 和 `DSH_HOME`，不会修改全局 PATH；已打开终端保留打开时的 profile。

## 自动化任务与叮嘱

左侧“自动化任务”管理 ClawClaw 定时任务，包括计划、启停、立即运行、历史和任务会话。升级到 DSH 0.1.7-rc.2 不会迁移或删除已有任务；Desktop Profile 不同时加载上游 Schedule，避免出现两个互不相通的任务列表。

Settings 中的“叮嘱”是跨工作区、跨会话持续生效的长期指令，不是定时任务。它继续留在 Settings，与自动化任务分开管理。

## 侧栏快捷入口

在“设置 → 通用设置 → 快捷入口”中可固定、移除和排序最多 4 个功能或 Settings section。已固定项会出现在侧栏一级入口区；主面板入口直接打开对应功能，设置入口直接打开对应 section；侧栏折叠时保留图标和提示。

快捷入口统一管理“插件”、“自动化任务”和当前存在的 Settings section。侧栏只显示已固定的项目；新安装默认固定插件、自动化任务、技能和叮嘱。这项功能与“编辑快捷键”中的键盘组合键相互独立。

## 更新

打包应用只读取 `https://clawclaw.xzinfra.com/updates/dsh/stable/release.json`，不使用 `latest.yml` 或 `latest-mac.yml`。后台检查失败或无新版本时静默；手动检查会显示结果。

桌面设置中的“更新资格记录”默认关闭。明确开启后，它只在本机限额记录版本、更新阶段、分类结果、耗时和制品摘要，不记录完整 URL、错误原文、设备身份或用户内容；可随时一键清除。记录仅在用户主动导出诊断 ZIP 时包含。

确认下载后，应用把 manifest 指定的安装包保存到应用数据目录下的私有 `updates/installers/`，并校验大小、SHA-512 和 DMG/PE 容器。当前请求不发送旧项目的 `X-DSH-Desktop-*` 统计 header。Windows 和 macOS 产物都有意保持未签名；HTTPS 与摘要校验只证明下载内容和发布清单一致，不验证发布者身份。Windows 会先安全关闭 Host，只有关闭成功才启动 NSIS；macOS 会打开已校验的 Universal DMG，由用户手动替换应用。升级后的应用会询问是否删除保留的安装包。服务或产物是否已发布，以检查实际结果为准。

## 排查

- 窗口关闭后先检查托盘；退出才会停止后台服务。
- 插件未出现时检查目标 profile，重启后再看日志。
- Channels 无法连接时检查平台凭据、权限、网络和页面错误；不要公开凭据。
- 可从托盘导出诊断 ZIP；崩溃无法进入界面时运行实际安装的程序并加 `--export-diagnostics`。例如 Windows：

  ```powershell
  & "$env:LOCALAPPDATA\Programs\ClawClaw\ClawClaw.exe" --export-diagnostics
  ```

- 日志在应用数据目录的 `logs/`，诊断 ZIP 在 `diagnostics/`。导出可能包含路径、会话内容、结构化 fatal report、选择启用的更新资格记录和崩溃内存片段，分享前先检查。

仍无法解决时，在 [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues) 提供操作系统、版本、复现步骤和脱敏后的错误。
