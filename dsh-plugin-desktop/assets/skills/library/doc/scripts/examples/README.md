# doc scenario examples (executable compliant samples)

This directory holds actions-JSON examples for `submit_review_edit.py` / `submit_doc_edit.py`. Every example passes `verify_examples.py` (script dry-run validation) — they are "living" compliant samples.

When rules are upgraded (e.g. a new field constraint), running `verify_examples.py` once reveals which examples have aged.

## File list

1. `example_C_rewrite_block.json` — whole-block rewrite (preferred update + chained Mark ar) — `submit_review_edit.py`.
2. `example_C2_partial_replace.json` — partial text replace inside a block (unchanged text stays bare) — `submit_review_edit.py`.
3. `example_D_change_block_type.json` — change block type (paragraph → level-2 heading; `delete + insert_after`) — `submit_review_edit.py`.
4. `example_E_edit_heading.json` — edit heading text — `submit_review_edit.py`.
5. `example_F_reuse_card.json` — reuse the previous review card — `submit_review_edit.py`.
6. `example_G_global_review.json` — global summary card (`agent_review_global`) — `submit_review_edit.py`.
7. `example_word_selection.json` — text-selection revision (edit part of a paragraph) — `submit_review_edit.py`.
8. `example_comment_revision.json` — comment revision (casual intro → formal style) — `submit_review_edit.py`.

## Usage

Dry-run a single example:

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/submit_review_edit.py" \
    --page-id "test_page" \
    --summary "$(basename example_C_rewrite_block.json .json)" \
    --actions-file example_C_rewrite_block.json --dry-run
```

Run all examples (recommended):

```bash
python3 "${CLAWCLAW_SKILL_DIR}/doc/scripts/examples/verify_examples.py"
```

Success prints `KS_EXAMPLES_SELFCHECK_OK`; any failure names the exact action and error code for quick diagnosis.

## Naming rules

- Filename prefix `example_<scenario-tag>_<snake_case short description>.json`
- Content is a JSON array (equivalent to `--actions-file` input)
- Review-mode examples must end with `card_op`; edit-mode examples must not contain `card_op`
- Examples use **fake block ids only** (`blk_*` / `dis_*`-style); never real doc data

## Relation to `workflows.md`

`workflows.md` carries the "which example when" scenario descriptions; this directory carries the **examples themselves and the self-check**. On rule upgrades, run `verify_examples.py` first to find which examples need rewriting.
