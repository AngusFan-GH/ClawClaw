# schema-evolution — Field Linkage & Image Pipeline (post-delivery evolution)

> Covers post-delivery field add/remove/edit sync for dynamic data pages, and the image-field pipeline for pages showing images.

## 11.1 Dynamic data pages · database fields can change and stay in sync with the html (need: fields aren't fixed)

> **Principle**: the database fields linked to a dynamic data page (retrofit branch / create branch) are **not fixed** — after the table is built, you can still **add fields / remove fields / rename or retype fields / change records**, and the change propagates to the linked html page.

### Field-level changes (schema evolution)

- Add a field — script: `../database/add_database_field.py` (success outputs `{"field_id", "properties"}`; `properties` is the latest schema) — html side: the SDK uses `db.getSchema()` to **read fields/options at runtime**, never hard-coded; the new field renders into the matching column/card template automatically
- Rename a field / change its type — script: `../database/update_database_field.py` (success outputs `{"properties":[...]}`; retyping or deleting an existing select/multi_select option can wipe existing cell values; explain the risk when confirming with the team — see `../database/entry.md` §2.2) — html side: field name/type is read dynamically via `db.getSchema()`, no code change needed
- Delete a field — script: `../database/delete_database_field.py` (success outputs `{"properties":[...]}`, irreversible; confirmation rule in `../database/entry.md` §2.3) — html side: gracefully falls back to empty for the missing field, no error
- Change a field's options (select/multi_select) — done via options passed to `add_database_field` / `update_database_field` (an already-written `option.id` is permanent and can't be replaced — see `../database/entry.md` §13) — html side: options are read dynamically via `db.getSchema()`, no code change needed

> **The html must read the schema dynamically — don't hard-code any metadata beyond the ID**: `databaseId` is hard-coded (see `entry.md`'s red lines), but the **field list / option set** is read at runtime via `db.getSchema()` (see `modify-branch.md` stage 4 / `database-sdk-contract.md`). This way, once fields change, the page reflects the latest schema on its next load with no need to regenerate the html.

### Whether a field change requires touching the html

- **Only record values changed** → no html change needed at all (`__SMART_PAGE__.database` reads the latest value at runtime).
- **A field was added/removed and the page needs to show that column** → if the html renders headers/fields dynamically via `getSchema`, usually no code change is needed; only when the page is a **fixed layout** (the DOM skeleton hard-codes which fields to show) does it need `edit-flow.md`'s incremental edit to add/remove the corresponding DOM (see §4 — an incremental transaction, not a full overwrite).

### Data migration when restructuring (existing business data)

Field-level changes above keep the same table and its data. When the change is a genuine restructuring — the new structure requires dropping or replacing columns, or a new table would replace the old one — and the existing table already has business data, the data must be carried over explicitly:

1. Export the old table first: `../database/get_database_content.py` (full CSV text).
2. Build the new structure — evolve the existing table via `add_database_field.py` / `update_database_field.py` where possible; create a new table only when the old one cannot be evolved.
3. Map the exported records to the new structure and write them back via `../database/batch_add_database_records.py` (batches of ≤100, serial).
4. Verify the migrated row count matches the export before claiming completion; only then retire the old columns / old table, and only with the user's confirmation (deletion rules: `../database/entry.md` §13).

Never just drop columns or build a new table and leave the old data behind — silent data loss is the worst outcome of a restructuring. Re-import with a changed field structure follows this same rule (`import-flow.md` §5).

---

## 11.2 Image-display pages · database image-field pipeline (need: images stay swappable)

> **Rule**: whenever a page **needs to display images** (the source material has images, or the user wants "photos / an image wall / cards with pictures"), the linked database **must include an `image` field**; images map to the page through that field, and the setup supports **uploading/swapping images through conversation** afterward.

### Building the table: include an image field

Add an image column to the schema passed to `create_database.py` (see `../database/entry.md` §1 example `"照片": {"image": {}}`), adding an image column for the business data page's records; its `value` stores the image src — **new records must always store the hosted COS direct link produced by the `image-hosting.md` image-hosting flow**; existing records that already have a base64 value can stay as-is, and get converted to a hosted link opportunistically the next time the image is swapped.

### Uploading an image via conversation → writing it to the image field → mapping it to the page

```
User gives a local image in conversation (explicit path)
  │
  ├─(upload per the `image-hosting.md` image-hosting flow)──> get a hosted COS-accessible URL
  │
  ├─(`database/batch_add_database_records.py` or `batch_update_database_records.py`, fill the image field with that URL)──> write to the database
  │     ← new image: add_record; swap image: update_record on the matching record's image field
  │
  └─ at runtime, the html reads the image field's URL by field → renders <img src> (for business data pages, this happens after db.query, via setAttribute('src'))
```

### Ongoing image swaps

- User says "swap the Nth image for this one" → locate the matching record → use `batch_update_database_records.py` with a single-element array to change the image field's URL → the page picks it up on next load.
- **Never hand-edit the html's `<img src>` directly** (the SDK will overwrite it, and it won't persist) — editing the database record is the only durable way.

> Image field value / FieldValue shape: `../database/params-reference.md` §PropertyValue; image uploads always go through the `image-hosting.md` image-hosting flow.

---
