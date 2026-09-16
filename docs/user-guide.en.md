# ClawClaw user guide

[中文](user-guide.md)

## Installation and first launch

Use artifacts actually published in [ClawClaw Releases](https://github.com/AngusFan-GH/ClawClaw/releases). Windows x64 uses NSIS or a portable ZIP; macOS uses a DMG. Installers contain Electron, Node, pnpm, and the DSH runtime. See [Contributing](../CONTRIBUTING.en.md) to build from source.

An uninitialized profile first opens Setup Wizard for mode, material, market, notifications, browser, and network preferences, with a skip option. The main Host and window start after setup finishes. Closing the main window normally hides it; reopen through the tray, or choose Quit to stop the application.

## Data directories

| Content | Default location |
| --- | --- |
| Harness data, profiles, settings, sessions | `~/.clawclaw/data` |
| Default workspace files | `~/.clawclaw/workspaces/default` |
| Stable application state and logs on macOS | `~/Library/Application Support/ClawClaw` |
| Beta application state and logs on macOS | `~/Library/Application Support/ClawClaw Beta` |
| Windows application state and logs | `%APPDATA%\ClawClaw` or `%APPDATA%\ClawClaw Beta` |

`~` is the current user's home. Without another data location, a sole legacy `~/.dsh` is moved into `~/.clawclaw/data`. If both directories exist, both are preserved, the new directory is used, and a conflict is logged without merging. Back up important data before migration. A data-directory selection saved in the application takes precedence over startup defaults; without a saved selection, explicit `DSH_HOME` can override the default. Safe mode uses separate temporary data and workspace locations.

Harness data and workspace files are separate: changing the data directory does not move the default workspace. Stable and Beta share default Harness data and workspace paths while separating Electron application state. Portable ZIPs do not provide self-contained data storage.

## Workspaces

The application registers a protected default workspace, stored with the title “默认”. Its registration cannot be deleted. Existing workspaces remain available; selection for new sessions considers persisted activity, the current selection, and the default workspace.

From the conversation home or sidebar, browse folders, enter an absolute path, return home, create folders, show hidden folders, or use the system picker. Select a directory before creating or switching workspaces. A workspace identifies task files; a profile determines which plugins load.

## Channels

Open Channels, select a platform, and follow its credential or QR configuration flow. The current UI exposes Weixin, WeCom, Feishu, DingTalk, QQ, iMessage, Telegram, WhatsApp, Discord, and Slack. iMessage requires macOS. Connection availability depends on account permissions, configuration, and network access; a bundled entry does not authorize an account.

Channel workspace resolution uses the channel's `workspace`, plugin `defaultWorkspace`, `CLAWCLAW_DEFAULT_WORKSPACE`, then `~/.clawclaw/workspaces/default`, in that order. Incoming messages replace archived or unavailable bound sessions with a usable session. Messages and replies pass through the platform; see [data handling](../PRIVACY.md) and the [Channels reference](../channels/dsh-im/README.md).

## Profiles and recovery

A profile combines bundles, dependencies, and patches. The tray discovers existing profiles and the lazily created `desktop` and `web` defaults. Switching persists the target before an orderly restart and does not copy plugins from the old profile.

Startup failure does not automatically select a previous profile. Recovery provides plugin management, rollback, profile switching, and diagnostics. Healthy starts maintain three rotating checkpoints covering active-profile declarations and shared Harness-home `settings.yaml` and `cordis.patch.yml`. Restore requires selecting an exact slot. Checkpoints exclude credentials, `.env`, sessions, storage, caches, and workspace files; they are not full backups.

## Windows and local access

- **Compatibility** preserves the default upstream client layout. On macOS/Windows a separate Desktop WebContentsView owns the 36-pixel toolbar, isolated from content-plugin CSS.
- **Extended** combines isolated chrome with a Desktop layout hosting upstream sidebar, conversation, and details.
- **Advanced** uses its own root and compact integrated captions.

macOS supports transparent materials; Windows 11 build 22621 and newer can provide Mica. Linux supports compatibility mode only. Mode and material changes restart the application.

The Web service defaults to loopback with port `0` (system assigned). Plugins requiring a stable browser origin can use an available fixed port in settings or:

```yaml
dsh-desktop:
  port: 43189
```

Opening in a browser does not enable LAN exposure. LAN access is a separate setting; the UI displays actual URLs. Reachability is not user authentication: admitted clients may operate local files through sessions and tools. Use trusted networks only.

## Plugins and terminal

Select Community Market, `dsh-market`, or disabled in settings. Community Market discovers entries from the chosen catalog and resolves an exact npm version for confirmed installation. Third-party plugins run with local user permissions.

Open the desktop terminal to run commands against its active profile:

```sh
dsh plugin add <plugin>
dsh plugin remove <plugin>
dsh plugin update
```

An explicit `--profile <name>` takes precedence. Restart after plugin changes. Private `dsh`, `pnpm`, and `node` shims and `DSH_HOME` apply to that terminal, not global PATH. Existing terminals retain the profile selected when they opened.

## Updates

Packaged applications read `https://clawclaw.xzinfra.com/updates/<stable|beta>/release.json`. Background failures or unchanged versions are silent; manual checks show a result. Beta accepts only `-beta.N` versions; installing Stable is a separate action.

After download confirmation and destination selection, the application fetches the manifest's HTTPS artifact and verifies SHA-512 and its DMG/PE container. Requests do not send the original project's `X-DSH-Desktop-*` statistics headers. Digest verification is not publisher-signature verification. On macOS, replace the application using the opened DMG; Windows hands off to NSIS after confirmation. Downloaded installers can be removed after installation. Actual checks determine whether the service and artifacts are available.

## Troubleshooting

- Check the tray after closing a window. Quit stops the background service.
- For missing plugins, check the target profile, restart, and inspect logs.
- For Channels failures, check credentials, permissions, network access, and page errors. Never publish credentials.
- Export a diagnostic ZIP from the tray. If startup crashes, run the installed executable with `--export-diagnostics`, for example on Windows:

  ```powershell
  & "$env:LOCALAPPDATA\Programs\ClawClaw\ClawClaw.exe" --export-diagnostics
  ```

- Logs live under application data in `logs/`; exported ZIPs use `diagnostics/`. Review exports before sharing: they can contain paths, session content, and crash-memory fragments.

Report unresolved problems at [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues) with operating system, version, reproduction steps, and sanitized errors.
