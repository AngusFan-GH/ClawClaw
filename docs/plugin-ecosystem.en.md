# ClawClaw plugin ecosystem

[中文](plugin-ecosystem.md)

ClawClaw follows DSH composition: upstream, Desktop, Channels, Market, and third-party plugins meet through explicit contracts. The goal is choice, diagnostics, and maintainability, not unrestricted local-machine access for every plugin.

1. **Prefer general contracts.** Ordinary plugins depend on upstream DSH; desktop features use `desktopProfiles`, `desktopPnpm`, and `desktopWindow` only when needed. Do not depend on Electron, private RPC, or file layouts.
2. **Declare boundaries clearly.** State execution location, network requests, permissions, data locations, compatible versions, and restart needs. Market metadata cannot replace the plugin's own documentation.
3. **Prefer user confirmation and recoverability.** Installation, account authorization, network exposure, and file operations need explicit user actions. Recovery checkpoints are not plugin transactions or complete backups.
4. **Respect provenance and licenses.** Plugin packages, catalogs, and channel suppliers own their metadata, services, and licenses. Installability, catalog presence, or a settings entry does not imply project endorsement.

Community Market provides catalog selection, discovery, detail, and confirmed npm operations. `dshmarket` is an optional compatibility provider. Fabric remains an RFC Draft; without reviewed schemas, a reference adapter, and conformance evidence, it is not a stable interoperability standard.

Plugin authors should start with [plugin development](plugin-development.en.md); market providers should use [Community Market documentation](../dsh-community-market/README.md); current runtime ownership is in [architecture](architecture.en.md).
