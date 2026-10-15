# mutation flow

Every remote mutation first resolves a clear write target. The user's original explicit request authorizes the mutation when the target and scope are already clear — do not pause for a second authorization based on space type.

## Target resolution

- Existing node: `space.workspace.node-info` for the actual `spaceId`; operate in that node's own space.
- User-explicit space / directory: use that space's `spaceId`; verify `parentId` consistency when given.
- No explicit target: for create / import / upload only, follow create-time routing per `manage/filing/entry.md`. If routing still has no target, keep the space named in session; omit optional `spaceId` (backend defaults to `personal`) only when no space was named at all.
- Missing / ambiguous / contradictory target → stop, resolve or disambiguate. Never invent a default space when the user named one.

## Execution

1. Locate node, kind, position, target directory; resolve a clear target for create / upload.
2. Confirm the formal Agent capability is enabled; if not, refuse, do not probe.
3. Verify the current role can write the actual target; `reader` / `invalid` or any non-writable signal refuses directly, no confirmation round.
4. Read latest content / node / sibling state; establish baseline, complete same-name check.
5. The original request already authorizes: re-check baseline and permission right before submit, then submit via the module's native path. If a previously confirmed irreversible item or the remote baseline changed → re-present and wait.
6. After submit, read-only verification only. Unclear result → query first; never blindly retry.
7. Every successful create / import / upload / move closes the reply with exactly one line stating where the item landed — {{已存至 <space>/<directory>/<node>}} — plus the node link when the output carries one. One line, no menu, no question.

Re-checking after a remote baseline change: if the original request still realizes uniquely on the latest baseline, rebuild and continue; if the target becomes non-unique, semantics change, or scope expands, stop and ask. User-unrequested deletion, overwrite, field-type conversion, or any extra action counts as scope expansion.

Execute silently. Phrases like "write directly" / "no review" only pick the submission path. Target disambiguation, unrequested extra scope, product-form selection, and publish-state sync still follow the module rules.

Must confirm first: a doc full-replace carrying `nodeBlockId`. Always warn and get an explicit go-ahead even when the same message requested them: database field deletion, field-type conversion (retype), batch record deletion — irreversible or data-wiping (`database/entry.md` §13). Exempt: deleting a record the running verification itself created (page/edit-flow.md §5.3, page/clone-flow.md B11) — self-created test-data cleanup.

## Confirmation (irreversible ops)

Use `AskUserQuestion` (interactive card; fall back to a one- or two-sentence natural question when the tool is absent): one or two sentences stating what will be done, where, and the user-visible change; fixed options "Confirm execute" / "Cancel", no pre-selection. For complex content, show a brief list or diff in a normal reply first. Before confirmation: no business write calls, no upload-credential requests, no file PUT, no import.

Cover: modify/content delete that is irreversible or data-wiping (target and result; state the risk explicitly). One complete impact presentation may share one confirmation across an inseparable chain.

The runtime environment is for internal routing and auth only. In user-visible reasoning and replies, never reference this file, the flow, rules, sections, steps, or authorization status; state decisions as your own judgment (never 「按规则需要确认」).

## Same-name and overwrite

- No conflict → never mention same-name handling to the user.
- Create/upload/move/rename with user-given final name and unique target → execute with that name even if a same-name node exists; no silent rename or overwrite.
- Multiple same-name candidates → ask the user to disambiguate (target selection, not second authorization).
- User actively requests auto-rename or overwrite → auto-rename generates the final name first; overwrite proceeds only when the native API supports atomic overwrite of a specific node (never delete-then-create).

These APIs have no universal atomic same-name handling: re-check siblings before and after submit, but never promise to eliminate concurrent conflicts.

## Currently unsupported

- No formal Agent API for file / folder node deletion. Doc block, Database field / record, or Page DOM deletion follows the modify path.
- No history-version list or restore API. With a known Page version, `download_page_artifacts.py --version` is read-only artifact fetch only.
