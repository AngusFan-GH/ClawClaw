#!/usr/bin/env python3
"""Extract text (Markdown) + images from .docx / .pdf / .pptx / .xlsx / .xls / .csv / .tsv for sheet-generation reference.

Pipeline:
1. Extract text as Markdown (mammoth for docx, pymupdf for pdf, python-pptx
   for pptx — slide text frames, tables, charts, speaker notes; openpyxl for
   xlsx/xls — one markdown table per non-empty sheet; stdlib csv for csv/tsv).
2. Extract original images to images/ (high-res, retained for traceability;
   only applies to docx/pdf/pptx — tabular inputs have no images).
3. Generate thumbnails/ (small PNG previews; sheet-agent can Read these as
   visual fallback when content.md text alone is insufficient — e.g. scanned
   PDFs, table screenshots, or slide layouts dominated by images).

Default output is a subfolder under the project's resources/ tree:
    <cwd>/resources/extracted/<stem>/{content.md, images/, thumbnails/}

The excel-generation skill explicitly overrides the output via -o to place
artifacts under the ref directory:
    <ref_dir>/reference/<stem>/{content.md, images/, thumbnails/}

Multiple reference docs can coexist without filename collisions.

Thumbnails are uniformly PNG to preserve text legibility (no JPEG artifacts
on text edges). Token cost in vision models depends on resolution, not file
size, so PNG is preferred for agent viewing.

For xlsx/xls/csv/tsv the source file is treated as a **read-only reference**
— this script never opens it for writing. The skill's Step 4 must generate a
brand-new workbook via openpyxl; it must never overwrite the reference source.

Safety: this script never performs wildcard deletion. It writes into a new
output directory and overwrites only explicit files inside it.

Dependencies:
    - mammoth           (docx → HTML with image extraction)
    - pymupdf           (PDF text + embedded image extraction)
    - python-pptx       (PPTX text frames / tables / images / charts / notes)
    - openpyxl          (XLSX sheet reading; also required by the skill downstream)
    - xlrd              (legacy .xls reading; auto-installed only when needed)
    - Pillow            (thumbnail generation)
    - markdownify       (HTML → Markdown conversion)

Usage:
    python3 scripts/extract.py <input_file> [-o output_dir] [--thumb-width 600]

Examples:
    # Default: writes to ./resources/extracted/report/
    python3 scripts/extract.py ~/Desktop/report.docx

    # Explicit output directory (excel-generation skill uses this form)
    python3 scripts/extract.py paper.pdf -o /path/to/ref/reference/paper

    # Slide deck as content reference
    python3 scripts/extract.py q1_review.pptx -o /path/to/ref/reference/q1_review

    # Spreadsheet as READ-ONLY content reference (skill will emit a NEW workbook)
    python3 scripts/extract.py sales.xlsx -o /path/to/ref/reference/sales
    python3 scripts/extract.py raw.csv -o /path/to/ref/reference/raw

    # Higher-res thumbnails for dense screenshots
    python3 scripts/extract.py document.docx --thumb-width 800
"""

from __future__ import annotations

import argparse
import io
import subprocess
import sys
from pathlib import Path


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _die(message: str, code: int = 1) -> None:
    print(f"[extract] ERROR: {message}", file=sys.stderr)
    raise SystemExit(code)


def _auto_install(import_name: str, pip_name: str | None = None) -> None:
    """Try importing a package; auto-install via pip if missing."""
    pip_name = pip_name or import_name
    try:
        __import__(import_name)
    except ImportError:
        print(f"[extract] {pip_name} not found, installing ...", file=sys.stderr)
        try:
            subprocess.check_call(
                [sys.executable, "-m", "pip", "install", "--quiet", pip_name]
            )
        except subprocess.CalledProcessError as e:
            _die(f"failed to install {pip_name}: {e}", code=4)
        # Verify after install
        try:
            __import__(import_name)
        except ImportError as e:
            _die(f"{pip_name} still unavailable after install: {e}", code=4)


def _check_deps(
    need_pymupdf: bool = False,
    need_mammoth: bool = False,
    need_pptx: bool = False,
    need_openpyxl: bool = False,
    need_xlrd: bool = False,
) -> None:
    # Pillow is only needed when we generate thumbnails, i.e. for doc-like
    # inputs that may carry images. Tabular inputs (xlsx/xls/csv/tsv) don't
    # need it — skip to avoid an unnecessary install on minimal envs.
    if need_pymupdf or need_mammoth or need_pptx:
        _auto_install("PIL", "Pillow")

    if need_mammoth:
        _auto_install("mammoth")
        _auto_install("markdownify")

    if need_pymupdf:
        _auto_install("fitz", "pymupdf")

    if need_pptx:
        _auto_install("pptx", "python-pptx")

    if need_openpyxl:
        _auto_install("openpyxl", "openpyxl>=3.1.0")

    if need_xlrd:
        # xlrd >= 2.0 dropped .xlsx; that's fine here because .xlsx goes through openpyxl.
        _auto_install("xlrd", "xlrd>=2.0.1")


# ---------------------------------------------------------------------------
# Thumbnail generation
# ---------------------------------------------------------------------------


def _make_thumbnail(
    src: Path,
    dst_dir: Path,
    max_width: int = 600,
) -> Path:
    """Create a PNG thumbnail (uniform format for legible text)."""
    from PIL import Image

    img = Image.open(src)
    # Preserve transparency where present; convert palette/CMYK to RGB
    if img.mode in ("P", "CMYK"):
        img = img.convert("RGB")

    # Resize proportionally
    if img.width > max_width:
        ratio = max_width / img.width
        new_size = (max_width, int(img.height * ratio))
        img = img.resize(new_size, Image.LANCZOS)

    out_path = dst_dir / (src.stem + ".png")
    img.save(out_path, "PNG", optimize=True)
    return out_path


def _generate_thumbnails(
    images_dir: Path,
    thumbs_dir: Path,
    max_width: int,
) -> list[Path]:
    """Generate PNG thumbnails for all images in a directory."""
    thumbs_dir.mkdir(parents=True, exist_ok=True)
    results = []

    image_exts = {".png", ".jpg", ".jpeg", ".gif", ".bmp", ".tiff", ".webp"}
    images = sorted(
        f for f in images_dir.iterdir() if f.suffix.lower() in image_exts
    )
    if not images:
        return results

    for img_path in images:
        try:
            thumb = _make_thumbnail(img_path, thumbs_dir, max_width)
            results.append(thumb)
        except Exception as e:
            print(f"  [extract] WARNING: failed to thumbnail {img_path.name}: {e}")

    return results


# ---------------------------------------------------------------------------
# DOCX extraction
# ---------------------------------------------------------------------------


def _extract_docx(docx_path: Path, out_dir: Path) -> tuple[Path, int]:
    """Extract text via mammoth (file-path image refs) + markdownify."""
    import mammoth
    from markdownify import markdownify

    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    img_counter = 0

    @mammoth.images.img_element
    def save_image(image):
        nonlocal img_counter
        img_counter += 1
        ext_map = {
            "image/png": ".png",
            "image/jpeg": ".jpg",
            "image/gif": ".gif",
            "image/bmp": ".bmp",
            "image/tiff": ".tiff",
            "image/webp": ".webp",
        }
        ext = ext_map.get(image.content_type, ".png")
        fname = f"image{img_counter}{ext}"
        with image.open() as img_bytes:
            (images_dir / fname).write_bytes(img_bytes.read())
        return {"src": f"images/{fname}"}

    with open(docx_path, "rb") as f:
        result = mammoth.convert_to_html(f, convert_image=save_image)

    html_content = result.value

    # Convert HTML → Markdown
    md_content = markdownify(html_content, heading_style="ATX", strip=["script", "style"])
    md_content = md_content.strip()

    md_file = out_dir / "content.md"
    md_file.write_text(md_content, encoding="utf-8")

    return md_file, img_counter


# ---------------------------------------------------------------------------
# PDF extraction
# ---------------------------------------------------------------------------


def _extract_pdf(pdf_path: Path, out_dir: Path) -> tuple[Path, int]:
    """Extract text + embedded images from PDF via pymupdf."""
    import fitz

    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    md_parts = []
    img_count = 0

    with fitz.open(pdf_path) as doc:
        for page_idx in range(len(doc)):
            page = doc[page_idx]
            page_num = page_idx + 1

            md_parts.append(f"## Page {page_num}\n")

            text = page.get_text("text").strip()
            if text:
                md_parts.append(text)
                md_parts.append("")

            image_list = page.get_images(full=True)
            for img_idx, img_info in enumerate(image_list, 1):
                xref = img_info[0]
                try:
                    pix = fitz.Pixmap(doc, xref)
                    # Only convert CMYK (n - alpha > 3) to RGB. RGB / RGBA /
                    # grayscale are saved as-is — PNG supports all of them
                    # and we want to preserve transparency.
                    if pix.n - pix.alpha > 3:
                        pix = fitz.Pixmap(fitz.csRGB, pix)

                    img_name = f"page{page_num:02d}_img{img_idx:02d}.png"
                    img_path = images_dir / img_name
                    pix.save(str(img_path))
                    img_count += 1

                    md_parts.append(f"![](images/{img_name})")
                    md_parts.append("")
                except Exception as e:
                    print(f"  [extract] WARNING: page {page_num} image {img_idx}: {e}")

    md_content = "\n".join(md_parts)
    md_file = out_dir / "content.md"
    md_file.write_text(md_content, encoding="utf-8")

    return md_file, img_count


# ---------------------------------------------------------------------------
# PPTX extraction
# ---------------------------------------------------------------------------


def _pptx_table_to_md(table) -> str:
    """Render a python-pptx table as a markdown table.

    First row is treated as the header. Cells with line breaks are flattened
    with `<br>` so the markdown renders as a single row each. Pipes inside
    cell text are escaped to avoid breaking the table.
    """

    def cell_text(cell) -> str:
        # Cells contain a text_frame; .text already concatenates paragraphs
        # with newlines. Flatten + escape pipes for markdown safety.
        return cell.text.replace("|", "\\|").replace("\n", "<br>").strip()

    rows = list(table.rows)
    if not rows:
        return ""

    header = [cell_text(c) for c in rows[0].cells]
    body = [[cell_text(c) for c in r.cells] for r in rows[1:]]

    # Pad/truncate body rows to header width for safety
    width = len(header)
    norm_body = [(row + [""] * width)[:width] for row in body]

    lines = ["| " + " | ".join(header) + " |"]
    lines.append("|" + "|".join(["---"] * width) + "|")
    for row in norm_body:
        lines.append("| " + " | ".join(row) + " |")
    return "\n".join(lines)


def _pptx_chart_to_md(chart) -> str:
    """Best-effort markdown summary of a chart: type + categories + series.

    python-pptx exposes plain category labels and numeric series values for
    common chart types (bar/line/pie/area/etc.). For uncommon types it may
    raise; in that case we fall back to a one-line note.
    """
    try:
        chart_type = str(chart.chart_type).split(".")[-1].rstrip(">")
        plot = chart.plots[0]
        categories = list(plot.categories)
        series_blocks = []
        for s in plot.series:
            try:
                values = list(s.values)
            except Exception:
                values = []
            series_blocks.append((s.name or "<unnamed>", values))

        lines = [f"**Chart** ({chart_type})", ""]
        if categories or series_blocks:
            header = ["category"] + [name for name, _ in series_blocks]
            lines.append("| " + " | ".join(str(h) for h in header) + " |")
            lines.append("|" + "|".join(["---"] * len(header)) + "|")
            for i, cat in enumerate(categories):
                row = [str(cat)]
                for _, values in series_blocks:
                    row.append(str(values[i]) if i < len(values) else "")
                lines.append("| " + " | ".join(row) + " |")
        return "\n".join(lines)
    except Exception as e:
        return f"**Chart** (extraction failed: {e})"


def _extract_pptx(pptx_path: Path, out_dir: Path) -> tuple[Path, int]:
    """Extract text frames, tables, charts, images, and notes from a .pptx.

    Layout in content.md:
        ## Slide N
        <text frames>
        ### Tables
        <markdown tables>
        ### Charts
        <markdown chart summaries>
        ![](images/slideN_imgM.ext)
        > **Speaker Notes:** ...
    """
    from pptx import Presentation
    from pptx.enum.shapes import MSO_SHAPE_TYPE

    images_dir = out_dir / "images"
    images_dir.mkdir(parents=True, exist_ok=True)

    prs = Presentation(pptx_path)
    md_parts: list[str] = []
    img_count = 0

    for slide_idx, slide in enumerate(prs.slides, 1):
        md_parts.append(f"## Slide {slide_idx}\n")

        text_blocks: list[str] = []
        table_blocks: list[str] = []
        chart_blocks: list[str] = []
        image_refs: list[str] = []

        # Walk top-level shapes; nested shapes inside groups are recursed via
        # an explicit stack so we don't miss text inside grouped layouts.
        stack = list(slide.shapes)
        while stack:
            shape = stack.pop(0)

            # Recurse into groups
            if shape.shape_type == MSO_SHAPE_TYPE.GROUP:
                stack[0:0] = list(shape.shapes)
                continue

            if shape.has_text_frame:
                txt = shape.text_frame.text.strip()
                if txt:
                    text_blocks.append(txt)

            if shape.has_table:
                md_table = _pptx_table_to_md(shape.table)
                if md_table:
                    table_blocks.append(md_table)

            if shape.has_chart:
                chart_blocks.append(_pptx_chart_to_md(shape.chart))

            if shape.shape_type == MSO_SHAPE_TYPE.PICTURE:
                try:
                    img = shape.image
                    ext = (img.ext or "png").lstrip(".").lower()
                    img_count += 1
                    fname = f"slide{slide_idx:02d}_img{img_count:02d}.{ext}"
                    (images_dir / fname).write_bytes(img.blob)
                    image_refs.append(f"![](images/{fname})")
                except Exception as e:
                    print(
                        f"  [extract] WARNING: slide {slide_idx} image: {e}",
                        file=sys.stderr,
                    )

        if text_blocks:
            md_parts.append("\n\n".join(text_blocks))
            md_parts.append("")

        if table_blocks:
            md_parts.append("### Tables\n")
            md_parts.append("\n\n".join(table_blocks))
            md_parts.append("")

        if chart_blocks:
            md_parts.append("### Charts\n")
            md_parts.append("\n\n".join(chart_blocks))
            md_parts.append("")

        if image_refs:
            md_parts.append("\n".join(image_refs))
            md_parts.append("")

        # Speaker notes (skip the empty placeholder pptx attaches by default)
        if slide.has_notes_slide:
            notes = slide.notes_slide.notes_text_frame.text.strip()
            if notes:
                quoted = "\n".join(f"> {line}" for line in notes.splitlines())
                md_parts.append(f"> **Speaker Notes:**\n{quoted}")
                md_parts.append("")

    md_content = "\n".join(md_parts).rstrip() + "\n"
    md_file = out_dir / "content.md"
    md_file.write_text(md_content, encoding="utf-8")

    return md_file, img_count


# ---------------------------------------------------------------------------
# Spreadsheet extraction (xlsx / xls / csv / tsv)
#
# Spreadsheets are treated as **read-only** references here — we open, read,
# and close them without ever writing back. The excel-generation skill's Step 4
# generates a brand-new workbook via openpyxl; it must never target the
# reference source path as its output.
# ---------------------------------------------------------------------------


# Guardrails for cell rendering — reference materials can be sprawling
# (>1M-cell workbooks are common). We bound each sheet aggressively so the
# resulting content.md stays small enough for the model to actually consume,
# while still capturing the structure + a representative data sample.
_XL_MAX_ROWS_PER_SHEET = 200
_XL_MAX_COLS_PER_SHEET = 40
_XL_CELL_MAX_CHARS = 200


def _md_cell(value) -> str:
    """Render a spreadsheet cell for a markdown table.

    Rules:
    - None → empty string (blank cell).
    - Everything else → str(...) with pipe / newline escaping so the row
      never breaks the table. Values are truncated to `_XL_CELL_MAX_CHARS`
      to keep reference tables readable and token-cheap.
    """
    if value is None:
        return ""
    text = str(value).replace("\r\n", "\n").replace("\r", "\n")
    text = text.replace("|", "\\|").replace("\n", "<br>").strip()
    if len(text) > _XL_CELL_MAX_CHARS:
        text = text[: _XL_CELL_MAX_CHARS - 1] + "…"
    return text


def _rows_to_md_table(rows: list[list], *, has_header: bool = True) -> str:
    """Render a 2D list of cells as a markdown table.

    Column count is normalized to the widest observed row so the table is
    always well-formed. The caller decides whether the first row is a header;
    if `has_header=False` we synthesize `col_1..col_N` header labels.
    """
    if not rows:
        return "_(empty)_"

    width = max((len(r) for r in rows), default=0)
    if width == 0:
        return "_(empty)_"

    norm = [(list(r) + [None] * width)[:width] for r in rows]

    if has_header:
        header = [_md_cell(c) or f"col_{i + 1}" for i, c in enumerate(norm[0])]
        body = norm[1:]
    else:
        header = [f"col_{i + 1}" for i in range(width)]
        body = norm

    lines = ["| " + " | ".join(header) + " |"]
    lines.append("|" + "|".join(["---"] * width) + "|")
    for row in body:
        lines.append("| " + " | ".join(_md_cell(c) for c in row) + " |")
    return "\n".join(lines)


def _extract_xlsx(xlsx_path: Path, out_dir: Path) -> tuple[Path, int]:
    """Extract every non-empty sheet from an .xlsx workbook.

    Uses openpyxl with `read_only=True, data_only=True` so we:
    - never mutate the source file,
    - read cached formula values instead of the formula strings (formulas
      themselves are not useful as content reference; their evaluated
      values are).

    Also performs a second pass with `data_only=False` to count formula cells
    within the sampled window. Cells that are formulas in that pass but None
    in the data_only pass have no cached value — a signature of workbooks
    produced programmatically (openpyxl / xlsxwriter / pandas) that were never
    opened in Excel / WPS / LibreOffice. If we find such cells we prepend a
    warning to content.md so the downstream agent won't silently treat
    "missing cached value" as "empty data".

    Returns (content.md path, 0) — image count is always 0 for tabular inputs.
    """
    from openpyxl import load_workbook

    # Pass 1: collect coordinates of formula cells within the sampled window.
    # We only scan the same window we'll actually render, so this stays O(sample)
    # rather than O(workbook).
    formula_coords: dict[str, set[tuple[int, int]]] = {}
    try:
        wb_f = load_workbook(filename=str(xlsx_path), read_only=True, data_only=False)
        try:
            for sheet_name in wb_f.sheetnames:
                coords: set[tuple[int, int]] = set()
                ws = wb_f[sheet_name]
                for i, row in enumerate(ws.iter_rows()):
                    if i >= _XL_MAX_ROWS_PER_SHEET:
                        break
                    for j, cell in enumerate(row[:_XL_MAX_COLS_PER_SHEET]):
                        if cell.data_type == "f":
                            coords.add((i, j))
                if coords:
                    formula_coords[sheet_name] = coords
        finally:
            wb_f.close()
    except Exception as e:  # noqa: BLE001 — detection is best-effort; never fail extraction over it
        print(
            f"[extract] WARNING: formula-cell scan skipped: {e}",
            file=sys.stderr,
        )
        formula_coords = {}

    # Pass 2: cached values. This is what goes into content.md, and it also
    # lets us count how many of the pass-1 formulas came out as None.
    total_formulas = sum(len(v) for v in formula_coords.values())
    uncached_formulas = 0
    md_parts: list[str] = []

    wb = load_workbook(filename=str(xlsx_path), read_only=True, data_only=True)
    try:
        for sheet_name in wb.sheetnames:
            ws = wb[sheet_name]
            md_parts.append(f"## Sheet: {sheet_name}\n")

            rows: list[list] = []
            row_count = 0
            truncated_rows = False
            truncated_cols = False
            sheet_coords = formula_coords.get(sheet_name, set())
            for row in ws.iter_rows(values_only=True):
                row_count += 1
                if row_count > _XL_MAX_ROWS_PER_SHEET:
                    truncated_rows = True
                    break
                cells = list(row)
                if len(cells) > _XL_MAX_COLS_PER_SHEET:
                    cells = cells[:_XL_MAX_COLS_PER_SHEET]
                    truncated_cols = True
                # Count uncached formulas: any pass-1 formula coordinate whose
                # pass-2 value is None. row_count is 1-based; coordinates are
                # 0-based, so use row_count - 1.
                row_idx = row_count - 1
                for (fi, fj) in sheet_coords:
                    if fi == row_idx and fj < len(cells) and cells[fj] is None:
                        uncached_formulas += 1
                # Drop trailing all-None rows to avoid tables full of empty tails.
                rows.append(cells)

            # Trim trailing fully-empty rows (openpyxl often reports blank tails).
            while rows and all(c is None or str(c).strip() == "" for c in rows[-1]):
                rows.pop()

            if not rows:
                md_parts.append("_(empty sheet)_\n")
                continue

            md_parts.append(_rows_to_md_table(rows, has_header=True))
            if truncated_rows or truncated_cols:
                notes = []
                if truncated_rows:
                    notes.append(f"rows truncated to first {_XL_MAX_ROWS_PER_SHEET}")
                if truncated_cols:
                    notes.append(f"columns truncated to first {_XL_MAX_COLS_PER_SHEET}")
                md_parts.append(f"\n_> {'; '.join(notes)}._")
            md_parts.append("")
    finally:
        wb.close()

    # If any formula cell in the sample has no cached value, prepend a warning.
    # This is the fingerprint of workbooks produced programmatically and never
    # opened in Excel/WPS/LibreOffice. The warning tells the downstream agent
    # to distinguish "uncached formula" from "genuinely empty data" and, when
    # in doubt, ask the user to open+save the file once before re-uploading.
    warning_block = ""
    if total_formulas > 0 and uncached_formulas > 0:
        ratio = uncached_formulas / total_formulas
        warning_block = (
            f"> **Warning:** {uncached_formulas}/{total_formulas} formula cells in the "
            f"sampled window ({_XL_MAX_ROWS_PER_SHEET}x{_XL_MAX_COLS_PER_SHEET}) have no "
            f"cached value ({ratio:.0%}); they render as blanks below.\n"
            f"> Cause: openpyxl reads only cached formula values, so a workbook produced "
            f"programmatically (openpyxl / xlsxwriter / pandas) and never opened in "
            f"Excel/WPS/LibreOffice has no cache. This is not missing data.\n"
            f"> Skip these columns when aggregating, or ask the user to open and save "
            f"the file once in Excel/WPS/LibreOffice and re-upload.\n\n"
        )

        print(
            f"[extract] WARNING: {xlsx_path.name}: {uncached_formulas}/{total_formulas} "
            f"formula cells in the sampled window have no cached value ({ratio:.0%}); "
            f"source may be produced programmatically and never opened in "
            f"Excel/WPS/LibreOffice. See content.md header for details.",
            file=sys.stderr,
        )

    md_content = warning_block + "\n".join(md_parts).rstrip() + "\n"
    md_file = out_dir / "content.md"
    md_file.write_text(md_content, encoding="utf-8")
    return md_file, 0


def _extract_xls(xls_path: Path, out_dir: Path) -> tuple[Path, int]:
    """Extract every non-empty sheet from a legacy .xls workbook via xlrd."""
    import xlrd
    from xlrd import (
        XL_CELL_BOOLEAN,
        XL_CELL_DATE,
        XL_CELL_EMPTY,
        XL_CELL_ERROR,
        xldate,
    )

    book = xlrd.open_workbook(str(xls_path))
    md_parts: list[str] = []

    def _restore_cell(cell_type: int, value):
        """xlrd returns raw storage values; restore semantic types so downstream
        readers don't confuse a date serial (float) with a numeric measurement,
        or a boolean flag (1/0) with a count."""
        if cell_type == XL_CELL_EMPTY or value == "":
            return None
        if cell_type == XL_CELL_DATE:
            try:
                return xldate.xldate_as_datetime(value, book.datemode)
            except Exception:  # noqa: BLE001 — malformed serial; render as-is
                return value
        if cell_type == XL_CELL_BOOLEAN:
            return bool(value)
        if cell_type == XL_CELL_ERROR:
            return f"#ERR({value})"
        return value

    for sheet_name in book.sheet_names():
        ws = book.sheet_by_name(sheet_name)
        md_parts.append(f"## Sheet: {sheet_name}\n")

        rows: list[list] = []
        row_limit = min(ws.nrows, _XL_MAX_ROWS_PER_SHEET)
        col_limit = min(ws.ncols, _XL_MAX_COLS_PER_SHEET)
        for r in range(row_limit):
            rows.append([
                _restore_cell(ws.cell_type(r, c), ws.cell_value(r, c))
                for c in range(col_limit)
            ])

        while rows and all(c is None for c in rows[-1]):
            rows.pop()

        if not rows:
            md_parts.append("_(empty sheet)_\n")
            continue

        md_parts.append(_rows_to_md_table(rows, has_header=True))
        notes = []
        if ws.nrows > _XL_MAX_ROWS_PER_SHEET:
            notes.append(f"rows truncated to first {_XL_MAX_ROWS_PER_SHEET} / {ws.nrows}")
        if ws.ncols > _XL_MAX_COLS_PER_SHEET:
            notes.append(f"columns truncated to first {_XL_MAX_COLS_PER_SHEET} / {ws.ncols}")
        if notes:
            md_parts.append(f"\n_> {'; '.join(notes)}._")
        md_parts.append("")

    md_content = "\n".join(md_parts).rstrip() + "\n"
    md_file = out_dir / "content.md"
    md_file.write_text(md_content, encoding="utf-8")
    return md_file, 0


def _extract_delimited(
    csv_path: Path,
    out_dir: Path,
    *,
    delimiter: str,
) -> tuple[Path, int]:
    """Extract a delimited text file (csv / tsv) as a single markdown table.

    Encoding detection: BOM sniff first (authoritative), then try utf-8 / gbk;
    fall back to latin-1 (never raises) with a loud warning, since arriving
    here usually means the file uses an encoding this ladder cannot recover
    (BOM-less UTF-16, Big5, GB18030, etc.) and downstream readers would get
    garbled markdown if the warning is ignored.
    """
    import csv

    raw_bytes = csv_path.read_bytes()

    # 4-byte BOMs must be checked before 2-byte BOMs: UTF-32-LE BOM
    # (\xff\xfe\x00\x00) starts with the UTF-16-LE BOM (\xff\xfe).
    _BOM_ENCODINGS: list[tuple[bytes, str]] = [
        (b"\xef\xbb\xbf", "utf-8-sig"),
        (b"\xff\xfe\x00\x00", "utf-32-le"),
        (b"\x00\x00\xfe\xff", "utf-32-be"),
        (b"\xff\xfe", "utf-16-le"),
        (b"\xfe\xff", "utf-16-be"),
    ]
    text: str | None = None
    used_encoding: str = ""
    for bom, enc in _BOM_ENCODINGS:
        if raw_bytes.startswith(bom):
            try:
                text = raw_bytes.decode(enc)
                used_encoding = enc
            except UnicodeDecodeError:
                pass  # rare: BOM disagrees with body; fall through to ladder
            break

    if text is None:
        for enc in ("utf-8", "gbk", "latin-1"):
            try:
                text = raw_bytes.decode(enc)
                used_encoding = enc
                break
            except UnicodeDecodeError:
                continue
    if text is None:  # unreachable — latin-1 never raises
        _die(f"failed to decode {csv_path} with common encodings")

    encoding_warning = ""
    if used_encoding == "latin-1":
        encoding_warning = (
            "> **Warning:** encoding detection fell back to latin-1 (no BOM, UTF-8/GBK "
            "both failed). Non-ASCII characters (CJK etc.) are likely mojibake; do not "
            "rely on cell values below.\n"
            "> Ask the user to re-save the file as UTF-8 (CSV UTF-8) or UTF-16 LE with "
            "BOM and re-upload.\n\n"
        )
        print(
            f"[extract] WARNING: {csv_path.name}: encoding detection fell back to "
            f"latin-1; file has no BOM and UTF-8/GBK both failed to decode, output "
            f"may be garbled. If sourced from a BOM-less UTF-16 export (Excel "
            f"*Unicode Text*, SQL Server bcp, etc.), ask the user to re-save as "
            f"UTF-8 or UTF-16 LE with BOM and re-upload.",
            file=sys.stderr,
        )

    # StringIO (not splitlines): the csv module preserves quoted line breaks
    # inside cells (multi-line addresses / notes).
    reader = csv.reader(io.StringIO(text), delimiter=delimiter)
    rows: list[list] = []
    truncated_rows = False
    truncated_cols = False
    for i, row in enumerate(reader):
        if i >= _XL_MAX_ROWS_PER_SHEET:
            truncated_rows = True
            break
        if len(row) > _XL_MAX_COLS_PER_SHEET:
            truncated_cols = True
        cells = row[:_XL_MAX_COLS_PER_SHEET]
        # Empty strings → None so blanks render as blanks, not "".
        rows.append([c if c != "" else None for c in cells])

    while rows and all(c is None for c in rows[-1]):
        rows.pop()

    md_parts: list[str] = [f"## {csv_path.name}\n"]
    if not rows:
        md_parts.append("_(empty file)_\n")
    else:
        md_parts.append(_rows_to_md_table(rows, has_header=True))
        notes = []
        if truncated_rows:
            notes.append(f"rows truncated to first {_XL_MAX_ROWS_PER_SHEET}")
        if truncated_cols:
            notes.append(f"columns truncated to first {_XL_MAX_COLS_PER_SHEET}")
        if notes:
            md_parts.append(f"\n_> {'; '.join(notes)}._")

    md_content = encoding_warning + "\n".join(md_parts).rstrip() + "\n"
    md_file = out_dir / "content.md"
    md_file.write_text(md_content, encoding="utf-8")
    return md_file, 0


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Extract text (and images where applicable) from .docx/.pdf/.pptx/.xlsx/.xls/.csv/.tsv for sheet generation reference"
    )
    parser.add_argument("input", help="Input file (.docx, .pdf, .pptx, .xlsx, .xls, .csv, or .tsv)")
    parser.add_argument(
        "-o", "--out", default=None,
        help="Output directory (default: <cwd>/resources/extracted/<stem>/)",
    )
    parser.add_argument(
        "--thumb-width", type=int, default=600,
        help="Max thumbnail width in px (default: 600, balances legibility and tokens)",
    )
    args = parser.parse_args()

    if args.thumb_width < 50:
        _die(f"--thumb-width must be at least 50, got {args.thumb_width}")

    input_path = Path(args.input).expanduser().resolve()
    if not input_path.exists():
        _die(f"file not found: {input_path}")

    suffix = input_path.suffix.lower()
    supported = (".docx", ".pdf", ".pptx", ".xlsx", ".xls", ".csv", ".tsv")
    if suffix not in supported:
        _die(
            f"unsupported format '{suffix}'. "
            f"Supported: {', '.join(supported)}"
        )

    _check_deps(
        need_pymupdf=(suffix == ".pdf"),
        need_mammoth=(suffix == ".docx"),
        need_pptx=(suffix == ".pptx"),
        need_openpyxl=(suffix == ".xlsx"),
        need_xlrd=(suffix == ".xls"),
    )

    out_dir = (
        Path(args.out).expanduser().resolve()
        if args.out
        else Path.cwd() / "resources" / "extracted" / input_path.stem
    )
    out_dir.mkdir(parents=True, exist_ok=True)

    print(f"[extract] Input:  {input_path}")
    print(f"[extract] Output: {out_dir}")
    print()

    # Extract
    if suffix == ".docx":
        print("[extract] [1/2] Extracting from DOCX (mammoth)...")
        md_file, img_count = _extract_docx(input_path, out_dir)
    elif suffix == ".pdf":
        print("[extract] [1/2] Extracting from PDF (pymupdf)...")
        md_file, img_count = _extract_pdf(input_path, out_dir)
    elif suffix == ".pptx":
        print("[extract] [1/2] Extracting from PPTX (python-pptx)...")
        md_file, img_count = _extract_pptx(input_path, out_dir)
    elif suffix == ".xlsx":
        print("[extract] [1/1] Extracting from XLSX (openpyxl, read-only)...")
        md_file, img_count = _extract_xlsx(input_path, out_dir)
    elif suffix == ".xls":
        print("[extract] [1/1] Extracting from XLS (xlrd)...")
        md_file, img_count = _extract_xls(input_path, out_dir)
    elif suffix == ".csv":
        print("[extract] [1/1] Extracting from CSV...")
        md_file, img_count = _extract_delimited(input_path, out_dir, delimiter=",")
    else:  # .tsv
        print("[extract] [1/1] Extracting from TSV...")
        md_file, img_count = _extract_delimited(input_path, out_dir, delimiter="\t")

    print(f"[extract]   Text → {md_file.name}")
    is_tabular = suffix in (".xlsx", ".xls", ".csv", ".tsv")
    if not is_tabular:
        print(f"[extract]   Images: {img_count} found")

    # Thumbnails — only meaningful for doc-like inputs that may carry images.
    images_dir = out_dir / "images"
    thumbs_dir = out_dir / "thumbnails"

    if not is_tabular:
        if img_count > 0 and images_dir.exists():
            print(f"\n[extract] [2/2] Generating PNG thumbnails (max {args.thumb_width}px)...")
            thumbs = _generate_thumbnails(images_dir, thumbs_dir, args.thumb_width)
            print(f"[extract]   Thumbnails: {len(thumbs)} PNG files")
        else:
            print("\n[extract] [2/2] No images to thumbnail, skipping.")

    # Summary
    print()
    print("=" * 60)
    print("[extract] Done! Output structure:")
    print(f"  {out_dir}/")
    print(f"    content.md        ← text (agent reads this)")
    if not is_tabular:
        print(f"    images/           ← originals ({img_count} files)")
        if thumbs_dir.exists():
            print(f"    thumbnails/       ← previews (agent views these)")
    print("=" * 60)


if __name__ == "__main__":
    main()