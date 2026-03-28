# ClawClaw 与 OpenClaw 对齐优化清单

本文档用于梳理 ClawClaw 当前与 OpenClaw 上游之间仍需补齐的同步、兼容、产品化与发布保障项，方便后续按优先级选择并推进修改。

对照基线：

- ClawClaw 项目：`/Users/angusfan/Documents/xzinfra/projects/clawx`
- OpenClaw 本地源码：`/Users/angusfan/Documents/xzinfra/research/openclaw`
- 当前对照版本：`openclaw@2026.3.24`

## 1. 当前已经补好的部分

- `openclaw.json` 损坏时的自动修复、备份与启动恢复提示
- 默认 provider / 默认模型 / runtime auth 的启动前同步
- 单通道更新逻辑收口为 `stable`
- 插件镜像损坏时的自动重装校验
- 升级兼容测试基线
- 本地发版门禁：`pnpm run release:check`

这些改动已经显著降低了“升级后无法启动”和“UI 配置与 runtime 分叉”的风险。

## 2. 建议优先级

### P0：建议优先处理

1. 主动升级迁移机制
2. Sessions 会话系统专项优化
3. MemorySearch 配置面补齐
4. `plugins.slots` 与 memory/context-engine 插件体系支持
5. 发版流程固定接入 `release:check`

### P1：中优先级

1. Gateway auth surface 与上游 secrets/runtime 对齐
2. Browser 配置与迁移能力补齐
3. Session reset / compact / usage 产品入口
4. 插件 config-state 可视化
5. 升级恢复与发布可观测性

### P2：后续增强

1. 跨 session 工具产品化
2. `skills.entries` 完整配置化
3. 更完整的 OpenClaw 高级配置 UI

## 3. 需要优化和修改的内容

### 3.1 升级兼容与迁移

#### 3.1.1 缺“主动迁移”，当前仍偏被动修复

现状：

- 当前以 `sanitize`、启动恢复、`doctor --fix` fallback 为主
- 更偏向“配置已经坏了，再修”

问题：

- 很多旧配置并不会直接导致启动失败，但会产生语义漂移
- 用户升级后可能表现异常，而不是立即报错

建议：

- 在检测到 OpenClaw 版本升级后，执行一次轻量兼容迁移
- 将上游 `doctor-legacy-config` 的高频迁移项整理成本地兼容表

优先级：`P0`

#### 3.1.2 还没有系统吸收 OpenClaw `doctor` 的兼容迁移项

上游已处理的典型迁移包括：

- `browser.profiles.*.driver: "extension"` -> `"existing-session"`
- 单账号 channel 顶层字段 -> `channels.<provider>.accounts.default`
- `skills.entries.nano-banana-pro` -> `agents.defaults.imageGenerationModel` / `models.providers.google`
- streaming / dm alias / talk / cross-context 等旧字段迁移

建议：

- 挑出和 ClawClaw UI、Setup、Settings 直接相关的迁移项优先落地
- 对升级链做“主动迁移 + 启动兜底修复”双层策略

优先级：`P0`

### 3.2 Provider / Auth / Runtime 同步

#### 3.2.1 主链已改善，但还没有完全对齐上游 secrets/runtime 模型

现状：

- 已经支持默认 provider、默认模型、auth profiles、`models.json` 的同步
- 多 agent auth 收敛已有测试覆盖

剩余问题：

- 上游 `gateway.auth.token`、`memorySearch.remote.apiKey`、`skills.entries.*.apiKey` 已进入统一 secrets/runtime 体系
- ClawClaw 还主要停留在“按字段写配置文件”

建议：

- 后续逐步从“字段同步”升级到“理解 OpenClaw secrets surface”
- 在 UI 保存后增加 runtime 一致性校验

优先级：`P1`

#### 3.2.2 `gateway.auth.token` 当前是明文直写

现状：

- ClawClaw 会将 `gateway.auth.mode=token` 和 `gateway.auth.token=<plaintext>` 写入 `openclaw.json`

风险：

- 与上游 `SecretRef` / gateway service repair / auth surface 不完全一致
- 后续若产品支持更复杂部署，这里会成为限制点

建议：

- 后续升级为兼容上游 auth surface，而不只是写死 token

优先级：`P1`

### 3.3 Sessions 会话系统

这是当前最值得单独拉一条线处理的模块。

#### 3.3.1 会话列表加载没有充分利用上游预览能力

现状：

- ClawClaw 会先 `sessions.list`
- 然后对很多 session 再调用 `chat.history(limit: 1000)` 推 label 和最后活跃时间

上游能力：

- `sessions.list(includeDerivedTitles, includeLastMessage)`
- `sessions.preview`

问题：

- session 数量一多，IO 和请求放大明显
- 侧边栏和冷启动会话恢复会更慢

建议：

- 优先改为使用上游 preview/derived title 能力

优先级：`P0`

#### 3.3.2 仍使用 synthetic session，新建会话没有真正接入上游原生创建与解析

现状：

- ClawClaw 本地先造 synthetic session key
- 第一条消息发出后才 materialize

问题：

- 会话恢复、去重、current session 对齐逻辑复杂
- 边界场景较多

建议：

- 逐步接入 `sessions.create`
- 同时补 `sessions.resolve`

优先级：`P0`

#### 3.3.3 没有接上游按 session 粒度的订阅与 transcript 流

上游能力：

- `sessions.messages.subscribe`
- `sessions.messages.unsubscribe`
- `/sessions/{sessionKey}/history?follow=1` SSE

问题：

- 目前更依赖 gateway 事件 + 必要时补拉历史
- 实时 transcript 增量同步能力没有充分利用

建议：

- 增加 session 粒度订阅或 transcript SSE

优先级：`P1`

#### 3.3.4 缺少 session 生命周期管理入口

上游能力：

- `sessions.reset`
- `sessions.compact`
- `sessions.usage`

ClawClaw 当前：

- 有 delete
- 没有 reset
- 没有 compact
- usage 主要靠本地 transcript `.jsonl` 解析

建议：

- 先补 `reset`
- 再补 `usage`
- `compact` 可作为进阶能力

优先级：`P1`

#### 3.3.5 Session 归档、裁剪、磁盘预算与维护状态未产品化

上游会话存储包含：

- pruning
- disk budget
- archive
- transcript rotation
- maintenance warnings

问题：

- 客户只会感觉“会话怎么没了/变短了”
- 缺少解释与状态可见性

建议：

- 增加 session retention / archive / maintenance warning 的产品展示

优先级：`P1`

#### 3.3.6 上游跨 session 工具链还没产品化

上游已有：

- `sessions_list`
- `sessions_history`
- `sessions_send`
- `sessions_spawn`

ClawClaw 当前仍更像“当前会话聊天器”。

建议：

- 先明确是否要把这部分作为产品能力承接
- 如果要，则需要单独规划 UI 与权限模型

优先级：`P2`

### 3.4 Memory / Browser / Gateway 配置面

#### 3.4.1 `memorySearch` 只同步了开关，没有跟上完整配置面

当前只同步：

- `agents.defaults.memorySearch.enabled`
- `session-memory` hook 开关

但上游 `memorySearch` 已包含：

- provider / fallback / model
- remote.baseUrl / apiKey / headers / batch
- store / chunking / sync / query / cache
- experimental.sessionMemory

问题：

- 后续只要涉及 embedding provider、远程向量、检索调优，ClawClaw 就不够用

建议：

- 将 `memorySearch` 作为独立专项补齐

优先级：`P0`

#### 3.4.2 `sessionMemory` 与 sessions 生命周期联动不够

问题：

- 用户看不到哪些 session 被归档、参与 memory capture、参与 memorySearch
- 与 reset/compact/subagent session 的关系也没有产品化

建议：

- 和 sessions 专项一并规划

优先级：`P1`

#### 3.4.3 Browser 配置同步太浅

当前只保证：

- `browser.enabled = true`
- `browser.defaultProfile = "openclaw"`

上游实际还涉及：

- `browser.profiles.*`
- driver 迁移
- `browser.ssrfPolicy`
- existing-session attach 兼容

建议：

- 至少先补兼容迁移
- 后续再决定是否做完整 UI

优先级：`P1`

### 3.5 Plugins / Skills / 扩展体系

#### 3.5.1 `plugins.slots` 还没有承接

上游已有：

- `plugins.slots.memory`
- `plugins.slots.contextEngine`

问题：

- ClawClaw 现在只负责装插件，不负责管理插件槽位
- 后续 memory/context-engine 插件难以产品化配置

建议：

- 优先补 `plugins.slots`

优先级：`P0`

#### 3.5.2 `memory-core` / `memory-lancedb` 插件体系还没真正承接

问题：

- 上游 memory 已逐步插件化
- ClawClaw 还主要用简单设置开关对接

建议：

- 与 `memorySearch` 一起规划

优先级：`P1`

#### 3.5.3 `skills.entries` 还没有完整产品化

问题：

- 上游 `skills.entries.*` 已进入 secrets/config 面
- ClawClaw 当前更多是安装和展示，不是完整配置与 secret 管理

建议：

- 后续将 skill config 纳入设置体系

优先级：`P2`

### 3.6 发布门禁与可观测性

#### 3.6.1 发版门禁已经有命令，但还需固化为团队流程

当前入口：

- `pnpm run release:check`

建议的发版顺序：

1. `pnpm run release:check`
2. `pnpm run build:vite`
3. 平台打包
4. 用真实旧版本用户数据做一次升级 smoke test

优先级：`P0`

#### 3.6.2 缺升级恢复与兼容问题的可观测性

建议增加统计项：

- 配置自动修复次数
- 配置重建次数
- provider/runtime 收敛修复次数
- 插件重装次数
- 升级后首次启动成功率
- 会话恢复耗时

问题：

- 目前更多依赖用户反馈和日志排查

优先级：`P1`

#### 3.6.3 缺发布产物一致性校验

建议关注：

- 更新元数据
- 平台安装包
- 更新源与产物的一致性

优先级：`P1`

## 4. 建议的推进顺序

### 第一阶段

1. 主动升级迁移机制
2. Sessions 专项优化
3. MemorySearch 配置面补齐

### 第二阶段

1. `plugins.slots` 与 memory 插件体系
2. Session reset / usage / compact
3. Browser 迁移与 Gateway auth surface 对齐

### 第三阶段

1. 插件 config-state 可视化
2. `skills.entries` 产品化
3. 跨 session 工具产品化
4. 升级/恢复可观测性

## 5. 推荐先选的 5 个改造项

如果只打算先做最值当的一批，建议优先从下面 5 项中选择：

1. 升级后主动迁移
2. Sessions 列表/恢复/创建链优化
3. MemorySearch 配置面补齐
4. `plugins.slots` 支持
5. 发版门禁固定执行

## 6. 后续使用方式

建议后续在评审或排期时，直接围绕本文件逐项挑选：

- 选择要做的项
- 标注负责人
- 标注预计工作量
- 标注是否影响升级兼容
- 标注是否需要补对应测试

如果后续开始逐项落地，建议把每项的状态补成：

- `todo`
- `in_progress`
- `done`
- `deferred`

