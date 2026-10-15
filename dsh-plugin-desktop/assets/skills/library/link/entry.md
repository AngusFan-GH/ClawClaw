# link — webpage link clip

`kind=link` nodes store a webpage URL; the backend fetches the page body asynchronously and converts it to Markdown.

## 1. Create link

Only `http://` / `https://` are supported. Pass `--title` when the user specifies a title; otherwise the backend uses the page's original title. This is a mutation; run `../mutation.md` first; target space follows `../SKILL.md` §Target Space.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" doc.create-link \
    --url "<url>" [--title "<title>"]
```

`data.nodeBlockId` is the new node id and is also the `nodeId` used later to read the body (`data.taskId` is only for task tracking). Continue with §2 to read the fetch outcome.

## 2. Read body

For a user-given existing node, first confirm `kind=link` per `../SKILL.md` §Entry Routing, then call with its `nodeId`:

```bash
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" doc.get-link-content \
    --node-id "<nodeId>"
```

Fetch is asynchronous; branch on `data.status`:

- `pending` — re-query with the same `nodeId` after ~3 seconds; if still pending after ~5 minutes cumulative, stop polling and return the node link with a note that the body is still being fetched.
- `done` — body is in `data.content` as Markdown.
- `failed` — end the flow, report that the page fetch failed.

## 3. Receipt

- Create: return the node link `/space/d/{nodeBlockId}`.
- Read: use `content` to fulfill the user's original request (summary, extract, further processing).
