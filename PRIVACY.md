# ClawClaw data handling

[中文](PRIVACY.zh.md)

- **Version:** 2.0
- **Last updated:** 2026-09-16

ClawClaw is a local-first open-source desktop application. This notice describes known local storage and network behavior in this repository's source and builds. It is not a privacy promise for undeployed services, third-party builds, plugins, or platforms. The project is independently maintained at [AngusFan-GH/ClawClaw](https://github.com/AngusFan-GH/ClawClaw) and does not represent DeepSeek, Anywhere Labs, SpiritX, npm, GitHub, or messaging platforms.

## Local data

Default Harness data is `~/.clawclaw/data`; the default workspace is `~/.clawclaw/workspaces/default`. Data can include profiles, settings, sessions, logs, caches, plugin dependencies, and files saved in workspaces. Electron application data stores windows, logs, update state, and diagnostics. Explicit `DSH_HOME`, an application data-directory choice, and safe mode can change paths.

On first use, a sole `~/.dsh` is moved to the new default. If both exist, they are not merged. Healthy-start recovery checkpoints cover only selected profile declarations and shared settings/patches; they exclude credentials, `.env`, sessions, storage, caches, and workspace files.

## Network connections

Connections depend on user choices, profiles, and plugins. Known endpoints in the default Desktop composition are:

| Trigger | Recipient and data that may be sent |
| --- | --- |
| SpiritX model requests | `https://ai.xzinfra.com/spiritx-api/v1`; model requests, authentication information, and protocol metadata. Users configure `SPIRITX_API_KEY`. |
| Update checks | `https://clawclaw.xzinfra.com/updates/stable/release.json`; IP, time, User-Agent, and normal HTTP metadata. The client does not add original DSH Desktop installation UUID or `X-DSH-Desktop-*` statistics headers. |
| Confirmed downloads | The HTTPS artifact URL in a release manifest; IP, time, download path, and normal network metadata. The client verifies SHA-512 and container format. |
| dshmarket / pnpm | User-selected catalogs, npm registry, GitHub, or package/image sources; searches, package names, versions, browsing data, and normal metadata may be sent. |
| Channels | Relevant Weixin, WeCom, Feishu, DingTalk, QQ, iMessage, Telegram, WhatsApp, Discord, or Slack services; credentials, authorization/QR data, message content, attachment references, and protocol metadata depend on platform/configuration. |
| Other plugins/tools | Plugin- or user-configured models, MCP servers, websites, registries, and APIs; their own implementation and policies control scope. |

The default Desktop patch disables upstream session telemetry, DeepSeek session log, DeepSeek model API extensions, DeepSeek web search, and official package inventory. User profiles or plugins can enable other network behavior; inspect the active profile rather than relying only on this default.

## Local Web and LAN

The Web carrier listens on loopback by default. Opening a system browser still accesses a local service. When users explicitly enable LAN access, the service can bind network interfaces. Reachability is not user authentication: LAN clients may request operations on local resources through sessions and tools. Use trusted networks only. LAN traffic need not pass through project update services, but reaches connected clients.

## Diagnostics and sharing

Diagnostic ZIPs are created only when a user exports them. They can include application logs, Crashpad dumps, run markers, and system information. Recognized credentials are masked where possible, but paths, session text, tool output, plugin messages, or memory fragments can remain. Exports are never uploaded automatically. Review them and use trusted sharing channels.

## Choices and responsibility

Users can disable markets, remove plugins, disable LAN access, change models, or delete local data. The application cannot retract data already sent to a model, market, messaging platform, or plugin; review each recipient's policy. Uninstalling does not necessarily remove `~/.clawclaw`, workspaces, or application-data directories; back up files first.

This project has no account system or centralized user database. Report security or privacy issues at [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues) without credentials or private logs, or use a security channel published by repository maintainers when one exists.
