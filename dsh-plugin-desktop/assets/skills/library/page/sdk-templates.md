# SDK templates — minimal working set for data pages

The platform auto-injects the SDK; `window.__SMART_PAGE__.database` is immediately available. This file is the minimal template set for both the create branch (`create-branch.md`) and the retrofit branch (`modify-branch.md`). Read `database-sdk-contract.md` only when a need goes beyond these templates (aggregate stats, advanced filters, uploadImage caching details, full fetch-strategy table).

- Hard-code `databaseId` into the HTML (from `create_database` output).
- Dual-layer limits: **20 QPS per page**, plus the table's own 10,000 rows / 50 columns / 1 MB per row / 30 QPS — `database-sdk-contract.md` §1.1. Do not burst parallel `query` / `addRecord`.
- **Write pre-check field whitelist**: `sorts`/`filter`/`fields[]`/`row["fieldName"]`/`properties["fieldName"]` may only reference fields present in the `properties` returned by `create_database` — never invent one; before sorting by time, confirm the field list actually has a matching date field.

Pick by `page_type`: display = case 2, form = case 3, mixed = case 4.

**Case 2 — data display**

`query` returns `{ results, nextCursor, hasMore }`; each item in `result.results` is a flat object `{ "fieldName": value }`. Value shapes: text/select/email/phone → string; number → number; date → ISO string; checkbox → boolean; multi_select → string[]; url → `{text,link}`; image → array `[{imageUrl,...}]` (take the single image via `row['fieldName'][0].imageUrl`, checking for null first).

A single `query` call only returns one page (`pageSize` defaults to 50, capped at 200). **Never treat a single query as the full dataset** (data beyond one page silently goes missing; DSDK014 blocks it). For large datasets prefer a pager / load-more; for stats numbers (totals / group counts / sums) use `db.aggregate` (`database-sdk-contract.md` §4.5) instead of querying the full set and computing client-side.

```html
<script>
  (function() {
    var db = window.__SMART_PAGE__.database;
    var DATABASE_ID = 'DATABASE_ID';
    var SCHEMA_OPTIONS = {};   // { "fieldName": [{ text, id }] }

    db.getSchema({ databaseId: DATABASE_ID }).then(function(schema) {
      (schema.properties || []).forEach(function(field) {
        if ((field.type === 'select' || field.type === 'multi_select') && field.config && field.config.options) {
          SCHEMA_OPTIONS[field.name] = field.config.options;
        }
      });
      loadData();
    }).catch(function(err) { console.error('[database] schema 加载失败:', err); loadData(); });

    // Pulling the full dataset via pagination: the cursor param name must be startCursor (not cursor!); the response pairs it with nextCursor / hasMore.
    // All three safeguards are required, otherwise the backend dropping an invalid field leaves the cursor perpetually empty → stuck on page one forever → infinite loop.
    function loadData(startCursor, acc, guard) {
      acc = acc || [];
      guard = guard || 0;
      if (guard > 100) { renderData(acc); return; } // safeguard①: hard cap, fallback circuit breaker
      db.query({
        databaseId: DATABASE_ID,
        sorts: [{ property: 'SORT_FIELD', direction: 'descending' }], // SORT_FIELD must be a real field (DSDK009)
        pageSize: 200,  // default 50, max 200; a single call returns only one page — must keep paging via hasMore/nextCursor
        startCursor: startCursor // pagination cursor, param name is fixed as startCursor; pass undefined for the first page
      }).then(function(result) {
        acc = acc.concat(result.results || []); // only take data from result.results (DSDK010)
        var next = result.nextCursor;
        if (result.hasMore && next && next !== startCursor && (result.results || []).length) {
          loadData(next, acc, guard + 1); // safeguard②: cursor must advance (next !== startCursor); safeguard③: only continue paging if this page was non-empty
        } else {
          renderData(acc);
        }
      }).catch(function(err) { console.error('[database] 数据加载失败:', err); });
    }

    function renderData(rows) {
      // row keys use the schema field name (Chinese); element selectors come from field_mapping[fieldName].display_selector
    }
  })();
</script>
```

**Case 3 — form submission**: intercept `<form>` submit and route to `db.addRecord`.

```html
<script>
  (function() {
    var db = window.__SMART_PAGE__.database;
    var DATABASE_ID = 'DATABASE_ID';
    var form = document.querySelector('FORM_SELECTOR');
    if (!form) return;
    var SCHEMA_OPTIONS = {};

    db.getSchema({ databaseId: DATABASE_ID }).then(function(schema) {
      (schema.properties || []).forEach(function(field) {
        if ((field.type === 'select' || field.type === 'multi_select') && field.config && field.config.options) {
          SCHEMA_OPTIONS[field.name] = field.config.options;
        }
      });
      renderSelectOptions();
    }).catch(function(err) { console.error('[database] schema 加载失败:', err); });

    function renderSelectOptions() {
      // dynamically fill <option> for every select/multi_select; selector comes from field_mapping[fieldName].form_input
      // option.value = opt.id (taken directly on submit), option.textContent = opt.text
    }

    form.addEventListener('submit', function(e) {
      e.preventDefault();
      var submitBtn = form.querySelector('[type="submit"]');
      if (submitBtn) { submitBtn.disabled = true; submitBtn.textContent = '提交中...'; }

      // properties key uses the schema field name; selector copied from field_mapping[fieldName].form_input; type follows value_type
      var properties = {};
      // properties['姓名']     = { text: form.querySelector('[name="name"]').value };
      // properties['邮箱']     = { email: form.querySelector('[name="email"]').value };
      // properties['电话']     = { phone_number: form.querySelector('[name="phone"]').value };
      // properties['部门']     = { select: form.querySelector('[name="department"]').value };
      // properties['年龄']     = { number: parseFloat(form.querySelector('[name="age"]').value };
      // properties['同意条款'] = { checkbox: form.querySelector('[name="agree"]').checked };
      // properties['生日']     = { date: form.querySelector('[name="birthday"]').value };
      // properties['技能']     = { multi_select: Array.prototype.map.call(form.querySelectorAll('[name="skills"]:checked'), function(el){ return el.value; }) };
      // properties['官网']     = { url: { text: v, link: v } };

      db.addRecord({ databaseId: DATABASE_ID, properties: properties })
        .then(function() { showSuccess('提交成功！'); form.reset(); })
        .catch(function(err) { console.error('[database] 提交失败:', err); showError('提交失败，请稍后重试'); })
        .finally(function() { if (submitBtn) { submitBtn.disabled = false; submitBtn.textContent = '提交'; } });
    });

    function showSuccess(msg) { /* pick a prompt style consistent with the original HTML */ }
    function showError(msg) { /* pick an error style consistent with the original HTML */ }
  })();
</script>
```

**Type conversion**: `number`→`{number: parseFloat(v)}`; `checkbox`→`{checkbox: el.checked}`; `date`→`{date: "ISO"}`; `select`→`{select: selectEl.value}` (value is already opt.id); `multi_select`→`{multi_select: [...]}` (each item's value=opt.id); `url`→`{url:{text,link}}`; `image`→`{image:{images:[{title,imageUrl}]}}`, `imageUrl` may **only** come from the return value of `db.uploadImage`. Keep native HTML5 validation.

**Image upload (mandatory sequence whenever the form has an `image` field)**: `file → base64 → db.uploadImage → take r.url → write into properties → addRecord`, all serial; if `url` comes back empty, abort and report an error — never create the record first and backfill the image later, never treat a `data:`/`blob:` address as `imageUrl`.

```javascript
// Step ①: upload each file once, producing an image item
function uploadOne(file) {
  if (file.size > 10 * 1024 * 1024) return Promise.reject(new Error('图片不能超过 10MB'));
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function() { resolve(String(reader.result).split(',')[1] || ''); }; // strip the data: prefix
    reader.onerror = function() { reject(new Error('读取文件失败')); };
    reader.readAsDataURL(file);
  }).then(function(base64) {
    return db.uploadImage({ data: base64, contentType: file.type, fileName: file.name });
  }).then(function(r) {
    if (!r || !r.url) throw new Error('上传失败：未返回 url');
    return { title: file.name, imageUrl: r.url };
  });
}

// Step ②: only write to the database once all urls are in hand
var files = form.querySelector('[name="photo"]').files;
Promise.all(Array.prototype.map.call(files, uploadOne)).then(function(images) {
  if (images.length) properties['图片'] = { image: { images: images } };
  return db.addRecord({ databaseId: DATABASE_ID, properties: properties });
}).catch(function(err) { console.error('[database] 图片上传/提交失败:', err); showError('图片上传失败，请重试'); });
```

**Case 4 — mixed**: merge cases 2 and 3 in the same IIFE: `getSchema` → `renderSelectOptions` → `loadData`; submit goes through `addRecord`, and on success call `loadData()` to refresh.

**Shared hard rules**:

- Single file (CSS/JS/HTML inlined); ES5-compatible (`function`/`var`); wrap SDK calls in try/catch; must not error in an environment without the SDK; disable the submit button while submitting.
- **Truncation must be declared in the receipt**: when the user explicitly asks for only part of the data (Top N / latest N), render that part and mark `{{数据完整=已确认截断(<reason>)}}` in the receipt `QUALITY_OK` to pass (DSDK015 still FAILs; the receipt self-declaration exempts it, see `page-quality-check.md` §4/§5); otherwise render the full set.
- Database binding markers follow `canonical-schema.md` §1.5.5 (DSDK011/012); never hard-code `<option>` — render after `db.getSchema`.
- **Local caching of form input** (DSDK008): whenever `addRecord` is present, cache only the fields that actually get submitted (`form_input != null`) into `localStorage` (debounce 300ms on `input`/`change`, clear on success, keep on failure, refill after `renderSelectOptions()`); skip `password`/`data-no-cache` fields and any field matching `密码·身份证·secret·token·key`; never cache search/filter/decorative controls; degrade silently if storage is unavailable.
- **Pre-submit image caching**: whenever `uploadImage` is present, store the picked `File` in IndexedDB as soon as it's selected (`localStorage` only stores a reference flag); restore the preview from IndexedDB after a full page reload, and clear it only once `addRecord` succeeds (details in `database-sdk-contract.md` §7.1). The `file` object itself goes through IndexedDB, **not** the text-based `localStorage` cache above.
