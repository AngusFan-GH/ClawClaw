# Project Bundled Skills

ClawClaw preinstalls any project skill found under `resources/skills/<slug>/SKILL.md`
into the user's OpenClaw skill directory on app startup:

- Source: `resources/skills/<slug>/`
- Target: `~/.openclaw/skills/<slug>/`

Only directories that contain `SKILL.md` are installed. Files such as
`bundles.json` or this README are ignored.

## Minimal layout

```text
resources/
  skills/
    my-skill/
      SKILL.md
      references/
      scripts/
      assets/
```

## Minimal `SKILL.md`

```md
# My Skill

Use this skill when the user asks for a project-specific workflow.

## Instructions

1. Confirm the target task briefly.
2. Inspect the local project files before making changes.
3. Use any files in `references/` or `scripts/` when needed.
```

## Notes

- Skills are copied only when `~/.openclaw/skills/<slug>/SKILL.md` does not already exist.
- To force a fresh reinstall during development, delete the installed target directory first.
- Keep the directory name stable because it becomes the installed skill slug.
