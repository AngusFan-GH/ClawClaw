# ClawClaw 文档

[English](README.en.md)

本目录放置当前产品说明。根目录 [README](../README.md) 用于快速了解，包 README 说明构建与发布，日期化 Agent Notes 保存已完成决策的历史背景。

| 目的 | 文档 |
| --- | --- |
| 安装、数据目录、工作区、Channels、恢复 | [用户指南](user-guide.md) |
| 常见问题 | [FAQ](faq.md) |
| 本地数据、模型、Channels、市场和更新请求 | [隐私与数据处理](../PRIVACY.zh.md) |
| 进程、运行时、模型与更新协议 | [架构](architecture.md) |
| 为 ClawClaw/DSH 开发插件 | [插件开发](plugin-development.md) |
| 产品边界与取舍 | [为什么做 ClawClaw](why-desktop.md) |
| 插件生态原则 | [插件生态](plugin-ecosystem.md) |
| 贡献和验证 | [贡献指南](../CONTRIBUTING.md) |
| Stable/Beta 包级操作 | [Stable](../dsh-plugin-desktop/README.zh.md) · [Beta](../dsh-plugin-desktop-beta/README.zh.md) |
| Channels | [实现说明](../channels/dsh-im/README.zh.md) |
| 内置 Market | [Community Market](../dsh-community-market/README.zh.md) |
| 社区互操作提案 | [Fabric Draft](../dsh-community-fabric/README.zh.md) |

## 文档边界

- 根 README、用户指南、FAQ、隐私说明和本页描述当前产品。
- `dsh-plugin-desktop*/docs/` 是公开的开发接口合同；Stable/Beta 使用不同导入路径。
- `dsh-community-market/` 是私有内置 package，已有 runtime、Schema 和测试；其文档的市场行为以当前实现为准。
- `dsh-community-fabric/` 仍是私有 RFC 文档工程，不能作为 loader entry、SDK 或已发布 schema 使用。
- `deepseek-harness/` 是只读上游子模块，其文档不属于 ClawClaw 产品文档。
- `.agents/notes/implemented/` 与 `docs/evidence/` 是证据和历史材料，可能描述早期 DSH Desktop 身份或已替换设计。

所有面对用户或开发者的文档有中英两版。相邻 `*.i18n.yaml` 记录 Git blob hash，变更后必须刷新；该校验只检查记录是否跟随文件，不评估翻译质量。
