# 参与 ClawClaw

[English](CONTRIBUTING.en.md)

通过 [Issues](https://github.com/AngusFan-GH/ClawClaw/issues) 提交问题或功能建议，通过本仓库 Pull Request 贡献代码和文档。问题应包含系统、应用版本、复现步骤和脱敏错误；社区行为见[行为准则](CODE_OF_CONDUCT.md)。

## 环境与启动

使用 Node.js `^22.19.0` 或 `>=24.0.0`，安装 Corepack，使用根目录锁定的 pnpm `11.8.0`：

```sh
git submodule update --init --recursive
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

`dev` 会打开图形应用，其他验证保持 headless-safe。

## 所有权

- `deepseek-harness/` 是只读子模块。上游 pin 与桌面行为变更分开提交。
- `dsh-plugin-desktop/` 拥有 Desktop 的 Host、Client、Electron、打包和测试。
- `channels/dsh-im/` 拥有 Channels 产品层；供应方版本、构建修补和声明应一起维护。
- Fabric 仍是私有文档 Draft，无 runtime/SDK。
- 四个自有 package 共用外层 pnpm workspace。上游使用独立 workspace，只通过根 `upstream:*` 命令操作。
- vendored runtime、补丁、manifest、锁文件和 `upstream.json` 必须保持一致。参见[架构](docs/architecture.md)。

## 验证

```sh
corepack pnpm check:layout
corepack pnpm check
corepack pnpm --filter @clawclaw/dsh-im run check
```

`check:layout` 包含双语、依赖方向、vendored runtime 和仓库布局检查。`check` 覆盖 Fabric 与 Desktop 完整 gate；Channels 的独立测试需额外运行上述 `check`。根 `test` 和 `typecheck` 会包含 Channels。

仅文档变更至少运行双语与社区文档检查，以及 `git diff --check`；更改链接时验证本地目标。原生 UI、安装/卸载和签名行为需要对应目标系统的显式人工或打包验证。

## 文档与提交

- 保持中英文内容一致，修改文档后更新其相邻 `*.i18n.yaml` 中的 Git blob hash；不是只更新根 README 的记录。
- 可用 `git hash-object --path=docs/user-guide.md -- docs/user-guide.md` 获取示例文档的 hash；逐个填写对应记录，不把 hash 一致误当翻译质量检查。
- 日期化决策、研究和实验保留历史语境；当前用法放在产品指南、接口参考和包 README 中。
- 使用 conventional commits，如 `fix(desktop): ...`、`docs: ...`。PR 说明问题、最终行为、验证和限制。
- 生产依赖变化后，对 Desktop 包运行 `verify:notices`，检查生成差异并保留第三方许可。Channels 的独立声明也需复核。

发布与平台命令见 [Desktop 包](dsh-plugin-desktop/README.zh.md)。不要将本地构建描述为已发布或已签名产物。
