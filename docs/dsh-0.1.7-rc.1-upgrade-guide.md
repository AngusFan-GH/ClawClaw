# ClawClaw 升级 DSH 0.1.7-rc.1 落地指南

## 1. 目标与不可破坏项

本次把 ClawClaw 使用的 DeepSeek Harness 从 `0.1.5-rc.2`
（`fb2c4b9e698e30edb738bca4cf0618587db7d203`）升级到 `0.1.7-rc.1`
（`46a7f68b0922371ce7144b668b90e377d8e799f4`）。ClawClaw 继续是完全独立的
桌面壳，上游 `apps/desktop/` 不进入产品运行路径。

升级完成后必须保持：

1. 现有 Profile、设置、用户插件和 `.agent-presets` 自定义 preset 可继续使用。
2. 已有 Session 可从 V2/V3 自动迁移到 V4，preset 身份和父子关系不丢失。
3. compatibility 模式仍使用未覆盖的上游默认客户端；extended/advanced 模式继续由
   ClawClaw 插件组合提供。
4. Electron 主进程、隔离 Host、私有 RPC、更新、恢复、通知、Skills、Market 和 Channels
   行为不回退。
5. `deepseek-harness/` 始终是只读 submodule；上游 pin 与桌面行为变更分开提交。
6. 所有构建、类型检查、单测和 Loader smoke 保持 headless-safe。

## 2. 上游变化与落点

| 上游变化 | 直接影响 | ClawClaw 落点 |
| --- | --- | --- |
| `dsh-settings-file` 移除，设置写入 Profile `cordis.patch.yml` | 启动前设置、Setup Wizard、checkpoint、Recovery | 从已合成的 Profile 行读取；Wizard 原子编辑当前 Profile patch；首次兼容读取旧 `settings.yaml`，交给上游一次性导入 |
| `dsh-agent-presets` 被声明式 registry 取代 | 内置 preset、`.agent-presets`、Skills scope、历史 Session | 使用 Web bundle 的四个内置声明；新增只读 legacy registrar；Skills 使用 `acquireScope()` lease |
| code/workflow runtime 重命名为 PTC packages | 依赖、Loader 行、打包清单、smoke | 替换为 `dsh-ptc-runtime`、`dsh-ptc-runtime-node`、`dsh-workflow-ptc` |
| Session 当前格式从 V3 升到 V4 | packaged migration smoke | 验证 V2/V3 到 V4、父子 catalog、源代保留和损坏拒绝 |
| app-boot 增加插件兼容性预检 | 自有 bundle 可能被拒绝 | 所有自有 DSH compatibility 元数据改为 `0.1.7-rc.1`，不得使用豁免掩盖不兼容 |
| Cordis 升至 `4.0.4` | Loader/include/group/timer API | 与目标 manifest 对齐并运行完整类型及 Loader 验证 |
| Web bundle 增加 plugin manager、config editor、authorization 等 | Profile 组合和 UI roster | 默认继承；仅对与 ClawClaw 产品策略冲突的行做显式 patch |

## 3. 设置兼容设计

### 3.1 新持久化模型

- `desktop-shell` 行拥有 `mode`、`port`、窗口材质、浏览器访问和网络暴露设置。
- `desktop-notifications` 行拥有通知设置。
- Setup Wizard 在 Host 启动前只编辑当前 Profile 的 `cordis.patch.yml`，保留其他 patch、
  `!!js` 表达式和未知字段。
- 启动设置从 bundle、Profile patch 和 home patch 的最终合成结果读取，确保与实际 Loader
  配置一致。

### 3.2 旧版本迁移

- 若 Profile 尚无对应显式配置且 `$DSH_HOME/settings.yaml` 存在，首启可从旧文件读取已知
  ClawClaw 字段，避免升级首启回到默认值。
- Host 启动后由上游 settings 服务把旧 section 导入 Profile，并将原文件改名为
  `settings.yaml.imported`。
- 第二次启动只读 Profile patch，不依赖已被改名的旧文件。
- 不主动删除 `settings.yaml.imported`，导入拒绝的 section 仍可人工恢复。

### 3.3 checkpoint 与 Recovery

- checkpoint 主配置对象改为当前 Profile 的 `cordis.patch.yml` 和 manifest。
- 迁移窗口内继续备份存在的 `settings.yaml` / `settings.yaml.imported`，但恢复文案不再把
  `settings.yaml` 描述为主设置文件。
- “打开设置”操作指向当前 Profile patch。

## 4. preset 兼容设计

### 4.1 内置 preset

内置 `standard`、`ptc`、`minimal`、`cordis` 直接采用
`@deepseek-ai/dsh-web-app/presets/*.patch.yml` 的声明式定义，不复制物理目录。

### 4.2 旧 `.agent-presets`

新增 ClawClaw Host 插件，在启动时只读扫描
`$DSH_HOME/.agent-presets/<id>/preset.yml` 和 `agent.cordis.yml`：

- 沿用旧版的目录名、metadata 和 Cordis entry-list 校验规则。
- 通过公开 `ctx.agentPresets.register()` 注册，不修改、移动或删除用户文件。
- 与内置 ID 冲突时官方 preset 优先，legacy registrar 记录明确告警并跳过同名用户项，不能让
  registry 出现重复 ID 或让用户目录替换产品核心 preset。
- 解析失败的 preset 保持可诊断，不影响其他 preset 或 Desktop 启动。
- 兼容层有明确移除条件：产品提供可审阅的 bundle 转换器并完成至少一个发布周期告警后，
  才能另行决策；本次升级不迁移用户数据。

### 4.3 Skills scope

- live Session 使用 `agentPresets.serviceFor(agent, 'skills')`。
- cold Session、Workspace 和 preset 浏览使用 `await using lease = acquireScope(id)`；Skills
  查询必须在 lease 生命周期内完成。
- 未知或损坏的历史 preset 继续返回明确错误，不静默切换到另一个 preset。

## 5. 实施阶段与提交边界

### 阶段 A：文档与上游 pin

1. 提交本指南。
2. 仅更新 submodule gitlink 和 `upstream.json` 的 source commit/version；单独提交。
3. 确认 submodule HEAD 精确等于目标 tag，且 submodule 工作树干净。

### 阶段 B：vendored runtime 与依赖图

1. 通过根 `upstream:*` 命令安装、构建、打包目标 runtime。
2. 生成 `vendor/dsh-runtime/0.1.7-rc.1` manifest/tarballs 和 workspace overrides。
3. 删除或替换已移除的 DSH dependencies；更新 Cordis vendor 版本。
4. 重基 16 个版本绑定 patch：上游已吸收则删除，仍需要则改到目标包和版本。
5. 更新 lockfile、third-party notice、packaged inventory 和 compatibility metadata。

阶段门禁：`check:vendored-runtime`、冻结 lockfile 安装、依赖中不存在
`0.1.5-rc.2` 或已移除包。

### 阶段 C：Profile、设置与 preset 迁移

1. 适配目标 Web/base 组合和新 app-boot API。
2. 落地 Profile patch 设置读写及旧设置首启桥接。
3. 落地 legacy preset registrar 和新 scope lease。
4. 更新 Setup Wizard、Recovery、checkpoint、Skills UI 和相关文案。

阶段门禁：聚焦的 profile/settings/preset/skills 测试和真实 Loader boot smoke。

### 阶段 D：Session、打包与运行时 smoke

1. 更新 V4 migration 断言和迁移包清单。
2. 更新 packaged filesystem/runtime smoke，不依赖已删除的 preset 目录。
3. 验证 ASAR resolver、Profile fallback、native picker、Windows subprocess 等本地 patch。
4. 验证 compatibility、extended、advanced 三种模式。

阶段门禁：package smoke、profile boot smoke、V2/V3/V4 migration 测试。

### 阶段 E：完整验证与收尾

依次执行：

```text
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
corepack pnpm check
git diff --check
git status --short
git -C deepseek-harness status --short
```

只有全部 headless 门禁通过才移除旧 vendored runtime。GUI、签名、Windows/macOS 真实安装器
验证继续作为显式 release qualification，不由普通 `check` 隐式启动。

## 6. 回滚与停止条件

- 任一阶段失败时回滚该阶段自己的提交，不移动已经验证的 submodule pin 提交。
- 不通过删除用户 Profile、Session、preset 或设置来解决升级失败。
- 若目标公开 API 无法保留旧 preset、Profile 设置或历史 Session 行为，立即停止并请求产品决策。
- 若某个本地 patch 无法在不改变安全边界的情况下重基，立即停止并报告 patch、上游变化和
  可选方案。
- 旧 runtime 目录保留到完整门禁结束，提供离线比对和恢复依据。

## 7. 完成定义

- runtime、submodule、metadata、lockfile 和所有 DSH dependency 均为 `0.1.7-rc.1`。
- 旧 `settings.yaml` 首启、二次启动和失败导入均有测试。
- 内置及旧自定义 preset、live/cold Skills、历史 preset Session 均有测试。
- V2/V3 Session 到 V4 的正常、父子和损坏路径均有测试。
- 三种桌面模式、隔离 Host、打包 runtime 和 Loader smoke 通过。
- 完整 `corepack pnpm check` 通过，submodule 无本地修改。
- 本文各阶段写回实际结果、偏差和验证命令。

## 8. 实际落地结果（2026-09-28）

### 8.1 已完成

- submodule 已固定到 tag `dsh-v0.1.7-rc.1` / commit
  `46a7f68b0922371ce7144b668b90e377d8e799f4`，上游工作树保持只读且干净。
- 已生成并校验 `vendor/dsh-runtime/0.1.7-rc.1` 的 309 个包；Desktop、Channel、patch、
  compatibility metadata 和 lockfile 均切换到目标版本。
- 已迁移 Profile/config editor、声明式 agent preset registry、PTC runtime、Session V4、Jobs
  事件订阅、Skills scope lease 和 Windows argv 执行接口。
- 已提供旧 `settings.yaml`、旧 Settings API 和 `.agent-presets` 的兼容桥；旧 preset 默认值迁移到
  `agent-preset-registry.selectedDefault`，同名时官方 preset 优先。
- Desktop 启动 overlays 会通过 `profileContext.overlays` 在 Config Editor reload 后重放；Cron
  仅在 rehydrate 后内容变化时写回，避免 reload 循环。
- Profile smoke 精确验证 0.1.7 的浏览器认证协议：token 兑换必须返回 `303`、`Location: ./`
  和 authority-bound cookie。
- 打包闭包包含 285 个可达的一方包节点；第三方声明覆盖 645 个生产依赖。

### 8.2 与原计划的偏差

- legacy preset 与官方 ID 冲突时没有保留旧版“用户覆盖”行为。0.1.7 registry 拒绝重复 ID，
  因此采用官方优先并告警；自定义且不冲突的 preset 继续原样注册，用户文件不会被修改。
- Settings compatibility patch 必须同时保留运行时原始 schema 和 volatile 表单 schema；若共用
  volatile schema，boolean/array 会以表单包装值进入 Desktop、Cron、Reminders 和 MCP。
- Config Editor reload 与旧设置导入可能发生短暂 revision 竞争；实现对三类已知 stale-entry 错误
  最多重试 10 个 event-loop tick，未使用会与 dispose 死锁的 `loader.await()`。
- 上游发布包缺少 `dsh-client-ui-primitives` source map，Vitest 会输出非致命 Vite 警告；构建、
  类型检查和测试结果不受影响。

### 8.3 验证结果

以下命令已通过：

```text
corepack pnpm install --frozen-lockfile
corepack pnpm typecheck
corepack pnpm test                 # 159 files, 1275 passed, 6 skipped
corepack pnpm build
corepack pnpm check                # 含 layout、vendored runtime、CLI、Loader、Profile、license、operations
corepack pnpm --filter dsh-plugin-desktop verify:notices
git diff --check
git -C deepseek-harness status --short
```

普通 headless 门禁不会启动 GUI，也不替代 Windows/macOS 的签名、真实安装器和平台原生 smoke；
这些仍属于发布前 qualification。
