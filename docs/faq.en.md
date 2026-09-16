# ClawClaw FAQ

[中文](faq.md)

## How does this relate to DeepSeek Harness and DSH Desktop?

ClawClaw is independently maintained on their foundations. DeepSeek Harness supplies the agent runtime; DSH Desktop supplies the desktop foundation. ClawClaw does not represent their official products or services.

## Where are installers? Is Node.js required?

Check [ClawClaw Releases](https://github.com/AngusFan-GH/ClawClaw/releases). Installers bundle their runtime; source development requires Node.js and Corepack, as described in [Contributing](../CONTRIBUTING.en.md). macOS/Windows are the primary packaging targets. Linux source support does not imply a published distribution.

## Does a local application work offline?

Host, configuration, and workspace files are local. The default SpiritX model uses a remote API requiring credentials and network access. Channels, markets, updates, and networked plugins also contact external services. See [data handling](../PRIVACY.md).

## Where is data stored? Is Beta isolated?

Defaults are `~/.clawclaw/data` for Harness data and `~/.clawclaw/workspaces/default` for workspace files. Stable/Beta share these defaults; Electron state uses separate ClawClaw and ClawClaw Beta application-data directories. See the [user guide](user-guide.en.md) for overrides and migration.

## Why cannot I delete the default workspace?

Host protects its registration as the default file location for new sessions and Channels. Add or select other workspaces as needed. Registration protection does not back up files.

## Why do Channels still need setup?

The application supplies adapters and settings, not platform accounts. Each platform needs credentials, QR authorization, or permissions. iMessage requires macOS.

## Is the plugin market implemented?

`dshmarket` is bundled and can be selected or disabled. Fabric remains a community RFC Draft, not an installable SDK. Market installation is not a security review; plugins run with local user permissions.

## Are profiles and workspaces the same?

No. Profiles select plugins and configuration; workspaces select task directories. Desktop terminal plugin commands use the profile selected when the terminal opened. Restart after changes. Switching profiles does not copy plugins.

## Is upstream completely unchanged?

The upstream Git submodule is read-only. Actual runtime packages are vendored and receive explicit compatibility patches from `patches/`. Desktop plugins also change model, brand, workspace, and channel composition.

## Does startup failure automatically roll back?

No automatic profile switch or configuration restore occurs. Select a checkpoint in Recovery. Checkpoints exclude sessions, credentials, and workspace files; they are not backups.

## How do I update or report issues?

Use the application's update check. Channel-specific ClawClaw manifests supply artifacts that are digest-verified before user-confirmed installation. Report problems at [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues), including version, platform, reproduction, and sanitized logs.
