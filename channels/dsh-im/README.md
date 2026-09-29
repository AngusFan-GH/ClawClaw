# ClawClaw Channels

[中文](README.zh.md)

`@clawclaw/dsh-im` is ClawClaw's messaging-channel package, version `0.2.0`. It composes pinned `@xmanrui/dsh-im` 4.20.2 Host channels with ClawClaw client navigation, directory picking, locale text, session handling, and outbound artifact behavior.

## Supported entries

The client currently exposes Weixin, WeCom, Feishu, DingTalk, QQ, iMessage, Telegram, WhatsApp, Discord, and Slack. iMessage requires macOS. Channel availability depends on platform account permissions, credentials, QR authorization, network access, and supplier behavior; a visible entry is not an account or service guarantee.

Host composition also includes Office internally, but it is not exposed by the current client navigation and is not a supported product entry.

## Workspace resolution

For each channel, the Host resolves its working directory in this order:

1. channel-specific `workspace`;
2. package `defaultWorkspace`;
3. `CLAWCLAW_DEFAULT_WORKSPACE` supplied by Desktop;
4. `~/.clawclaw/workspaces/default`.

Incoming activity replaces an archived or unavailable bound session with a usable session. This preserves messaging continuity but does not recover deleted user data or platform messages.

## Development

Run from repository root:

```sh
corepack pnpm --filter @clawclaw/dsh-im run build
corepack pnpm --filter @clawclaw/dsh-im run typecheck
corepack pnpm --filter @clawclaw/dsh-im run test
corepack pnpm --filter @clawclaw/dsh-im run check
```

The package delegates channel protocol behavior to `@xmanrui/dsh-im`. Keep its pinned version, local build patches, tests, and [third-party notices](THIRD_PARTY_NOTICES.md) aligned. Do not put provider credentials in source, test fixtures, logs, or issues.

See the product [user guide](../../docs/user-guide.en.md), [data handling](../../PRIVACY.md), and package [manifest](package.json).
