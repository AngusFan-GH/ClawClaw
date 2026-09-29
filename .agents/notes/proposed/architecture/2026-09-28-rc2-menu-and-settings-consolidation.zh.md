# DSH 0.1.7-rc.2 菜单与设置整合方案

日期：2026-09-28  
状态：已实施

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

### 1. 插件使用一个可配置入口

保留 rc.2 的“插件”主面板作为插件能力的唯一入口，但将其侧栏入口交给 Desktop 快捷菜单
统一注册，不再由上游 `ui-plugin-manager` 固定显示。Desktop 复用 rc.2 插件管理器的正式
Client 实现，只抑制它自己的 `sidebar.panellist` 注册；`dshmarket` 提供的市场页面通过它的
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
- 将现有“定时任务”提升为 Desktop 自有的“自动化任务”主面板，不再注册 Settings 页面；
  它的侧栏入口同样由快捷菜单按配置注册。
- Host 端数据、执行器、API 和现有任务文件均保留，不删除或重写用户数据。
- `desktop-reminders` 的实际产品语义是跨工作区、跨会话持续生效的“叮嘱”，不是定时提醒；
  它继续作为 Settings section，不并入自动化。

待上游提供可验证的导入、幂等映射和回滚协议后，再单独设计 Desktop 到 Schedule 的迁移。

### 3. 基于 rc.2 重新实现侧栏快捷菜单

保留 `desktop-shortcuts` Host 设置命名空间和用户已有的固定项数据，继续在通用设置中提供
最多 4 项的添加、移除和排序操作。候选项统一包含两类：已经存在的全局主面板，以及当前
注册的 Settings section。新安装默认显示“插件”、“自动化任务”、“技能”和“叮嘱”。旧版默认
列表整体升级为这四项；自定义列表保留顺序，只把已退役的 `desktop-cron-tasks` id 映射为
`desktop-automations`，其他不存在的目标继续过滤。

不再声明 rc.2 已无消费者的 `sidebar.shortcuts`，也不再发送 DOM 自定义事件。主面板快捷项只
按配置注册正式 `sidebar.panellist`，其 id 直接指向已有 `main`；Settings 快捷项则注册一对
`sidebar.panellist` / `main` 转接入口，通过 `sidebar.settings` 注册的 root store 调用 Settings
外壳自带的 `openSection(id)`，再清除短暂的主面板选中状态。这样两类入口使用同一套排序、显隐、
图标和折叠 tooltip 逻辑，同时不依赖翻译文本、私有 DOM 结构或失效 slot。

### 4. Settings 只承载配置

保留 Desktop、Skills 和 MCP 等 Settings section 及其现有 ConfigForm/API 写入路径。删除
ClawClaw 基于翻译文本查找 Settings 按钮的逻辑。rc.2 的 `settings.section` 暂未提供图标字段，
因此 Desktop 在 `settings.action` 生命周期内按 section ledger 的稳定顺序挂载统一语义图标；定位只使用
上游公开的 Settings modal 标记和 `nav button` 结构，不依赖中英文标签或构建生成的 CSS 类名。
其余 Settings 导航样式、store、快捷键、更新提示和交互仍全部由上游外壳负责。

## 实施顺序

1. 新增插件市场桥接：监听 `market` 服务，隐藏旧 Settings 入口，向 `plugins.item` 注册市场。
2. 新增 Desktop 自动化主面板，复用现有 Cron API 和页面组件，但不固定注册侧栏入口。
3. 从 Settings 移除 Cron 页面注册，并在 Profile 中禁用上游 Schedule 两个 bundle；叮嘱保留。
4. 禁用上游 `ui-plugin-manager` 的独立 Client 行，由 Desktop 复用其 Client 实现并接管侧栏入口。
5. 重新启用快捷入口 Host 设置，将主面板和 Settings section 统一投影为动态侧栏入口。
6. 删除 Settings 文本匹配图标注入，改为按 section id 和 ledger 顺序投影统一语义图标。
7. 更新单元测试、Profile 组合断言和用户文档。

## 验收条件

- 新安装左侧默认出现“插件”和一个“自动化任务”入口，不再出现第二套任务入口；两者均可在
  “快捷入口”中移除、重新添加和排序。
- 启用 `dshmarket` 时，市场在“插件”面板内可打开，Settings 中不再出现独立市场页面。
- 关闭市场时，“插件”面板仍可管理已安装 bundle，市场条目不出现。
- “自动化任务”能查看和管理升级前已有的定时任务，打开任务会话行为不变。
- Settings 中重新提供“快捷入口”配置，但不再出现“定时任务”的重复配置页；叮嘱与 Desktop 设置仍可读写。
- 已固定项按配置顺序出现在侧栏；主面板项直接打开对应页面，Settings 项直接打开对应 section；
  折叠侧栏仍显示可识别图标和 tooltip。
- 旧的 `dsh-desktop-shortcuts.items` 数据继续生效；旧自动化 id 会迁移，其他已不存在的目标会被过滤，
  不会阻断其余固定项。
- 仓库运行时代码中不再存在 `sidebar.shortcuts`、`clawclaw:open-settings-section` 或基于翻译文本注入
  Settings 图标的运行时代码。
- `corepack pnpm typecheck`、相关单测、`corepack pnpm build` 和 `corepack pnpm check` 通过。

## 非目标

- 不修改 `deepseek-harness/` 子模块。
- 不迁移或删除任何现有 Cron/Reminder 数据。
- 不把所有 Settings section 提升为一级菜单。
- 不在本次实现 Desktop 到上游 Schedule 的数据转换。

## 实施与验证结果

- 已完成插件市场桥接、Desktop 自动化一级面板、上游 Schedule 禁用和 Settings 文本匹配图标逻辑删除。侧栏快捷菜单按上述补充方案重新实现。
- 启动故障根因不是插件管理器模块加载，而是快捷菜单的目标订阅形成了同步反馈环：目标列表订阅
  `main` 插槽，重建 Settings 快捷入口时又向同一插槽注册或注销转接面板，随即再次触发重建，
  导致 Renderer 持续占用 CPU 且无法完成 Loader 启动。目标存储现只在候选项的 id、标签或类型
  实际变化时通知订阅者；快捷入口自身引起的 `main` 版本变化不会再触发重建。
- 已增加回归测试，模拟注册 `main` 时同步触发插槽订阅，断言一次初始化只产生预期数量的注册，
  防止同类递归重新出现。
- 修正快捷设置表单标识：rc.2 的 `configForms.get()` 接收 Host 插件 entry id，而不是设置 namespace；
  Client 现使用 `desktop-shortcuts` 获取表单，排序、移除和添加操作才能写入其注册的
  `dsh-desktop-shortcuts` namespace。
- 修正可编辑 entry 的 Profile 层级：此前 `desktop-shortcuts` 只由 launcher 最后一层 overlay 插入，
  ConfigEditor 读取候选 Profile 时会先跳过尚不存在的配置目标，再由 overlay 插入默认 entry，因而以
  `settings/rejected` 拒绝所有修改。Desktop 现在幂等地把该结构行放在当前 Profile patch 的第一项，
  并只从 launcher overlay 中移除这一条；快捷项配置因此在同一 Profile 层内晚于结构行应用，而
  `desktop-shell`、`web-runtime` 等启动约束仍由高优先级 overlay 强制执行。
- 实际启动 Desktop 开发版验证：完整组合下 Renderer 在 638ms 内报告 healthy，侧栏按默认配置显示
  “内置插件”、“自动化任务”、“技能”和“叮嘱”，没有重复的固定入口。
- 实际打开 Settings 验证：“快捷入口”显示上述四项，添加、移除和排序控件可用；“叮嘱”和
  “桌面设置”仍可访问，不再出现“定时任务”或独立“插件市场”设置页。
- 实际点击验证：排序会更新 Profile 并立即重排侧栏；移除会立即隐藏入口并重新启用候选项的添加
  按钮。Host 不再返回 `Configuration for "desktop-shortcuts" is overridden by a home patch or command-line overlay`。
- 统一菜单图标来源：主面板快捷项使用插件 pinwheel、自动化任务 Clock；Settings section 按实际
  含义使用固定语义图标（叮嘱 ListPen、技能 Skill、MCP Cable、桌面设置 MonitorCog、消息渠道
  MessageCirclePlus），原有通用设置、模型、内置插件和 Agent 预设继续使用各自既有图标。快捷设置
  列表、动态侧栏入口和 Settings 导航共用同一映射，只有确实没有专用语义的未知 section 才回退齿轮。
- Settings 快捷项使用内部 `settings:` 前缀，解决“插件”主面板和“内置插件”设置页都使用 `plugins`
  造成的身份冲突；读取旧配置时会按目标类型迁移，保留原有排序和入口语义。
- `corepack pnpm check` 完整门禁已通过，其中完整单测为 163 个测试文件、1299 项测试通过、
  6 项跳过；构建、类型检查、Loader/Profile 启动、运行时闭包、许可证和操作可靠性检查均通过。
