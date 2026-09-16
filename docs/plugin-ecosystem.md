# ClawClaw 插件生态

[English](plugin-ecosystem.en.md)

ClawClaw 采用 DSH 的组合模型：上游、Desktop、Channels、Market 和第三方插件以明确 contract 组合。生态的目标是可选择、可诊断、可维护，不是让每个插件获得全部本机权限。

1. **优先通用 contract。** 普通插件依赖上游 DSH，桌面功能才使用 `desktopProfiles`、`desktopPnpm`、`desktopWindow`。不要依赖 Electron、内部 RPC 或文件布局。
2. **清楚声明边界。** 说明运行位置、网络请求、权限、数据目录、兼容版本和是否需要重启。市场元数据不能代替插件自己的说明。
3. **以用户确认和可恢复性为先。** 安装、账号授权、网络暴露和文件操作应有明确用户动作；恢复检查点不是插件事务或完整备份。
4. **尊重来源与许可。** 插件包、目录和渠道供应方各自负责其元数据、服务与许可证。可安装、收录或显示在设置中不等于项目背书。

Community Market 已提供目录选择、发现、详情和受确认的 npm 操作。`dshmarket` 是可选兼容 provider。Fabric 仍是 RFC Draft；在有评审 schema、参考 adapter 和一致性证据前，不能将其称为稳定互操作标准。

插件作者从[插件开发](plugin-development.md)开始；市场提供方看 [Community Market 文档](../dsh-community-market/README.zh.md)；当前 runtime 所有权见[架构](architecture.md)。
