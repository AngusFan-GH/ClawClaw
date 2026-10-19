# Packaging with GitLab office runners

[中文](gitlab-packaging.md)

Local packaging has been validated separately on Mac and Windows. Reuse those native environments; this workflow needs no Linux runner and does not deploy to the previous update server.

## Pipeline

Select `dsh-desktop` under Build → Pipelines → Run pipeline to start a build manually, or start that branch manually through the authenticated API. Ordinary pushes and historical tags do not start packaging. Historical tags lack the new CI configuration; never move a released tag to run it.

`package-macos` uses the `clawclaw-macos` runner and `package-windows` uses `clawclaw-windows`. Both clone the same pipeline commit, initialize the read-only upstream submodule, install dependencies, prepare the runtime, run the full gate, and package natively. Use Node 22.x at 22.19+ or Node 24.x. The root workspace uses Corepack and pnpm 11.8.0; upstream commands retain their independent pnpm version.

Each job uploads its installer with commit, pipeline ID, version, size, and SHA-512 metadata. `assemble` downloads both job artifacts on the Mac runner, rejects mixed commits or pipelines, verifies SHA-512 again, and combines the installers in `release/`. Download the final artifact from the assemble job. Final artifacts expire after 30 days; platform intermediates expire after 7 days.

The final directory contains a DMG, an EXE, and `build-info.json`. It is not a client update feed. Until the internal download domain is configured, the pipeline generates no `release.json` and uploads nothing to the old server. The installers still contain the old update origin, which needs a separate migration before internal production release.

## Network and storage

Dependencies use `http://192.168.103.203:8081/repository/xzinfra-npm-group/`. If authentication is required, configure repository-specific CI/CD secrets in GitLab; do not copy another project's publishing credentials. Corepack, Electron, and packaging tools still require external access or corresponding internal mirrors. `CLAWCLAW_WINDOWS_UPSTREAM_SOURCE` and `CLAWCLAW_MACOS_UPSTREAM_SOURCE` can point to each runner's validated local `deepseek-harness` Git checkout when GitHub is unreachable. CI clones the pinned commit from that local object source, then restores the official submodule URL before verification; no upstream source or pin is changed.

The default GitLab artifact limit may be too small. The Mac DMG is already about 464 MB. Both project and reverse-proxy limits must accommodate the combined installer archive; a project limit of at least 2048 MB is recommended. For `413` or `artifact too large`, ask operations to adjust the limits before rebuilding. These are server settings; large artifact uploads have not yet been verified.

## Mac runner

The isolated local installation is `~/.local/share/clawclaw-runner/`, with separate `builds/` and `cache/` directories outside the development checkout. It uses native bash with one job at a time and a Runner version matching the company's GitLab 16.9 family. Upgrade GitLab and Runner together later.

The runner starts as the current user's LaunchAgent at login and goes offline after logout or shutdown. Do not install a second Homebrew runner that could poll concurrently.

## Windows runner

Sign in as the `admin` user that successfully built the installer. The runner directory is `D:\Angus\Work\Projects\ClawClaw\Runner`. Its Git, x64 Node, Corepack, Python, C++ tools, and network access must match the validated manual environment.

1. Create a Windows project runner under Settings → CI/CD → Runners. Use tag `clawclaw-windows`, disable Run untagged jobs, and leave Protected off if building ordinary branches. Set the maximum job timeout to at least three hours and lock the runner to this project.
2. Copy the generated Runner authentication token. Update the development checkout on Windows and run the commands below. This is not the API token used by glab; never send it in chat or commit it.

```powershell
git switch dsh-desktop
git pull --ff-only
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\setup-windows-runner.ps1
```

The script downloads official Runner 16.9.1, verifies SHA-256, reads the token at a hidden prompt, registers a PowerShell shell runner, and creates a startup shortcut for the current user. It stores no Windows password. The repository ignores `Runner/`; never copy its configuration into Git. Keep the runner window open; closing it takes the runner offline. Windows behavior cannot be validated on Mac and must be checked on the actual Windows machine.

## Each build

1. Start both computers, sign in as their build users, connect to the company network, and confirm both runners are Online.
2. Prevent sleep during packaging and keep the Mac user logged in. Neither computer needs to run continuously.
3. Start a manual `dsh-desktop` pipeline. The packaging script reports the active command every minute; Universal file scanning can still take time.
4. Wait for the entire pipeline, including assemble, to succeed. Download and validate the final installers before shutting down either computer. The Mac is still needed for assembly after its package job succeeds.

Offline runners and unavailable network resources leave jobs waiting or failing; a runner queue is not a compilation failure.
