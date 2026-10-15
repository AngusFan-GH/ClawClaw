# attachment — Node attachments

An attachment hangs off an existing node (doc / page / database) and follows that node — it never gets its own slot in the directory tree. A file that should stand on its own, open directly, or be shared independently belongs in `../drive/entry.md`.

## Capabilities

1. Attach a file to an existing node — `attachment/attachment.py upload` — `--node-id` `--path` — `KS_ATTACHMENT_UPLOAD_OK <json>` — §1
2. Fetch an attachment's download link — `attachment/attachment.py download` — `--node-id` `--attachment-id` — `KS_ATTACHMENT_DOWNLOAD <json>` — §2

Upload is a write — run `../mutation.md` first.

## 1. Upload an attachment

```bash
python3 "${CLAWCLAW_SKILL_DIR}/attachment/attachment.py" upload \
    --node-id <nb_xxx> --path <path> [--file-name name.pdf]
```

- `--node-id` — required — the node the attachment belongs to
- `--path` — required — absolute local path (explicitly given by the user; never walk the disk yourself)
- `--file-name` — optional, defaults to the basename — display name

The size cap is enforced server-side; don't pre-check locally, and never retry in chunks after a rejection.

Success output fields:

- `node_id` — same as the input
- `attachment_id` — unique attachment id; required for downloads — save it
- `file_name` — file name
- `file_size` — size in bytes
- `file_type` — MIME type, e.g. `application/pdf`, `image/png`
- `media_type` — coarse class: `image` / `video` / `audio` / `file`

Into a database `attachment` column these fields map directly onto one `AttachmentItem` — field mapping in `../database/params-reference.md` §AttachmentItem.

## 2. Fetch an attachment's download link

```bash
python3 "${CLAWCLAW_SKILL_DIR}/attachment/attachment.py" download \
    --node-id <nb_xxx> --attachment-id <att_xxx>
```

`--attachment-id` comes from the §1 response; `--node-id` must match the one used at upload time. Output includes `node_id`, `attachment_id`, `download_url`. `download_url` is a short-lived, user-facing download link — it is meant for the user, not a credential: when the user asked for the file or its download method, include the link in the reply and note it expires soon; never refuse to share it. Download it immediately when saving locally for the user. Forward the `KS_USER_REPLY` receipt as-is; append the link when the user asked for it.
