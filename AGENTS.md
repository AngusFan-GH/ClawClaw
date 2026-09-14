# DSH Desktop repository rules

This repository owns the desktop product around an unmodified DeepSeek Harness checkout.

## Prerequisites and setup

- Use Node.js `^22.19.0` or `>=24.0.0` and the root pnpm `11.8.0` release through Corepack.
- Initialize the pinned upstream checkout with `git submodule update --init --recursive`.
- Install root dependencies with `corepack pnpm install --frozen-lockfile`.

## Build, run, and verify

- Start the desktop development workflow with `corepack pnpm dev`.
- Build the desktop package with `corepack pnpm build`.
- Run unit tests with `corepack pnpm test`.
- Run type checking with `corepack pnpm typecheck`.
- Run the complete headless gate with `corepack pnpm check`.
- Develop and validate Desktop feature changes in `dsh-plugin-desktop-beta/` first, then synchronize shared changes into `dsh-plugin-desktop/` while preserving declared variant differences. Before committing or pushing shared Desktop changes, run `corepack pnpm check:desktop-variants` and validate both affected packages; neither package automatically inherits the other's source edits.
- Run upstream operations through the root scripts, such as `corepack pnpm upstream:build`.

- `deepseek-harness/` is a pinned upstream Git submodule. Never edit files inside it from a desktop feature branch.
- `dsh-plugin-desktop/` owns the Cordis Host and Client faces, Electron bootstrap, packaging, and release tests.
- `dsh-community-fabric/` owns the community interoperability RFC. Until schemas and a reviewed reference adapter exist, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- `dsh-community-market/` owns the community-market shell. Until its runtime is implemented, it remains a private documentation scaffold and must not declare loadable DSH or package entry points.
- The outer repository and all owned packages use the root pnpm release with the default isolated linker.
- The upstream submodule keeps its own pnpm workspace. Run upstream commands through the root `upstream:*` scripts, which enter the submodule before invoking Corepack.
- Compatibility mode must run the upstream default client without overrides. Advanced presentation belongs to desktop-owned client plugins and may replace documented slots or services through profile composition.
- Keep graphical application launch explicit. Builds, typechecks, unit tests, and Loader smokes must remain headless-safe.
- Commit before major changes of direction and keep the submodule pin update separate from desktop behavior changes.
- Keep the repository topology and package-manager split consistent with the [owning Agent Note](.agents/notes/implemented/process/2026-08-15-pinned-upstream-and-isolated-pnpm-workspace.md).
