# ClawClaw

基于 **Tauri + 本地 ClawCore 运行时（Node）** 的跨平台桌面智能体。

ClawCore 拥有智能体循环、上下文、工具、预算、持久化与调度；通过 Pi 传输直连模型供应商，
模型密钥保存在系统钥匙串。本应用不包含 OpenClaw/Gateway/ClawHub 运行时，也没有本地
HTTP 代理——渲染层只通过白名单 Tauri IPC 与后端通信。

## 功能

- SQLite（`node:sqlite`）本地持久化与不可变事件日志
- 供应商账户：密钥入钥匙串、工作区默认唯一、一键验证
- 智能体：系统提示词、供应商/模型覆盖、工具策略与预算
- 版本化、需授权的工具：`core.time.getCurrentTime`（自动）与工作区受限的
  `core.artifact.readText`、`core.fs.listDirectory`（需审批，绝不重复执行）
- 本地技能库（随包只读 + 从本地文件夹安装），无远程市场
- 渠道：真实 token/Webhook 适配器（出站投递 + 入站路由）；微信/WhatsApp 二维码/OAuth
  明确标注为不支持，不做伪造
- 五段 cron（IANA 时区）+ 持久触发游标，停机不补跑
- 附件大小/MIME/路径逃逸控制与图片像素上限
- 带精确来源游标的对话摘要、FTS5 关键词记忆，按工作区隔离

## 开发

```bash
corepack pnpm install --frozen-lockfile   # Node >= 22.5
pnpm run typecheck
pnpm test
pnpm run build:backend && pnpm run smoke
pnpm run build:vite
pnpm dev
```

`pnpm run release:check` 按顺序执行完整门禁：类型检查、测试、两端构建、独立冒烟与 cargo check。

许可证：MIT
