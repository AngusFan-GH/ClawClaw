# 为什么做 ClawClaw

[English](why-desktop.en.md)

ClawClaw 把可组合的 DSH runtime 放进适合长期使用的桌面应用，并为本地工作区与即时通讯渠道补上产品层能力。它不试图重写 Agent runtime 或把 Web UI 伪装成 Electron 原生界面。

## 边界

- 上游 DSH 继续负责 agent、模型、工具、会话、profile 和 Web 协议。
- ClawClaw 负责 Electron 生命周期、隔离 Host、工作区默认值、Channels 入口、桌面窗口、终端、恢复、市场选择和更新客户端。
- 第三方插件通过公开 Cordis/Web contract 集成，不获得窗口、托盘、内部 RPC、安装器或 launcher 私有状态。

“上游子模块不改动”是源码所有权约束。实际产品仍由固定 runtime tarball、根 pnpm override、显式补丁和 Desktop/Channels 插件组成；因此兼容升级必须检查完整组合，而不是只看子模块 diff。

## 为什么有工作区与 Channels

DSH 的 profile 处理依赖组合，但日常任务还需要一个明确、安全的文件起点。ClawClaw 注册不可删除的默认工作区，允许用户增加或选择其他目录，并让 Channels 在没有单独配置时复用默认工作区。它不移动用户已有文件，也不把工作区当成 profile 的副本。

Channels 把消息平台接入现有任务和会话能力。渠道配置、账号授权、平台限制和消息传输仍是用户与平台的关系；内置入口不构成账号托管、服务可用性保证或安全审核。

## 为什么仍然使用插件

Desktop、Market 和 Channels 是可组合层，而不是对上游私有 API 的直接修改。这样做让普通 DSH 插件仍可在 CLI 或 Web profile 中运行，也让 ClawClaw 专用插件可以只依赖明确的 `desktopProfiles`、`desktopPnpm` 和 `desktopWindow` contract。生命周期以 Host generation 为边界：切换 profile 或窗口模式时，插件必须释放旧 service 与子进程。

当前 Community Market 已作为私有内置 package 实现；Fabric 仍是社区 RFC Draft。市场目录或“可安装”状态不等于兼容性、安全性、许可证或隐私审查。

## 面向谁

使用应用请从[用户指南](user-guide.md)开始；开发插件读[插件开发](plugin-development.md)和[服务合同](../dsh-plugin-desktop/docs/plugin-services.zh.md)；维护启动、打包和发布读[架构](architecture.md)及各 Desktop 包 README。
