# ClawClaw 官方 Desktop 实现借鉴与落地指南

[English](official-desktop-adoption-plan.en.md)

## 1. 目的和基线

本文指导 ClawClaw 在保持完全独立桌面壳的前提下，选择性借鉴 DeepSeek Harness 官方 Desktop。它既是实施顺序，也是每次变更的验收清单。

- ClawClaw 基线：`dsh-desktop` 分支，产品版本 `0.2.4`。
- 当前运行时基线：只读子模块和 vendored runtime 均为 DSH `0.1.7-rc.2`。
- 调研的官方基线：`deepseek-ai/deepseek-harness` `master` 的 `21638c5631`（2026-09-27）。
- 官方参考目录：`apps/desktop/`。上游采用 MIT 许可证；实质复制代码时必须保留所需归属和许可证说明。

本文不是同步上游 Desktop 的计划。上游代码只作为行为和测试设计的参考，所有产品代码仍由 `dsh-plugin-desktop/` 所有。

## 2. 不可破坏的架构边界

以下约束优先于任何上游实现：

1. `deepseek-harness/` 是固定版本的只读子模块，桌面功能分支不得修改其中的文件。
2. ClawClaw 继续拥有品牌、Market、Channels、Profile、客户端插件、Electron 启动、打包和发布流程。
3. 兼容模式继续无覆盖地运行上游默认客户端；增强展示只能通过 ClawClaw Profile 组合和已记录的 slot/service 替换实现。
4. 主进程、隔离 Host utility process 和 renderer 的信任边界保持不变；新增能力通过私有、类型化 RPC 穿越边界。
5. `asar: false`、vendored DSH runtime 和双 `WebContentsView` 模式是当前有意设计，不为追随上游布局而改变。
6. GUI 启动保持显式；构建、类型检查、单测和 Loader smoke 必须能在无图形环境运行。
7. 上游子模块 pin 更新必须与 ClawClaw 行为变更分开提交。

## 3. 当前能力盘点

ClawClaw 已有下列能力，因此不再移植同类实现：

| 能力 | ClawClaw 当前实现 | 结论 |
| --- | --- | --- |
| Host 隔离和私有 RPC | `host-process.ts`、`host-process-entry.ts`、`host-rpc.ts` | 保留 |
| 单实例和 second-instance 唤醒 | `main.ts` | 保留 |
| 关闭窗口后驻留托盘 | `electron-shell-generation.ts`、`electron-runtime.ts` | 保留 |
| 更新检查和制品校验 | `update-lifecycle.ts`、`update-download.ts` | 增量强化 |
| Host 优雅关闭 | `shutdown.ts`、`startup-generation.ts` | 扩展检查，不替换 |
| 异常运行标记、日志和诊断导出 | `crash-evidence.ts`、`log-files.ts` | 增量强化 |
| Cron Tasks 和提醒 | ClawClaw 自有控制器和客户端插件 | 纳入退出检查 |
| Windows NSIS、macOS Universal DMG | package/release scripts | 保持未签名并强化结构校验 |

## 4. 借鉴分类

### 4.1 可适配移植

| 官方参考 | 借鉴行为 | ClawClaw 落点 |
| --- | --- | --- |
| `quit-confirmation.ts` | 退出前检查、保守降级、重复请求合并、无 owner 原生对话框 | 新增中断快照和确认器，接入现有 shutdown |
| `update-schedule.ts` | 单调时钟、抖动、指数退避、并发检查合并 | 扩展 `update-lifecycle.ts` 周期调度 |
| 更新下载行为 | 私有目录、进度、大小/摘要/容器校验和安全安装交接 | 扩展 `update-download.ts` 与 Electron runtime |
| `crash-report.ts` | 结构化 fatal report、限额、原子写入 | 扩展现有 crash evidence，不上传 |
| `update-journal.ts` | 本地、可选的更新资格日志 | 新增 opt-in 本地 journal |
| installer tests | 安装事务、失败回滚、卸载保留/清理边界 | 加强 ClawClaw NSIS 测试矩阵 |
| `background-notice.ts`、`update-attention.ts` | 首次后台驻留提示、更新就绪提示 | 使用 ClawClaw 自有 locale/tray/window API |

“适配”意味着复制行为契约而非目录结构。每项实现必须使用 ClawClaw 的生命周期、语言、设置和测试设施。

### 4.2 明确不移植

- DeepSeek 账号、Platform 登录和官方云服务耦合。
- 官方强制更新 `40005` 协议及其产品策略。
- DeepSeek analytics、COS 发布和内部部署流程。
- `dsh-app://` shell 架构及官方窗口/客户端整体替换。
- 官方 ASAR 和运行时解析布局。
- SafeNet 专用签名编排。
- 原生自动更新框架及其 `latest.yml`、`latest-mac.yml` 和 blockmap 协议。

若未来确需以上能力，必须单独写设计记录，不能作为本计划的顺带变更。

## 5. 分阶段落地

状态取值为 `待实施`、`实施中`、`已完成` 或 `阻塞`。完成状态只有在代码、自动化测试和本文验收记录同时更新后才成立。

### 阶段 1（P0）：退出和安装更新前的中断检查

**状态：已完成（2026-09-28）**

目标：没有工作会被中断时静默退出；存在 active agent/job 或正在执行的 ClawClaw Cron Task 时要求用户确认；检查失败或超时必须保守提示。

改动：

- 定义稳定的 `DesktopInterruptionSnapshot`，只跨 RPC 传布尔值和计数，不暴露 Cordis 对象。
- `host-bootstrap.ts` 从 Cordis Host 读取 running agent、running/stopping job 和 Cron 执行状态。
- `startup-generation.ts` 对 in-process 与 isolated Host 暴露同一 `inspectInterruptions()`。
- `host-process-entry.ts` / `host-process.ts` 增加私有 RPC；主进程设置短超时。
- 新增一次只允许一个决策的原生确认器。重复退出请求共享 Promise，隐藏窗口不被强制显示。
- 普通退出、托盘退出、信号退出和安装更新最终都汇入同一批准/关闭路径；操作系统强制关机等不可交互路径保持可终止。

测试和验收：

- 覆盖空闲、active、scheduled、两者兼有、RPC 报错/超时和重复请求。
- 覆盖 in-process 与 utility-process Host 的相同结果。
- 用户取消后 Host 和窗口继续可用；用户确认后只释放一次 generation。
- headless 单测不创建真实 Electron 窗口。

回滚界线：新增检查和对话框可以整体移除，不能回滚或绕过原有 `DesktopShutdownCoordinator` 的幂等关闭保证。

实际落地：`interruption-inspection.ts` 通过 DSH 公开 registry 统计 running agent、两类 inbox 和去重后的 live job；ClawClaw Cron 控制器同时报告 running 和已启用且有下次触发时间的任务。`startup-generation.ts` 为 in-process/isolated Host 提供同一接口，私有 RPC 使用 2 秒截止和运行时结构校验。`quit-confirmation.ts` 合并检查、对话框和最终 shutdown；未知状态保守提示，取消不会释放 Host。崩溃异常仍直接进入原有有界关闭，不等待交互。

验证：`corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/interruption-inspection.spec.ts tests/quit-confirmation.spec.ts tests/startup-generation.spec.ts tests/host-process.spec.ts tests/shutdown.spec.ts`（33 项通过）；`corepack pnpm --filter dsh-plugin-desktop run typecheck`；`corepack pnpm --filter dsh-plugin-desktop run build`；`corepack pnpm --filter dsh-plugin-desktop run test`（1239 项通过、6 项既有跳过）。

### 阶段 2（P0）：更新调度抖动、退避和直接下载

**状态：已完成（2026-09-28）**

目标：保留 ClawClaw 六小时正常轮询策略，同时避免大量客户端同刻请求，并通过产品自有下载链路校验安装包。

改动：

- 调度使用 `performance.now()`，默认抖动 `20%`，失败指数退避到可配置上限。
- 自动、前台恢复和显式检查共享在途请求；手动检查绕过 deadline，但不启动第二个网络请求。
- manifest 请求保留有界超时；安装包下载支持取消、大小上限、进度和原子落盘。

验收：确定性随机源/时钟单测覆盖上下界、退避复位、手动绕过、释放后不重挂 timer；下载测试覆盖取消、超限、大小不符、摘要不符和容器不符。回滚时可退回固定六小时调度，但必须保留现有下载哈希、大小、容器和 redirect 检查。

实际落地：首次检查仍固定为启动后 60 秒；成功后的基础间隔仍为 6 小时，默认 `20%` 抖动。失败按 12 小时、24 小时递增并封顶，成功后复位。手动检查继续绕过周期 timer，并通过既有 `checkTask` 共享在途网络请求。安装包由 `update-download.ts` 直接通过 Electron 网络边界获取，写入应用数据目录的私有临时文件；只有大小、SHA-512 和 DMG/PE 容器全部通过后才原子替换目标文件。manifest 的既有 15 秒请求总截止保持独立。

验证：更新聚焦测试 39 项通过；`corepack pnpm --filter dsh-plugin-desktop run typecheck`；`corepack pnpm --filter dsh-plugin-desktop run build`；`corepack pnpm --filter dsh-plugin-desktop run test`（1247 项通过、6 项既有跳过）。

### 阶段 3（P0）：未签名跨平台发布与安装交接

**状态：已完成（2026-09-29）**

目标：在 Windows 与 macOS 都不签名的前提下，使用单一 `release.json` 协议完成下载、内容校验和平台适配的安全交接。

改动和验收：

- `release.json` 是唯一的更新指针，声明 Windows NSIS 和 macOS Universal DMG 的 HTTPS URL、字节数与 SHA-512。
- 发布脚本先上传两个带版本安装包，逐项复算大小与摘要，最后原子切换 `release.json`；不生成或上传 YAML/blockmap 元数据。
- Windows 在 Host 成功关闭后启动已校验的 NSIS；关闭失败时不得启动安装器。
- macOS 打开已校验的 DMG，由用户手动替换应用，不宣称原生自动替换或回滚。

实际落地：运行时不再依赖原生 updater；Windows 与 macOS 共用 `update-download.ts` 的私有目录、原子下载、大小/SHA-512/容器校验和保留制品状态。Windows 下载完成后等待退出确认与 Host 关闭，随后以可见方式启动 NSIS；macOS 下载完成后打开 unsigned Universal DMG。GitHub Actions 的 `release.yml` 从同一 tag 分派原生 Windows/macOS Runner，只收集 EXE、DMG 和生成的 `release.json`；`upload-update.mjs` 使用 SSH key 校验清单与实际文件一致、拒绝覆盖版本归档，并将清单作为最后一步发布。此模型的信任边界是 HTTPS 与发布摘要，不提供发布者身份认证；这是当前明确接受的产品约束，必须在用户文档中持续披露。

### 阶段 4（P1）：结构化 fatal crash report

**状态：已完成（2026-09-28）**

目标：在现有 abnormal-run marker 之外保存本地、限额、可诊断的 fatal report。

- 捕获 main/Host 的 fatal 类型、时间、产品版本、进程角色和经过清洗的 stack/message。
- 原子写入，固定文件数和总大小；禁止保存 token、环境变量、对话内容和任意请求体。
- 接入现有诊断导出；默认不上传。
- 测试损坏文件、并发写入、轮转、路径清洗和隐私字段排除。

已落地：`fatal-crash-report.ts` 为 main、隔离 Host 异常退出和 Electron native child 消失写入本地结构化报告。报告只包含 schema、时间、来源、进程角色、应用版本、平台/架构、PID，以及经 `maskSecrets` 和私有路径替换后的 message/stack；不遍历 Error 自定义属性，也不读取环境变量、请求正文或对话。每份 UTF-8 JSON 硬限制为 128 KiB，目录最多保留 10 份且合计不超过 1 MiB，采用同目录独占临时文件加原子 rename。写入和清理拒绝符号链接目录；轮转与诊断导出只接受单链接普通文件，避免通过符号链接或硬链接访问目录外数据。报告仅在用户主动导出的诊断 ZIP 中出现，没有网络上传路径。

接入点：main 未捕获异常、意外 Host 失败、Electron `child-process-gone` 和启动失败。写报告失败只记录已清洗错误，不阻断原有退出或恢复流程。损坏但命名合法的旧报告无需解析即可轮转；同一毫秒内多次写入使用 UUID 消除冲突。

验证：`corepack pnpm --filter dsh-plugin-desktop exec vitest run tests/fatal-crash-report.spec.ts tests/diagnostic-export.spec.ts tests/desktop-logger.spec.ts`（33 项通过）；`corepack pnpm --filter dsh-plugin-desktop run typecheck`；`corepack pnpm --filter dsh-plugin-desktop run build`；`corepack pnpm --filter dsh-plugin-desktop run test`（1258 项通过，6 项既有跳过）。

### 阶段 5（P1）：可选的更新资格 journal

**状态：已完成（2026-09-28）**

目标：用户明确开启后，在本机记录检查、下载、校验、stage、安装交接和下次启动结果，便于判断更新链路质量。

- 默认关闭；设置文案和隐私说明同步更新。
- 只记录版本、阶段、错误分类、耗时和制品身份摘要，不记录完整 URL 查询、设备身份或用户内容。
- 有 schema 版本、大小上限、原子写入和一键清除；可包含在用户主动导出的诊断包中。

已落地：桌面设置新增默认关闭、可热切换的“更新资格记录”及一键清除操作。`update-qualification-journal.ts` 只接受固定枚举事件和显式投影字段，覆盖本次启动就绪、检查请求/结果、下载确认/拒绝、release 二次确认、stage 完成、安装交接和分类失败；记录安装/目标版本、整数耗时，以及由发布元数据中的制品 digest 再派生的 SHA-256，不接受 URL、错误原文、任意扩展字段、设备身份或用户内容。隔离 Host 通过既有 typed runtime bridge 获取 Electron 拥有的私有目录，进程内 Host 使用同一 contract。

每次事件以同目录临时文件和原子 rename 刷新完整 JSON 快照；单文件不超过 64 KiB，最多 4 份且合计不超过 256 KiB。目录、轮转、清除和诊断导出拒绝符号链接目录，并跳过符号链接或多链接文件。清除活动 journal 后不会恢复旧内存事件。存储故障只产生已分类警告，不阻断启动或更新。只有用户主动导出诊断 ZIP 时才包含现存 journal，应用没有自动上传路径；根隐私说明、用户指南、恢复窗口文案和中英文设置文案已同步。

验证：更新 journal、状态机、native installer、设置/API、诊断 Worker、隔离桥和 Electron runtime 聚焦测试 202 项通过；`corepack pnpm --filter dsh-plugin-desktop run typecheck`；`corepack pnpm --filter dsh-plugin-desktop run build`；`corepack pnpm --filter dsh-plugin-desktop run test`（1264 项通过，6 项既有跳过）。

### 阶段 6（P1）：安装事务、回滚和卸载测试

**状态：已完成（2026-09-28；真实平台场景作为 release qualification 执行）**

目标：用自动化证明安装失败不会破坏可启动版本，卸载行为与用户数据保留政策一致。

- 扩展 Windows VM 测试：覆盖版本升级、中途中止、损坏包、重启后完成和旧版本仍可启动。
- 明确应用文件、缓存、日志、Profile/工作区的卸载保留矩阵并测试。
- macOS 对 staged artifact、替换失败和重新启动补充等价 smoke。

已落地：`installer-data-retention.ts` 将卸载边界固化为可测试的五项策略：安装文件、卸载注册项和快捷方式删除；应用缓存、日志、Harness/Profile 数据及工作区保留。`package.json` 的 NSIS 配置由单测约束为不得启用 `deleteAppDataOnUninstall`，中英文用户指南公开同一矩阵。

Windows 的既有 NSIS A/B 实验已覆盖正常升级、目标内容完整性、安装进程树中途中止、锁定 `app.asar`、中断后旧版/新版一致性判定和实际启动验证。本阶段进一步扩展 `smoke-windows-installer-upgrade.ps1`：先截断 candidate 的副本并要求 Windows 拒绝，随后验证旧版版本未改变且仍能启动；再执行运行中升级、候选版本重启、同版本覆盖和卸载。卸载前分别在 `%APPDATA%\ClawClaw` 的缓存/日志、隔离 `DSH_HOME` 的 Profile 及隔离工作区写入唯一 marker，卸载后要求应用目录、注册项、快捷方式消失而四类 marker 仍存在，最后只清理本次 marker。`check:win-package` 已纳入策略测试。

macOS 未开启原生自动更新，发布物是经用户确认后打开的 unsigned Universal DMG，因此不伪造应用内原子替换/rollback 能力。package smoke 验证 mounted DMG、`arm64`/`x86_64` 双架构和嵌入 native 文件；下载与 Electron runtime 单测证明下载/校验失败、取消或 Host 关闭失败都不会产生错误的安装交接。DMG 手动替换与重新打开仍属于真实 macOS 发布资格检查。

headless 验证覆盖 `installer-data-retention.spec.ts`、`update-download.spec.ts`、`electron-runtime.spec.ts` 和 macOS package smoke；完整 typecheck、生产 build 与单测作为最终门禁。当前 macOS 开发机无法执行 Windows PowerShell/NSIS VM smoke；真实 Windows 安装报告与 macOS DMG 手动替换结果仍须随对应发布保存，不能用 headless 结果替代。

### 阶段 7（P2）：后台驻留和更新就绪注意力

**状态：已完成（2026-09-28）**

目标：首次关闭到后台时只提示一次；更新已准备好时通过托盘/窗口状态温和提示，不抢焦点。

- notice 状态按 Profile/产品设置持久化并支持重置。
- 遵守系统通知权限；无权限时回退到 tray 状态。
- 不用教学式永久文案，不在每次关闭时重复通知。

已落地：`background-close-notice.ts` 将官方一次性提示状态机适配到 ClawClaw 的 Electron generation。第一次关闭主窗口时，应用在真正隐藏前显示中英文原生提示；重复 close 在对话框期间只重新聚焦窗口，不创建重叠对话框。只有明确确认才在 Electron `userData` 下写入按 Profile 名称 SHA-256 隔离的私有原子 marker；取消、对话框失败或 generation 释放均保持窗口可见。marker 写入失败不会阻断本次已确认的隐藏，但下次启动会再次提示。设置页通过私有同源 API 和 typed Host RPC 提供显式重置，不向 renderer 暴露文件路径。

更新后台检查继续先持久化每版本一次的通知状态，并把官方 update-attention 行为接到 ClawClaw 既有 `notifyAttention`：聚焦窗口完全静默；Windows 闪烁任务栏，其他平台累加应用徽标；系统原生通知仅在 Electron 报告支持时创建，点击只显示应用而不下载或安装。即使原生通知不可用，任务栏/徽标信号仍先执行，更新托盘项也持续显示可用版本，因此权限或平台能力不足不会移除回退路径。普通 `updates.notify` 保留给不需要额外窗口注意力的状态通知。

与官方实现的有意差异：状态按 Profile 而非全局产品键隔离；重置属于 ClawClaw 设置 API；macOS 全屏退出后隐藏的既有状态机保持不变；不引入永久教程文案，不让通知点击触发安装，也不复制官方 shell 或设置结构。

验证：`background-close-notice.spec.ts`、`electron-runtime.spec.ts`、`client-desktop-settings.spec.ts`、`host-runtime-bridge.spec.ts` 和 `updates.spec.ts` 共 156 项通过；完整 typecheck 和生产 build 通过；完整单测 1272 项通过、6 项既有跳过。测试覆盖首次/后续关闭、显式重置、并发 close、取消/失败/释放、Profile 隔离、符号链接目录拒绝、RPC 投影、后台更新去重、聚焦静默，以及系统通知不可用时的任务栏回退。

## 6. 通用实施流程

每一阶段按以下顺序执行：

1. 用 `git show origin/master:apps/desktop/...` 读取固定的官方参考，不切换或修改子模块。
2. 写出 ClawClaw 行为契约和失败策略，再实现最小适配层。
3. 先运行聚焦测试，再运行 `corepack pnpm typecheck` 和 `corepack pnpm test`；涉及打包时运行对应 package gate。
4. 回写本文件的状态、实际偏差和验证命令。
5. 每个阶段单独提交；子模块 pin 变更永远另提提交。

完整 headless 发布前门禁为 `corepack pnpm check`。需要 Windows VM 或 GUI 的测试必须是显式 release qualification，不能让普通 headless gate 隐式启动图形界面。

## 7. 完成定义

本计划完成需同时满足：

- 阶段 1 至 3 全部完成并进入默认发布门禁。
- 阶段 4 至 7 完成，或分别有经过评审的延期记录和明确风险所有者。
- 中英文用户文档、隐私说明和包级操作文档与最终行为一致。
- `corepack pnpm check` 通过；Windows/macOS release qualification 在对应平台通过。
- `deepseek-harness/` 工作树无修改，子模块 pin 未与桌面行为混在同一提交。

## 8. 上游出处

主要参考（均位于官方仓库 `apps/desktop/`）：

- `src/quit-confirmation.ts`
- `src/update-schedule.ts`
- `src/update-journal.ts`
- `src/crash-report.ts`
- `src/background-notice.ts`
- `src/update-attention.ts`
- `tests/README.zh.md`

实现时若参考文件在上游发生变化，应在提交说明中记录新的 commit，而不是让本文的基线静默漂移。
