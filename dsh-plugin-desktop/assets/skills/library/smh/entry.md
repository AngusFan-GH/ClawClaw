# smh — legacy smart-media-library files

Earlier library versions used a separate storage for files, leaving behind a batch of `kind=smh` nodes. These nodes only support download; new files all go through `../drive/entry.md`; do not initiate SMH uploads.

Content replacement is not supported. To modify, download then upload as a new file (via the new-file flow in `../drive/entry.md` §1); to change only the title, route via `../manage/entry.md`.

## Get download link

```bash
python3 "${CLAWCLAW_SKILL_DIR}/smh/get_download_link.py" --node-id <blk_xxx>
```

Output is `KS_SMH_DOWNLOAD <json>` containing `node_id`, `file_name`, `ext`, `download_url`. `download_url` is a short-lived, user-facing download link — it is meant for the user, not a credential: when the user asked for the file, the link, or a download method, include it in the reply and note it expires soon; never refuse to share it. Download it immediately when saving locally for the user. Forward the `KS_USER_REPLY` receipt; append the link when the user asked for it.