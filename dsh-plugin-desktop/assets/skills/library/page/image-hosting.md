# image-hosting — Image Hosting (mandatory precondition for online HTML delivery)

> **Scope**: all HTML being published as an online page (`import-flow.md` imports + `edit-flow.md` edit transactions). This must be cleared before calling `import_html.py` / before committing the transaction; the final HTML **must not** retain any third-party image-source external links (hard gate).
>
> **Preferred image source = hosted COS direct link**: images in the HTML should **preferentially** use the hosted direct link returned by `manage/upload_image.py` (platform COS domain, host contains `clawclaw` / `clawclaw`).
>
> **Base64 inlining: new images must use a hosted link; existing base64 stays untouched**
> - **Images added or replaced in this round (ones we're writing into the HTML ourselves)**: always upload first to get a hosted COS direct link — **do not** write them as `data:image/...;base64,...` (covers `<img src>`, `srcset`, CSS `url(...)`, and JS-built data URLs). Reason: bloated output can hit import/transaction-commit size limits, slows first-paint and mobile load, can't be reused, and is unfriendly to diffing and incremental edits. Only fall back to base64 temporarily — and note it in the receipt — when hosted upload keeps failing and delivery can't wait.
> - **Existing inline base64 images already in the page**: **may stay as-is, no need to convert or clean up**, and this does not fail the delivery check either; only touch them when the user explicitly asks to "switch inline images to hosted links."
>
> **Existing image sources (requirement 4.6)**: when editing an already-hosted page, any existing third-party external links found in the page must also be brought under this hosting section (hard gate); existing inline base64 images follow the rule above and are **kept as-is**. Do not proactively rework already-published historical pages.

### Execution order

1. **Extract** every static `<img>` tag's image reference (`src` / `srcset`) from the HTML.
2. **Classify each reference's source type**:
   - Starts with `data:` (base64 / inline data URL) → **skip if it's an existing one** (keep as-is, don't route it into the hosting flow); if it's an image being added/replaced in this round, don't use base64 — upload it per step 3 and write the hosted direct link instead.
   - Relative path → if it's a file packaged together with the HTML upload (zip / directory import), skip it; if it **points to a local disk image** (won't be uploaded with the artifact), upload it locally per step 3 to get a hosted direct link.
   - `http:` / `https:` / protocol-relative `//` absolute link → check its host: host containing `clawclaw` or `clawclaw` = a platform-internal link (already a hosted COS link), skip it; otherwise = a third-party external link, **must** be hosted.
3. **Convert to a hosted direct link**: call `manage/upload_image.py` (usage in `manage/entry.md` §`manage/upload_image.py`) — use `--url "<original image URL>"` for third-party links, pass the path directly for local images; take the `json.url` from the returned `KS_IMAGE_UPLOAD_OK` and write it back into the corresponding `<img>`'s `src` / `srcset`; never echo upload credentials / signed URLs to the user.
4. **Log failures**: if a conversion fails → record it in the failure list, never go silent, never leave a blank placeholder (see "Failure reporting" below).

### Pre-delivery self-check (must run before closing out)

**Check 1 · leftover third-party external links (hard gate)**: covers static `<img>` tag references only; scope to `<img>` tags → extract the host from `src`/`srcset` → filter out platform-internal hosts, any remaining output means leftovers:

```bash
grep -Eoi '<img[^>]+>' "<final.html>" \
  | grep -Eoi "(src|srcset)[[:space:]]*=[[:space:]]*[\"'][^\"']*(https?:)?//[^\"']+" \
  | grep -Eoi "(https?:)?//[^/\"')[:space:]]+" \
  | grep -Eiv 'clawclaw|clawclaw'
```

- **No output = pass** → clear to call `import_html.py` / commit the transaction.
- **Any output = fail** → go back and redo the pipeline; on repeated failure, move to "Failure reporting."
- Out of scope for this check (needs manual or a follow-up script if the page has these): CSS background images `url(...)`, `<source>`, `<video poster>`, and images injected dynamically via JS (`img.src`).

**Check 2 · base64 inlining (self-check only for "images added in this round," does not block delivery)**: confirm every image written or replaced this round uses a hosted direct link, with no newly introduced `data:image/...;base64`; output for pre-existing inline images is expected and normal — **not a failure, no cleanup required**.

```bash
grep -Eoi 'data:image/[a-z0-9.+-]+;base64' "<final.html>" | sort | uniq -c
```

### Failure reporting (never go silent, never paper over it with a placeholder)

- **User-specified image**: clearly state which image(s) couldn't be hosted, why, and how the corresponding spot in the page is handled (swap for another / user uploads manually / accept leaving it blank).
- **User didn't specify an image**: first try to find a suitable on-theme image; if that also fails, report per the rule above.
- **Unacceptable fallbacks**: writing a local absolute path into the HTML, or leaving a third-party external link and calling it done. (Base64 for a new image is only an acceptable temporary fallback when upload keeps failing, and must be flagged in the receipt.)

---
