# ClawClaw 常见问题

[English](faq.en.md)

## 与 DeepSeek Harness、DSH Desktop 是什么关系？

ClawClaw 基于两者演进，独立维护。DeepSeek Harness 提供 Agent runtime，DSH Desktop 提供桌面基础。本项目不代表它们的官方产品或服务。

## 安装包在哪？需要 Node.js 吗？

以 [ClawClaw Releases](https://github.com/AngusFan-GH/ClawClaw/releases) 为准。安装包包含运行环境，不需单独安装 Node.js。源码开发需要 Node.js 和 Corepack，见[贡献指南](../CONTRIBUTING.md)。macOS/Windows 是主要打包目标；Linux 源码支持不等于已有发行包。

## 本地应用是否离线运行？

本地 Host、配置和工作区在本机。默认 SpiritX 模型会访问远程 API，需要可用凭据和网络；Channels、市场、更新及其他联网插件也会连接外部服务。详见[数据处理说明](../PRIVACY.zh.md)。

## 数据存在哪里？Beta 是否隔离？

默认数据是 `~/.clawclaw/data`，工作区是 `~/.clawclaw/workspaces/default`。Stable/Beta 默认共享这两处，Electron 状态分别保存在 ClawClaw 与 ClawClaw Beta 的应用数据目录。显式数据路径和迁移规则见[用户指南](user-guide.md)。

## 为什么默认工作区不能删除？

它是新会话和 Channels 的默认文件位置，由 Host 保护其注册。可以添加和切换其他工作区；保护注册不代表文件有自动备份。

## 为什么 Channels 还要配置？

程序内置的是渠道适配和设置入口，不是平台账号。每个平台需要相应凭据、扫码或权限；iMessage 仅适用于 macOS。

## 插件市场可用了吗？

Community Market 与 `dshmarket` 已内置，可在设置中选择或关闭。Fabric 仍是社区 RFC Draft，不是可安装 SDK。市场安装不等于安全审核，插件会使用本机用户权限。

## Profile 和工作区是否相同？

不是。Profile 决定插件与配置；工作区决定任务目录。插件命令默认作用于桌面终端打开时的 profile，变更后需重启。切换 profile 不会复制插件。

## 上游真的完全没有修改吗？

上游 Git 子模块保持只读。实际运行时来自 vendored 包，并应用仓库 `patches/` 中的兼容补丁；桌面自有插件还会改变模型、品牌、工作区和渠道组合。

## 启动失败会自动回滚吗？

不会自动切换 profile 或还原配置。使用恢复界面选择检查点。检查点不含会话、凭据或工作区文件，不能代替备份。

## 如何更新或报告问题？

使用应用的检查更新功能；更新来自 ClawClaw 分通道 manifest，下载后校验摘要并由用户确认安装。问题提交到 [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues)，附版本、平台和复现步骤，先对日志脱敏。
