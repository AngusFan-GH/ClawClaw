# Why ClawClaw exists

[中文](why-desktop.md)

ClawClaw packages the composable DSH runtime as a desktop application intended for regular use, and adds product-layer support for local workspaces and messaging channels. It does not rewrite the agent runtime or pretend that the Web UI is a native Electron UI.

## Boundaries

- Upstream DSH remains responsible for agents, models, tools, sessions, profiles, and Web protocol.
- ClawClaw owns Electron lifecycle, isolated Host, workspace defaults, Channels entry points, desktop windows, terminal, recovery, market selection, and update client behavior.
- Third-party plugins integrate through published Cordis/Web contracts and do not gain windows, tray, private RPC, installers, or launcher-private state.

An unchanged upstream submodule is a source-ownership rule. The actual product still combines pinned runtime tarballs, root pnpm overrides, explicit patches, and Desktop/Channels plugins. Compatibility work must validate the composition rather than only reviewing the submodule diff.

## Why workspaces and Channels

Profiles describe dependency composition, but ordinary tasks need a clear and safe starting location for files. ClawClaw registers a non-deletable default workspace, lets users add or choose other directories, and lets Channels use it when no channel-specific directory is configured. It neither moves existing files nor treats a workspace as a profile copy.

Channels connect messaging platforms to existing task and session capabilities. Channel configuration, account authorization, platform limits, and message transport remain a relationship between the user and the platform. A built-in entry point is not account hosting, a service-availability guarantee, or a security review.

## Why plugins remain central

Desktop, Market, and Channels are compositional layers, not direct modifications of upstream private APIs. Ordinary DSH plugins can still run in CLI or Web profiles, while ClawClaw-only plugins can depend on explicit `desktopProfiles`, `desktopPnpm`, and `desktopWindow` contracts. Host generation defines lifecycle: profile or presentation changes require plugins to release old services and subprocesses.

Community Market is currently implemented as a private built-in package. Fabric remains a community RFC Draft. Catalog presence or installability does not mean compatibility, security, license, or privacy review.

## Who should read this

Start with the [user guide](user-guide.en.md) to use the application. Plugin authors should read [plugin development](plugin-development.en.md) and the [service contract](../dsh-plugin-desktop/docs/plugin-services.md). Maintainers should use [architecture](architecture.en.md) and the Desktop package READMEs for startup, packaging, and release work.
