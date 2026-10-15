#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
page/commit_page_transaction.py —— 提交 Page 编辑事务

用法：
    python3 page/commit_page_transaction.py \\
      --transaction-id "<tx_id>" --message "更新页面" --cleanup-dir /tmp/edit

约定:
    - --message 必填；--pnid 可选
    - --cleanup-dir 可选；提交成功或版本冲突（19901）后删除该目录，其它失败不删
      （冲突后留下旧工作副本，会被下一轮事务当成基线复用并覆盖界面编辑）
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
from collections.abc import Mapping
from pathlib import Path
from typing import Optional

_LIB_DIR = Path(__file__).resolve().parents[1]
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from _common import HttpError, error_exit, http_request, safe_print  # noqa: E402

API_PATH = "/space/api/agent/v1/commit-page-transaction"
# 与 error_handling.md「版本冲突」分类中 commit-page-transaction 实际返回的业务码对齐。
_VERSION_CONFLICT_CODE = "19901"


def _normalize_msys_path(p: str) -> str:
    if sys.platform == "win32" and len(p) >= 3 and p[0] == "/" and p[1].isalpha() and p[2] == "/":
        return p[1] + ":" + p[2:]
    return p


def _resolve_cleanup_dir(raw: str) -> Optional[Path]:
    value = (raw or "").strip()
    if not value:
        return None
    path = Path(_normalize_msys_path(value)).expanduser()
    try:
        path = path.resolve()
    except OSError:
        error_exit("cleanup-dir 路径无效")
    home = Path.home().resolve()
    if path == Path(path.anchor) or path == home or len(path.parts) < 3:
        error_exit("cleanup-dir 非法")
    return path


def _delete_cleanup_dir(path: Optional[Path]) -> None:
    if path is not None and path.is_dir():
        shutil.rmtree(path, ignore_errors=True)


def _is_version_conflict(error_code: object) -> bool:
    return str(error_code or "").strip() == _VERSION_CONFLICT_CODE


def _post_envelope(body: dict, *, timeout: float = 30.0) -> dict:
    return http_request("POST", API_PATH, body=body, timeout=timeout)


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--transaction-id", dest="transaction_id", default="")
    parser.add_argument("--pnid", dest="pnid", default="")
    parser.add_argument("--message", dest="message", default="")
    parser.add_argument("--cleanup-dir", dest="cleanup_dir", default="")
    try:
        args, _unknown = parser.parse_known_args()
    except SystemExit:
        error_exit("参数解析失败")

    tx_id = (args.transaction_id or "").strip()
    if not tx_id:
        error_exit("transaction_id 缺失")

    pnid = (args.pnid or "").strip()

    message = (args.message or "").strip()
    if not message:
        error_exit("message 缺失")

    cleanup_dir = _resolve_cleanup_dir(args.cleanup_dir)

    body = {"transactionId": tx_id, "message": message}
    if pnid:
        body["pnid"] = pnid

    try:
        envelope = _post_envelope(body)
    except HttpError as e:
        if _is_version_conflict(e.error_code):
            _delete_cleanup_dir(cleanup_dir)
        error_exit(f"提交 Page 事务失败: {e}", traceid=e.traceid)

    # 业务失败已由公共请求层转为 code + 安全 msg；这里只输出成功信封。
    safe_print(json.dumps(envelope, ensure_ascii=False, separators=(",", ":")))

    # 仅在业务成功时追加成品回执行；409/失败不给"成功"话术，避免误导。
    code = envelope.get("code", envelope.get("retcode"))
    if code in (0, "0", "OK", "ok"):
        data = envelope.get("data") or envelope.get("result") or {}
        if isinstance(data, Mapping):
            url = str(data.get("url") or "").strip()
            new_version = data.get("newVersion")
            if url:
                # url 由后端返回，Agent 直接原样透传，禁止自拼。
                safe_print(f"KS_PAGE_COMMIT\t{new_version if new_version is not None else '-'}\t{url}")
                safe_print(f"KS_USER_REPLY\tAgent 已为您完成页面修改，点击查看：{url}")
        _delete_cleanup_dir(cleanup_dir)


if __name__ == "__main__":
    main()
