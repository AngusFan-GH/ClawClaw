# Packaging with GitLab office runners

[中文](gitlab-packaging.md)

Local packaging has been validated separately on Mac and Windows. Reuse those native environments; this workflow needs no Linux runner and does not deploy to the previous update server.

## Publication method

Source and pipelines live in company GitLab. After native packaging, the Mac and Windows runners upload installers directly over SSH to `192.168.103.220` as the dedicated `clawclaw-release` user. Large installers do not pass through GitLab artifacts.

- Private staging: `/data/clawclaw/incoming/<pipelineId>-<commit>/<platform>/`.
- Public download root: `/data/clawclaw/public/`.
- Immutable version directory: `/releases/dsh/<version>/`, containing DMG, EXE, `release.json`, and `build-info.json`.
- Stable feed: `https://clawclaw.xzinfra.com/updates/dsh/stable/release.json`.

`deploy/clawclaw-internal.nginx.conf` configures internal HTTPS. Certificates and the private key remain under `/etc/clawclaw/tls/` on the server, outside Git. The migrated wildcard certificate expires at 2026-10-27 07:59:59 Asia/Shanghai and needs renewal. The server's external IP is `218.69.255.22`; public DNS must point `clawclaw.xzinfra.com` there, with external port 443 forwarded to `192.168.103.220:443`. Internal split DNS may resolve directly to `192.168.103.220`. From the company network, public-IP port 443 currently reaches the H3C SecPath F100 management page. A separate test from the old Alibaba Cloud server times out on that public 443 endpoint while File Browser on 9527 returns HTTP 200. These vantage points differ; internal hairpin access does not establish external reachability. Network operations must check port forwarding, security policy, and management-service handling before DNS cutover. Clients retain the existing HTTPS domain.

## Historical client compatibility

Retain `clawclaw.xzinfra.com` and HTTPS port 443. Versions 0.2.0 and 0.2.1 request `/updates/stable/release.json`; 0.2.2–0.2.10 request `/updates/dsh/stable/release.json`. Internal Nginx maps the earlier endpoint directly to the same DSH manifest without a redirect. The manifest retains HTTPS installer URLs, sizes, and SHA-512 fields. The previous server already publishes 0.2.10, so the first new migration release uses 0.2.11 to make an update visible to current clients too.

This migration supports 0.2.x and excludes earlier 0.1.x clients using `/updates/stable/latest.yml`. Do not present DSH JSON as that older protocol; supporting 0.1.x requires separate migration and validation. Verify historical 0.2.x client requests and files referenced by old manifests before DNS cutover.

## Pipeline

Select `dsh-desktop` under Build → Pipelines → Run pipeline, or start that branch through the authenticated API. Ordinary pushes and historical tags do not start packaging; never move released tags.

`package-macos` uses `clawclaw-macos`; `package-windows` uses `clawclaw-windows`. Both shallow-clone the exact pipeline commit, initialize the read-only upstream submodule, install dependencies, prepare the runtime, run the full gate, and package natively. The root workspace uses Node 22.x at 22.19+ or Node 24.x, Corepack, and pnpm 11.8.0. Upstream retains its independent pnpm version.

Each platform uploads its installer and commit, pipeline, version, size, and SHA-512 metadata to isolated staging. Uploads use temporary names and mark metadata ready last. After both jobs succeed, `assemble` downloads the same pipeline's files on Mac, checks version, provenance, size, and SHA-512 again, generates the update manifest, and uploads the release. The server saves the complete version directory before atomically switching the stable manifest. Existing versions cannot be overwritten; changed contents require a new product version.

Publication first checks the internal `/healthz` marker over trusted HTTPS. DNS pointing to the old server or an untrusted certificate prevents publication without switching the feed. Transfer and transaction smoke tests do not establish that a formal installer release has succeeded; the first full native pipeline must still pass.

For first-time or early internal publication, add `UPDATE_ORIGIN_VERIFY_IP=192.168.103.220` to that manual pipeline. It must equal `UPDATE_HOST`. The health check connects directly to this IP while retaining certificate trust, hostname verification, and the internal marker check. This permits publishing to the production server directory before DNS cutover. Manifest HTTPS domains remain unchanged; use an explicit address override to verify downloads until DNS is switched. Omit this variable for routine publication.

Download installers from the HTTPS version directory. GitLab retains job logs. Server staging and version directories are not cleaned automatically; check client and rollback requirements before removing history.

## Connection variables, network, and storage

Project CI/CD variables configure `CLAWCLAW_DIRECT_UPLOAD=1`, `UPDATE_HOST`, `UPDATE_USER`, `UPDATE_PORT`, `UPDATE_STAGING_ROOT`, `UPDATE_REMOTE_ROOT`, and `UPDATE_BASE_URL`. SSH private-key and trusted host-key contents use file variables `UPDATE_SSH_KEY_FILE` and `UPDATE_SSH_KNOWN_HOSTS_FILE`; never print or commit their contents. Connections enforce host-key verification. The publishing user owns its deployment directories and does not use root. Both runners need SSH/SCP clients and connectivity to server port 22.

Dependencies use `http://192.168.103.203:8081/repository/xzinfra-npm-group/`. Configure repository-specific CI/CD secrets if authentication is required; do not copy another project's publishing credentials. Corepack, Electron, and packaging tools still require external access or corresponding internal mirrors. `CLAWCLAW_WINDOWS_UPSTREAM_SOURCE` and `CLAWCLAW_MACOS_UPSTREAM_SOURCE` can point to validated local upstream Git repositories when GitHub is unreliable. CI clones the pinned commit and restores official submodule URLs without changing upstream source or the pin.

Pipeline #450 generated and mount-verified the Mac DMG, but GitLab rejected its artifact upload with `413 Request Entity Too Large`. The direct-upload workflow removes these large GitLab artifacts, so increasing GitLab's artifact limit is no longer required.

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
