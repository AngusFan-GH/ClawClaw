# Contributing to ClawClaw

[中文](CONTRIBUTING.md)

Use [Issues](https://github.com/AngusFan-GH/ClawClaw/issues) for problems and feature proposals, and pull requests in this repository for code and documentation. Include OS, version, reproduction, and sanitized errors. Follow the [code of conduct](CODE_OF_CONDUCT.en.md).

## Setup

Use Node.js `^22.19.0` or `>=24.0.0`, Corepack, and root-pinned pnpm `11.8.0`:

```sh
git submodule update --init --recursive
corepack pnpm install --frozen-lockfile
corepack pnpm dev
```

`dev` opens the graphical application; validation must remain headless-safe.

## Ownership

- `deepseek-harness/` is a read-only submodule. Commit upstream pin updates separately from desktop behavior.
- `dsh-plugin-desktop/` owns the Desktop Host, Client, Electron bootstrap, packaging, and tests.
- `channels/dsh-im/` owns product Channels; maintain supplier version, build patches, and notices together.
- Fabric remains a private documentation Draft without runtime/SDK.
- Four owned packages share outer pnpm. Upstream has its own workspace; use root `upstream:*` commands.
- Keep vendored runtime, patches, manifests, lockfile, and `upstream.json` aligned. See [architecture](docs/architecture.en.md).

## Validation

```sh
corepack pnpm check:layout
corepack pnpm check
corepack pnpm --filter @clawclaw/dsh-im run check
```

`check:layout` covers bilingual records, dependency direction, vendored runtime, and layout. `check` runs Fabric and the Desktop gate; run the extra Channels `check` above for its independent tests. Root `test` and `typecheck` include Channels.

Documentation-only changes require at least bilingual and community documentation checks, plus `git diff --check`. Verify local targets when changing links. Native UI, installation/uninstallation, and signing require explicit checks on the target platform.

## Documentation and commits

- Keep English and Chinese content aligned. Update each adjacent `*.i18n.yaml` Git blob hash, not only the root README record.
- For example, `git hash-object --path=docs/user-guide.md -- docs/user-guide.md` produces that document's hash. Record each file separately; matching hashes do not establish translation quality.
- Preserve historical context in dated decisions, research, and experiments. Put current usage in product guides, API references, and package READMEs.
- Use conventional commits such as `fix(desktop): ...` or `docs: ...`. PRs should state the problem, final behavior, validation, and limits.
- After production dependency changes, run `verify:notices` for the Desktop package, review generated changes, and preserve third-party licenses. Review the independent Channels notices too.

See the [Desktop package reference](dsh-plugin-desktop/README.md) for release commands. Do not describe local builds as published or signed artifacts.
