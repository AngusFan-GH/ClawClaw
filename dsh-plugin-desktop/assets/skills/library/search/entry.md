# search — Library Search

## Route here for

1. Search, find, or look up content already stored in the library — full-library, a named space/node, or 我的资料 by default
2. A broad, query-less overview of a library/space's contents ("这个资料库/空间大概讲什么")
3. Knowledge-base Q&A ("把文档弄成能问答的知识库 / 我问它答") — answer from stored content via `rag_search.py` below (chunk-level semantic retrieval); when the material isn't in the library yet, land it first (import / clip), then search and answer

Call `space.*` APIs through `space_api.py` at the skill root. Run `space_api.py <api-name> --help` when a parameter is unclear.

## Commands

- No scope given, or the user wants the entire library searched → `space.searcher.search-nodes`. Returns node-level hits (which documents matched).
- A scope is known — a space or node the user named, or 我的资料 by default when none is given → `search/rag_search.py --space-id`/`--node-id`. Returns fragment-level hits (the exact passage that matched).
- `--query`: 1–128 characters, the search intent only — never paste a whole block of context. Split a complex question into at most 3 searches.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/space_api.py" space.searcher.search-nodes --query "<关键词>"
```

- Show `nodeTitle`, `nodeKind`, `url`, `textContent` from `data.items[]`. Use `nodeId`, `score`, `locations` only for ranking.
- No hits → say the keyword was not found.

```bash
python3 "${CLAWCLAW_SKILL_DIR}/search/rag_search.py" \
  --query "<问题>" --node-id "<nodeId>"
```

- Pass at least one of `--space-id` / `--node-id`; either accepts multiple values, repeated or comma-separated.
- `--limit` defaults to 20, caps at 100. `--drive-limit` defaults to 10.
- Read `KS_RAG_CARDS` to build the user-facing reply (`cards[].title/source/snippet/image_urls/chunk_count`).
- Read `KS_RAG\t<spaceId>\t<nodeId>\t<nodeKind>\t...` when a hit's full text is needed next.

## Present results

- Finding or opening material → list each `title` as a link with its `chunk_count` and top-scoring `snippet`; show the first image when one exists.
- Summarizing or analyzing → write the answer as prose, mark each key claim `[N]`, and list sources in order of first appearance.
- Writing a report or brief → after composing the full text, save it via `doc/create_doc.py`.
- The user-facing view uses only `title`, `source`, `snippet`, `image_urls`, `chunk_count`, and citation numbers.
- Nothing matches → say plainly the given scope has no relevant content.

## Fetch a hit's full text

- Take the non-empty `nodeKind` and matching `nodeId` from `KS_RAG`.
- Enter the matching module's `entry.md` per the kind table in `SKILL.md`.
- Skip when `nodeKind` is empty or not covered there.

## Broad overview request

Browse top-level titles via `list-nodes` in `manage/entry.md`, one level at a time. Tell the user a full summary isn't available and this only lists titles. Never run a keyword search and present the hits as if they were an overview.

## Boundaries

- A single node given explicitly → read only that node, never expand it into a library-wide search.
- A write target never doubles as search authorization — see `../SKILL.md` §Search & Proactive Context.
- Scope (我的资料 vs. team space) only resolves the candidate space — it never changes how this module is called. Space list: `list-user-spaces` in `manage/entry.md`.
