# Expert center

The Expert center is the Desktop-owned catalog of local expert packages. An
expert is a user-authored Agent preset plus one manifest that describes who the
preset is for, so browsing and filtering never changes how a Session runs: an
expert *is* an Agent preset, and summoning one creates an ordinary Session that
runs that preset.

## Package layout

Expert packages live beside legacy Agent presets, so the same directory already
serves both features:

```
$DSH_HOME/.agent-presets/<expert-id>/
  preset.yml        # Agent preset metadata (name, description, order)
  agent.cordis.yml  # the Cordis entry list the preset mounts
  expert.yml        # expert manifest owned by this catalog
```

`DSH_HOME` resolves through `@deepseek-ai/dsh-home-paths` (`$DSH_HOME`, then
`~/.dsh`). The directory name is the expert id and must equal the manifest
`id`; a directory without `expert.yml` stays a plain Agent preset and is not
listed here.

## `expert.yml`

```yaml
id: data-analyst            # required, equals the directory name
version: 1.0.0              # required
category: data-ai           # required, stable filter key
display:
  name: 数据分析师           # required
  title: 商业数据与可视化顾问   # optional
  description: 清洗数据、识别异常并输出图表和报告。  # optional
  tags: [Excel, CSV, 图表]   # optional, at most 24 unique entries
entry:                      # optional
  defaultPrompt: 帮我分析这份数据并输出管理层摘要
  quickPrompts:             # at most 12; each opens a new Session with the task prefilled
    - 分析销售数据
    - 制作经营周报
```

Unknown keys are ignored. Text is trimmed, control characters are rejected, and
every field has a documented length ceiling.

## Availability

The roster reports one row per package:

- `available` — the manifest is valid and the linked Agent preset composes.
- `unavailable` — the package is readable, but the preset is not: the id may be
  taken by an official preset (`preset-missing`), its composition may fail to
  activate (`preset-broken`), its entry list may be invalid (`preset-invalid`),
  or the deployment composes no registry at all.
- `invalid` — the package itself cannot be used: missing files, unreadable
  members, unsafe paths, invalid YAML, incomplete or mismatched manifests,
  duplicate ids, or oversized files.

A broken package never hides its siblings and never blocks the scan; the panel
renders the row with its reason, and the detail view also shows the package
directory so the cause is actionable.

## Summoning

"Start conversation" only creates a Session: the Client calls
`POST /api/desktop/experts/action` with `{ action: "summon", id, prompt?,
workspaceId? }`, the Host resolves the expert and asks the Session controller to
create a Session with `agentPreset: <expert id>`. The Host refuses before
creating anything when the expert is unavailable or unknown, so a failure never
leaves a Session bound to the wrong preset. No model or tool call is involved,
and no role text is prepended to messages — the conversation runs whatever the
preset composes, and the header chip simply reads the Session's own
`agentPreset` projection.

Quick tasks reuse the same path with an explicit prompt; the returned text is
staged client-side and handed to the new Session's composer through the public
`conversation.input.left` slot.

## Safety rules

- Discovery never follows symlinks: a symlinked package directory is skipped,
  and a symlinked member is reported as `unsafe-path`.
- Every package is resolved through `realpath` and must stay inside the catalog
  root; directory names must match `^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$`.
- `expert.yml` reads are capped at 64 KiB, `preset.yml` and `agent.cordis.yml`
  at 4 MiB; the scan stops at 512 packages and flags the truncation.
- Only those three files inside the package are read. Credentials and any other
  user data are never read, stored, or exposed.
- The HTTP surface is the shared Desktop JSON API: loopback-only, same-origin,
  `POST` actions with `application/json` and a 64 KiB body ceiling.
