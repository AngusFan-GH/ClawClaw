#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
page/upload_page_artifact.py —— 把本地改动文件上传到 Page 事务工作区

用法：
    python3 page/upload_page_artifact.py \\
      --transaction-id "<tx_id>" --path "index.html" --file /tmp/edit/index.html

约定:
    - --path 必须是产物相对路径，禁止绝对路径 / ..
    - --file 必须是已存在的本地文件；不要上传 .baseline/ 下的副本
    - 单文件上限 50 MiB，与 import_html.py 对齐
"""

from __future__ import annotations

import argparse
import sys
import urllib.error
import urllib.request
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

API_PATH = "/space/api/agent/v1/get-page-upload-url"
MAX_UPLOAD_BYTES = 50 * 1024 * 1024
PUT_TIMEOUT = 60


def _safe_rel_path(raw: str) -> str:
    path = (raw or "").replace("\\", "/").strip()
    if not path or path.startswith("/") or "\x00" in path:
        return ""
    parts = [p for p in path.split("/") if p not in ("", ".")]
    if not parts or any(p == ".." for p in parts):
        return ""
    return "/".join(parts)


def _normalize_msys_path(p: str) -> str:
    if sys.platform == "win32" and len(p) >= 3 and p[0] == "/" and p[1].isalpha() and p[2] == "/":
        return p[1] + ":" + p[2:]
    return p


def _is_baseline_file(path: Path) -> bool:
    return ".baseline" in path.parts


def _put_to_cos(upload_url: str, body: bytes) -> bool:
    """预签名 URL 自带鉴权；不注入 ClawClaw 头，也不把 URL 写进错误文案。"""
    if not upload_url or not body:
        return False
    req = urllib.request.Request(url=upload_url, data=body, method="PUT")
    try:
        with urllib.request.urlopen(req, timeout=PUT_TIMEOUT) as resp:
            return 200 <= getattr(resp, "status", 200) < 300
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        OSError,
        ValueError,
    ):
        return False
    except Exception:  # noqa: BLE001
        return False


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--transaction-id", dest="transaction_id", default="")
    parser.add_argument("--path", dest="path", default="")
    parser.add_argument("--file", dest="file", default="")
    try:
        args, _unknown = parser.parse_known_args()
    except SystemExit:
        error_exit("参数解析失败")

    tx_id = (args.transaction_id or "").strip()
    rel = _safe_rel_path(args.path)
    file_arg = (args.file or "").strip()
    if not tx_id:
        error_exit("transaction_id 缺失")
    if not rel:
        error_exit("path 缺失或非法")
    if not file_arg:
        error_exit("file 缺失")

    local = Path(_normalize_msys_path(file_arg)).expanduser()
    try:
        local = local.resolve()
    except OSError:
        error_exit("本地文件路径无效")
    if not local.is_file():
        error_exit("本地文件不存在")
    if _is_baseline_file(local):
        error_exit("禁止上传 .baseline 副本")

    try:
        size = local.stat().st_size
    except OSError:
        error_exit("无法读取本地文件")
    if size <= 0:
        error_exit("文件为空")
    if size > MAX_UPLOAD_BYTES:
        error_exit("文件超出大小上限")

    try:
        body = local.read_bytes()
    except OSError:
        error_exit("读取本地文件失败")
    if len(body) != size:
        error_exit("读取本地文件失败")

    try:
        data = unwrap_data(
            http_request(
                "POST",
                API_PATH,
                body={"transactionId": tx_id, "path": rel},
                timeout=15.0,
            )
        )
    except HttpError as e:
        error_exit(f"获取 Page 上传 URL 失败: {e}", traceid=e.traceid)

    upload_url = str(data.get("uploadUrl") or "").strip()
    method = str(data.get("method") or "PUT").strip().upper() or "PUT"
    if not upload_url:
        error_exit("上传凭证响应缺少 uploadUrl")
    if method != "PUT":
        error_exit("不支持的上传方法")

    if not _put_to_cos(upload_url, body):
        error_exit("上传产物失败")

    safe_print(f"KS_PAGE_UPLOAD\t{rel}\t{len(body)}")


if __name__ == "__main__":
    main()
