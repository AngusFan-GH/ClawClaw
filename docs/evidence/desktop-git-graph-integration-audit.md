# dsh-git-graph 接入与验证报告

日期：2026-10-23

## 接入结论与版本

已将 `@linxin666/dsh-client-ui-git-graph@0.4.8` 作为 Desktop 的固定生产依赖接入。DSH 仍为 `0.2.1-rc.2`，React 仍为 `18.3.1`，未修改 `deepseek-harness/`，也未引入新的 pnpm workspace。

参考项目：[dsh-web/packages/dsh-git-graph](https://github.com/zhu1090093659/dsh-web/tree/main/packages/dsh-git-graph)。实现以 npm 发布的 0.4.8 原始包为准，完整性固定于根锁文件。分析时参考仓库 HEAD 为 `9c1523417f76ea36516db80e831953c1f1062007`，不将这个后续源码提交冒充 npm 产物的构建来源。

保留发布包的 Git 服务、HTTP 接口、分支菜单、图谱和 worktree 实现；Desktop 通过独立 Host 导出、客户端构建适配及键盘交互层接入。

## 功能清单

| 功能 | 当前行为 | 验证 |
| --- | --- | --- |
| Git 入口 | Git 工作区中的空白新会话，在工作区与 Agent 预设旁显示当前分支 | 实际桌面窗口 |
| 分支搜索 | 本地分支过滤、当前分支标记、未提交文件数 | 组件测试、实际菜单 |
| 切换分支 | 真实 Git switch；分支不存在、被其他 worktree 占用、操作进行中等错误保持明确 | 临时真实 Git 仓库、真实 Profile |
| 创建分支 | 基于当前 HEAD 创建并切换；空名称禁用，支持取消 | 组件测试、真实 Git、真实桌面取消 |
| 提交图谱 | 按拓扑显示提交、引用、作者、时间和拓扑列 | 真实合并历史、实际桌面 |
| 分页 | 首次 200 个提交，加载更多每次增加 100 | 组件测试、实际桌面 200 → 300 |
| 创建 worktree | 在托管目录创建 `wt/<名称>` 分支；注册工作区并创建、打开新会话 | 真实 Git、真实 Profile、客户端业务测试 |
| worktree 基准 | 表单选择基线分支 | 组件测试、实际表单 |
| worktree 管理 | 列出关联检出；主检出不可删除 | 真实 Git、真实 Profile、实际管理器 |
| 删除保护 | 脏目录先拒绝，再明确确认强制删除；删除分支独立勾选，默认保留分支 | 组件测试、临时真实 Git |
| 自动隔离 | 默认关闭；启用后新会话使用独立 worktree，重复点击只创建一次 | 配置持久化、客户端真实适配逻辑测试 |
| Agent 工具 | 复用原包的可选 `git_worktree`；默认关闭 | 默认配置核对；本次未执行模型调用或启用该选项 |
| 键盘 | Escape 关闭并返回分支按钮；弹窗 Tab 焦点限制在窗口内 | 组件测试、实际 Escape |
| 非 Git/已有会话 | 非 Git 工作区隐藏入口；已有非空会话不显示分支切换器 | 组件测试、实际已有会话 |
| 外部变化同步 | 保留原包 SSE 订阅、跨标签共享连接及窗口聚焦刷新 | 复用原实现；本次未另做多浏览器并发压测 |

分支切换作用于整个工作区的磁盘检出；它不是单个会话的独立分支。原有会话 ID、历史和 cwd 不会因此迁移。需要隔离文件时，应使用 worktree 新会话入口。Git 自身允许不会覆盖本地文件的切换；适配层不会擅自清理本地改动。

## Desktop 适配与数据保护

- `desktop-git-graph` 通过 Desktop 自有 bundle 加载，模块名为 `dsh-plugin-desktop/git-graph`。其配置纳入现有可编辑行管理，重复准备 Profile 不会重复插入或覆盖用户显式设置。
- `autoIsolate: false`、`autoBaseline: current`、`agentTool: false` 为初始配置。托管目录继续使用 `$DSH_HOME/worktrees/<repo-key>/<name>/`；普通新建会话不会自动更换工作区。
- 浏览器产物在构建时移除安装统计模块及调用，不向 dsh-market.com 发送心跳或创建统计访客标识。对固定版本的包装和补丁锚点做严格检查，版本变化须重新审查，构建不会静默套用失配补丁。
- 修正原包手动创建 worktree 会话的失败回滚：会话创建失败时，先取消新工作区注册，再回滚目录；注册清理失败则保留目录。会话已创建但导航失败时，保留会话、注册及目录，不再删除刚创建的会话环境。
- Git Host 适配层为所有 JSON 与 SSE 路由复用 `connection.requestRejection`。现有桌面认证链路、仅回环/同源请求约束及工作区路径检查继续有效；验证携带 renderer 能力但缺少连接 Cookie 的请求返回 401。真实 Profile 检查验证未注册的子目录不能被直接作为 Git 工作区使用。
- 仅显式删除本插件托管目录，主检出保留；删除工作区注册不主动删除原有会话存储。未迁移、重写或删除原有任务、会话或运行记录。
- 未修改 npm 包内文件或官方 DSH 源码。Apache-2.0 来源及 Desktop 补丁说明已补充至第三方声明，原包 LICENSE 随依赖闭包保留。

## 验证结果

- `corepack pnpm check`：完整通过。Desktop 部分 **196 个测试文件通过，1638 项通过、6 项跳过**；包含类型检查、构建、运行时闭包、CLI、Loader、真实 Profile、许可证和操作故障契约检查。
- Git 专项：**5 项真实 Git 服务测试、17 项发布包客户端/业务/键盘测试、1 项 Profile 配置持久化测试**；另复核 2 项现有品牌入口回归，共 25 项专项命令测试通过。
- 真实 Profile 的离线 Git 检查覆盖 config/status/branches/graph/create-branch/switch/worktrees/add/remove，使用现有认证请求头与 Cookie。全部写操作仅在独立临时目录执行；原文件内容和主分支保持不变。
- 原有 Schedule 的多次持久化重启、历史保留与不补跑检查，以及微信/飞书真实 Gateway 离线会话检查，随完整门禁通过。
- macOS 实际窗口：正常重启加载；进入已有 ClawClaw 工作区的空白会话；分支菜单、创建分支表单及取消、worktree 创建表单、主检出保护、提交图谱、加载更多及 Escape 均已核对。实际仓库只读查看，未执行切换、创建分支或删除 worktree。
- `git diff --check`：通过。

开发过程第一次总门禁遇到另一路发布文档的双语记录更新，之后该修改完成，最终总门禁已完整通过。测试环境对上游 primitives 缺失 source map 的提示不影响测试结果，未为此修改依赖产物。

## 使用与验证边界

入口：选择已有 Git 工作区 → 在该工作区新建空白会话 → 点击当前分支 → 选择 Git 图谱或 worktree 操作。图谱是只读浏览；它不是提交、推送或历史改写界面。

本机需要可用的 Git。自动隔离和 Agent 工具属于独立可选能力，当前未替用户启用。本次实际 GUI 验证在 macOS 完成；Windows/Linux 已有构建和 Profile 约束沿用，但未声称完成对应系统的实际图形窗口验收。

接入验证阶段未自动提交或推送代码。桌面截图为 `/tmp/clawclaw-git-graph.png`，展示真实仓库加载到 300 个提交的结果。

## 样式统一与实际窗口复核（2026-10-23）

Desktop 新增 `src/client/git-graph-styles.ts`，在客户端作用域中注册和释放样式。适配只作用于 Git 插件的 data 属性根节点，颜色、背景、圆角、阴影均复用当前 DSH 主题变量；不改 npm 依赖内容和上游源码。

- 分支菜单沿用项目菜单材质、输入焦点色与中性边框；使用与项目菜单一致的 CSS anchor 能力定位，并限制到窗口底边以上，修复最小窗口下最后一个操作入口被裁切的问题。
- 创建分支、创建 worktree、管理 worktree 与图谱统一使用标准弹窗底色、遮罩、标题及关闭按钮尺寸。创建表单宽度 480px、管理器 720px、图谱 880px，均受视口约束。
- 主按钮复用 `button-primary-fill` / `label-primary-foreground`，浅色为深色按钮，深色为浅色按钮；取消按钮使用描边。统一启用、禁用、悬停和键盘焦点表现，去除输入框重复焦点边框。
- 提交摘要、哈希、作者、时间调整字号、行距和留白；当前分支标签保持主题主色对比，其余引用使用中性底色。长路径允许换行，列表在弹窗内部滚动。
- 本次完整 `corepack pnpm check` 通过：196 个测试文件，1638 项通过、6 项跳过，含真实 Profile Git 及原有功能回归。之后对最小窗口菜单定位、管理器宽度和样式变量的收尾修改，再次执行 `corepack pnpm build`、`corepack pnpm typecheck`，均通过。所有引用的 DSW 主题变量已核对存在。
- macOS 实际窗口验证：浅色与深色主题、分支菜单、创建分支弹窗、worktree 创建表单的启用/禁用按钮、取消、管理器主检出保护、图谱及 Escape。窗口从 1422×802 缩到应用最小宽度 900px、高度 642px，验证菜单完整可见及图谱内滚动；结束后恢复原窗口尺寸和“跟随系统”主题。
- 原有 Git 操作、会话及数据逻辑未修改；GUI 中只查看和取消输入，没有创建分支/worktree 或发送消息。此次未在 Windows/Linux 图形窗口实测。

最终截图：`/tmp/clawclaw-git-graph-styled-light.png`、`/tmp/clawclaw-git-graph-styled-dark-narrow.png`。完整检查日志：`/tmp/clawclaw-git-style-check.log`。

## 版本更新

本次 Git 图谱集成与样式适配随 Desktop 源码版本 `0.2.12` 提交；DSH 源码与运行时继续固定为 `0.2.1-rc.2`。同步更新包版本和中英文 README。此次操作仅更新源码版本并创建本地提交，未推送、创建发布 tag 或部署安装包。

版本更新后再次运行 `corepack pnpm check`，完整通过（196 个测试文件，1638 项通过、6 项跳过）；日志为 `/tmp/clawclaw-0.2.12-check.log`。
