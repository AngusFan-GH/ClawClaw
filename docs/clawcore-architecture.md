# ClawCore Runtime Architecture

## Goal

ClawCore is the local-first agent runtime owned by ClawClaw. It replaces OpenClaw as the source of truth and execution engine while retaining a temporary import bridge for existing user settings, sessions, skills, and channel accounts.

The runtime is a harness, not an agent framework wrapper. Its core is a small deterministic loop; model transports, storage, tools, memory, schedules, channel adapters, sandbox implementations, and UI projections are independently versioned capabilities.

## Non-negotiable boundaries

1. The renderer only consumes versioned ClawCore commands and events. It never reads provider configuration, local files, or a gateway endpoint directly.
2. SQLite owns non-secret domain data. Provider credentials and channel credentials are written through Tauri's native bridge to the OS keychain; SQLite records only whether a secret is present. A one-time legacy migration clears a plaintext value only after keychain persistence succeeds. No third-party runtime configuration file is written as part of normal ClawCore operation.
3. A run is the sole unit of execution. Chat, a scheduled task, an incoming channel message, and a workflow step all create a `Run`.
4. Tool calls are permissioned capabilities. The model can request a call but cannot execute one without policy approval.
5. External runtimes are adapters. They are never the source of truth.

## Runtime topology

```text
React renderer
  -> typed desktop command/event contract
  -> Tauri native host
  -> ClawCore Node process
       -> SQLite / protected provider store
       -> model adapters
       -> run engine
       -> tool policy + sandbox
       -> channel adapters / scheduler / MCP
       -> optional OpenClaw import bridge (migration only)
```

Tauri continues to own window lifecycle, tray, dialogs, URL/path opening, autostart, and child-process supervision. ClawCore owns all product behavior.

## Domain model

| Entity | Ownership | Notes |
| --- | --- | --- |
| `Workspace` | ClawCore | Isolates files, policies, knowledge and default agent. |
| `Provider` / `ModelProfile` | ClawCore | Endpoint and non-secret options; API credentials remain in keychain. |
| `AgentProfile` | ClawCore | Prompt, model route, toolset, memory policy and budget. |
| `Conversation` / `Message` | ClawCore | Immutable message ledger and editable display projection. |
| `Run` | ClawCore | State machine for one model/tool execution. |
| `Tool` / `Toolset` | ClawCore | Manifest, schema, policy and executor. |
| `Skill` | ClawCore | Markdown instruction, optional tools and resources. |
| `Schedule` | ClawCore | Durable cron/interval trigger that creates a run. |
| `ChannelAccount` | ClawCore | Inbound/outbound adapter identity and delivery policy. |
| `Artifact` | ClawCore | File, image, report or structured output produced by a run. |

## Run state machine

```text
queued -> preparing -> streaming -> waiting_for_approval -> streaming
                                             |                  |
                                             v                  v
                                          cancelled <- stopping <- completed
                                                        |
                                                        v
                                                      failed
```

Every transition is appended to the event log. A UI reconnect replays events after its cursor; it never infers a run state from transient websocket state.

## Event contract

`RunEvent` has `eventId`, `runId`, `sequence`, `occurredAt`, `type`, and typed payload. The initial stable set is:

- `run.started`, `run.status`, `run.completed`, `run.failed`, `run.cancelled`
- `message.delta`, `message.completed`, `reasoning.delta`
- `tool.requested`, `tool.approved`, `tool.denied`, `tool.started`, `tool.completed`, `tool.failed`
- `usage.updated`, `artifact.created`, `approval.required`

Events are persisted before broadcast. Each command carries an idempotency key, so reconnects and retried channel deliveries do not duplicate runs or tool calls.

## Capability model

ClawCore adopts DeepSeek Harness's useful composition principle—models, tools, sessions, sandboxes, storage, schedules and UI projections are replaceable capabilities—without adopting a global plugin kernel for the first release. The core keeps a small, explicit registry API and isolates third-party extensions in worker processes.

Capability kinds:

- `ModelAdapter`: converts a `ModelProfile` and context into a normalized stream.
- `ToolExecutor`: validates input, requests approval, executes with a cancellation signal, returns structured output.
- `ChannelAdapter`: maps provider messages to/from a canonical inbound/outbound envelope.
- `Sandbox`: supplies filesystem, process and network boundaries.
- `MemoryProvider`: retrieves and writes scoped memories.
- `Scheduler`: persists trigger state and starts idempotent runs.

## Model and agent loop

The first implementation uses `@earendil-works/pi-ai` only as a transport adapter. ClawCore owns prompts, context construction, loop limits, tool execution, retries, cost accounting, transcript persistence and cancellation.

For each turn, the target loop is:

1. Resolve an immutable `RunPlan` from AgentProfile, workspace policy, model profile and enabled skills.
2. Load the conversation ledger and memory candidates within a token budget.
3. Stream one model completion.
4. Persist streamed text and usage events.
5. Validate each tool request against schema and policy; pause for approval when required. The current implementation performs this pause and does not execute a requested tool.
6. Execute allowed calls in the sandbox and append tool results (next capability phase).
7. Continue until the model completes, the budget is exceeded, an approval is denied, or cancellation occurs.

Limits are explicit: maximum turns, tool calls, wall time, model tokens, tool output bytes, concurrent runs and per-workspace spend.

## Security

- Tool manifests declare filesystem roots, network origins, process allowance, secret access and user-approval level.
- All external content is tainted. Tainted text cannot silently alter tool policy or secret scope.
- Shell and code execution always run in a workspace sandbox; unrestricted host mode is an explicit user setting.
- Credentials are referenced by opaque IDs and injected only at adapter execution time.
- Audit events contain parameter hashes and redacted summaries, never raw secrets.

## Migration

1. Import legacy providers into ClawCore tables with source metadata.
2. Run ClawCore chat, agents, schedules, local skills, artifacts and tools directly.
3. Keep a read-only import bridge only while a user still has legacy data to migrate.
4. Move channel adapters one integration at a time.
5. Make the bridge read-only, export a migration report, then remove the OpenClaw runtime bundle.

No normal application operation may write OpenClaw configuration after phase 2 begins.
