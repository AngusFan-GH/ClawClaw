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

Publishing a GitHub Release does not modify the live update server. Server-side retrieval of a specific official Release, source and installer validation, and publication will be connected separately. No inbound server SSH access for GitHub runners or scheduled synchronization is configured.

The client feed remains `https://clawclaw.xzinfra.com/updates/dsh/stable/release.json`, supporting 0.2.x clients starting at 0.2.6. New installer URLs use immutable `/releases/dsh/<version>/` paths; retain historical installer paths referenced by older feeds. The feed keeps the existing version, channel, and per-platform HTTPS URL, size, and SHA-512 format.

`deploy/clawclaw-internal.nginx.conf` retains download hosting and historical paths. The general `scripts/upload-update.mjs` validates files and atomically switches the feed after storing the complete version directory. GitHub invokes only its `--dry-run` mode and never deploys over SSH. Before the server cutover, verify GitHub download connectivity, HTTPS certificates, DNS, public port 443, the original 0.2.6–0.2.10 checkers, and complete installer downloads. Keep the old server serving until cutover verification completes.

## Two remotes

`origin` points to GitHub and `gitlab` to the company GitLab. Both remotes retain `main` and `dsh-desktop`: use `dsh-desktop` for daily development and `main` as the integration baseline. After validation, merge development changes into `main` and synchronize each branch to both remotes. Official publication is still triggered by a version tag, not by branch synchronization.

The retired office Runner implementation, Windows diagnostics, and early expert UI alternatives are preserved in merge history and in a local Git bundle created before branch cleanup. The current tree continues to use GitHub-hosted runners; preserving history does not reactivate retired implementations. Synchronize through ordinary fast-forwards or merges without force-overwriting remote history.
