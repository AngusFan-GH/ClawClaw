# DSH 0.1.7-rc.2 菜单与设置整合方案

日期：2026-09-28  
状态：已完成

## 背景

升级到 DSH `0.1.7-rc.2` 后，上游 `ui-plugin-manager` 和 `ui-schedule` 分别向
`sidebar.panellist` 注册了“插件”和“自动化任务”一级面板。ClawClaw 同时保留了旧的
插件市场、定时任务、叮嘱和可配置快捷入口，导致以下问题：

- “插件”与“插件市场”分散在一级面板和 Settings 中，用户无法判断两者的边界。
- 上游 Schedule 与 `desktop-cron-tasks` 是两套独立任务模型，列表和历史互不相通。
- `sidebar.shortcuts` 已没有 rc.2 外壳消费者，快捷入口设置虽然仍可写入配置，但不会显示。
- 快捷入口点击依赖无人监听的 `clawclaw:open-settings-section` DOM 事件。
- Settings 图标仍通过翻译文本匹配和 DOM 属性注入，依赖非公开结构。

## 决策

### 1. 插件使用一个一级入口

保留 rc.2 的“插件”一级面板作为插件能力的唯一入口。`dshmarket` 提供的市场页面通过它的
`market` 客户端服务嵌入 `plugins.item`，同时调用 `setSettingsVisible(false)` 隐藏市场原有的
独立 Settings 页面。

职责如下：

- 市场条目：发现、搜索和安装社区插件。
- 已安装 bundle：启停、卸载、查看 bundle/row 配置。
- Desktop 设置中的“插件来源”：只选择或关闭市场提供方，因为这会改变 Profile 启动组合并
  需要重启；它不是第二个市场浏览入口。

当市场未启用或未提供 `market` 服务时，不显示市场条目，插件管理页的其他功能保持可用。

### 2. 自动化暂以 Desktop 任务模型为唯一实现

本次不做有损数据迁移。ClawClaw 已发布的 `desktop-cron-tasks` 有现存数据、执行策略和会话
关联，而上游 Schedule 没有导入这些记录的稳定接口。因此：

- 在 Desktop Profile 中禁用上游 `schedule` 和 `ui-schedule`。
- 将现有“定时任务”提升为 Desktop 自有的“自动化任务”一级面板，不再注册 Settings 页面。
- Host 端数据、执行器、API 和现有任务文件均保留，不删除或重写用户数据。
- `desktop-reminders` 的实际产品语义是跨工作区、跨会话持续生效的“叮嘱”，不是定时提醒；
  它继续作为 Settings section，不并入自动化。

待上游提供可验证的导入、幂等映射和回滚协议后，再单独设计 Desktop 到 Schedule 的迁移。

### 3. 退役旧快捷入口

删除 Desktop Profile 中的 `desktop-shortcuts` Host 插件，不再注册
`settings.general.item` 或自定义 `sidebar.shortcuts`。不主动删除用户设置文件中已有的
`dsh-desktop-shortcuts` 字段，避免静默改写配置；该字段成为无行为的旧配置，可在未来的设置
迁移版本中统一清理。

需要频繁访问的产品级功能应注册正式的 `sidebar.panellist` 一级面板；普通配置继续留在
Settings。键盘快捷键使用 rc.2 的官方 shortcuts 服务，不与侧栏入口混用。

### 4. Settings 只承载配置

保留 Desktop、Skills 和 MCP 等 Settings section 及其现有 ConfigForm/API 写入路径。删除
ClawClaw 基于翻译文本查找 Settings DOM 并替换图标的逻辑。Settings 导航样式和行为由上游
外壳负责，Desktop 不再依赖私有 DOM 结构。

## 实施顺序

1. 新增插件市场桥接：监听 `market` 服务，隐藏旧 Settings 入口，向 `plugins.item` 注册市场。
2. 新增 Desktop 自动化一级面板，复用现有 Cron API 和页面组件。
3. 从 Settings 移除 Cron 页面注册，并在 Profile 中禁用上游 Schedule 两个 bundle；叮嘱保留。
4. 退役快捷入口 Host/Client 注册及其样式、导出和 Profile 行。
5. 删除 Settings 文本匹配图标注入。
6. 更新单元测试、Profile 组合断言和用户文档。

## 验收条件

- 左侧仅出现“插件”和一个“自动化任务”入口，不再出现第二套任务入口。
- 启用 `dshmarket` 时，市场在“插件”面板内可打开，Settings 中不再出现独立市场页面。
- 关闭市场时，“插件”面板仍可管理已安装 bundle，市场条目不出现。
- “自动化任务”能查看和管理升级前已有的定时任务，打开任务会话行为不变。
- Settings 中不再出现“快捷入口”“定时任务”的重复配置页；叮嘱与 Desktop 设置仍可读写。
- 仓库中不再存在 `sidebar.shortcuts`、`clawclaw:open-settings-section` 或基于翻译文本注入
  Settings 图标的运行时代码。
- `corepack pnpm typecheck`、相关单测、`corepack pnpm build` 和 `corepack pnpm check` 通过。

## 非目标

- 不修改 `deepseek-harness/` 子模块。
- 不迁移或删除任何现有 Cron/Reminder 数据。
- 不把所有 Settings section 提升为一级菜单。
- 不在本次实现 Desktop 到上游 Schedule 的数据转换。

## 实施与验证结果

- 已完成插件市场桥接、Desktop 自动化一级面板、上游 Schedule 禁用、旧快捷入口退役和 Settings DOM 图标注入删除。
- 实际启动 Desktop 开发版验证：侧栏仅有“插件”和一个“自动化任务”；插件市场在插件面板内正常打开。
- 实际打开 Settings 验证：“叮嘱”和“桌面设置”均可访问，不再出现“快捷入口”、“定时任务”或独立“插件市场”设置页。
- `corepack pnpm typecheck`、聚焦单测、`corepack pnpm build` 和 `corepack pnpm check` 全部通过；完整检查为 160 个测试文件、1280 项测试通过，6 项跳过。
