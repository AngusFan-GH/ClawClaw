# DSH 0.2.1-rc.2 升级报告

日期：2026-10-23。升级目标：DSH `0.2.1-rc.2`；ClawClaw 产品版本保持 `0.2.11`。完整根门禁、冻结安装及 macOS 包检查均已通过；解锁后已观察到真实主窗口正常显示，其余人工验收状态单列。

## 版本与来源

- ClawClaw 产品版本维持 0.2.11。
- 升级前提交：c3a0866cac38fc3299927473b0cf2fe2915ca8fd。
- 上游从 0.1.7-rc.2 / 477b4f420553e8a52c2fbccc464d7561b239c443 升至官方 dsh-v0.2.1-rc.2 / 687f282e8625c6b8d11ff58211a90524be2e4317。
- 源码 pin 已单独提交：7440a71d5e。
- 运行时由未修改的官方源码通过根 upstream:prepare-runtime 构建；343 个 tarball 的版本、来源和 SHA-256 记录于 vendor/dsh-runtime/0.2.1-rc.2/manifest.json。
- 外层保持 pnpm 11.8.0，上游使用其自带 pnpm 11.28.5。未将上游纳入外层 workspace。

## 升级前基线

完整 corepack pnpm check 通过。Desktop 为 184 个测试文件、1481 项通过、6 项跳过；包含类型检查、构建、CLI/Loader/Profile、运行时闭包、许可证和操作可靠性检查。

## 影响及适配

| 范围 | 变化与处理 |
| --- | --- |
| 运行时与依赖 | DSH 全家族统一至目标版本，删除已移除的 invariants 和旧 in-process-driver 依赖，改用 subagent-spawn-in-process，补齐目标 Profile 和必需 peers。同步 Cordis、Loader、Include、Timer、Schemastery 等配套版本。 |
| 客户端闭包 | 原 packageExtensions 绑定旧版本，导致新包缺少真实运行依赖。按目标源码补齐 client-store 和 ui-primitives 的依赖，更新 Zustand、Shiki、KaTeX。 |
| CLI | 旧 allowDesktopProfile 补丁退出使用；采用官方 manageDesktopProfile 参数，保留插件命令作用于 Desktop Profile 的能力。 |
| 设置 | 原设置兼容补丁仍适用，保留 namespace、register/get/watch 及旧设置导入行为。 |
| 专家与专家团 | 改用 startActivation，使用 caller 投递策略；在子 Agent 发布前应用专家身份与 MCP 工具限制，将版本化组合写为忽略型 plugin record，恢复时仅读取子会话自己的记录。保留深度限制、取消、结果和清理。 |
| 划词引用 | 采用官方 user content/text Factory 渲染接口，保留图片、文件、技能和会话引用能力。 |
| 划词侧聊 | 创建时显式传入有效工作目录，优先使用 WorkingDirectory 服务，避免工作目录切换后仍使用初始 cwd。 |
| 旧目录与兼容性检查 | 官方新增的兼容性预检原先绕过 Desktop resolver，错误读取 `$DSH_HOME/profiles/node_modules` 中残留的 0.1.7 插件元数据，禁用设置、会话等核心服务。新增 DesktopPluginPackages，通过同一 resolver 选择实际加载的包。保留第三方不兼容插件的拒绝策略，不授予版本豁免，不删除旧目录。两个 Host 模式与 Profile 冒烟都接入该适配。 |
| 错误诊断 | 私有 Host RPC 保留原始错误堆栈，恢复诊断可定位 Host 内部实际失败行，继续使用既有日志脱敏机制。 |
| Web 与桌面启动 | 移除已不存在的 webRuntime 服务依赖，保留 WebServer 实际端口检查。将旧 web-runtime trustedHosts 合并到新版 Connection 配置并保留显式调用授权。 |
| 自动化 | 保留 Desktop Cron 的数据、会话和跳过补跑策略，继续禁用官方 Schedule，并禁用新迁入 Agent 预设的 tool-schedule。 |
| 隐私策略 | 原反馈与会话遥测继续禁用，新增 desktop-product-telemetry 和 product-analytics 也在最终 Profile 层强制禁用。 |
| 会话存储 | JSONL 插件改用模块导出，保留真实 V2→V4 worker 迁移测试及原日志不变断言。 |
| 渠道 | 同步兼容声明和 Cordis peer，保留现有渠道实现。 |
| 库存元数据 | 按官方新语义验证无法读取的包只告警、不阻断请求；缺失版本的包保留名称。 |

## 补丁处置

- 设置兼容补丁保留，已对目标构建验证适用。
- 目录选择器与 Electron 子进程补丁保留，按目标版本命名并接入目标制品。
- CLI 旧补丁不再接入依赖图，改用官方接口；旧补丁文件作为历史材料保留。旧 runtime 制品目录同样不参与当前运行时解析。
- 其余 pnpm、打包、fs-ext、ripgrep、open 和 Market 补丁按现有功能继续使用。
- 没有修改上游源码工作树，没有增加上游子代理补丁。

## 验证结果

| 验证 | 结果与范围 |
| --- | --- |
| 官方构建与制品 | upstream:prepare-runtime 通过；343 个制品已同步，版本、来源、SHA-256 由 manifest 记录。 |
| 冻结依赖安装 | corepack pnpm install --frozen-lockfile 通过，使用根 pnpm 11.8.0。 |
| 完整根门禁 | 最终 corepack pnpm check 通过：布局与制品、双语文档、构建、类型、185 个测试文件（1486 项通过，6 项跳过）、闭包、CLI、Loader、Profile、许可证及操作可靠性检查；后者覆盖 7 项操作、18 项故障契约。 |
| 运行时闭包 | 318 个第一方节点形成闭合依赖图。 |
| macOS 包检查 | check:mac-package 通过，包含构建、类型、3 个 Vitest 文件/16 项测试及闭包；这不是安装包签名、公证或双架构实机认证。此前外置盘断开造成的中断已通过重新执行排除。 |
| 渠道 | 27 项渠道测试通过；真实启动中现有渠道连接就绪。未发送测试消息。 |
| 专家集成 | 真实预设 + 离线模型执行 summon_expert，通过身份、工具隔离、caller 结果归属、plugin record 持久化、关闭后重新 resume 的身份和权限恢复断言。 |
| 旧目录启动回归 | 临时共享目录放置不兼容旧版 settings 元数据，当前设置服务仍能启动；另一个真正不兼容的 Profile 插件保持禁用且不执行代码。 |
| 会话兼容 | 测试含 V2→V4 存储迁移、原日志保留断言及现有会话相关回归。 |
| 许可证与声明 | 757 个生产包检查通过，其中 3 个使用需保留声明的许可证。type-fest 的 `(MIT OR CC0-1.0)` 两项原已分别允许，补入组合表达式并重新生成 THIRD_PARTY_NOTICES.md。 |
| 真实用户 Profile | 使用原 desktop Profile 启动实际 Electron 隔离 Host，监听本机回环地址，渠道出现 ready 日志，不再出现旧版核心插件禁用和 `.get()` 异常。未认证浏览器请求返回 403，访问控制仍生效。 |
| 窗口人工观测 | 用户解锁后，通过实际 Electron 窗口确认已进入 ClawClaw 主界面，未显示恢复页。原工作区和历史会话列表可见，自动化面板正常显示 2 个已启用任务及下次执行时间；未触发任务、发送消息或修改设置。这仅覆盖启动与当前页面呈现，不代表全部交互均已人工验收。 |

## 建议人工验收

启动及自动化面板呈现已经实测；下列完整流程尚未全部人工执行。每项记录实际结果及错误日志时间。

1. 启动进入主界面；退出后再次启动，确认不进入恢复页。
2. 打开已有历史会话，新建工作区和会话，使用原模型完成一轮工具调用，再中止一轮执行。
3. 选择文件、上传图片、划词引用和侧聊，检查工作目录与引用内容正确。
4. 召唤已启用专家、运行专家团，确认绑定 Skills/MCP 生效且限制未丢失。
5. 查看已有 Cron、叮嘱，使用临时任务验证执行、停用与重启后的持久化；避免修改正式任务用于试验。
6. 检查插件管理、Market、预设和 Profile 切换；第三方插件不兼容时应明确拒绝。
7. 检查渠道接收和回复、通知、托盘、终端入口及恢复流程。
8. 在 Windows 实机验证安装升级、PowerShell 与路径选择；在 macOS 验证实际发行包及原生窗口。

## 数据、限制与回退

自动化冒烟使用隔离的临时 DSH_HOME。排查时发现早期测试未设置该变量，曾生成一条自有合成测试会话，已仅清除该合成记录并修复测试隔离。随后按用户启动失败反馈验证了日常 desktop Profile；未重置、清空或手工改写原有配置、会话、凭据、Cron 与叮嘱数据。应用正常启动可能更新自身日志、缓存和状态。现有会话夹具迁移通过不构成对任意用户历史数据的完整兼容认证。

根依赖中的 dshmarket 仍声明较旧的 dsh-settings peer 范围，会产生 peer 警告；现有设置兼容补丁与测试保留，未擅自放宽上游声明。用户单独安装的第三方插件需按其实际版本验证。浏览器插件提示本机缺少 bsk CLI，属于该插件外部运行依赖，本次未安装。

Windows 原生运行、安装升级、真实模型请求和真实渠道收发需要在相应系统与授权账号下人工验证。自动化通过不等于这些项目已经完成。

回退使用升级前产品和升级前完整数据备份。先退出全部 ClawClaw 进程，另存升级后的数据，再恢复升级前数据目录和应用状态目录；工作区文件如有变化需独立处理。开发环境回退应使用升级前提交的独立 worktree、初始化对应 submodule，并重新 frozen install/build。不要在当前用户工作区使用破坏性的 reset，也不要默认旧运行时可直接读取新运行时写过的数据。现有三个配置检查点不含会话、凭据和工作区，不能替代完整备份。
