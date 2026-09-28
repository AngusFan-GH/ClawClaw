# ClawClaw 官方 Desktop 实现借鉴与落地指南

[English](official-desktop-adoption-plan.en.md)

## 1. 目的和基线

本文指导 ClawClaw 在保持完全独立桌面壳的前提下，选择性借鉴 DeepSeek Harness 官方 Desktop。它既是实施顺序，也是每次变更的验收清单。

- ClawClaw 基线：`dsh-desktop` 分支，产品版本 `0.2.2`。
- 当前运行时基线：只读子模块和 vendored runtime 均为 DSH `0.1.5-rc.2`。
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
| Windows NSIS、macOS 签名/公证预检 | package/release scripts | 增量强化 |

## 4. 借鉴分类

### 4.1 可适配移植

| 官方参考 | 借鉴行为 | ClawClaw 落点 |
| --- | --- | --- |
| `quit-confirmation.ts` | 退出前检查、保守降级、重复请求合并、无 owner 原生对话框 | 新增中断快照和确认器，接入现有 shutdown |
| `update-schedule.ts` | 单调时钟、抖动、指数退避、并发检查合并 | 扩展 `update-lifecycle.ts` 周期调度 |
| `update-http-executor.ts` | 响应头和下载块空闲超时 | 适配当前 `electron-updater` 后接入下载器 |
| `test-windows-update-signature.mjs` | 用 `NsisUpdater.verifySignature()` 验证发布者、错签和未签名拒绝 | 新增 Windows 发布资格测试 |
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

### 阶段 2（P0）：更新调度抖动、退避和空闲超时

**状态：已完成（2026-09-28）**

目标：保留 ClawClaw 六小时正常轮询策略，同时避免大量客户端同刻请求，并使“连接存在但不再传输”的下载能确定失败。

改动：

- 调度使用 `performance.now()`，默认抖动 `20%`，失败指数退避到可配置上限。
- 自动、前台恢复和显式检查共享在途请求；手动检查绕过 deadline，但不启动第二个网络请求。
- 响应头超时和 chunk idle timeout 使用独立配置；先验证 `electron-updater` 当前内部 API，必要时单独升级依赖。

验收：确定性随机源/时钟单测覆盖上下界、退避复位、手动绕过、释放后不重挂 timer；模拟 stalled headers/body 后在界限内失败。回滚时可退回固定六小时调度，但必须保留现有下载哈希、大小、容器和 redirect 检查。

实际落地：首次检查仍固定为启动后 60 秒；成功后的基础间隔仍为 6 小时，默认 `20%` 抖动。失败按 12 小时、24 小时递增并封顶，成功后复位。手动检查继续绕过周期 timer，并通过既有 `checkTask` 共享在途网络请求。`DesktopUpdateHttpExecutor` 保留 `electron-updater` 的 Electron session、代理和校验链路，在响应头前及相邻响应数据块之间施加默认 60 秒空闲截止；可用 `DSH_DESKTOP_UPDATE_HTTP_IDLE_TIMEOUT_MS` 调整。manifest 的既有 15 秒请求总截止保持独立。

验证：更新聚焦测试 39 项通过；`corepack pnpm --filter dsh-plugin-desktop run typecheck`；`corepack pnpm --filter dsh-plugin-desktop run build`；`corepack pnpm --filter dsh-plugin-desktop run test`（1247 项通过、6 项既有跳过）。

### 阶段 3（P0）：Windows Authenticode 发布者资格验证

**状态：阻塞（资格门禁已实现；缺少 Windows 签名身份和凭据化 release 路径）**

目标：区分 PE 格式有效与 Authenticode 身份可信；更新元数据中的 `publisherName` 必须对应实际签名证书。

改动和验收：

- 保留 `verify-win-installer.ts` 作为 PE/容器 smoke，避免把格式检查误称为签名检查。
- 新增只在 Windows release qualification 运行的 `NsisUpdater.verifySignature()` 测试。
- 测试匹配发布者成功、错误发布者失败、未签名文件失败，并继续验证 SHA-512。
- 未提供签名身份的本地开发构建明确 skip；正式发布通道不得 skip。

回滚只允许移除测试接线，不允许降低生产 updater 已配置的发布者校验。

已落地部分：新增 `qualify:win-signature`，仅允许在原生 Windows 上针对已签名安装器、独立未签名负例和打包后的 `app-update.yml` 运行；它要求 `CLAWCLAW_WINDOWS_PUBLISHER_NAME` 与元数据完全一致，真实调用 `NsisUpdater.verifySignature()` 覆盖匹配、错误和未签名三种控制，并检查前后 SHA-512。原 `verify-win-installer.ts` 已明确改称 PE/COFF 结构检查。

阻塞原因：当前 `dist:win` 明确删除所有签名环境变量并传入 `win.signExecutable=false`，tag release 也沿用该未签名路径。仓库没有可验证的法定发布者字符串、代码签名证书或凭据化 Windows release 命令，不能伪造这些事实。解除阻塞需要选定发布主体，配置凭据化签名产物和独立未签名控制，将资格命令接入正式 release job，并禁止未通过报告的 Windows stable 上传。当前聚焦测试 7 项和完整 typecheck 已通过；真实 Authenticode 正/负例必须在上述条件具备后于 Windows 执行。

### 阶段 4（P1）：结构化 fatal crash report

**状态：待实施**

目标：在现有 abnormal-run marker 之外保存本地、限额、可诊断的 fatal report。

- 捕获 main/Host 的 fatal 类型、时间、产品版本、进程角色和经过清洗的 stack/message。
- 原子写入，固定文件数和总大小；禁止保存 token、环境变量、对话内容和任意请求体。
- 接入现有诊断导出；默认不上传。
- 测试损坏文件、并发写入、轮转、路径清洗和隐私字段排除。

### 阶段 5（P1）：可选的更新资格 journal

**状态：待实施**

目标：用户明确开启后，在本机记录检查、下载、校验、stage、安装交接和下次启动结果，便于判断更新链路质量。

- 默认关闭；设置文案和隐私说明同步更新。
- 只记录版本、阶段、错误分类、耗时和制品身份摘要，不记录完整 URL 查询、设备身份或用户内容。
- 有 schema 版本、大小上限、原子写入和一键清除；可包含在用户主动导出的诊断包中。

### 阶段 6（P1）：安装事务、回滚和卸载测试

**状态：待实施**

目标：用自动化证明安装失败不会破坏可启动版本，卸载行为与用户数据保留政策一致。

- 扩展 Windows VM 测试：覆盖版本升级、中途中止、损坏包、重启后完成和旧版本仍可启动。
- 明确应用文件、缓存、日志、Profile/工作区的卸载保留矩阵并测试。
- macOS 对 staged artifact、替换失败和重新启动补充等价 smoke。

### 阶段 7（P2）：后台驻留和更新就绪注意力

**状态：待实施**

目标：首次关闭到后台时只提示一次；更新已准备好时通过托盘/窗口状态温和提示，不抢焦点。

- notice 状态按 Profile/产品设置持久化并支持重置。
- 遵守系统通知权限；无权限时回退到 tray 状态。
- 不用教学式永久文案，不在每次关闭时重复通知。

## 6. 通用实施流程

每一阶段按以下顺序执行：

1. 用 `git show origin/master:apps/desktop/...` 读取固定的官方参考，不切换或修改子模块。
2. 写出 ClawClaw 行为契约和失败策略，再实现最小适配层。
3. 先运行聚焦测试，再运行 `corepack pnpm typecheck` 和 `corepack pnpm test`；涉及打包时运行对应 package gate。
4. 回写本文件的状态、实际偏差和验证命令。
5. 每个阶段单独提交；子模块 pin 变更永远另提提交。

完整 headless 发布前门禁为 `corepack pnpm check`。需要真实签名证书、Windows VM、公证服务或 GUI 的测试必须是显式 release qualification，不能让普通 headless gate 隐式启动图形界面或依赖秘密。

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
- `src/update-http-executor.ts`
- `src/update-journal.ts`
- `src/crash-report.ts`
- `src/background-notice.ts`
- `src/update-attention.ts`
- `scripts/test-windows-update-signature.mjs`
- `scripts/windows-sign.mjs`
- `tests/README.zh.md`

实现时若参考文件在上游发生变化，应在提交说明中记录新的 commit，而不是让本文的基线静默漂移。
