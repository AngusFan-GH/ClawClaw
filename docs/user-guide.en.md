# ClawClaw user guide

[中文](user-guide.md)

## Installation and first launch

Use artifacts actually published in [ClawClaw Releases](https://github.com/AngusFan-GH/ClawClaw/releases). Windows x64 uses NSIS or a portable ZIP; macOS uses a DMG. Installers contain Electron, Node, pnpm, and the DSH runtime. See [Contributing](../CONTRIBUTING.en.md) to build from source.

An uninitialized profile first opens Setup Wizard for mode, material, market, notifications, browser, and network preferences, with a skip option. The main Host and window start after setup finishes. The first close for each Profile explains that the application remains active in the background; after acknowledgement, later closes normally hide the window. Reopen it through the tray, or choose Quit to stop the application. Use "Reset background close notice" in Desktop settings to show the notice again.

## Data directories

| Content | Default location |
| --- | --- |
| Harness data, profiles, settings, sessions | `~/.clawclaw/data` |
| Default workspace files | `~/.clawclaw/workspaces/default` |
| Application state and logs on macOS | `~/Library/Application Support/ClawClaw` |
| Application state and logs on Windows | `%APPDATA%\ClawClaw` |

`~` is the current user's home. ClawClaw does not read, move, or modify another application's `~/.dsh`. To continue using data stored there, explicitly select that directory in the application after inspecting and backing it up; ClawClaw does not merge directories automatically. A data-directory selection saved in the application takes precedence over launch defaults; without a saved selection, `CLAWCLAW_HOME` can override the default data directory. Safe mode uses separate temporary data and workspace locations. After startup, ClawClaw exports the selected data directory as `DSH_HOME` to the Host, built-in terminal, and plugins; an external `DSH_HOME` is not a Launcher data-directory input.

Harness data and workspace files are separate: changing the data directory does not move the default workspace. Portable ZIPs do not provide self-contained data storage.

ClawClaw uses a conservative data-retention policy when the desktop application is uninstalled:

| Data | Uninstall behavior |
| --- | --- |
| Program files in the installation directory, uninstall entry, and shortcuts | Remove |
| Application cache, update state, and logs | Preserve |
| Harness data, Profiles, settings, sessions, and plugin state | Preserve |
| Workspaces and user files inside them | Preserve |

Uninstalling is therefore not the same as deleting local data. For complete removal, back up anything needed and then explicitly delete those data directories; never rely on the installer to delete a workspace.

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

Plugins in the sidebar is the single entry point: it manages installed bundles and, when a market is enabled, exposes Plugin Marketplace for discovery, search, and installation. Desktop settings only selects `dsh-market` as the provider or disables it; it no longer creates a second marketplace page. Third-party plugins run with local user permissions.

Open the desktop terminal to run commands against its active profile:

```sh
dsh plugin add <plugin>
dsh plugin remove <plugin>
dsh plugin update
```

An explicit `--profile <name>` takes precedence. Restart after plugin changes. Private `dsh`, `pnpm`, and `node` shims and `DSH_HOME` apply to that terminal, not global PATH. Existing terminals retain the profile selected when they opened.

## Automations and reminders

Automations in the sidebar manages ClawClaw scheduled tasks, including timing, activation, immediate runs, history, and task conversations. Upgrading to DSH 0.1.7-rc.2 does not migrate or delete existing tasks. The Desktop profile does not load upstream Schedule at the same time, avoiding two unrelated task catalogs.

Reminders in Settings are standing instructions that apply across workspaces and conversations, not scheduled tasks. They remain in Settings and are managed separately from Automations.

## Sidebar shortcuts

Use **Settings → General → Shortcuts** to pin, remove, and reorder up to four features or Settings sections. Pinned entries appear in the sidebar's top-level destination area. Panel entries open their feature directly, while settings entries open the matching section. Their icons and tooltips remain available when the sidebar is collapsed.

Shortcuts manage Plugins, Automations, and the Settings sections that currently exist through one list. The sidebar shows only pinned entries; new installs pin Plugins, Automations, Skills, and Reminders by default. Sidebar shortcuts are independent from the keyboard bindings under **Edit shortcuts**.

## Updates

Packaged applications consume only `https://clawclaw.xzinfra.com/updates/dsh/stable/release.json`; they do not use `latest.yml` or `latest-mac.yml`. Background failures or unchanged versions are silent; manual checks show a result.

Update qualification evidence in Desktop settings is off by default. When explicitly enabled, it keeps bounded local records of versions, update stages, classified outcomes, durations, and artifact summaries. Full URLs, raw errors, device identity, and user content are excluded. Evidence can be cleared at any time and is included only in a user-requested diagnostic ZIP.

After confirmation, the application saves the manifest's installer in the private `updates/installers/` directory under application data and verifies its size, SHA-512 digest, and DMG/PE container. Requests do not send the original project's `X-DSH-Desktop-*` statistics headers. Windows and macOS artifacts are intentionally unsigned; HTTPS and digest verification establish consistency with the release manifest, not publisher identity. Windows starts NSIS only after the Host shuts down successfully. macOS opens the verified Universal DMG for the user to replace the application manually. After upgrading, the application offers to remove the retained installer. Actual checks determine whether the service and artifacts are available.

## Troubleshooting

- Check the tray after closing a window. Quit stops the background service.
- For missing plugins, check the target profile, restart, and inspect logs.
- For Channels failures, check credentials, permissions, network access, and page errors. Never publish credentials.
- Export a diagnostic ZIP from the tray. If startup crashes, run the installed executable with `--export-diagnostics`, for example on Windows:

  ```powershell
  & "$env:LOCALAPPDATA\Programs\ClawClaw\ClawClaw.exe" --export-diagnostics
  ```

- Logs live under application data in `logs/`; exported ZIPs use `diagnostics/`. Review exports before sharing: they can contain paths, session content, structured fatal reports, explicitly enabled update qualification evidence, and crash-memory fragments.

Report unresolved problems at [ClawClaw Issues](https://github.com/AngusFan-GH/ClawClaw/issues) with operating system, version, reproduction steps, and sanitized errors.
