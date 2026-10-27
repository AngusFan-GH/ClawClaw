# Install ClawClaw on macOS

[中文](install-macos.md) · [Windows installation](install-windows.en.md)

## Before downloading

ClawClaw provides a Universal DMG for both Apple silicon and Intel Macs. It includes the runtime, so you do not need Node.js, pnpm, or developer tools. Check the selected release notes for OS version requirements.

Download the macOS disk image (`.dmg`) from the download source provided by the project. Check the download information for system requirements and choose the package for your computer.

## Install

1. Double-click the downloaded `.dmg` and wait for the disk image to open.
2. Drag `ClawClaw.app` into Applications and wait for copying to finish. If the image has no Applications shortcut, open Applications in Finder and copy the app there.
3. Eject the ClawClaw disk image.
4. Open ClawClaw from Applications. Use this installed copy for future launches instead of running it inside the DMG.

Copying into Applications may require local administrator credentials.

## If macOS blocks the first launch

If the package is unsigned or not notarized, macOS may report that it cannot verify the developer or check the app for malicious software. Once you have confirmed that the file came from the project download source and you trust the download, follow [Apple's instructions](https://support.apple.com/102445):

1. Try opening ClawClaw in Applications, then dismiss the blocking alert.
2. Open System Settings → Privacy & Security and scroll to the ClawClaw alert.
3. Select Open Anyway, authenticate if requested, and confirm Open in the subsequent prompt.

If the button is missing or your computer is managed by an organization, contact the administrator. If macOS says the app is damaged or will damage your computer, stop, download it again from the project download source, and report the issue; treat this separately from developer verification. You do not need to disable Gatekeeper globally or remove quarantine attributes.

## Complete first-time setup

1. Follow the setup wizard. You can skip optional choices and adjust them later in Settings.
2. Connect a model when prompted, or configure it later in Settings → Models. Your chosen model may require an API key and network access; installing the app does not supply model service credentials.
3. Open the default workspace or add your own folder, create a conversation, and send a message to confirm that the model responds.

Closing the main window normally hides it while the app stays active. Reopen it from the menu bar tray icon, or choose Quit there to stop it completely.

## Update

Save your work and back up important data before updating. Use the app's update check or download a newer DMG from the project download source.

The macOS updater downloads and verifies the package, then opens the DMG. Replacement is still manual: quit ClawClaw from the tray, copy the new `ClawClaw.app` into its original Applications location, confirm replacement, and launch it after copying finishes. Do not overwrite a running copy.

## Uninstall and retained data

Quit ClawClaw from the tray, then move `ClawClaw.app` from Applications to the Trash. Removing the app retains the following local data:

| Content | Default location |
| --- | --- |
| Configuration, profiles, sessions, plugin state | `~/.clawclaw/data` |
| Default workspace files | `~/.clawclaw/workspaces/default` |
| Application state, caches, logs | `~/Library/Application Support/ClawClaw` |

`~` is your home directory. Custom data directories and additional workspaces may be elsewhere. For a complete cleanup, check the actual paths and back them up before deleting them yourself. Reinstalling does not automatically reset these directories.

## Troubleshooting

- DMG will not open: make sure the download completed and download the macOS package again.
- Copy reports that the app is in use: quit from the tray and retry. Closing the window does not quit the app.
- App opens but chat fails: check the API key, model configuration, and network in Settings → Models.
- Startup fails: export diagnostics from the tray. If the interface is unavailable, run the installed executable in Terminal:

  ```sh
  /Applications/ClawClaw.app/Contents/MacOS/ClawClaw --export-diagnostics
  ```

Adjust the command if you installed elsewhere. When contacting the project maintainers, include your macOS version, chip type, ClawClaw version, and reproduction steps. Review logs and diagnostic archives and remove sensitive information before sharing.
