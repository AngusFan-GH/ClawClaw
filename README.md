# ClawClaw

中文 | [English](README.en.md)

基于 DeepSeek Harness 和 DSH Desktop 演进的开源桌面 Agent 应用，集成本地工作区、会话、插件市场和即时通讯 Channels。

本仓库由 [AngusFan-GH/ClawClaw](https://github.com/AngusFan-GH/ClawClaw) 维护，与 DeepSeek、Anywhere Labs 及各渠道平台不存在官方隶属或背书关系。上游代码、依赖和许可证保留各自归属。

## 当前状态

当前源码版本为 **0.2.3**，固定 DSH 源码和运行时版本为 **0.1.7-rc.2**。稳定版安装包由项目自己的[更新源](https://clawclaw.xzinfra.com/updates/dsh/stable/release.json)发布；原 DSH Desktop 官网的安装包不属于本项目。

- **桌面运行**：原生窗口、托盘、隔离 Host 进程、三种窗口模式、终端和恢复工具。
- **工作区**：内置受保护的默认工作区，支持浏览目录、输入路径、新建文件夹和系统目录选择器。
- **Channels**：微信、企业微信、飞书、钉钉、QQ、iMessage、Telegram、WhatsApp、Discord 和 Slack 的配置入口；各平台仍需账号、凭据或扫码授权。
- **插件**：一级“插件”页面统一承载已安装插件管理和 `dshmarket` 市场；市场提供方可在桌面设置中选择或关闭，目录收录不等于安全审核。
- **自动化任务**：一级入口管理 ClawClaw 定时任务，继续使用现有任务数据与会话记录。
- **快捷入口**：统一配置插件、自动化任务和 Settings section，最多固定 4 项到侧栏并自由排序。
- **更新**：通过 ClawClaw 的稳定版静态 manifest 发现版本，验证下载的 SHA-512，再由用户确认安装。

Windows x64 和 macOS 是主要打包目标；macOS 支持 Universal 构建。Linux 有兼容模式和 headless 检查路径，不能据此推断已有 Linux 发行包。

## 开发启动

需要 Node.js `^22.19.0` 或 `>=24.0.0`、Corepack 和 Git。外层统一使用 pnpm `11.8.0`。

```sh
git submodule update --init --recursive
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

`dev` 会打开图形应用。只做无界面验证时使用：

```sh
corepack pnpm check
corepack pnpm --filter @clawclaw/dsh-im run check
```

## 构建与发布

macOS 必须在原生 macOS 主机上构建未签名 Universal DMG，Windows 必须在原生 Windows x64 主机上构建未签名 NSIS；本地不能从一台电脑可靠地产出两个平台。推荐先运行完整门禁，再用 GitHub Actions 从同一 commit 并行构建：

```sh
corepack pnpm check
gh workflow run release.yml --ref dsh-desktop -f publish=false
```

确认预构建的 macOS、Windows 和 `Assemble release` 三个 job 全部成功后，推送与 `dsh-plugin-desktop/package.json` 版本严格一致的 `clawclaw-v<版本>` tag 即可正式发布。首次服务器与 GitHub Environment 配置、本地分平台打包、产物路径、发布验证和失败恢复的完整步骤见 [Desktop 包发布流程](dsh-plugin-desktop/README.zh.md#完整构建与发布流程)。

## 数据与配置

默认数据目录是 `~/.clawclaw/data`，默认工作区是 `~/.clawclaw/workspaces/default`。已有 `~/.dsh` 且新数据目录不存在时，会迁移旧目录；两者都存在时保留两者并使用新目录，不自动合并。显式 `DSH_HOME`、应用中选择的数据目录和安全模式有各自的覆盖规则，见[用户指南](docs/user-guide.md)。

## 文档

| 目标 | 文档 |
| --- | --- |
| 安装、工作区、Channels、恢复 | [用户指南](docs/user-guide.md) |
| 常见问题 | [FAQ](docs/faq.md) |
| 本地数据和网络请求 | [隐私与数据处理](PRIVACY.zh.md) |
| 全部文档与历史材料 | [文档索引](docs/README.md) |
| 贡献代码与验证 | [贡献指南](CONTRIBUTING.md) |
| 进程、插件、打包和更新 | [架构](docs/architecture.md) |
| 插件接口与示例 | [插件开发](docs/plugin-development.md) |
| 桌面包与发布命令 | [Desktop 包](dsh-plugin-desktop/README.zh.md) |
| Channels 实现与维护 | [Channels](channels/dsh-im/README.zh.md) |
| 市场与社区合同 | [Fabric Draft](dsh-community-fabric/README.zh.md) |

## 来源与许可

桌面产品沿用 [DSH Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop) 的基础；`deepseek-harness/` 是只读的官方上游子模块。应用使用仓库内打包的 DSH runtime，并通过 `patches/` 应用显式兼容修补；“不修改子模块”不等于“运行时没有补丁”。Channels 基于 `@xmanrui/dsh-im` 4.20.2，保留来源说明与第三方许可。

项目采用 [MIT License](LICENSE)。依赖许可见 Desktop 包和 [Channels 的第三方声明](channels/dsh-im/THIRD_PARTY_NOTICES.md)。问题和贡献请提交到 [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues) 和本仓库的 Pull Request。
