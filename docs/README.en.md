# ClawClaw documentation

[中文](README.md)

This directory contains current product documentation. The root [README](../README.en.md) is the quick introduction, package READMEs cover build/release operations, and dated Agent Notes preserve the historical context of completed decisions.

| Goal | Documentation |
| --- | --- |
| Installation, paths, workspaces, Channels, recovery | [User guide](user-guide.en.md) |
| Common questions | [FAQ](faq.en.md) |
| Local data, models, Channels, markets, updates | [Privacy and data handling](../PRIVACY.md) |
| Processes, runtime, models, update protocol | [Architecture](architecture.en.md) |
| Official Desktop adoption scope and phased delivery | [Adoption guide](official-desktop-adoption-plan.en.md) |
| Develop ClawClaw/DSH plugins | [Plugin development](plugin-development.en.md) |
| Product boundaries and decisions | [Why ClawClaw](why-desktop.en.md) |
| Plugin ecosystem principles | [Plugin ecosystem](plugin-ecosystem.en.md) |
| Contribution and validation | [Contributing](../CONTRIBUTING.en.md) |
| Desktop package operations | [Desktop](../dsh-plugin-desktop/README.md) |
| Channels | [Implementation reference](../channels/dsh-im/README.md) |
| Community interoperability proposal | [Fabric Draft](../dsh-community-fabric/README.md) |

## Documentation boundaries

- The root README, user guide, FAQ, privacy notice, and this page describe the current product.
- `dsh-plugin-desktop/docs/` holds supported public integration contracts.
- `dsh-community-fabric/` remains a private RFC documentation project and is not a loader entry, SDK, or released schema.
- `deepseek-harness/` is a read-only upstream submodule; its documentation is not ClawClaw product documentation.
- `.agents/notes/implemented/` and `docs/evidence/` are evidence and historical material, which can describe earlier DSH Desktop identities or replaced designs.

Every user- and developer-facing document has English and Chinese versions. Adjacent `*.i18n.yaml` files record Git blob hashes and must be refreshed after edits. That gate checks record freshness, not translation quality.
