#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""database/import_csv.py —— 导入本地 CSV 文件到 Database。

用法：
    python3 database/import_csv.py <path-to-local.csv>
      [--file-name <展示名.csv>] [--database-id <id>] [--space-id <id>] [--parent-id <id>]

约定：
    - path 必须是已存在的单个 .csv 文件
    - --file-name 缺省取 basename；--database-id 非空为覆盖重导入
    - --space-id / --parent-id 缺省落我的文档
    - 成功输出 KS_IMPORT_OK {node_block_id, file_name, url, publish_url}
    - 任一步失败输出 {"error":"<msg>"}，均 exit 0
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path

# 复用 library/_common.py 的 HTTP / 脱敏 / 失败出口约定。
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

_PATH_GET_UPLOAD_CREDENTIAL = "/space/api/agent/v1/get-upload-credential"
_PATH_IMPORT_LOCAL_FILE_ASYNC = "/space/api/agent/v1/import-local-file-async"
_PATH_QUERY_IMPORT_PROGRESS = "/space/api/agent/v1/query-import-file-progress"

# 异步导入轮询策略：最多 90 次，间隔 2s（总等待上限 ~3min）。
POLL_MAX_ATTEMPTS = 90
POLL_INTERVAL_SECONDS = 2.0

# 单次允许上传的最大文件大小（字节），与后端 cos 配置保持一个数量级；
# 超出直接静默退出，避免长时阻塞与超大请求体。
MAX_UPLOAD_BYTES = 50 * 1024 * 1024  # 50 MiB

# COS PUT 上传超时（秒）；与本地网络条件相关，给一个相对宽松的值。
PUT_TIMEOUT = 60

# 允许的本地文件扩展名（小写）。
_ALLOWED_EXTS = (".csv",)


def _file_meta(path: str) -> tuple:
    """读取文件内容并返回 (content, size)；任何异常 → (b"", 0) 由调用方按失败处理。"""
    try:
        with open(path, "rb") as f:
            content = f.read(MAX_UPLOAD_BYTES + 1)
    except (OSError, IOError):
        return b"", 0
    size = len(content)
    if size == 0 or size > MAX_UPLOAD_BYTES:
        return b"", 0
    return content, size


def _put_to_cos(upload_url: str, body: bytes) -> bool:
    """把文件二进制 PUT 到 COS 预签名 URL；2xx 视为成功。"""
    if not upload_url or not body:
        return False
    req = urllib.request.Request(
        url=upload_url,
        data=body,
        method="PUT",
    )
    try:
        with urllib.request.urlopen(req, timeout=PUT_TIMEOUT) as resp:
            return 200 <= resp.status < 300
    except (
        urllib.error.HTTPError,
        urllib.error.URLError,
        TimeoutError,
        OSError,
        ValueError,
    ):
        return False
    except Exception:  # noqa: BLE001 - 任何意外都静默
        return False


def _poll_import_progress(task_id: str) -> dict:
    """轮询异步导入任务进度，返回 status=done 的 progress data。

    最多 POLL_MAX_ATTEMPTS 次、间隔 POLL_INTERVAL_SECONDS 秒；
    命中 failed / cancelled 或超出轮询上限一律走 error_exit。
    """
    progress_url = _PATH_QUERY_IMPORT_PROGRESS
    last_progress = 0
    for attempt in range(POLL_MAX_ATTEMPTS):
        if attempt:
            time.sleep(POLL_INTERVAL_SECONDS)
        try:
            data = unwrap_data(
                http_request("POST", progress_url, body={"taskId": task_id}, timeout=10.0)
            )
        except HttpError as e:
            error_exit(f"查询导入进度失败: {e}")

        status = (data.get("status") or "").strip().lower()
        try:
            last_progress = int(data.get("progress") or last_progress)
        except (TypeError, ValueError):
            pass

        if status == "done":
            return data
        if status == "failed":
            reason = (data.get("failReason") or "").strip() or "未知原因"
            error_exit(f"导入失败: {reason}")
        if status == "cancelled":
            error_exit("导入任务已被取消")
        # pending / 其他中间态：继续轮询

    error_exit(
        f"导入超时：轮询 {POLL_MAX_ATTEMPTS} 次后任务仍未完成"
        f"（最后进度 {last_progress}%）"
    )
    return {}


def main() -> None:
    if any(a in ("-h", "--help") for a in sys.argv[1:]):
        print(__doc__)
        return
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("path", nargs="?", default="")
    parser.add_argument("--file-name", dest="file_name", default="")
    parser.add_argument("--database-id", dest="database_id", default="")
    parser.add_argument("--space-id", dest="space_id", default="")
    parser.add_argument("--parent-id", dest="parent_id", default="")
    try:
        args, _unknown = parser.parse_known_args()
    except SystemExit:
        error_exit("参数解析失败")

    path = (args.path or "").strip()
    if not path or not os.path.isfile(path):
        error_exit("文件路径无效或文件不存在")

    content, size = _file_meta(path)
    if size == 0:
        error_exit("文件为空或超出大小上限")

    file_name = (args.file_name or os.path.basename(path)).strip()
    if not file_name:
        error_exit("文件名为空")
    ext = os.path.splitext(file_name)[1].lower()
    if ext not in _ALLOWED_EXTS:
        error_exit(f"不支持的文件扩展名: {ext}（仅支持 .csv）")

    target_space_id = (args.space_id or "").strip()
    target_parent_id = (args.parent_id or "").strip()
    existing_database_id = (args.database_id or "").strip()

    # ---- Step 1: 获取上传凭证 ----
    credential_body: dict = {
        "fileName": file_name,
        "fileSize": size,
    }
    if target_parent_id or target_space_id:
        credential_body["parentId"] = target_parent_id or target_space_id
    try:
        cred_data = unwrap_data(
            http_request("POST", _PATH_GET_UPLOAD_CREDENTIAL, body=credential_body, timeout=8.0)
        )
    except HttpError as e:
        error_exit(f"获取上传凭证失败: {e}")

    upload_url = (cred_data.get("uploadUrl") or "").strip()
    cos_key = (cred_data.get("cosKey") or "").strip()
    if not upload_url or not cos_key:
        error_exit("上传凭证响应缺少 uploadUrl 或 cosKey")

    # ---- Step 2: PUT 上传文件到 COS ----
    if not _put_to_cos(upload_url, content):
        error_exit("文件上传到 COS 失败")

    # ---- Step 3: 组装导入参数 ----
    import_body: dict = {
        "cosKey": cos_key,
        "fileName": file_name,
    }

    # --space-id
    if target_space_id:
        import_body["spaceId"] = target_space_id

    # --parent-id
    if target_parent_id:
        import_body["parentId"] = target_parent_id

    # --database-id（重导入：非空时覆盖更新该 database，留空则新建）
    if existing_database_id:
        import_body["nodeBlockId"] = existing_database_id

    # 可选 title：默认用文件名去掉扩展名
    title = os.path.splitext(file_name)[0].strip()
    if title:
        import_body["title"] = title

    # ---- Step 4: 触发异步导入 ----
    try:
        async_data = unwrap_data(
            http_request("POST", _PATH_IMPORT_LOCAL_FILE_ASYNC, body=import_body, timeout=15.0)
        )
    except HttpError as e:
        error_exit(f"导入文件请求失败: {e}")

    task_id = (async_data.get("taskId") or "").strip()
    if not task_id:
        error_exit("服务端返回的 taskId 为空")

    # ---- Step 5: 轮询导入进度 ----
    import_data = _poll_import_progress(task_id)

    node_block_id = (import_data.get("nodeBlockId") or "").strip()
    if not node_block_id:
        error_exit("服务端返回的 nodeBlockId 为空")

    url = (import_data.get("url") or "").strip()
    publish_url = (import_data.get("publishUrl") or "").strip()

    output = {
        "node_block_id": node_block_id,
        "file_name": file_name,
        "url": url,
        "publish_url": publish_url,
    }
    safe_print(
        "KS_IMPORT_OK "
        + json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
