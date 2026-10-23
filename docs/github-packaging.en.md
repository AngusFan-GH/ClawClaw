# GitHub packaging and releases

[中文](github-packaging.md)

## Responsibilities

GitHub is the primary repository, with development on `dsh-desktop`. GitLab retains a code backup; office computers no longer run CI builds. The official upstream Git submodule and its pinned commit remain unchanged. The root workspace uses pnpm 11.8.0 through Corepack.

GitHub-hosted macOS and Windows runners build both native installers. GitHub Releases archives official versions; clients continue downloading updates from the company server. Builds use public dependency sources and require neither the company npm registry, local upstream mirrors, nor server SSH credentials.

## Daily CI

CI runs for pushes to `dsh-desktop` and `main`, pull requests targeting them, and manual dispatches. Linux runs the complete gate. Windows and macOS retain native builds, type checks, platform tests, and runtime closure verification; Windows upstream command checks also remain. Documentation-only changes run documentation checks. `check:win-package` and `check:mac-package` are headless preflights that do not create installers.

Daily CI never invokes `dist:*`, creates DMG, EXE, or portable archives, or publishes a Release. Only the Release workflow below creates installers.

## Release packaging and archives

In Actions, select **Release ClawClaw Desktop**, choose the branch to validate, and leave `publish=false`. Both platforms install frozen dependencies, prepare the upstream runtime, and run the complete `pnpm check` before packaging. This gate covers builds, type checks, all unit tests, and runtime verification, so packaging reuses its result instead of repeating platform preflights. Verification of the actual installers still runs after packaging. Both platforms cache the pnpm store by operating system, architecture, and root lockfile. Outputs are an unsigned Universal DMG and Windows x64 NSIS installer.

Each platform records the product version, Git commit, repository, workflow run ID, build attempt, filename, size, and SHA-512. Assembly accepts both platforms only from the same repository, commit, version, and run ID, and recalculates file checksums. Each installer must be no larger than 1 GiB to support existing update clients. Retrying the same workflow may reuse a previously successful platform artifact while retaining its attempt. Artifacts from separate runs cannot be combined.

Download `desktop-release` from the successful workflow: it contains both installers, `release.json`, and `build-info.json`. Workflow artifacts expire after 14 days and are not long-term version archives.

Official archives require an existing `clawclaw-v<version>` tag matching the product version. Pushing that tag triggers builds and GitHub Release publication; alternatively, manually run that tag with `publish=true`. Publishing from an ordinary branch is rejected. Never move published tags.

The publication job runs in the `github-release` environment and is the only job granted `contents: write`. It creates a draft, uploads all files, and publishes only after successful upload. Existing releases, including drafts left by failures, are never overwritten. Inspect and remove an unpublished draft before retrying. Increase the version when changing official release contents. Environment approval and tag restrictions may be configured in GitHub.

## Company server and older clients

The release chain is: GitHub builds both platforms and archives formal Releases → an operator runs the local deployment command from the company network → installers are uploaded over LAN SSH → the canonical version directory is written → the stable feed switches atomically → public downloads are verified. Trial builds never deploy automatically; explicitly selecting a successful trial run for local deployment is supported.

No server polling, public SSH mapping, office Runner, or GitHub-held server credentials are required. The workstation must reach GitHub and the company server during deployment. Existing version directories cannot be overwritten; increase the version for future releases.

Installers always use `/releases/dsh/<version>/ClawClaw-<version>-universal.dmg` and `ClawClaw-<version>-x64-Setup.exe`, without temporary trial paths. The feed remains `/updates/dsh/stable/release.json`. Replacing 0.2.11 was a one-time migration exception and it is already live; the next formal release must be at least 0.2.12. Do not reuse 0.2.11.

New clients use `https://clawclaw.xzinfra.com:9528/updates/dsh/stable/release.json`. Installer URLs use the same HTTPS origin on port 9528 and immutable `/releases/dsh/<version>/` paths. The feed retains the existing version, channel, per-platform HTTPS URL, size, and SHA-512 format, with 16 KiB manifest and 1 GiB installer limits.

Migration covers versions starting at 0.2.8. Installed 0.2.8–0.2.10 clients request the old HTTPS port 443; neither DNS nor HTTP redirects can move them automatically to 9528. This plan requires a manual installation of the new client once, followed by automatic update checks through the new endpoint. 0.2.11 is now live on the 9528 endpoint. Earlier same-version trial builds using 443 require a manual installation of the latest package; same-version comparison cannot update them automatically. Older versions are outside the migration validation scope.

The server remains `192.168.103.220`, with public root `/data/clawclaw/public`, version directories `/data/clawclaw/public/releases/dsh/<version>/`, and stable feed `/data/clawclaw/public/updates/dsh/stable/release.json`. `deploy/clawclaw-internal.nginx.conf` adds HTTPS 9528 while retaining LAN 443; HTTP 80 redirects to explicit port 9528. File Browser on 9527 is unchanged. The network administrator must configure `218.69.255.22:9528 -> 192.168.103.220:9528` and point the original public hostname to `218.69.255.22`; split DNS can resolve the hostname directly to the LAN address internally.

`scripts/upload-update.mjs` handles local SSH publication and defaults to `/data/clawclaw/public`. `UPDATE_PORT=22` is the LAN SSH port, unrelated to HTTPS download port 9528.

Before publication, verify trusted HTTPS certificates, LAN and real public 9528 connectivity, DNS, the new manifest, complete downloads and SHA-512 for both installers, and update checks after manually upgrading 0.2.8–0.2.10 installations. A LAN check with `curl --resolve clawclaw.xzinfra.com:9528:192.168.103.220 https://clawclaw.xzinfra.com:9528/healthz` retains hostname and certificate verification but does not prove public reachability. Retain the old server and stable feed until migration validation completes; do not automatically rewrite URLs in historical feeds.

## Deploy from the local workstation

Configure ignored `.env.server.local` with `UPDATE_HOST=192.168.103.220`, `UPDATE_USER=clawclaw-release`, `UPDATE_PORT=22`, `UPDATE_REMOTE_ROOT=/data/clawclaw/public`, and the existing `UPDATE_SSH_KEY_FILE` / `UPDATE_SSH_KNOWN_HOSTS_FILE` paths. An SSH agent may provide the private key instead. Retain strict host-key verification. Authenticate `gh` locally with repository Actions read access.

```sh
# Choose from recent downloadable packaging runs:
corepack pnpm deploy:run
# Choose and validate without deploying:
corepack pnpm deploy:run --dry-run
# List available runs without downloading or deploying:
corepack pnpm deploy:run --list
# An explicit run ID still works:
corepack pnpm deploy:run <GitHub-run-id> --dry-run
```

Without an ID, an interactive terminal lists the latest 30 successful workflow runs that still have a nonexpired, nonempty `desktop-release` artifact. The table shows version, build time in Asia/Shanghai, branch/tag, commit and run ID. Choose a row number; Enter or `q` cancels without selecting a default. The version is read from the exact source commit as a display hint; downloaded provenance is checked independently. If version lookup fails, the row shows `unknown`. Noninteractive automation must supply an ID or use `--list`. An older run outside the latest 30 can still be selected by explicit ID.

Run these commands from the repository root with Node.js/Corepack, `gh`, OpenSSH and tar installed. The numeric run ID is the final component of the Actions `/actions/runs/<run-id>` URL; it is not a version, job ID or artifact ID. `--dry-run` still downloads the full bundle and does not test SSH connectivity. A subsequent real deployment downloads again.

The command downloads only that run's `desktop-release` artifact, verifies the successful workflow and matching repository/commit/run provenance, checks canonical installer URLs, sizes and SHA-512, uploads installers, then atomically switches the stable feed. Finally it verifies the public feed, full installer checksums and HTTP Range support. Temporary local downloads are removed on exit. Run while artifacts remain available (14 days); failure does not trigger an automatic retry. If upload succeeds but public verification fails, the stable feed has already switched and is not automatically rolled back. Inspect the live feed before retrying because existing versions cannot be overwritten. This command always publishes to the stable feed; it has no upload-only mode.

Formal tags still archive GitHub Releases automatically; deployment is a separate explicit local command. Increase the product version before each new formal release (next: 0.2.12 or later). Do not recreate or move published tags. No GitHub Actions deployment secrets are needed.

## Two remotes

`origin` points to GitHub and `gitlab` to the company GitLab. Both remotes retain `main` and `dsh-desktop`: use `dsh-desktop` for daily development and `main` as the integration baseline. After validation, merge development changes into `main` and synchronize each branch to both remotes. Official publication is still triggered by a version tag, not by branch synchronization.

The retired office Runner implementation, Windows diagnostics, and early expert UI alternatives are preserved in merge history and in a local Git bundle created before branch cleanup. The current tree continues to use GitHub-hosted runners; preserving history does not reactivate retired implementations. Synchronize through ordinary fast-forwards or merges without force-overwriting remote history.
