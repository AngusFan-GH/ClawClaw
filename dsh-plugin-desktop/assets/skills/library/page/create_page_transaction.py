#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
page/create_page_transaction.py —— 开启 Page 编辑事务，并列出该基线版本的产物

用法：
    python3 page/create_page_transaction.py --node-id "<page_node_id>"

约定:
    - --node-id 支持裸 ID / /space/d/<id> / /p/<id>
    - 按返回的 files / html 自行选择要改的文件，用 url 作为 CDN 前缀 GET
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from pathlib import Path, PurePosixPath

_LIB_DIR = Path(__file__).resolve().parents[1]
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from _common import HttpError, error_exit, http_request, safe_print, unwrap_data  # noqa: E402

API_CREATE = "/space/api/agent/v1/create-page-transaction"
API_LIST = "/space/api/agent/v1/list-page-artifacts"
_SPACE_D_RE = re.compile(r"/space/d/([^/?#]+)")
_PUBLISH_P_RE = re.compile(r"/p/([^/?#]+)")


def _normalize_node_id(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    match = _SPACE_D_RE.search(value)
    if match:
        return match.group(1).strip()
    match = _PUBLISH_P_RE.search(value)
    if match:
        return match.group(1).strip()
    return value


def _safe_rel_path(raw_path: str) -> str:
    p = (raw_path or "").strip().lstrip("/")
    if not p:
        return ""
    pure = PurePosixPath(p)
    if pure.is_absolute() or any(part == ".." for part in pure.parts):
        return ""
    return str(pure)


def _cdn_base(raw: str) -> str:
    url = (raw or "").strip()
    if not url:
        return ""
    if not url.endswith("/"):
        url = url + "/"
    return url


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--node-id", dest="node_id", default="")
    try:
        args, _unknown = parser.parse_known_args()
    except SystemExit:
        error_exit("参数解析失败")

    node_id = _normalize_node_id(args.node_id)
    if not node_id:
        error_exit("node_id 缺失")

    try:
        created = unwrap_data(
            http_request("POST", API_CREATE, body={"nodeId": node_id}, timeout=15.0)
        )
    except HttpError as e:
        error_exit(f"开启 Page 事务失败: {e}", traceid=e.traceid)

    tx_id = str(created.get("transactionId") or "").strip()
    base_version = created.get("baseVersion")
    if not tx_id:
        error_exit("开启事务响应缺少 transactionId")
    if base_version is None or isinstance(base_version, bool):
        error_exit("开启事务响应缺少 baseVersion")
    try:
        base_version_i = int(base_version)
    except (TypeError, ValueError):
        error_exit("baseVersion 非法")

    try:
        listed = unwrap_data(
            http_request(
                "POST",
                API_LIST,
                body={"nodeId": node_id, "version": base_version_i},
                timeout=15.0,
            )
        )
    except HttpError as e:
        error_exit(f"获取 Page 产物列表失败: {e}", traceid=e.traceid)

    cdn_url = _cdn_base(str(listed.get("url") or ""))
    artifacts = listed.get("artifacts") or []
    if not cdn_url:
        error_exit("产物列表缺少 data.url")
    if not isinstance(artifacts, list) or not artifacts:
        error_exit("产物列表为空")

    files: list[str] = []
    seen: set[str] = set()
    for item in artifacts:
        raw = item.get("path") if isinstance(item, dict) else None
        rel = _safe_rel_path(str(raw or ""))
        if not rel:
            error_exit(f"产物路径非法或越权: {raw!r}")
        if rel in seen:
            continue
        seen.add(rel)
        files.append(rel)

    html = [p for p in files if p.lower().endswith((".html", ".htm"))]

    output = {
        "transactionId": tx_id,
        "baseVersion": base_version_i,
        "url": cdn_url,
        "files": files,
        "html": html,
    }
    safe_print(
        "KS_PAGE_TX_OPEN "
        + json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
