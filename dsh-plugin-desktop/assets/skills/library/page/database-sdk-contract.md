# Page Database SDK Contract

> This document defines the `window.__SMART_PAGE__.database` runtime protocol available to the Agent when writing HTML.
> For cross-module table creation, schema queries, CSV import, server-side record updates and other capabilities, see `../database/entry.md`. Limits: §1.1.

## 1. Injection and invocation

The platform's iframe sandbox injects the SDK before user scripts execute. Read it directly in the HTML:

```javascript
var db = window.__SMART_PAGE__.database;
```

All methods return a `Promise`. `databaseId` must be hard-coded into the HTML as a string literal, with its value coming from the stdout of `../database/create_database.py`.

## 1.1 Limits

Page SDK calls are **20 QPS per page**. They are also bound by the table's own caps — both layers apply:

- Maximum rows: 10,000 — `56150`
- Maximum columns: 50 — `56152`
- Maximum size per row: 1 MB — `56153`
- Rate limit: **30 QPS per database** — `50001`

Page-layer 20 QPS also returns `50001`. Handle per `../error_handling.md`. Do not `Promise.all` a burst of SDK calls; serial `loadAll` paging is fine. `onUpdated` re-queries must debounce (§8).

Table numbers: `../database/params-reference.md` §Limits. Table QPS: `../database/entry.md` §Rate limit.

## 2. Available methods

- `db.query(params)` — query a list of records (**a single call returns only one page**; pagination must be implemented by the page itself) — params `{ databaseId, filter?, sorts?, fields?, startCursor?, pageSize? }`
- `db.addRecord(params)` — add a record — params `{ databaseId, properties }`
- `db.getRecord(params)` — fetch a single record — params `{ databaseId, recordId, fields? }`
- `db.updateRecord(params)` — update a record (incremental — only updates the fields that are passed) — params `{ databaseId, recordId, properties? }`
- `db.deleteRecord(params)` — delete a record — params `{ databaseId, recordId }`
- `db.getSchema(params)` — fetch the database schema — params `{ databaseId }`
- `db.uploadImage(params)` — upload an image and get back a CDN URL — params `{ data, contentType?, fileName? }` (**no `databaseId`**)
- `db.aggregate(params)` — aggregate stats (count/sum/avg/max/min + optional filter + optional groupBy); one call returns multiple stats, avoiding full-set pulls for client-side math — params `{ databaseId, aggregates }`
- `db.uploadFile(params)` — upload an attachment file and get back an `AttachmentItem` writable into an `attachment` field (see §9) — params `{ nodeId, file }`
- `db.getDownloadUrl(params)` — get a pre-signed attachment download URL (see §9) — params `{ nodeId, attachmentId }`
- `db.getPreviewUrl(params)` — get an attachment preview URL / thumbnail (see §9) — params `{ nodeId, attachmentId, heightSize? }`
- `db.onUpdated(handler)` — subscribe to database data-change notifications; how to respond is decided by the page's business code (see §8) — `handler({ databaseIds })` (**no `databaseId`**, and **returns no Promise**)
- `db.getUserInfo()` — get the current logged-in user's info (`nickName`, `id`, `avatar`, etc.); **calling it when logged out triggers a login redirect — only call it when the page genuinely needs the user's identity** — **no `databaseId`**, no params (see §10)

Write-method return values: `db.updateRecord` → `{ id }` (**incremental update**: only fields passed in `properties` are overwritten, unpassed fields are left unchanged); `db.deleteRecord` → `{}` (empty body). `updateRecord`'s `properties` has the same structure as `db.addRecord` (see §3 PropertyValue).

## 3. PropertyValue

`db.addRecord`'s `properties` is a `map<string, PropertyValue>`; the key must exactly match a database schema field name.

Each `PropertyValue` is a oneof structure: `{ "<type key>": <value> }`.

- `text` — value type string — e.g. `{ text: "张三" }`
- `number` — value type number — e.g. `{ number: 25 }`
- `select` — value type string — e.g. `{ select: "opt_1" }` or `{ select: "进行中" }`
- `multi_select` — value type string[] — e.g. `{ multi_select: ["opt_a", "opt_b"] }` or `{ multi_select: ["篮球", "钢琴"] }`
- `date` — value type string — e.g. `{ date: "2026-06-24" }`
- `checkbox` — value type boolean — e.g. `{ checkbox: true }`
- `url` — value type object — e.g. `{ url: { text: "官网", link: "https://example.com" } }`
- `email` — value type string — e.g. `{ email: "a@example.com" }`
- `phone_number` — value type string — e.g. `{ phone_number: "13800138000" }`
- `image` — value type object — e.g. `{ image: { images: [{ title: "封面", imageUrl: "https://example.com/a.png", width: 800, height: 600 }] } }`
- `attachment` — value type object — e.g. `{ attachment: [{ name, attachmentId, fileType, fileSize, mediaType }] }` (each element is an `AttachmentItem` returned by `db.uploadFile`, see §9)

Each element of `attachment` is an `AttachmentItem` returned by `db.uploadFile` (carrying `attachmentId`); a local file must first go through `db.uploadFile` to obtain the `AttachmentItem` before being written into the record (execution order in §9).

`image`'s `imageUrl` must be a publicly accessible URL; for a local file the user uploads on the page, you **must first** call `db.uploadImage` to get a `url`, and only write it into the record after that (execution order in §7) — **never** write a `data:image/...;base64,` or `blob:` address directly into `imageUrl`.

`select` / `multi_select` may be given either the option text or the option id; when the Agent writes HTML, prefer taking `.id` from `OPTIONS_MAP`.

```javascript
properties["部门"] = { select: OPTIONS_MAP["部门"][selectedKey].id };
properties["技能"] = {
  multi_select: Array.prototype.map.call(selectedEls, function(el) {
    return OPTIONS_MAP["技能"][el.value].id;
  })
};
```

## 4. Query params

`filter` is a recursive tree; a node is one of three shapes:

- Single-field condition — JSON shape `{ property: { property: "fieldName", text/number/select/date/checkbox: {...} } }`
- AND — `{ and: [filter1, filter2] }`
- OR — `{ or: [filter1, filter2] }`

Condition fields and operators by field type:
- text / url / email / phone_number — condition field `text` — operators `equals`, `contains`
- number — condition field `number` — operators `equals`, `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `is_empty`
- select / multi_select — condition field `select` — operators `equals`, `does_not_equal`
- date — condition field `date` — operators `equals`, `before`, `after`
- checkbox — condition field `checkbox` — operators `equals`, `does_not_equal`

`sorts` structure:

```javascript
[{ property: "fieldName", direction: "ascending" }]
```

`direction` may be `"ascending"` or `"descending"`.

> **Field-reference constraint**: `sorts[].property`, the `property` of any `filter` leaf, and the field names inside `fields[]` **must all come from the real field names returned by `db.getSchema()`**; fields not present in the schema may not be referenced.

`pageSize`: defaults to `50`, **maximum `200`** (values above that are truncated to 200). **A single `query` call always returns only one page** — the backend never returns the full dataset in one go, so **pagination logic must be implemented by the page itself**: either loop with a `loadAll`-style recursion (per §6) to pull the full dataset before rendering, or build a "load more / pager" interaction that stores `nextCursor` and pulls one page per click. **Never** assume a single `query` returns every record (once data exceeds one page, records will silently go missing and any statistics/aggregation will be wrong).

**Data integrity is a hard gate**: for 0-1 generated HTML, "pagination incomplete" is blocked by `lint_database_sdk_usage.py`'s **DSDK014**, "illegal truncation of database data" by **DSDK015** (when the user explicitly asks for truncation, mark `数据完整=已确认截断(<reason>)` in the receipt `QUALITY_OK` to pass), and "mock fake data in catch" by **DSDK016**. Rules: `page-quality-check.md`.

## 4.5 Aggregate params (aggregate stats)

Stats blocks (totals / group counts / sums / averages) use `db.aggregate` — never `db.query` the full set and compute client-side; one request returns multiple stats, the DB is read once, avoiding serial paging overhead on large datasets.

`db.aggregate(params)` params:

```javascript
{
  databaseId: "db_xxx",
  aggregates: [
    { name: "total",     type: "count" },                                                       // total
    { name: "by_dept",   type: "count", groupBy: "部门" },                                       // group count
    { name: "recent_7d", type: "count", filter: { property: { property: "报名时间", date: { after: "2026-08-26" } } } },  // conditional count
    { name: "total_fee", type: "sum",  property: "金额" },                                      // sum
    { name: "avg_age",   type: "avg",  property: "年龄" }                                        // average
  ]
}
```

`aggregates[]` item fields:

- `name` (required) — caller-defined result identifier (results are matched by it)
- `type` (required) — `count` | `sum` | `avg` | `max` | `min`
- `property` (required for sum/avg/max/min) — the aggregate field name (must exist in the schema and be number/currency); not needed for count
- `groupBy` (count only) — group field name (returns `[{key,count}]`, sorted by count desc, max 1000 groups)
- `filter` (optional) — per-item independent filter (reuses §4's Filter tree; `property`/`and`/`or` pick one)

Return:

```json
{
  "results": [
    { "name": "total",     "value": 128 },
    { "name": "by_dept",   "value": [{"key":"研发","count":50},{"key":"产品","count":30}] },
    { "name": "recent_7d", "value": 15 },
    { "name": "total_fee", "value": 12500.5 },
    { "name": "avg_age",   "value": 28.3 }
  ]
}
```

`value` shapes: `count` without groupBy → number; `count` + `groupBy` → `[{key, count}]` (count desc, max 1000 groups, over-limit truncated and flagged `truncated: true`); `sum`/`avg`/`max`/`min` → number or `null` (no valid rows).

Constraints: `aggregates` takes 1-10 items; multiple items sharing the same `filter` are merged by the backend and filtered once (callers don't care); a `count` with no filter and no groupBy takes an O(1) fast path (row count directly, no row data read).

Standard pattern (stats block):

```javascript
db.aggregate({
  databaseId: DATABASE_ID,
  aggregates: [
    { name: "total",   type: "count" },
    { name: "by_dept", type: "count", groupBy: "部门" },
    { name: "recent",  type: "count", filter: { property: { property: "报名时间", date: { after: "2026-08-26" } } } }
  ]
}).then(function(rsp) {
  rsp.results.forEach(function(item) {
    if (typeof item.value === "number") {
      document.querySelector('[data-stat="' + item.name + '"]').textContent = item.value;
    } else {
      // groupBy result is an array [{key, count}]
      renderGroupChart(item.name, item.value);
    }
  });
}).catch(function(err) { console.error("[database] aggregate failed:", err); });
```

DOM elements holding stats numbers must carry `data-sp-bindable="database"` + `data-sp-database-id` (§1.5.5), because stat values derive indirectly from the database.

## 5. GetSchema return value

`db.getSchema({ databaseId })` returns `{ id, title, properties }`.

- `id` — string — database ID
- `title` — string — database title
- `properties` — array — list of field definitions

Each item in `properties`:
- `id` — string — field ID
- `name` — string — field name
- `type` — string — field type (`text`, `number`, `select`, `multi_select`, `date`, `checkbox`, `url`, `email`, `phone_number`, `image`)
- `config` — object? — field configuration; for `select`/`multi_select` types this includes `options: [{ text, id }]`

Example:

```javascript
var schema = await db.getSchema({ databaseId: "db_xxx" });
// schema.properties → [{ id: "f1", name: "姓名", type: "text" }, { id: "f2", name: "状态", type: "select", config: { options: [{ text: "进行中", id: "opt_1" }] } }]
```

## 6. FieldValue

`db.query` returns `{ results, nextCursor, hasMore }`; always take the record array from `result.results` (pagination is paired with `result.nextCursor` / `result.hasMore`); `db.getRecord` returns `{ result }`. A record is a flat object: `{ "fieldName": value }` (including the system primary key `_id`).

**Pick the fetch strategy per scenario** — `query` returns only one page per call (`pageSize` defaults to 50, max 200); for large datasets prefer a pager / load-more over blindly pulling the full set (full-set pulls on large data mean many serial requests and a slow first screen):

- **Full list display (many rows)** → **pager / load-more** (store `nextCursor`, page on demand); 1 request per page turn.
- **Client-side filter / sort / stats needing all data** → full-set pull (the data genuinely must be in memory); N serial requests.
- **Only Top N / latest N** → single query (`sorts` + `pageSize=N`); 1 request.
- **Stats numbers** (totals / group counts / sums / averages) → **`db.aggregate`** (§4.5 — multiple stats in one call, no full-set pull); 1 request.

Both approaches must handle `hasMore` — never treat a single query as the full dataset (DSDK014 data-integrity hard gate). The pagination-cursor param name is fixed as `startCursor` (**not `cursor`** — the backend only recognizes `startCursor`; getting the name wrong causes it to be silently dropped → the cursor stays perpetually empty → infinite loop).

**Full-set pull** (`loadAll`, for scenarios that genuinely need all the data):

```javascript
function loadAll(startCursor, acc, guard) {
  acc = acc || []; guard = guard || 0;
  if (guard > 100) return Promise.resolve(acc);            // safeguard①: hard cap circuit breaker
  return db.query({ databaseId: DATABASE_ID, pageSize: 200, startCursor: startCursor })  // use the max of 200 when pulling the full dataset, to reduce round trips
    .then(function (r) {
      acc = acc.concat(r.results || []);
      var next = r.nextCursor;
      // safeguard②: cursor must advance (next !== startCursor); safeguard③: only continue paging if this page was non-empty
      if (r.hasMore && next && next !== startCursor && (r.results || []).length) {
        return loadAll(next, acc, guard + 1);
      }
      return acc;
    });
}
loadAll().then(function (all) { /* render all */ });         // pass undefined as startCursor for the first page
```

**Pager / load-more** (first choice for large lists — one page per fetch, paging on demand):

```javascript
var nextCursor = null;
function loadPage(cursor) {
  db.query({ databaseId: DATABASE_ID, pageSize: 50, startCursor: cursor })
    .then(function (r) {
      render(r.results);                    // render only the current page
      nextCursor = r.nextCursor;           // stored for the "next page" button
      togglePager(r.hasMore, !cursor);     // hasMore drives button visibility
    });
}
loadPage();                                 // first page on load
// "next page" button → loadPage(nextCursor); "previous page" → loadPage() again from the first page
```

Example `db.query` return value:

```json
{
  "results": [
    {
      "_id": "2rVLfQTl3uHurZq7dfrbdG",
      "姓名": "小李",
      "所属单位": "腾讯",
      "手机号": "123456",
      "邮箱": "123456789@qq.com",
      "参与人数": 2,
      "参与场次": "全天参与"
    }
  ],
  "nextCursor": "2rVLfQTl3uHurZq7dfrbdG",
  "hasMore": true
}
```

Return value by field type:
- text / select / email / phone_number → string
- number → number
- date → string, ISO 8601 (e.g. `"2026-06-24T10:00:00Z"`)
- checkbox → boolean
- multi_select → string[]
- url → `{ text, link }`
- image → `[{ imageUrl, title, width, height }]`
- empty value → `null`

Check for null before rendering an image:

```javascript
var imgs = row["图片"];
var src = imgs && imgs[0] ? imgs[0].imageUrl : "";
```

## 7. UploadImage

`db.uploadImage(params)` uploads image bytes to the CDN and returns a URL that can be written into an `image` field. It does **not** need a `databaseId`.

> **Execution order (mandatory)**: call `db.uploadImage` first to get the `url`, then use it for anything downstream (writing the `image` field, rendering a preview, etc).
> - If `url` never arrives or is empty → abort with an error; never send `addRecord` / `updateRecord`.
> - `imageUrl` may only be the `url` returned by `uploadImage`; writing a `data:base64` / `blob:` address into the record produces a dead link.
> - For multiple images: upload each one, wait for all via `Promise.all`, and write the `images` array in a single batch.

Params:
- `data` — string — required — base64 of the raw image bytes, **without** the `data:image/png;base64,` prefix
- `contentType` — string — optional — MIME type, e.g. `image/png`
- `fileName` — string — optional — the original filename (including extension)

Returns: `{ url }`, where `url` is a CDN-accessible address.

Constraints (the frontend must validate these itself; the backend rejects anything out of range): ≤10MB per image; MIME limited to `image/png`, `image/jpeg`, `image/gif`, `image/webp`, `image/bmp`, `image/svg+xml`, `image/heic`, `image/heif`, `image/tiff`.

Standard pattern — `<input type="file">` → base64 → `uploadImage` → write into the `image` field:

```javascript
function fileToBase64(file) {
  return new Promise(function (resolve, reject) {
    var reader = new FileReader();
    reader.onload = function () {
      // readAsDataURL yields something like "data:image/png;base64,xxxx" — take only the part after the comma
      resolve(String(reader.result).split(",")[1] || "");
    };
    reader.onerror = function () { reject(new Error("读取文件失败")); };
    reader.readAsDataURL(file);
  });
}

// Step ①: file → base64 → uploadImage, producing an image item ready to store
function uploadOne(file) {
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error("图片不能超过 10MB"));
  return fileToBase64(file)
    .then(function (base64) {
      return db.uploadImage({ data: base64, contentType: file.type, fileName: file.name });
    })
    .then(function (r) {
      if (!r || !r.url) throw new Error("上传失败：未返回 url");   // an empty url must abort — never proceed to write the record
      return { title: file.name, imageUrl: r.url };
    });
}

// Step ②: only write to the database and continue after every url has been obtained
function submitWithImages(files, otherProps) {
  return Promise.all(Array.prototype.map.call(files, uploadOne))
    .then(function (images) {
      var properties = otherProps || {};
      if (images.length) properties["图片"] = { image: { images: images } };
      return db.addRecord({ databaseId: DATABASE_ID, properties: properties });
    })
    .catch(function (err) {
      console.error("[database] 图片上传/提交失败:", err);
      throw err;   // hand off to the UI for the error message, never silently write an empty-image record
    });
}
```

`width` / `height` are optional; when needed, measure `naturalWidth` / `naturalHeight` locally with an `Image` object and include them in the image item in step ①.

Adding an image to an existing record follows the same pattern: `uploadImage` → `db.updateRecord({ databaseId, recordId, properties: { "图片": { image: { images: [...] } } } })`. Note that the `image` field is overwritten as a whole — when appending an image, first read the record's existing `[{ imageUrl, title, width, height }]`, concat, and submit the combined array.

### 7.1 Pre-submit image caching (mandatory — prevents loss on login redirects)

If the user submits while not logged in, the platform redirects to login and reloads the whole page, wiping any in-memory `File` objects. The image body itself is not serializable (base64 would blow up localStorage), so **store the `Blob` in IndexedDB**, with `localStorage` only holding a flag. Supports multiple images, keeping only the most recent selection. Flow: **pick images (clear the previous batch first) → restore the preview after the page reload → submit via §7's `uploadImage(Blob)` → clear the store once `addRecord` succeeds**. The following are mandatory constraints the Agent must implement itself (ES5):

- **Storage**: IndexedDB database `sp_form_img`, object store `f`, key = `location.pathname + "::图片#" + i`; `localStorage` key `"sp_img_flag_"+location.pathname` stores `{n, ts}` (image count + timestamp).
- **Same-origin isolation**: pages on the same origin share one store — **never call `store.clear()`**; keys are prefixed with `location.pathname`, and cleanup only deletes this page's `图片#0..#(n-1)` by `n`.
- **Robust open** (otherwise a shared origin throws `Uncaught NotFoundError`): don't hard-code the version; in `onsuccess` check `contains("f")` — if missing, `close()` and reopen with `version+1`, creating the store in `onupgradeneeded`; wrap `transaction` in try/catch and reject, and also handle `onblocked`.
- **Three actions**: ① on `change`, clear if the selection is empty, otherwise clear the previous batch then `put` each image (`图片#i`) and write the flag; ② restore (called after `renderSelectOptions()`) — clear if there's no flag or it's older than 48h, otherwise `get` each of the `n` items and rebuild the preview/closure; ③ on submit, use the restored Blobs (falling back to `input.files`) through §7's `submitWithImages`, clearing on success and keeping on failure.
- **Decoupled degradation**: wrap every IndexedDB call in `.catch` so failures degrade silently and **never affect `uploadImage`/`addRecord`**; skip caching entirely if `window.indexedDB` is unavailable.
- **When to clear**: on submit success / image removal / past 48h, uniformly delete this page's keys by `n` + delete the flag + clear the closure (a single image means `n===1`). `lint_database_sdk_usage.py`'s DSDK008 hard-checks that the IndexedDB caching code is present (`open`/`transaction`/`objectStore`/`put`/`delete` all present).

## 8. OnUpdated (data-change subscription, recommended)

`db.onUpdated(handler)` subscribes to data changes of **the databases already linked to the current page**: any source of change (someone editing the table, another client submitting, a script batch-writing, or the page's own `addRecord`) fires `handler` once persisted.

The platform only signals **that a change happened**; what the page does next is business logic (re-`query` and re-render / refresh one block only / update stat numbers / prompt "data updated" / ignore — all valid).

> **Recommended, not mandatory — judge per scenario**: multi-user collaboration, dashboard stats, long-dwell display pages where others keep writing → subscribe, so the page always shows the latest data; one-shot snapshot display and pure form pages subscribe only if needed.

Differences from other methods: **no `databaseId`** at call time (the platform decides the subscription scope); **registration is synchronous and immediate** (no `Promise`); the callback receives `{ databaseIds }` — the array of changed databaseIds, **carrying only the change scope** (the page queries record content itself).

```javascript
// Platform minimal form: re-querying in the callback is just the most common handling
db.onUpdated(({ databaseIds }) => {
  for (const databaseId of databaseIds) {
    window.__SMART_PAGE__.database.query({ databaseId });
  }
});

// Recommended pattern for data display pages (ES5, paired with §6 loadAll)
if (db && typeof db.onUpdated === "function") {           // capability missing → silent degradation
  db.onUpdated(function (payload) {
    var ids = (payload && payload.databaseIds) || [];
    if (ids.indexOf(DATABASE_ID) === -1) return;          // handle only the tables this page cares about
    loadAll().then(renderData).catch(function (err) { console.error("[database] refresh failed:", err); });
  });
}
```

Constraints (apply once you subscribe; in-callback business handling is up to the page):

- **Register once**: register a single handler during page init; keep the registration outside any `query` callback or render function.
- **Fetch new data yourself**: the callback carries only the change scope; the page re-fetches via `query` / `getRecord` by `databaseIds`.
- **Debounce**: consecutive writes fire multiple callbacks; if the handling issues requests / re-renders, add a 300ms debounce or a "processing" flag to block concurrency (page SDK is 20 QPS per page, §1.1).
- **Per-block partial update**: on multi-table pages update only the block matching `databaseIds`, preserving user input and scroll position (better than a full `location.reload()`).
- **Capability probe + reuse paging**: call it only after `typeof db.onUpdated === "function"`; re-fetching still goes through §6's `hasMore`/`nextCursor`.

## 9. Attachment (upload / download / preview)

The `attachment` field holds mixed media — images, video, audio, documents, archives (see the `attachment` type in §3 PropertyValue) — operated via three methods: `uploadFile` / `getDownloadUrl` / `getPreviewUrl`.

> **Execution order (mandatory)**: call `db.uploadFile` first to get an `AttachmentItem`, then write it into the record's `attachment` field (structure in §3).
> - Multiple files: upload each one, collect via `Promise.all`, then write the `attachment` array in a single batch.
> - The `attachmentId` used for download / preview comes from the `uploadFile` return value, or from an `attachment` element read back via `query` / `getRecord`.

### 9.1 `db.uploadFile(params) → Promise<AttachmentItem>`

The return value can be written straight into an `attachment` field of `addRecord` / `updateRecord`. Internally it runs `apply → direct PUT → confirm`, with the timeout relaxed to 10 minutes (30s for other methods) to accommodate large files.

Params:

- `nodeId` (string, required): target database ID (i.e. the `databaseId` hard-coded in this page)
- `file` (Blob / File, required): `files[i]` of `<input type="file">`, or `new File([bytes], "pack.zip")`

Returns an `AttachmentItem` (directly writable into an `attachment` field):

- `name` (string): display filename
- `attachmentId` (string): used later for download / preview / writing back to the record
- `fileType` (string): MIME, inferred from the filename
- `fileSize` (number): bytes
- `mediaType` (string): `image` / `video` / `audio` / `file`
- `width` / `height` (number, images only): read by the SDK from the file; omitted for non-images

Standard pattern — `uploadFile` each, collect via `Promise.all`, then write to the database in one batch:

```javascript
function submitWithAttachments(files, otherProps) {
  return Promise.all(Array.prototype.map.call(files, function (file) {
    return db.uploadFile({ nodeId: DATABASE_ID, file: file });
  })).then(function (items) {
    var properties = otherProps || {};
    if (items.length) properties["附件"] = { attachment: items };
    return db.addRecord({ databaseId: DATABASE_ID, properties: properties });
  });
}
```

`properties["附件"]` accepts a single `item`, an `AttachmentItem[]`, or `{ attachment: items }` — the SDK normalizes all three; the example uses the explicit wrapped form. Appending to an existing record uses `updateRecord`; the `attachment` field is overwritten as a whole, so concat the existing `AttachmentItem[]` before submitting when appending.

### 9.2 `db.getDownloadUrl(params) → Promise<{ downloadUrl }>`

Params:

- `nodeId` (string, required): target database ID
- `attachmentId` (string, required): the `uploadFile` return value, or read back from a record's `attachment` field

Returns: `downloadUrl` — string — a pre-signed download URL (short-lived; use it promptly once obtained).

```javascript
var res = await db.getDownloadUrl({ nodeId: DATABASE_ID, attachmentId: item.attachmentId });
// res.downloadUrl triggers the download
```

### 9.3 `db.getPreviewUrl(params) → Promise<{ previewUrl, thumbnailUrl? }>`

Params:

- `nodeId` (string, required): target database ID
- `attachmentId` (string, required): the `uploadFile` return value
- `heightSize` (number, optional): thumbnail height (an internal default exists); the Agent protocol normally **leaves it empty** — pass it only for a custom thumbnail size

Returns: `previewUrl` — string — the preview URL; `thumbnailUrl` — string, optional — the thumbnail (documents / archives may not have one).

```javascript
var res = await db.getPreviewUrl({ nodeId: DATABASE_ID, attachmentId: item.attachmentId });
// prefer res.thumbnailUrl when present; open res.previewUrl on click
```

## 10. GetUserInfo

`db.getUserInfo()` returns the current logged-in user's information. It takes **no parameters** and **no `databaseId`** — the platform resolves the caller's identity from the session.

> **Login-redirect behavior (decide before calling)**: when there is no valid login session, the platform **defaults to redirecting to the login page** — it does **not** return an empty `userInfo`. Therefore the page must decide on its own whether it needs the user's identity: **only call `getUserInfo` when the page genuinely requires the user's info** (avatar/nickname display, user-scoped data, etc.). A page that can work anonymously should not call it, otherwise the user will be forced into a login flow.

Returns `{ userInfo }` where `userInfo` is an object:

- `nickName` — string — user's nickname
- `id` — string — user ID
- `name` — string — account name
- `avatar` — string — avatar URL
- `accountType` — number — account type

```javascript
db.getUserInfo().then(function (rsp) {
  var info = rsp && rsp.userInfo;
  if (!info) {
    // userInfo 缺失（边缘情况），降级处理
    return;
  }
  // info.nickName / info.id / info.avatar ...
});
```

> **Still guard for null**: once the call returns, `userInfo` may be missing in edge cases; always check `if (!info) return;` before accessing fields.

## 11. SDK-call detection

The method set `parse_html.py` uses to detect existing SDK calls:

```text
addRecord|deleteRecord|getRecord|getSchema|query|updateRecord
```

A match produces `existing_databases`, which the subsequent upload associates via `import_html.py --databases`. `uploadImage` / `onUpdated` / `getUserInfo` carry no `databaseId` and do not participate in this detection; `uploadFile` / `getDownloadUrl` / `getPreviewUrl` take `nodeId` (the databaseId value) rather than the `databaseId` key and likewise don't participate — so a page that touches a database **only** through attachment methods must carry another explicit `databaseId` CRUD call in the HTML, or be linked manually at import time via `import_html.py --databases`.
