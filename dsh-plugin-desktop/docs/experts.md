# ClawClaw Experts

ClawClaw Experts is a desktop-owned Cordis plugin. Its implementation, catalog,
settings, client UI, Remote API, and release lifecycle are part of
`dsh-plugin-desktop`; it does not load or update an external expert package.

## Product Surface

- 321 bilingual built-in experts across 22 divisions.
- Custom experts with editable persona, category, avatar, Skills, and MCP
  bindings.
- Five built-in expert teams plus custom teams.
- Expert and team selection from settings, the composer button, and `@`
  references.
- Model tools for listing and summoning individual experts or teams.
- Standard subagent execution and optional native Agent Team dispatch.

The Host face is exported as `dsh-plugin-desktop/experts`. The Remote face is
exported as `dsh-plugin-desktop/experts-remote`. The client face is mounted by
the desktop client entry so all three faces use the same ClawClaw release.

## Runtime Composition

An expert run is assembled from three parts at summon time:

1. The expert persona from the bundled catalog or custom settings.
2. Enabled Skill bindings resolved in the parent agent's active workspace.
3. Enabled MCP server bindings resolved from the live tool inventory.

Bindings have `enabled` and `required` flags. A missing required capability
stops the run. A missing optional capability is included in the expert's
diagnostics. Skill content is appended to the expert persona. When an expert
declares MCP bindings, MCP tools from every unselected server are denied.
Nested expert and team control tools are always denied inside an expert run.

The native Agent Team service currently accepts a persona but does not expose a
per-member tool filter. Skill-only teams can therefore use native dispatch. A
team containing an enabled MCP binding automatically uses standard subagents so
the selected-server boundary remains enforceable.

## Ownership And Updates

Built-in personas ship under `assets/experts/` and are included in desktop
packages. There is no expert-specific update check, download path, repository
button, or feedback link. Catalog and behavior changes are reviewed, tested,
and released with ClawClaw. Third-party attribution for derived persona content
remains in `assets/experts/LICENSE`, `assets/experts/NOTICE`, and
`THIRD_PARTY_NOTICES.md`.
