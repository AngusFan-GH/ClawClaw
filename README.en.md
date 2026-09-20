# ClawClaw

[中文](README.md) | English

An open-source desktop agent application built on DeepSeek Harness and DSH Desktop, integrating local workspaces, sessions, plugin markets, and messaging Channels.

This repository is maintained at [AngusFan-GH/ClawClaw](https://github.com/AngusFan-GH/ClawClaw). It is not an official product of or endorsed by DeepSeek, Anywhere Labs, or the channel platforms. Upstream code, dependencies, and licenses retain their attribution.

## Current status

The source version is **0.2.1**, with **0.2.1-beta.1** for Beta and **0.1.5-rc.2** for the pinned DSH source and runtime. These are repository versions, not a claim that every platform has a published installer. Check this project's [Releases](https://github.com/AngusFan-GH/ClawClaw/releases) for actual artifacts. Downloads from the original DSH Desktop website are not ClawClaw releases.

- **Desktop runtime**: native windows, tray, isolated Host process, three presentation modes, terminal, and recovery tools.
- **Workspaces**: a protected default workspace, directory browsing, direct path entry, folder creation, and a system directory picker.
- **Channels**: configuration surfaces for Weixin, WeCom, Feishu, DingTalk, QQ, iMessage, Telegram, WhatsApp, Discord, and Slack. Each platform still requires accounts, credentials, or QR authorization.
- **Plugin market**: bundled `dshmarket`, selectable or disabled in settings. Listing does not imply a security review.
- **Updates**: channel-specific ClawClaw release manifests, SHA-512 download verification, and user-confirmed installation.

Windows x64 and macOS are the primary packaging targets; macOS supports Universal builds. Linux compatibility mode and headless checks do not imply a published Linux distribution.

## Development startup

Use Node.js `^22.19.0` or `>=24.0.0`, Corepack, and Git. The outer workspace uses pnpm `11.8.0`.

```sh
git submodule update --init --recursive
corepack pnpm install --frozen-lockfile
corepack pnpm dev:beta
```

`dev:beta` opens a graphical application; `dev` launches Stable. Develop and validate in Beta first, then synchronize shared changes into Stable. For headless validation:

```sh
corepack pnpm check
corepack pnpm --filter @clawclaw/dsh-im run check
```

## Data and configuration

The default data directory is `~/.clawclaw/data`; the default workspace is `~/.clawclaw/workspaces/default`. An existing `~/.dsh` is moved when the new data directory does not exist. If both exist, both are preserved and the new directory is used without merging. Explicit `DSH_HOME`, a directory selected in the application, and safe mode have separate override rules; see the [user guide](docs/user-guide.en.md).

Stable and Beta have separate Electron application data but share these default Harness data and workspace locations. Beta is not a fully isolated data sandbox.

## Documentation

| Goal | Documentation |
| --- | --- |
| Installation, workspaces, Channels, recovery | [User guide](docs/user-guide.en.md) |
| Common questions | [FAQ](docs/faq.en.md) |
| Local data and network requests | [Privacy and data handling](PRIVACY.md) |
| All documentation and historical material | [Documentation index](docs/README.en.md) |
| Contribution and validation | [Contributing](CONTRIBUTING.en.md) |
| Processes, plugins, packaging, updates | [Architecture](docs/architecture.en.md) |
| Plugin interfaces and examples | [Plugin development](docs/plugin-development.en.md) |
| Desktop packages and release commands | [Stable](dsh-plugin-desktop/README.md) · [Beta](dsh-plugin-desktop-beta/README.md) |
| Channels implementation | [Channels](channels/dsh-im/README.md) |
| Community contracts | [Fabric Draft](dsh-community-fabric/README.md) |

## Attribution and license

The desktop product derives from [DSH Desktop](https://github.com/anywhere-labs/deepseek-harness-desktop). `deepseek-harness/` is a read-only official upstream submodule. The application consumes vendored DSH runtime packages with explicit compatibility patches under `patches/`; an unchanged submodule does not mean an unpatched runtime. Channels builds on `@xmanrui/dsh-im` 4.20.2 with attribution and third-party notices preserved.

The project uses the [MIT License](LICENSE). Dependency licenses are recorded in the desktop packages and [Channels notices](channels/dsh-im/THIRD_PARTY_NOTICES.md). Report issues at [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues) and submit pull requests to this repository.
