# Install ClawClaw on Windows

[中文](install-windows.md) · [macOS installation](install-macos.en.md)

## Before downloading

The current Windows release target is **x64**. Check System type under Settings → System → About. There is currently no native Windows ARM64 or 32-bit package. Check the selected release notes for OS version requirements.

Download the Windows x64 Setup installer (`.exe`) from the download source provided by the project. Check the download information for system requirements and choose the package for your computer.

## Use the installer

1. Double-click the downloaded ClawClaw Setup installer (`.exe`).
2. Read the license information and continue through the wizard. Installation defaults to the current user; select a different directory in the wizard if needed.
3. Start installation and keep the window open. Installation may take several minutes; wait for it to finish.
4. Launch ClawClaw when installation finishes. Use the Start menu or desktop shortcut for future launches.

The usual current-user location is `%LOCALAPPDATA%\Programs\ClawClaw`; the directory selected in the wizard takes precedence. If Windows requests administrator permission, first confirm that it is the ClawClaw installer you just downloaded.

## If Windows protects your PC

If the installer is unsigned, Windows may show an unknown publisher or a Microsoft Defender SmartScreen prompt. Microsoft explains that unsigned files can trigger reputation warnings and organizational policies can prevent continuation. See [Microsoft's SmartScreen documentation](https://learn.microsoft.com/en-us/windows/apps/package-and-deploy/smartscreen-reputation).

Once you have confirmed that the file came from the project download source and you trust the download, choose More info → Run anyway if SmartScreen offers it. If continuation is unavailable, or organizational policy, Smart App Control, or antivirus blocks execution, keep the alert details and contact your administrator or the project maintainers. You do not need to disable system protection; investigate explicit malware detections first.

## Complete first-time setup

1. Follow the setup wizard. You can skip optional choices and adjust them later in Settings.
2. Connect a model when prompted, or configure it later in Settings → Models. Your chosen model may require an API key and network access; installing the app does not supply model service credentials.
3. Open the default workspace or add your own folder, create a conversation, and send a message to confirm that the model responds.

Closing the main window normally hides it while the app stays active. Reopen it from the taskbar notification area, including hidden icons, or choose Quit in the tray to stop it completely.

## Update

Save your work and back up important data before updating. Use the app's update check or download a newer Setup installer from the project download source, quit ClawClaw, and install into the original location. After verifying an in-app download, the updater shuts down the Host before launching the installer. If it reports that the app is still running, quit from the tray and retry.

## Uninstall and retained data

Quit from the tray, find ClawClaw in Windows Settings → Apps, and uninstall it.

Uninstalling retains local data, workspaces, application state, caches, and logs:

| Content | Default location |
| --- | --- |
| Configuration, profiles, sessions, plugin state | `%USERPROFILE%\.clawclaw\data` |
| Default workspace files | `%USERPROFILE%\.clawclaw\workspaces\default` |
| Application state, caches, logs | `%APPDATA%\ClawClaw` |

Paste these paths into the File Explorer address bar. Custom data directories and additional workspaces may be elsewhere. For a complete cleanup, check the actual paths and back them up before deleting them yourself. Reinstalling does not automatically reset these directories.

## Troubleshooting

- Installation takes a while: keep the window open and wait; avoid starting multiple installers.
- App is still running: check the notification area, choose Quit from ClawClaw's tray menu, and retry.
- App opens but chat fails: check the API key, model configuration, and network in Settings → Models.
- Startup fails: export diagnostics from the tray. If the interface is unavailable, run the installed executable in PowerShell:

  ```powershell
  & "$env:LOCALAPPDATA\Programs\ClawClaw\ClawClaw.exe" --export-diagnostics
  ```

Adjust the path for a custom installation. When contacting the project maintainers, include your Windows version, system type, ClawClaw version, installation method, and reproduction steps. Review logs and diagnostic archives and remove sensitive information before sharing.
