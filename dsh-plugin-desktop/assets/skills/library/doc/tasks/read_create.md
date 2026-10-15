# Read and create docs

Scope: view, summarize, extract original text; create a brand-new online doc; or explicitly full-overwrite an existing doc with complete Markdown. Regular body edits do NOT route here.

## 1. Read an existing doc

1. Per `../entry.md`, confirm the node kind and obtain `pageId`.
2. Call `get_doc_reviews.py --page-id <pageId>` for the latest content.
3. Success: first line is `KS_DOC_REVIEWS`, followed by the raw content.
4. Read-only / summarize / extract tasks end here — no submit script is called.
5. JSON error or empty stdout → stop and read `../error_handling.md`.

Read `../edit_core.md` §1 only when params or the stdout protocol are unclear.

## 2. Create a brand-new doc

1. Run `../../mutation.md`.
2. Prepare the title and the complete Markdown body. Fidelity is byte-level: ``` fences (```mermaid, ```python, …) are preserved exactly as written — never rewrite fences into `'''` or any other quoting, never drop or alter code or Mermaid source; pass the body via `--content-file`, never inline it into a shell/Python string that tempts quote-rewriting.
3. User names a space or parent node → pass plain `spaceId` / `parentId`; given only a URL, resolve the ID first — never pass the URL itself. No location given → use the default creation location, don't ask back.
4. Scan the body for GFM tables and dispatch:
   - No tables → for complex content run `create_doc.py --dry-run` first (no network, no token), then create in one shot.
   - Any table present → a one-shot create reliably 524s. Use the skeleton method: replace each table with a distinct one-line placeholder block, create the table-free skeleton, then insert each table separately via `submit_doc_edit.py` — each whole table ≤ ~3.6 KB / 12 rows goes in one single insert; larger tables chain segments per `table_edit.md` rules 3–4. Read `../server_pitfalls.md` §3, only if a real submission fails.
5. Call `create_doc.py` for real. On success, pass `KS_USER_REPLY` through verbatim.
6. `failedCount` or `fatalCount` > 0 → the doc was created but content may be incomplete; must prompt the user to open and verify.
7. Creation returns 524 / timeout → never blind-retry the same create. Read back the node: if a shell node exists and is confirmed empty, recover via §3 (full-overwrite) or fill it via the editing tasks.

## 3. Full-overwrite an existing doc

Only when the user explicitly asks to discard the whole body and re-import, or a creation timeout left a confirmed-empty doc shell node:

1. Read back and confirm the target is a writable `doc`; obtain its actual `spaceId`; prepare the complete Markdown.
2. Tell the user the entire body will be cleared and old block IDs / comment anchors may break; stop and wait for explicit confirmation.
3. After confirmation, re-check target and content, then call `create_doc.py --node-block-id <nodeId> --space-id <spaceId> --confirm-overwrite`.
4. Read the same node back to verify. Response ID differs, target missing / cross-space / not a doc → stop; never fall back to creating a new doc.

Full-text polish, terminology unification, cross-section edits and batch replacement still go through the editing tasks.

## 4. Creation content format

- Body is Markdown only; never mix in ClawClaw components like `<Paragraph>`, `<Callout>`, `<Table>`, `<Mermaid>`, `<Mark>`.
- Tables use Markdown/GFM tables.
- Mermaid uses Markdown fenced code.
- Plain quotes use `>`; component effects Markdown cannot express must not be worked around by mixing in component tags.

Read `../edit_core.md` §4 only when creation params, size limits, or success criteria are unclear.
