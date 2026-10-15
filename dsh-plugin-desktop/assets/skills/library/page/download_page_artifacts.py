#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
page/download_page_artifacts.py —— 拉取已托管 Page 的产物到本地目录

完整链路：
    1. POST /space/api/agent/v1/list-page-artifacts（编辑态，默认）
       或 list-page-publish-artifacts（发布态，--source publish）取产物清单
       → data.url（版本目录基址）+ data.artifacts[].path（相对文件清单）
    2. --list-only：到此结束，stdout 一行 KS_ARTIFACTS_LIST <json>
       （source / url / files / html / entry_html，编辑态另含 version；url 为 CDN 目录基址）
       否则并行 GET 每个 (url + path)，按 path 相对结构写到 out-dir
       传入 --path 时只拉这些相对路径（必须出现在清单中）；省略则拉整包
    3. 整包：入口 HTML 存在、下载数 == 清单数。按需：下载数 == --path 数。缺文件即报错
    4. 下载成功 → stdout 一行 "KS_ARTIFACTS_OK <JSON>"，exit 0
       JSON 含 work_dir、entry_html、files；
       失败 → stdout 单行 {"error":"<msg>"} 后 exit 0（不暴露 token / 签名 URL）

用法（macOS / Linux / Git Bash）：
    python3 page/download_page_artifacts.py --node-id "<page_node_id>"
    python3 page/download_page_artifacts.py --node-id "https://clawclaw.cn/space/d/<id>"
    python3 page/download_page_artifacts.py --node-id "https://clawclaw.link/p/<id>" --source publish
    python3 page/download_page_artifacts.py --node-id "<id>" --version 3 --out-dir /tmp/clone
    python3 page/download_page_artifacts.py --node-id "<id>" --version 3 --out-dir /tmp/edit --path about.html
    python3 page/download_page_artifacts.py --node-id "<id>" --list-only
    python3 page/download_page_artifacts.py --node-id "<id>" --source publish --list-only

约定:
    - --node-id 支持裸 nodeId / /space/d/<id> / /p/<id> 三种形态
    - --source 可选：edit（默认，编辑态最新/指定版本）| publish（发布态定格版本）
    - --version 仅编辑态生效；发布态固定取 meta.publishVersion，忽略 --version
    - --list-only 只列路径与 CDN 基址，不下载、不建目录；与 --path / --out-dir 同时出现时忽略后两者
    - --path 可重复；编辑流程按需拉取，克隆流程不要传（必须整包）
    - --out-dir 可选；默认在系统临时目录建一个唯一工作目录
    - 产物基址与 path 拼接后逐个 GET；直连 COS/CDN 不带鉴权头，仅注入通用 UA
    - 任一步业务异常一律输出结构化错误 JSON 后 exit 0
"""

from __future__ import annotations

import argparse
import json
import re
import sys
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path, PurePosixPath
from typing import Optional

_LIB_DIR = Path(__file__).resolve().parents[1]
if str(_LIB_DIR) not in sys.path:
    sys.path.insert(0, str(_LIB_DIR))

from _common import (  # noqa: E402
    HttpError,
    USER_AGENT,
    error_exit,
    http_request,
    safe_print,
    unwrap_data,
)

_PATH_LIST_ARTIFACTS = "/space/api/agent/v1/list-page-artifacts"
_PATH_LIST_PUBLISH_ARTIFACTS = "/space/api/agent/v1/list-page-publish-artifacts"

# nodeId 归一化：详情页 /space/d/<id> 与发布态 /p/<id> 两种链接形态。
_SPACE_D_RE = re.compile(r"/space/d/([^/?#]+)")
_PUBLISH_P_RE = re.compile(r"/p/([^/?#]+)")

_INT64_MIN = -(2**63)
_INT64_MAX = 2**63 - 1

# 单产物下载超时（秒）与失败重试次数。
GET_TIMEOUT = 30
MAX_RETRY = 1
# 并行下载并发数上限。
DEFAULT_CONCURRENCY = 4


def _normalize_node_id(raw: str) -> str:
    value = (raw or "").strip()
    if not value:
        return ""
    m = _SPACE_D_RE.search(value)
    if m:
        return m.group(1).strip()
    m = _PUBLISH_P_RE.search(value)
    if m:
        return m.group(1).strip()
    return value


def _parse_version(raw: str) -> Optional[int]:
    value = (raw or "").strip()
    if not value:
        return None
    try:
        version = int(value, 10)
    except ValueError:
        error_exit("version 必须是 int64 整数")
    if version < _INT64_MIN or version > _INT64_MAX:
        error_exit("version 必须是 int64 整数")
    return version


def _safe_rel_path(raw_path: str) -> Optional[str]:
    """把清单里的 path 规整为安全相对路径；拒绝绝对路径 / .. 穿越。"""
    p = (raw_path or "").strip().lstrip("/")
    if not p:
        return None
    pure = PurePosixPath(p)
    if pure.is_absolute() or any(part == ".." for part in pure.parts):
        return None
    return str(pure)


def _pick_entry_html(rel_paths: list[str]) -> str:
    """入口 HTML 选取：优先根级 index.html，其次最浅层的 .html。"""
    htmls = [p for p in rel_paths if p.lower().endswith((".html", ".htm"))]
    if not htmls:
        return ""
    for p in htmls:
        if p.lower() == "index.html":
            return p
    htmls.sort(key=lambda x: (x.count("/"), len(x)))
    return htmls[0]


def _join_url(base: str, rel: str) -> str:
    """产物基址 + 相对路径拼接；base 末尾按目录处理。"""
    if not base.endswith("/"):
        base = base + "/"
    return urllib.parse.urljoin(base, urllib.parse.quote(rel))


def _download_one(base_url: str, rel: str, out_dir: Path) -> None:
    """GET 单个产物写盘；失败抛 HttpError 由上层汇总。"""
    url = _join_url(base_url, rel)
    dest = out_dir / rel
    dest.parent.mkdir(parents=True, exist_ok=True)

    last_err: Optional[Exception] = None
    for _ in range(MAX_RETRY + 1):
        try:
            req = urllib.request.Request(
                url, method="GET", headers={"User-Agent": USER_AGENT}
            )
            with urllib.request.urlopen(req, timeout=GET_TIMEOUT) as resp:
                if not (200 <= getattr(resp, "status", 200) < 300):
                    last_err = HttpError(f"http {getattr(resp, 'status', '?')}")
                    continue
                data = resp.read()
            with open(dest, "wb") as f:
                f.write(data)
            return
        except (urllib.error.HTTPError, urllib.error.URLError,
                TimeoutError, OSError, ValueError) as e:
            last_err = e
    # 脱敏：只暴露相对路径，不回显签名 URL。
    raise HttpError(f"下载产物失败: {rel}") from last_err


def _normalize_msys_path(p: str) -> str:
    """Git Bash (MSYS) 的 $(pwd) 产出 /c/Users/... 风格路径；Windows 原生 Python 的
    Path.resolve() 会把它解析成 C:\\c\\Users\\... 双前缀错位目录。先转成 C:/ 风格再 resolve。
    仅在 Windows 上应用：Linux / macOS 上单字母根路径（如 /a/tmp、/x/output）合法，
    不应被错转。"""
    if sys.platform == "win32" and len(p) >= 3 and p[0] == "/" and p[1].isalpha() and p[2] == "/":
        return p[1] + ":" + p[2:]
    return p


def main() -> None:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--node-id", dest="node_id", default="")
    parser.add_argument("--version", dest="version", default="")
    parser.add_argument("--source", dest="source", default="edit")
    parser.add_argument("--out-dir", dest="out_dir", default="")
    parser.add_argument("--path", dest="paths", action="append", default=None)
    parser.add_argument("--list-only", dest="list_only", action="store_true", default=False)
    parser.add_argument(
        "--concurrency", dest="concurrency", default=str(DEFAULT_CONCURRENCY)
    )
    try:
        args, _unknown = parser.parse_known_args()
    except SystemExit:
        error_exit("参数解析失败")


    node_id = _normalize_node_id(args.node_id)
    if not node_id:
        error_exit("node_id 缺失")

    source = (args.source or "edit").strip().lower()
    if source not in ("edit", "publish"):
        error_exit("source 仅支持 edit / publish")

    # 发布态固定取 meta.publishVersion，忽略 --version。
    body: dict[str, object] = {"nodeId": node_id}
    if source == "edit":
        version = _parse_version(args.version)
        if version is not None:
            body["version"] = version
        api_path = _PATH_LIST_ARTIFACTS
    else:
        api_path = _PATH_LIST_PUBLISH_ARTIFACTS

    # ---- Step 1: 取产物清单 ----
    try:
        data = unwrap_data(
            http_request("POST", api_path, body=body, timeout=15.0)
        )
    except HttpError as e:
        error_exit(f"获取 Page 产物列表失败: {e}")

    list_only = bool(args.list_only)
    base_url = str(data.get("url") or "").strip()
    if base_url and not base_url.endswith("/"):
        base_url = base_url + "/"
    artifacts = data.get("artifacts") or []
    if not list_only and not base_url:
        error_exit("产物列表缺少 data.url")
    if not isinstance(artifacts, list) or not artifacts:
        error_exit("产物列表为空")

    rel_paths: list[str] = []
    for item in artifacts:
        raw = item.get("path") if isinstance(item, dict) else None
        rel = _safe_rel_path(str(raw or ""))
        if rel is None:
            error_exit(f"产物路径非法或越权: {raw!r}")
            return  # error_exit 已 sys.exit，此处仅为类型收窄
        rel_paths.append(rel)
    # 去重保序。
    seen: set[str] = set()
    rel_paths = [p for p in rel_paths if not (p in seen or seen.add(p))]

    if list_only:
        if not base_url:
            error_exit("产物列表缺少 data.url")
        html = [p for p in rel_paths if p.lower().endswith((".html", ".htm"))]
        entry_html = _pick_entry_html(rel_paths)
        if not entry_html:
            error_exit("产物清单中未找到入口 HTML")
        listed: dict[str, object] = {
            "source": source,
            "url": base_url,
            "files": rel_paths,
            "html": html,
            "entry_html": entry_html,
        }
        listed_version = data.get("version")
        if listed_version is not None and not isinstance(listed_version, bool):
            try:
                listed["version"] = int(listed_version)
            except (TypeError, ValueError):
                pass
        safe_print(
            "KS_ARTIFACTS_LIST "
            + json.dumps(listed, ensure_ascii=False, separators=(",", ":"))
        )
        return

    requested_raw = args.paths or []
    selective = bool(requested_raw)
    if selective:
        requested: list[str] = []
        seen_req: set[str] = set()
        for raw in requested_raw:
            rel = _safe_rel_path(str(raw or ""))
            if rel is None:
                error_exit(f"path 缺失或非法: {raw!r}")
            if rel in seen_req:
                continue
            seen_req.add(rel)
            requested.append(rel)
        unknown = [p for p in requested if p not in rel_paths]
        if unknown:
            error_exit(f"产物清单中不存在: {unknown[:5]}")
        rel_paths = requested

    entry_html = _pick_entry_html(rel_paths)
    if not selective and not entry_html:
        error_exit("产物清单中未找到入口 HTML")

    # ---- Step 2: 准备工作目录 ----
    out_dir_arg = (args.out_dir or "").strip()
    if out_dir_arg:
        out_dir = Path(_normalize_msys_path(out_dir_arg)).expanduser().resolve()
        out_dir.mkdir(parents=True, exist_ok=True)
    else:
        out_dir = Path(
            tempfile.mkdtemp(prefix=f"mindx-clone-{node_id[:12]}-")
        ).resolve()

    try:
        concurrency = max(1, min(8, int(args.concurrency)))
    except ValueError:
        concurrency = DEFAULT_CONCURRENCY

    # ---- Step 3: 并行下载 ----
    errors: list[str] = []
    with ThreadPoolExecutor(max_workers=concurrency) as pool:
        futures = {
            pool.submit(_download_one, base_url, rel, out_dir): rel
            for rel in rel_paths
        }
        for fut in as_completed(futures):
            try:
                fut.result()
            except HttpError as e:
                errors.append(str(e))
    if errors:
        error_exit("; ".join(errors[:5]))

    # ---- Step 4: 完整性校验 ----
    downloaded = []
    for rel in rel_paths:
        if (out_dir / rel).is_file():
            downloaded.append(rel)
    if len(downloaded) != len(rel_paths):
        missing = sorted(set(rel_paths) - set(downloaded))
        error_exit(f"产物下载不完整，缺失: {missing[:5]}")
    if entry_html and not (out_dir / entry_html).is_file():
        error_exit("入口 HTML 下载缺失")

    output = {
        "work_dir": str(out_dir),
        "entry_html": entry_html,
        "files": downloaded,
    }
    safe_print(
        "KS_ARTIFACTS_OK "
        + json.dumps(output, ensure_ascii=False, separators=(",", ":"))
    )


if __name__ == "__main__":
    main()
