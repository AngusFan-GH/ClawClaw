# Content Component Reference

When to read: when editing an existing document and you hit non-basic components, or are unsure about a component's attributes, children, or expanded format. `create_doc.py` accepts Markdown only and never uses the component syntax in this file.

This file only maintains component syntax. For action selection see `action_decision.md`; for fields and the Mark contract see `content_contract.md`; for table task dispatch and admission see `tasks/table_edit.md`; for CLI and stdout see `edit_core.md`.

Skip-read as needed: containers §3, Table §6, MathBlock §7, Code §8, Mermaid §9, Mark/Link §10, color whitelist Appendix B.

## 0. General Rules

### 0.1 Scenario Quick Reference

1. `create_doc.py` creates a whole document — Markdown only; never write ClawClaw component tags; component syntax is only for edit / revision flows.
2. `submit_doc_edit.py` insert / update — must use components.
3. `submit_review_edit.py` insert / update — must use components.
4. Submitting `content` / `new_content` — no frontmatter, no hand-written `id`.
5. Reading back full-page content — may contain frontmatter, read-only `id`, `ReviewSummary`.

In edit / revision / hand-written component content, inline styling must use `<Mark>`; never use Markdown inline styles like `**bold**` / `*italic*` / `~~strike~~`.

### 0.2 Allowed Component List

Block components:

- `Paragraph`
- `Heading`
- `BlockQuote`
- `Callout`
- `Divider`
- `Image`
- `Todo`
- `BulletedList`
- `NumberedList`
- `MathBlock`
- `Code`
- `Mermaid`

Table components:

- `Table`
- `TableRow`
- `TableCell`

Inline components:

- `Mark`
- `Link`

Read-only echo components:

- `ReviewSummary`
- `ReviewCard`

Never generate unknown components; `ReviewSummary` / `ReviewCard` appear only in read-back content and the Agent must never generate them on submit; when something cannot be expressed, use a supported component instead or explain the limitation to the user.

### 0.3 Attributes and Syntax

- No arbitrary `{...}` expression attributes, content expressions, or ESM `import` / `export`; the only writable exception is preserving an existing `Mark.comment={string[]}` comment anchor verbatim on update.
- Attribute values must use double quotes, e.g. `<Heading level="1">`.
- Boolean attributes carry no value, e.g. `<Mark bold>text</Mark>`, `<Todo checked>task</Todo>`.
- Never write `bold="true"` / `checked="true"`, and never write `false` explicitly.
- Never hand-write `id` on submit; `id` only ever appears in read-back content.
- Color attributes must use tokens from the appendix; `#fff`, `rgb(...)` and other CSS color values are forbidden.

Read-only exception: `ReviewCard.affectedBlockIds` in read-back content may appear in the `{[...]}` form; the Agent must never generate it on submit.

### 0.4 Newlines and Indentation

- One indent level is exactly 4 spaces; tabs are forbidden.
- Simple non-nested text blocks may use the compact form, e.g. `<Paragraph>body text</Paragraph>`, `<Heading level="2">Heading</Heading>`, `<Todo>task</Todo>`, `<BulletedList>list item</BulletedList>`.
- Complex structures must use the expanded form: container blocks, tables, nested lists, or any block containing multiple child blocks.
- Direct content lines of a block component and nested child blocks must each be indented 4 spaces deeper than the opening tag.
- No blank lines between adjacent child blocks inside a container block; otherwise the submit parser may misread the following child block as a code-block literal.
- `Mark` / `Link` must sit in the same text flow line as surrounding text; never insert line breaks mid-sentence for layout reasons.

### 0.5 Review Read-Back Attributes

Block components in read-back content may carry review attributes:

- `action`: `insert` / `delete` / `update`
- `reviewId`: the discussion id of the associated review card

`action` and `reviewId` always appear as a pair. The Agent usually does not need to fill them when building `content` / `new_content`.

## 1. Page-Level Attribute: Frontmatter

Frontmatter mainly exists in full-page read-back content. When the Agent submits write parameters:

- `content` / `new_content` of `submit_doc_edit.py` / `submit_review_edit.py` must not contain frontmatter.
- The title for `create_doc.py` comes from the `--title` argument; do not write frontmatter in the body content.

Read-back frontmatter example:

```yaml
---
title: React learning path
---
```

The only allowed field is `title`.

Level-1 headings are allowed in the body as section titles, but do not repeat a level-1 heading identical to the frontmatter `title` at the top of the body.

## 2. Text Block Components

- `Paragraph` — paragraph; attributes `textAlign`, `blockColor`; children text / `Mark` / `Link`; e.g. `<Paragraph>body text</Paragraph>`.
- `Heading` — heading; attributes `level`, `textAlign`, `blockColor`; children text / `Mark` / `Link`; e.g. `<Heading level="1">Heading</Heading>`.
- `Todo` — todo item; attributes `checked`, `blockColor`; children text / `Mark` / `Link` / child blocks; e.g. `<Todo checked>done item</Todo>`.
- `BulletedList` — unordered list item; attribute `blockColor`; children text / `Mark` / `Link` / child blocks; e.g. `<BulletedList>list item</BulletedList>`.
- `NumberedList` — ordered list item; attribute `blockColor`; children text / `Mark` / `Link` / child blocks; e.g. `<NumberedList>first item</NumberedList>`.

Rules:

- `textAlign` values: `left` / `center` / `right`. Do not set it explicitly when left-aligned by default.
- `blockColor` values: see `BLOCK_COLORS` in the appendix.
- `Heading.level` is required, a string from `"1"` to `"6"`.
- `Todo.checked` is a boolean attribute; write `<Todo checked>`, never `checked="true"`.
- The first child of `Todo` / `BulletedList` / `NumberedList` is the item's text; sub-tasks or sub-lists go after the text.
- Each `Todo` / `BulletedList` / `NumberedList` represents one list item; consecutive same-type components form a visual list.
- Text, `Mark`, and `Link` inside a `TableCell` must be carried by a `Paragraph`.

Example:

```xml
<Paragraph textAlign="right">
    <Mark bold>bold text</Mark>plain text
</Paragraph>
<Heading level="2" blockColor="light_blue">
    Section heading
</Heading>
<Todo>
    Task 1
    <Todo checked>Task 1-1</Todo>
</Todo>
<BulletedList>
    Unordered list
    <BulletedList>Unordered sub-list</BulletedList>
</BulletedList>
<NumberedList>
    Ordered list
    <NumberedList>Ordered sub-list</NumberedList>
</NumberedList>
```

## 3. Container Block Components

- `BlockQuote` — quote block; attributes `textAlign`, `blockColor`; children are block components.
- `Callout` — highlight block; attribute `icon`; children are block components.

Rules:

- No blank lines between adjacent child blocks inside a container.
- `BlockQuote.textAlign` values: `left` / `center` / `right`.
- `BlockQuote.blockColor` values: see `BLOCK_COLORS` in the appendix.
- `Callout` only accepts `icon`; passing `blockColor` / `borderColor` is forbidden.
- For simple quotes in a whole-document `create_doc.py` Markdown, `>` works; edit / revision submits must use `<BlockQuote>`.

Example:

```xml
<BlockQuote>
    <Paragraph>Quoted content</Paragraph>
</BlockQuote>
<Callout>
    <Heading level="3">Tip title</Heading>
    <Paragraph>Tip body.</Paragraph>
</Callout>
```

## 4. Divider

```xml
<Divider />
```

Rules:

- Use the self-closing tag.
- Edit / revision submits must use `<Divider />`.
- In `create_doc.py` Markdown bodies, the Markdown `---` may express a divider.

## 5. Image

Only the bare form persists:

```xml
<Image src="https://example.com/image.png" />
```

Rules:

- Field-tested: only a bare `<Image src="..." />` persists. An `Image` carrying any other attribute (`alt` / `align` / `width` / `height`) does not persist — the image is dropped. Never write these attributes.
- Each image must be its own single action; never bundle multiple images into one action.
- Edit / revision submits must use `<Image ... />`, not Markdown image syntax.
- In `create_doc.py` Markdown bodies, `![alt](url)` works.
- `src` only allows `http://` / `https://`.
- Executable or embedded protocols such as `javascript:` / `data:` / `vbscript:` are forbidden.
- The Agent does not proactively probe intranet URLs; if it must access or validate an image URL, it must follow SSRF protection and reject intranet, private ranges, special addresses, and `9.*` / `10.*` / `11.*` / `21.*` / `30.*`.

## 6. Table

```xml
<Table>
    <TableRow>
        <TableCell>
            <Paragraph>cell A1</Paragraph>
        </TableCell>
        <TableCell>
            <Paragraph>cell A2</Paragraph>
        </TableCell>
    </TableRow>
</Table>
```

Structure:

- Children of `Table` can only be `TableRow`.
- Children of `TableRow` can only be `TableCell`.
- Children of `TableCell` are block components other than `Table`.
- `TableRow` / `TableCell` must never be generated as standalone top-level content.

Rules:

- This section only applies to component-based `content/new_content` of `submit_doc_edit.py` / `submit_review_edit.py`; `create_doc.py` must not use the `<Table>` component.
- In edit / revision `content/new_content`, tables must be expressed with components; Markdown table syntax is forbidden.
- `create_doc.py` whole-document creation supports Markdown only; use Markdown / GFM tables for normal tables, and do not rewrite them as `<Table>...</Table>`.
- `Table` / `TableRow` / `TableCell` do not accept `readonly` / `id` attributes; `id` only comes from read-back content.
- Text, `Mark`, and `Link` inside a `TableCell` must be wrapped in `<Paragraph>`; never write `<TableCell>cell A1</TableCell>` directly.
- For table action dispatch, the mode split, batch quota, and read-back requirements, see `tasks/table_edit.md` and `server_pitfalls.md` §3.

### 6.1 Table Actions and the Helper

Action admission for table target types, cell content changes, and structural changes is defined in `tasks/table_edit.md`.

### 6.2 Table Structural Changes: Generate New `<Table>` Component Syntax with `table_edit_helper.py`

`table_edit_helper.py` is a local, network-free, token-free component generator that only supports row/column matrix transformations. Cell rich text, merged cells, column widths, and header attributes are outside its fidelity scope; decide whether to use the helper via `tasks/table_edit.md` first.

**Supported operators (--op)**:

- `insert_row` — insert one row; key args `after_row_index` or `before_row_index` (default = table tail), `cells: string[]` (length must equal current column count); use to add a row.
- `delete_row` — delete one row, cannot reduce to 0 rows; key arg `row_index`; use to remove a row.
- `insert_column` — insert one column; key args `after_col_index` or `before_col_index` (default = table tail), `cells: string[]` (length must equal current row count); use to add a column.
- `delete_column` — delete one column, cannot reduce to 0 columns; key arg `col_index`; use to remove a column.
- `set_table` — rebuild the table matrix from a 2D array; key arg `cells: string[][]`; use for 2D restructure / changing column count.

**Invocation**:

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/table_edit_helper.py" \
    --op insert_row \
    --table-content '<Table>...</Table>' \
    --args '{"after_row_index":1,"cells":["new A","new B","new C"]}'
```

For large tables, `--table-content-file` / `--args-file` read from files. Self-check: `python3 table_edit_helper.py --self-check` prints `KS_TABLE_EDIT_HELPER_SELFCHECK_OK` on success.

**stdout protocol**:

```text
KS_TABLE_EDIT_HELPER_SUCCESS
{"new_table_content": "<Table>...</Table>"}
```

Failure:

```text
KS_TABLE_EDIT_HELPER_ERROR
{"code": "<ERR_CODE>", "message": "<sanitized reason>"}
```

Common error codes: `COL_LENGTH_MISMATCH` (new row/column length does not match the current table), `ROW_INDEX_OUT_OF_RANGE` / `COL_INDEX_OUT_OF_RANGE` (out of range), `UNSUPPORTED_SPAN` (contains rowspan/colspan merges; undefined by the spec, so the script refuses), `UNSUPPORTED_INLINE_CONTENT` (Mark/Link rich text detected; the script refuses to avoid losing styles/links), `INVALID_TABLE_CONTENT` (unpaired `<Table>`), `ROW_LIMIT_EXCEEDED` / `COL_LIMIT_EXCEEDED` (>200 rows / >20 columns, guarding against LLM-submitted exploding data).

`new_table_content` only returns the complete component text; subsequent actions and submission follow `tasks/table_edit.md`, `action_decision.md`, and `content_contract.md`.

## 7. MathBlock

```xml
<MathBlock>
    $$
    i\hbar\frac{\partial}{\partial t}\Psi(\vec{r},t) = \left[-\frac{\hbar^2}{2m}\nabla^2 + V(\vec{r},t)\right]\Psi(\vec{r},t)
    $$
</MathBlock>
```

Attributes:

- `width`: optional, numeric literal string, in px.

Rules:

- Edit / revision scenarios must use `<MathBlock>`.
- In `create_doc.py` Markdown bodies, `$math$` / `$$math$$` work.
- The child is only one markdown math content block.

## 8. Code

````xml
<Code language="go">
package main
func main() {}
</Code>
````

Attributes:

- `language`: required, a code language tag string, e.g. `"go"` / `"python"` / `"typescript"` / `"bash"`.

Rules:

- Code block content is treated as plain text; do not write `Paragraph` / `Mark` / `Link`.
- Newlines are preserved as-is.
- Multi-line code must be written expanded: each code line on its own physical line between the open and close tags, with real newlines. A compact single-line Code is fine; a compact form carrying multiple lines degrades to a `Paragraph` on submit.
- One large single `Code` block (7 KB+) does not itself trigger the 524 volume limit — do not pre-split code content (`server_pitfalls.md` §3).
- In edit / revision, creating, inserting, or replacing a code block all use `<Code language="...">`.
- In edit / revision, changing code block content or language forbids `update`; use `delete + insert_before` / `insert_after`.
- In `create_doc.py` Markdown bodies, fenced code works.

## 9. Mermaid

```xml
<Mermaid>
flowchart TD
    Start([Start]) --> Input[/Input data/]
    Input --> Validate{Valid?}
    Validate -->|Yes| Process[Process data]
    Validate -->|No| Error[Show error]
    Process --> Save[(Save to database)]
</Mermaid>
```

Attributes:

- None (the component has no custom attributes; read-back content may carry `action` / `reviewId` review attributes).

Rules:

- `Mermaid` is a leaf block with no nested child blocks; its child is a single piece of Mermaid official-syntax source (plain text, original newlines preserved).
- The source only allows the Mermaid official syntax subset (`flowchart` / `sequenceDiagram` / `gantt` / `classDiagram` / `stateDiagram` etc.); mixing Markdown or other component tags into the source is forbidden, as is nesting `<Mermaid>`.
- When `submit_review_edit` / `submit_doc_edit` modifies a Mermaid block, `update.new_content=<Mermaid>...</Mermaid>` is forbidden; use `delete(id=original Mermaid block)` + `insert_before/insert_after(id=original Mermaid block, content=<Mermaid>...full rewritten source...</Mermaid>)`.
- In edit / revision flows, a `<Mermaid>` block contains raw Mermaid source only, and **must never wrap it in a Markdown fenced code block**; wrong: writing a `mermaid` fence around the source inside `<Mermaid>`; right: `<Mermaid>\nsequenceDiagram\n...\n</Mermaid>`.
- When the user asks to "change a node inside the mermaid diagram", the Agent should rewrite the complete Mermaid source and replace the whole block with `delete + insert_before/insert_after`; token-level review with `<Mark ar="insert|delete|format">` inside Mermaid is forbidden (diagram source is an atomic unit; token-level marks pollute the source and break rendering).
- In edit / revision, creating, inserting, or replacing a Mermaid block all use `<Mermaid>`; `insert_before` / `insert_after.content` of `submit_doc_edit.py` / `submit_review_edit.py` must also carry the diagram in a `<Mermaid>` component, and the content must not contain `<Mark ar>` or a Markdown fence.
- When `create_doc.py` creates Mermaid, prefer Markdown fenced code: ```` ```mermaid ... ``` ```` (same rule as fenced code blocks / `$$math$$`); this is supported Markdown syntax, so do not rewrite into `<Mermaid>...</Mermaid>` just to create a diagram. `<Mermaid>` is for edit / revision flows only; `create_doc` must not use the `<Mermaid>` component.

## 10. Inline Components

### 10.1 Mark

Purpose: styled text.

Attributes:

- `bold` — boolean attribute, no value.
- `italic` — boolean attribute, no value.
- `underline` — boolean attribute, no value.
- `strike` — boolean attribute, no value.
- `color` — `TEXT_COLORS`.
- `backgroundColor` — `BLOCK_COLORS`.
- `ar` — `insert` / `delete` / `format`, used by `submit_review_edit` only.
- `comment` — expression attribute `comment={["id1","id2"]}`, a list of text-selection comment IDs; preserve verbatim when the Agent modifies.

Example:

```xml
<Paragraph><Mark bold>key content</Mark><Mark color="yellow">warning</Mark></Paragraph>
<Paragraph><Mark ar="delete">old text</Mark><Mark ar="insert">new text</Mark></Paragraph>
<Paragraph><Mark ar="format" bold>text with format change only</Mark></Paragraph>
```

Rules:

- `Mark` must be written on a single line: opening tag, content, and closing tag on one line.
- The three `ar` values are mutually exclusive; illegal values are forbidden.
- `ar="format"` expresses a formatting change; style attributes express the final style, and having no style attribute means clearing existing inline formatting.
- `ar="insert"` / `ar="delete"` describe the addition/removal of the text itself; adding style attributes alongside is legal either way.
- The replacement idiom is one `Mark` with `ar="delete"` on the old text plus a separate `Mark` with `ar="insert"` on the new text, chained together.
- The usage boundary of `ar` between review and direct edit is defined in `content_contract.md`.

#### 10.1.1 Edit-Mode Boundaries

The update/insert boundaries of `Mark ar`, comment anchors, nesting limits, and direct-edit prohibitions are all defined in `content_contract.md`. This section only defines the Mark component's attributes and syntax.

### 10.2 Link

```xml
<Link href="https://example.com">text</Link>
```

Rules:

- `href` is required.
- `Link` must be written on a single line: opening tag, content, and closing tag on one line.
- Executable or embedded protocols such as `javascript:` / `data:` / `vbscript:` are forbidden.
- The Agent does not proactively probe intranet URLs; if it must access or validate a link, it must follow SSRF protection and reject intranet, private ranges, special addresses, and `9.*` / `10.*` / `11.*` / `21.*` / `30.*`.

## Appendix A: Read-Only Echo Components

The following components only ever appear in full-page read-back content; the Agent must never generate them on submit:

- `ReviewSummary`
- `ReviewCard`

`ReviewSummary` appears right after the frontmatter; it is omitted when there are no agent_review cards.

Example:

```xml
<ReviewSummary>
    <ReviewCard
        discussionId="abcd1234567890abcdef12"
        anchorBlockId="b_xxx"
        affectedBlockIds={["b_xxx", "b_yyy"]}
        summary="Rewrite the first paragraph in a more professional tone"
        status="pending"
    />
</ReviewSummary>
```

Common `ReviewCard.status` values:

- `pending`: awaiting the author's review
- `resolved`: accepted / rejected by the author, card closed

## Appendix B: Color Tokens

`BLOCK_COLORS` for `blockColor` and `Mark.backgroundColor`:

`default`, `grey`, `light_grey`, `dark`, `light_blue`, `blue`, `light_sky_blue`, `sky_blue`, `light_green`, `green`, `light_yellow`, `yellow`, `light_orange`, `orange`, `light_red`, `red`, `light_rose_red`, `rose_red`, `light_purple`, `purple`

`TEXT_COLORS` for `Mark.color`:

`default`, `grey`, `blue`, `sky_blue`, `green`, `yellow`, `orange`, `red`, `rose_red`, `purple`

`BORDER_COLORS` is kept only as a historical / read-only note; the Agent never generates `Callout.borderColor`.
