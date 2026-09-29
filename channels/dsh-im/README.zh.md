# ClawClaw Channels

[English](README.md)

`@clawclaw/dsh-im` 是 ClawClaw 的即时通讯渠道包，当前版本 `0.2.0`。它组合固定的 `@xmanrui/dsh-im` 4.20.2 Host 渠道，以及 ClawClaw 的 Client 导航、目录选择、语言文本、会话处理和出站产物行为。

## 支持的入口

当前 Client 提供微信、企业微信、飞书、钉钉、QQ、iMessage、Telegram、WhatsApp、Discord 和 Slack。iMessage 需要 macOS。实际可用性取决于平台账号权限、凭据、扫码授权、网络和供应方行为；可见入口不代表已拥有账号或服务保证。

Host 组合内部也包含 Office，但当前 Client 导航没有暴露它，不能作为已支持的产品入口。

## 工作区解析

每个渠道的工作目录按以下顺序确定：

1. 渠道自身的 `workspace`；
2. 包配置的 `defaultWorkspace`；
3. Desktop 提供的 `CLAWCLAW_DEFAULT_WORKSPACE`；
4. `~/.clawclaw/workspaces/default`。

新入站消息会把已归档或不可用的绑定会话替换为可用会话。这保证消息连续性，不会恢复用户已删除的数据或平台消息。

## 开发

从仓库根目录运行：

```sh
corepack pnpm --filter @clawclaw/dsh-im run build
corepack pnpm --filter @clawclaw/dsh-im run typecheck
corepack pnpm --filter @clawclaw/dsh-im run test
corepack pnpm --filter @clawclaw/dsh-im run check
```

本包把渠道协议行为委托给 `@xmanrui/dsh-im`。固定版本、本地构建补丁、测试和[第三方声明](THIRD_PARTY_NOTICES.md)必须一起维护。不要把供应方凭据写入源码、fixture、日志或 issue。

参阅产品[用户指南](../../docs/user-guide.md)、[数据处理说明](../../PRIVACY.zh.md)和 package [manifest](package.json)。
