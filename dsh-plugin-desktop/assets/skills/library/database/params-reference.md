# database · Parameter Reference

Field-value / filter / sort structure reference for the `database` module. Consult when building table-creation configs, writing properties, or querying with filter/sorts. Table size limits are in §Limits. Routing, capability contracts, and per-database QPS live in `entry.md`.

## Limits

Hard caps for a single database table. Exceeding them is rejected by the server — split the dataset, drop columns, or shrink oversized cell values before create / import / add-field / batch-add. On reject, follow `../error_handling.md` by code: `56150` (rows), `56152` (columns), `56153` (row size).

- Maximum rows: 10,000 — `56150`
- Maximum columns: 50 — `56152`
- Maximum size per row: 1 MB — `56153`

## PropertyConfig

Field type config (used by create table / add field / change field type). Uses `oneof`; types are mutually exclusive:

- `number` — NumberConfig — numeric data: salary, amount, quantity, rating, age, percentage
- `currency` — CurrencyConfig — monetary values: price, cost, budget, wage, bill amount
- `select` — SelectConfig — single exclusive state/category: follow-up status, order status, priority, department
- `multi_select` — SelectConfig — multiple simultaneous tags/attributes: employee tags, hobbies, applicable channels
- `date` — DateConfig — any date or time point: hire date, birthday, current time, deadline, publish date
- `checkbox` — bool — binary state: confirmed, done, enabled, read
- `url` — URLConfig — web links: personal homepage, reference, official site, doc link
- `email` — string — email addresses: contact email, signup email, subscription email
- `phone_number` — string — phone numbers: contact, emergency contact, hotline
- `image` — ImageConfig — images: avatar, product photo, cover, screenshot, ID photo
- `attachment` — AttachmentConfig — mixed media files: images, videos, audio, docs, archives
- `person` — PersonConfig — system users/members: task owner, follower, approver, creator
- `text` — string — free text not covered by the structured types above: remark, description, note

**NumberConfig**: `{ decimalPlaces: int, useSeparate: bool, displayType?: string }`

- `decimalPlaces`: decimal places.
- `useSeparate`: thousands separator.
- `displayType`: display type, optional, defaults to `"number"`; `"percent"` renders as percentage.

Percent column: `{ "number": { "displayType": "percent", "decimalPlaces": 2, "useSeparate": false } }`. `displayType` only affects UI display; written/returned values are always plain numbers.

**CurrencyConfig**: `{ currencySymbol: string, decimalPlaces: int, useSeparate: bool }`

- `currencySymbol`: currency symbol, e.g. `"$"`, `"¥"`, `"€"`.
- `decimalPlaces`: decimal places.
- `useSeparate`: thousands separator.

### Option id rules (SelectConfig)

**SelectConfig**: `{ options: [{ text: string, id?: string, style?: int }] }` — canonical, the only detailed statement:

- New options for select / multi_select may omit `id` — the server generates it; if an id is passed it must be stable and not conflict with other options.
- The `properties` in a successful create/add/update-field response is the single source of truth for the final schema and ids — always trust the final ids there.
- An existing option's `id` is **permanent** — reuse it verbatim when modifying the field; never assign a new id to an existing option (safety angle: `entry.md` §13).
- `style` may be omitted; new options use the server default color.

**URLConfig**: `{ text: string, link: string }`

**ImageConfig**: `{ images: [{ title: string, imageUrl: string, width: int, height: int }] }`

**AttachmentConfig**: `{}` (no column-level config; always pass `{ "attachment": {} }` when creating the table/column)

**PersonConfig**: `{}` (no column-level config; always pass `{ "person": {} }` when creating the table/column)

**DateConfig**: `{ format: string }`

- `format`: date display format controlling how date fields render in the UI. Allowed values:
  - `yyyy"年"m"月"d"日"` — 2026年7月21日
  - `yyyy-mm-dd` — 2026-07-21
  - `yyyy/m/d` — 2026/7/21
  - `m"月"d"日"` — 7月21日
  - `[$-804]yyyy"年"m"月"d"日" dddd` — 2026年7月21日 星期二
  - `m/d/yyyy` — 7/21/2026
  - `d/m/yyyy` — 21/7/2026
  - `yyyy"年"m"月"d"日" hh:mm` — 2026年7月21日 10:00
  - `yyyy-mm-dd hh:mm` — 2026-07-21 10:00

### Full table-creation schema example

Complete template for `create_database.py` `--schema` / stdin `title + properties` creating multiple field types at once. Each type's `properties[].config` structure is documented in the Config sections above:

```json
{
  "title": "学生信息表",
  "properties": [
    { "name": "姓名",     "config": { "text":         "" } },
    { "name": "年龄",     "config": { "number":       { "decimalPlaces": 0, "useSeparate": false } } },
    { "name": "出勤率",   "config": { "number":       { "decimalPlaces": 2, "useSeparate": false, "displayType": "percent" } } },
    { "name": "预算",     "config": { "currency":     { "currencySymbol": "¥", "decimalPlaces": 2, "useSeparate": true } } },
    { "name": "年级",     "config": { "select":       { "options": [ { "id": "g1", "text": "一年级" }, { "id": "g2", "text": "二年级" } ] } } },
    { "name": "兴趣",     "config": { "multi_select": { "options": [ { "id": "t1", "text": "篮球" }, { "id": "t2", "text": "钢琴" } ] } } },
    { "name": "入学日期", "config": { "date":         "2024-09-01T00:00:00Z" } },
    { "name": "是否住校", "config": { "checkbox":     false } },
    { "name": "主页",     "config": { "url":          { "text": "homepage", "link": "https://example.com" } } },
    { "name": "邮箱",     "config": { "email":        "" } },
    { "name": "手机",     "config": { "phone_number": "" } },
    { "name": "照片",     "config": { "image":        {} } },
    { "name": "附件",     "config": { "attachment":   {} } }
  ]
}
```

- For targeted creation, add `"space_id":"<target_space_id>"` at the top level; to also specify a directory, add the matching `"parent_id":"<target_parent_node_id>"`.
- Option id rules for new options: see §Option id rules above.

### Add / update field property examples

`--property` for `add_database_field.py` / `update_database_field.py` (a single `{name, config}`):

```json
{ "name": "毕业院校", "config": { "text": "" } }
```

```json
{ "name": "状态", "config": { "select": { "options": [ { "id": "s1", "text": "在读" }, { "id": "s2", "text": "毕业" } ] } } }
```

When `update_database_field.py` omits `config` or passes an empty object, it renames the field only:

```json
{ "name": "阶段" }
```

## PropertyValue

Write-side field values, mutually exclusive by type; each value must be a `{ "<type key>": <value> }` oneof structure. Shared by `batch_add_database_records.py` and `batch_update_database_records.py`:

- `text` — string — `{ "text": "张三" }`
- `number` — number — `{ "number": 25 }`
- `currency` — number — `{ "currency": 1234.56 }` — display format controlled by column-level CurrencyConfig
- `select` — string — `{ "select": "进行中" }` or `{ "select": "opt_1" }` — option text or option id
- `multi_select` — string[] — `{ "multi_select": ["篮球", "钢琴"] }` or `{ "multi_select": ["opt_a", "opt_b"] }` — each element is option text or option id
- `date` — string — `{ "date": "2026-06-24" }` or `{ "date": "2026-06-24T10:00:00Z" }` — ISO 8601 date/time
- `checkbox` — boolean — `{ "checkbox": true }`
- `url` — object — `{ "url": { "text": "官网", "link": "https://example.com" } }`
- `email` — string — `{ "email": "a@example.com" }`
- `phone_number` — string — `{ "phone_number": "13800138000" }`
- `image` — object — `{ "image": { "images": [{ "title": "封面", "imageUrl": "https://...", "width": 800, "height": 600 }] } }` — `width` / `height` optional
- `attachment` — AttachmentItem[] — `{ "attachment": [{ "name": "报告.pdf", "attachmentId": "att_1", "fileType": "application/pdf", "fileSize": 10240, "mediaType": "file" }] }` — see §AttachmentItem below
- `person` — object[] — `{ "person": [{ "id": "uid123" }, { "id": "uid456" }] }` — write takes only `id` (user unique identifier); `name` is filled by the server on return and may be omitted when writing

Full `properties` example:

```json
{
  "姓名": { "text": "张三" },
  "年龄": { "number": 25 },
  "预算": { "currency": 1234.56 },
  "状态": { "select": "进行中" },
  "标签": { "multi_select": ["重要", "客户"] },
  "截止日期": { "date": "2026-06-24" },
  "完成": { "checkbox": false },
  "官网": { "url": { "text": "官网", "link": "https://example.com" } },
  "邮箱": { "email": "a@example.com" },
  "电话": { "phone_number": "13800138000" },
  "负责人": { "person": [{ "id": "uid123" }] },
  "图片": {
    "image": {
      "images": [
        { "title": "封面", "imageUrl": "https://example.com/cover.png", "width": 800, "height": 600 }
      ]
    }
  },
  "附件": {
    "attachment": [
      { "name": "报告.pdf", "attachmentId": "att_1", "fileType": "application/pdf", "fileSize": 10240, "mediaType": "file" },
      { "name": "封面.png", "attachmentId": "att_2", "fileType": "image/png", "fileSize": 20480, "mediaType": "image", "width": 800, "height": 600 }
    ]
  }
}
```

### AttachmentItem

Element structure of write-side `attachment` arrays (stored as `[]AttachmentItem`):

- `name` — string, required — file name
- `url` — string, optional — file access URL (only attachments converted from an image column have it; used directly when there is no `attachmentId`)
- `thumbnailUrl` — string, optional — thumbnail URL (same no-attachmentId case, e.g. attachments converted from an image column)
- `fileType` — string, required — MIME type, e.g. `image/png`, `video/mp4`, `application/pdf`
- `fileSize` — int64, required — file size in bytes
- `mediaType` — string, required — media category: `image` / `video` / `audio` / `file`
- `attachmentId` — string, optional — server attachment ID (obtained after confirm; used for download / preview)
- `width` — int32, optional — original width of image / video
- `height` — int32, optional — original height of image / video

Uploaded and confirmed attachments are referenced by `attachmentId`; attachments converted from an image column without an `attachmentId` are referenced directly by `url` / `thumbnailUrl`. `width` / `height` only apply to images / videos; omit for other media types.

## FieldValue

Field values returned by query / get-record APIs — **different from PropertyValue**:

- text / email / phone_number → string — `"张三"`
- select → string (option text only) — `"进行中"`
- number / currency → number — `25` / `1234.56`
- date → string (ISO 8601) — `"2026-06-24T10:00:00Z"`
- checkbox → boolean — `true`
- multi_select → string[] — `["篮球", "钢琴"]`
- url → `{ text, link }` — `{ "text": "官网", "link": "https://..." }`
- image → array `[{ imageUrl, title, width, height }]`
- attachment → array of AttachmentItem; the server fills in `attachmentId` / `url` etc. on return
- person → array `[{ id, name }]`; `name` filled by the server on return
- empty → `null`

## Filter rules

Filter is a recursive tree; each node is **exactly one** of three mutually exclusive forms (never combine several in one node):

- `property` — leaf node: single-field condition — `{"property": {<PropertyFilter>}}`
- `and` — all child conditions match — `{"and": [<Filter>, <Filter>, ...]}`
- `or` — any child condition matches — `{"or": [<Filter>, <Filter>, ...]}`

### PropertyFilter (leaf node)

The `property` field names the column; then pick the matching condition object for the column type (also mutually exclusive, pick exactly one):

- text / url / email / phone — key `"text"` — `equals`, `contains`
- number / currency — key `"number"` — `equals`, `greater_than`, `less_than`, `greater_than_or_equal`, `less_than_or_equal`, `is_empty`
- select / multi_select — key `"select"` — `equals`, `does_not_equal`
- date — key `"date"` — `equals`, `before`, `after` (value is ISO 8601, e.g. `"2025-06-01"` or `"2025-06-01T00:00:00Z"`)
- checkbox — key `"checkbox"` — `equals`, `does_not_equal`
- person — key `"person"` — `equals` / `does_not_equal` (user ID array, order-insensitive), `contains` / `does_not_contain` (single user ID), `is_empty` (bool: true = empty, false = not empty)

### Examples

**Simple condition** — name contains "张":

```json
{
  "filter": {
    "property": {
      "property": "名字",
      "text": { "contains": "张" }
    }
  }
}
```

**AND combo** — `状态` = "完成" and `分数` > 80:

```json
{
  "filter": {
    "and": [
      { "property": { "property": "状态", "select": { "equals": "完成" } } },
      { "property": { "property": "分数", "number": { "greater_than": 80 } } }
    ]
  }
}
```

**Nested AND + OR** — `已完成` is true and (`标签` = "A" or `标签` = "B"):

```json
{
  "filter": {
    "and": [
      { "property": { "property": "已完成", "checkbox": { "equals": true } } },
      {
        "or": [
          { "property": { "property": "标签", "select": { "equals": "A" } } },
          { "property": { "property": "标签", "select": { "equals": "B" } } }
        ]
      }
    ]
  }
}
```

**person condition** — `负责人` contains user uid123:

```json
{
  "filter": {
    "property": {
      "property": "负责人",
      "person": { "contains": "uid123" }
    }
  }
}
```

**No filter** — returns all records:

```json
{}
```

## Sort

`[{ property: "<column name>", direction: "ascending" | "descending" }]`
