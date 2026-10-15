#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""Print the space filing routing table.

stdout:
    KS_LAYOUT_FOUND\t<spaceId>\t{"nodes":[...],"fallback":{...}}
    KS_LAYOUT_NONE\t<spaceId>
    KS_LAYOUT_VALID                         (--validate)
    {"error":"..."}
"""

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, Iterable, List, Mapping, Optional

_LIB_DIR = Path(__file__).resolve().parents[2]
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from _common import HttpError, error_exit, http_request, safe_print, unwrap_data  # noqa: E402

LIST_SPACES_PATH = "/space/api/agent/v1/list-user-spaces"
LAYOUT_DIR = Path.home() / ".clawclaw" / "library-layouts"
HTTP_TIMEOUT = 15.0


class JsonErrorArgumentParser(argparse.ArgumentParser):
    def error(self, message: str) -> None:
        error_exit("argument parsing failed")


def _build_parser() -> argparse.ArgumentParser:
    p = JsonErrorArgumentParser(
        description="Print the space filing routing table.",
        add_help=True,
    )
    p.add_argument("--space-id", default="", help="Space ID; omit to use 我的资料.")
    p.add_argument("--validate", default="", help="Validate a convention JSON file.")
    return p


def _clean_id(v: Optional[str]) -> str:
    s = (v or "").strip()
    if not s:
        return ""
    if any(ch in s for ch in ("/", "?", "#", "\t", "\n", "\r")):
        error_exit("invalid --space-id: pass a bare ID, not a URL")
    return s


def _resolve_personal_space() -> str:
    offset = 0
    limit = 100
    while True:
        try:
            envelope = http_request(
                "POST", LIST_SPACES_PATH,
                body={"limit": limit, "offset": offset}, timeout=HTTP_TIMEOUT,
            )
            data = unwrap_data(envelope)
        except HttpError as e:
            error_exit(f"failed to resolve personal space: {e}", traceid=e.traceid)
            return ""
        spaces = data.get("spaces")
        if isinstance(spaces, Mapping):
            spaces = spaces.get("spaces")
        if not isinstance(spaces, list):
            error_exit("unexpected list-user-spaces response shape")
            return ""
        for sp in spaces:
            if not isinstance(sp, Mapping):
                continue
            if str(sp.get("category", "")).strip() != "personal":
                continue
            sid = str(sp.get("spaceId", "")).strip()
            if sid:
                return sid
        if not data.get("hasMore") or not spaces:
            break
        used = data.get("limit")
        try:
            used_limit = int(used) if used is not None else 0
        except (TypeError, ValueError):
            used_limit = 0
        offset += used_limit if used_limit > 0 else len(spaces)
    error_exit("no personal space (我的资料) found")
    return ""


def _load_layout(space_id: str) -> Optional[Mapping[str, Any]]:
    path = LAYOUT_DIR / f"layout-{space_id}.json"
    if not path.is_file():
        return None
    try:
        layout = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        return None
    if not isinstance(layout, Mapping):
        return None
    return layout


def _compact(layout: Mapping[str, Any]) -> Dict[str, Any]:
    nodes: List[Dict[str, Any]] = []
    raw_nodes = layout.get("nodes")
    if isinstance(raw_nodes, list):
        for n in raw_nodes:
            if not isinstance(n, Mapping):
                continue
            nid = str(n.get("id", "")).strip()
            if not nid:
                continue
            keywords = [
                str(k).strip()
                for k in (n.get("keywords") or [])
                if str(k).strip()
            ] if isinstance(n.get("keywords"), list) else []
            nodes.append({
                "id": nid,
                "title": str(n.get("title", "")).strip(),
                "keywords": keywords,
                "intent": str(n.get("intent", "")).strip(),
            })
    fallback: Dict[str, Any] = {}
    fb = layout.get("fallbackNode")
    if isinstance(fb, Mapping):
        fb_id = str(fb.get("id", "")).strip()
        if fb_id:
            fallback = {"id": fb_id, "title": str(fb.get("title", "")).strip()}
    return {"nodes": nodes, "fallback": fallback}


def _validate_file(path_str: str) -> None:
    path = Path(path_str).expanduser()
    if not path.is_file():
        error_exit(f"validate: file not found: {path}")
        return
    try:
        layout = json.loads(path.read_text(encoding="utf-8"))
    except Exception:
        error_exit("validate: file is not valid JSON")
        return
    if not isinstance(layout, Mapping):
        error_exit("validate: top level must be a JSON object")
        return

    issues: List[str] = []

    space_id = str(layout.get("spaceId", "")).strip()
    if not space_id:
        issues.append("missing required field: spaceId")
    stem = path.stem
    if stem.startswith("layout-") and space_id and stem[len("layout-"):] != space_id:
        issues.append(f"spaceId '{space_id}' does not match filename suffix '{stem[len('layout-'):]}")

    if str(layout.get("version", "")).strip() != "1":
        issues.append(f"version must be \"1\", got {layout.get('version')!r}")
    if not str(layout.get("generatedAt", "")).strip():
        issues.append("missing required field: generatedAt")

    nodes = layout.get("nodes")
    seen_ids: set = set()
    if not isinstance(nodes, list) or not nodes:
        issues.append("nodes must be a non-empty array")
    else:
        for i, n in enumerate(nodes):
            if not isinstance(n, Mapping):
                issues.append(f"nodes[{i}] must be an object")
                continue
            nid = str(n.get("id", "")).strip()
            if not nid:
                issues.append(f"nodes[{i}].id is required")
            elif nid in seen_ids:
                issues.append(f"nodes[{i}].id duplicated: {nid}")
            else:
                seen_ids.add(nid)
            if not str(n.get("title", "")).strip():
                issues.append(f"nodes[{i}].title is required")
            intent = str(n.get("intent", "")).strip()
            if not intent:
                issues.append(f"nodes[{i}].intent is required")
            elif len(intent) > 80:
                issues.append(f"nodes[{i}].intent exceeds 80 chars")
            kw = n.get("keywords")
            if kw is not None:
                if not isinstance(kw, list):
                    issues.append(f"nodes[{i}].keywords must be an array of strings")
                else:
                    if len(kw) > 8:
                        issues.append(f"nodes[{i}].keywords has {len(kw)} entries, max 8")
                    seen_kw: set = set()
                    for k in kw:
                        ks = str(k).strip()
                        if not ks:
                            issues.append(f"nodes[{i}].keywords contains an empty entry")
                        elif ks in seen_kw:
                            issues.append(f"nodes[{i}].keywords duplicated: {ks}")
                        else:
                            seen_kw.add(ks)
                        if len(ks) > 24:
                            issues.append(f"nodes[{i}].keywords entry exceeds 24 chars: {ks[:24]}...")

    fb = layout.get("fallbackNode")
    fb_id = ""
    if not isinstance(fb, Mapping):
        issues.append("fallbackNode must be an object with a non-empty id")
    else:
        fb_id = str(fb.get("id", "")).strip()
        if not fb_id:
            issues.append("fallbackNode.id is required")
        elif fb_id in seen_ids:
            issues.append(f"fallbackNode.id duplicates nodes[] id: {fb_id}")
        if not str(fb.get("title", "")).strip():
            issues.append("fallbackNode.title is required")

    mode = str(layout.get("mode", "")).strip()
    conv_doc_id = str(layout.get("conventionDocId", "")).strip()
    if not mode:
        issues.append("missing required field: mode")
    elif mode not in ("folder", "doc"):
        issues.append(f"mode must be \"folder\" or \"doc\", got {mode!r}")
    if mode == "doc":
        if not conv_doc_id:
            issues.append("conventionDocId is required when mode is \"doc\"")
    elif conv_doc_id:
        issues.append("conventionDocId is only allowed when mode is \"doc\"")
    if conv_doc_id:
        if conv_doc_id in seen_ids:
            issues.append(f"conventionDocId duplicates nodes[] id: {conv_doc_id}")
        if fb_id and conv_doc_id == fb_id:
            issues.append(f"conventionDocId duplicates fallbackNode.id: {conv_doc_id}")

    if issues:
        safe_print(json.dumps({"error": "schema validation failed", "issues": issues[:20]}, ensure_ascii=False))
        return
    safe_print("KS_LAYOUT_VALID")


def main(argv: Optional[Iterable[str]] = None) -> None:
    try:
        args = _build_parser().parse_args(list(argv) if argv is not None else None)
    except SystemExit:
        raise

    if args.validate:
        _validate_file(args.validate)
        return

    space_id = _clean_id(args.space_id)
    if not space_id:
        space_id = _resolve_personal_space()

    layout = _load_layout(space_id)
    compact = _compact(layout) if layout is not None else {"nodes": [], "fallback": {}}
    if not compact["nodes"]:
        safe_print(f"KS_LAYOUT_NONE\t{space_id}")
        return

    safe_print(
        f"KS_LAYOUT_FOUND\t{space_id}\t{json.dumps(compact, ensure_ascii=False)}"
    )


if __name__ == "__main__":
    try:
        main()
    except SystemExit:
        raise
    except Exception:
        error_exit("unexpected error")
