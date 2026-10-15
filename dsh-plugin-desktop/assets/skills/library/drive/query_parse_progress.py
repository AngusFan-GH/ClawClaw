#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
drive/query_parse_progress.py —— 按节点 ID 查询内容解析进度与语音原文

完整链路：
    1. POST /space/api/agent/v1/query-node-parse-progress
    2. 成功 → stdout 输出 `KS_DRIVE_PARSE <json>`，exit 0
       JSON 含 node_id、status、content（当前页原文）、summary、file_name、
       file_type、updated_at、content_chars、page、page_size、page_count、has_more；
       失败 → stdout 单行 {"error":"<msg>"} 后 exit 0

用法：
    python3 drive/query_parse_progress.py --node-id <blk_xxx> [--page 1] [--page-size 8000]

约定：
    - 仅已触发内容解析的网盘节点有结果（当前主要为音频）；类型不确定时先调
      space.workspace.node-info 确认 kind=drive
    - 本脚本单次查询，不内置轮询；轮询策略见 drive/entry.md
    - success / init / processing 时不输出 KS_USER_REPLY（由 Agent 按 entry.md 轮询或组织答案）
    - failed 时输出 KS_USER_REPLY
    - 失败（HTTP/业务错误）一律输出结构化错误 JSON 后 exit 0
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

_LIB_DIR = Path(__file__).resolve().parents[1]
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from _common import (  # noqa: E402
    HttpError,
    error_exit,
    http_request,
    safe_print,
    unwrap_data,
)

_PATH = "/space/api/agent/v1/query-node-parse-progress"
# 8000 字约等于 30–40 分钟转写；1 小时录音大约 2 页。按 Unicode 字符计，不按字节。
_DEFAULT_PAGE_SIZE = 8000
_MAX_PAGE_SIZE = 16000


def _plain_content(raw: object) -> str:
    """取出给人看的原文。后端 success 时 content 常为 JSON：{"content": markdown, "transcript": {...}}。"""
    if raw is None:
        return ""
    text = raw if isinstance(raw, str) else str(raw)
    text = text.strip()
    if not text:
        return ""
    if text[:1] not in "{[":
        return text
    try:
        payload = json.loads(text)
    except json.JSONDecodeError:
        return text
    if isinstance(payload, dict):
        inner = payload.get("content")
        if isinstance(inner, str) and inner.strip():
            return inner
        # 有 JSON 外壳但没有可用 content：不要把 transcript 整包交给 Agent
        return ""
    return text


def _split_pages(text: str, page_size: int) -> list[str]:
    """按字符分页；优先在换行/句号处切开，避免把一句话截成两页。"""
    if not text:
        return [""]
    if page_size <= 0:
        page_size = _DEFAULT_PAGE_SIZE
    if len(text) <= page_size:
        return [text]
    pages: list[str] = []
    start = 0
    n = len(text)
    min_keep = page_size // 2
    while start < n:
        end = min(start + page_size, n)
        if end < n:
            window = text[start:end]
            cut = -1
            for sep in ("\n", "。", "！", "？"):
                idx = window.rfind(sep)
                if idx >= min_keep:
                    cut = idx + len(sep)
                    break
            if cut >= min_keep:
                end = start + cut
        pages.append(text[start:end])
        start = end
    return pages


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--node-id", dest="node_id", default="")
    parser.add_argument("--page", dest="page", default="1")
    parser.add_argument("--page-size", dest="page_size", default=str(_DEFAULT_PAGE_SIZE))
    try:
        args, _unknown = parser.parse_known_args()
    except SystemExit:
        error_exit("参数解析失败")


    node_id = (args.node_id or "").strip()
    if not node_id:
        error_exit("--node-id 必填")

    try:
        page = int(str(args.page).strip() or "1")
        page_size = int(str(args.page_size).strip() or str(_DEFAULT_PAGE_SIZE))
    except ValueError:
        error_exit("--page / --page-size 必须是正整数")
    if page < 1:
        error_exit("--page 从 1 开始")
    if page_size < 1:
        error_exit("--page-size 必须为正整数")
    if page_size > _MAX_PAGE_SIZE:
        page_size = _MAX_PAGE_SIZE

    try:
        data = unwrap_data(
            http_request("POST", _PATH, body={"nodeId": node_id}, timeout=10.0)
        )
    except HttpError as e:
        error_exit(f"查询解析进度失败: {e}")

    status = (data.get("status") or "").strip()
    full_content = _plain_content(data.get("content") or "")
    pages = _split_pages(full_content, page_size)
    page_count = len(pages)
    if page > page_count:
        page_content = ""
        has_more = False
    else:
        page_content = pages[page - 1]
        has_more = page < page_count
    out = {
        "node_id": (data.get("nodeId") or node_id).strip(),
        "status": status,
        "content": page_content,
        "summary": data.get("summary") or "",
        "file_name": (data.get("fileName") or "").strip(),
        "file_type": (data.get("fileType") or "").strip(),
        "updated_at": data.get("updatedAt") or 0,
        "content_chars": len(full_content),
        "page": page,
        "page_size": page_size,
        "page_count": page_count,
        "has_more": has_more,
    }

    safe_print(
        "KS_DRIVE_PARSE "
        + json.dumps(out, ensure_ascii=False, separators=(",", ":"))
    )

    # init/processing 不写 KS_USER_REPLY，否则 Agent 必须立刻透传回执、无法按 entry.md 轮询。
    if status == "failed":
        fn = out["file_name"] or "该文件"
        safe_print(f"KS_USER_REPLY\t「{fn}」的语音原文解析失败，无法读取原文。")
    # success：不写 KS_USER_REPLY，由 Agent 按用户诉求用 content/summary 组织答案。


if __name__ == "__main__":
    main()
