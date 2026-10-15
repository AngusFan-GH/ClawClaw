#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""ClawClaw 资料库文档识别与 MCP token 获取。

普通 SaaS 鉴权不在本模块内处理。资料库文档链路为：
- 从 `/space/d/<node_id>` 链接提取资料库 node ID；
- 调用资料库 get-drive-token 接口获取 MCP accessToken 和第三方 fileId；
- 文档 MCP 服务已支持自动将该第三方 fileId 转换为内部 file_id，第三方 fileId 可直接
  作为目标工具的 `file_id` 参数使用，无需再调用 `manage.resolve_third_file_id`；
- ClawClaw 沙箱经 SpaceEngine auth-proxy 请求资料库接口；
- ClawClaw 客户端经 CLAWCLAW_IPC `clawclaw.request/http.fetch` 请求资料库接口。
"""

import base64
import binascii
import json
import os
import re
import urllib.error
import urllib.parse
import urllib.request

DOCUMENT_HOSTS = frozenset({"www.clawclaw.cn", "staging.clawclaw.cn"})
_DOCUMENT_URL_KEYS = frozenset({"document_url", "doc_url", "file_url", "url"})
_NODE_ID_RE = re.compile(r"^[A-Za-z0-9_-]{1,256}$")
_DRIVE_TOKEN_API_PATH = "/space/api/agent/v1/get-drive-token"
_SANDBOX_BASE = "http://spaceengine.agent-gateway.auth-proxy.local"
_SANDBOX_PATH_PREFIX = "/_internal/spaceengine"
_SANDBOX_ENV_KEY = "X_IDE_IS_CLOUDSTUDIO"
_TRUE_VALUES = frozenset({"1", "true", "yes", "y", "on", "enabled"})
_CLAWCLAW_IPC_PIPE = "clawclaw.request"
_CLAWCLAW_IPC_METHOD = "http.fetch"
_OK_CODES = frozenset({0, "0", "OK", "ok"})
_clawclaw_ipc_client = None
_clawclaw_ipc_pipe = None

# X-App-Id 由两个维度共同确定：
#   1. get-drive-token 响应 data.edition：网盘 C 端 "toc" / SaaS 端 "tob"；
#   2. 资料库文档链接域名：区分生产 / 测试环境。
_PROD_DOCUMENT_HOST = "www.clawclaw.cn"
_TEST_DOCUMENT_HOST = "staging.clawclaw.cn"
EDITION_TOC = "toc"
EDITION_TOB = "tob"
_VALID_EDITIONS = frozenset({EDITION_TOC, EDITION_TOB})
_DRIVE_APP_ID_TABLE = {
    EDITION_TOC: {
        _TEST_DOCUMENT_HOST: "4aeacfde-821d-49df-898f-8ed1c49a42d9",
        _PROD_DOCUMENT_HOST: "f419a0b1-ffbf-4ba8-8c2e-98035c82688c",
    },
    EDITION_TOB: {
        _TEST_DOCUMENT_HOST: "e033a430-24b1-4bfa-b429-4e66d7b48e26",
        _PROD_DOCUMENT_HOST: "a08c9e6f-0521-41f5-a364-a3c323c5024a",
    },
}


class TokenError(Exception):
    """资料库 MCP token 获取失败。"""


class FileIDResolveError(Exception):
    """资料库文档链接格式解析失败（非允许域名或路径格式不符）。"""


def is_sandbox():
    """当前是否运行在 ClawClaw 沙箱内。"""
    return os.environ.get(_SANDBOX_ENV_KEY, "").strip().lower() in _TRUE_VALUES


def is_document_url(value):
    """判断链接是否来自允许的 ClawClaw 资料库域名。"""
    if not isinstance(value, str):
        return False
    try:
        parts = urllib.parse.urlsplit(value.strip())
    except ValueError:
        return False
    hostname = (parts.hostname or "").lower().rstrip(".")
    return parts.scheme.lower() == "https" and hostname in DOCUMENT_HOSTS


def get_drive_app_id(document_url, edition):
    """按资料库文档链接域名（生产/测试）与 get-drive-token 返回的 data.edition
    （网盘 C 端 toc / SaaS 端 tob）共同确定对应环境的 X-App-Id。document_url 必须
    先通过 is_document_url 校验，edition 取自 load_drive_token 的返回值。
    """
    if edition not in _VALID_EDITIONS:
        raise FileIDResolveError(
            "library_file_id_invalid_edition - get-drive-token 返回的 data.edition 不合法")
    parts = urllib.parse.urlsplit(document_url.strip())
    hostname = (parts.hostname or "").lower().rstrip(".")
    app_id = _DRIVE_APP_ID_TABLE.get(edition, {}).get(hostname)
    if not app_id:
        raise FileIDResolveError(
            "library_file_id_invalid_url - 无法识别资料库链接所属环境（生产/测试）")
    return app_id


def is_space_document_url(value):
    """判断链接是否为 `/space/d/<node_id>` 格式的资料库文档链接。"""
    try:
        extract_node_id(value)
        return True
    except FileIDResolveError:
        return False


def extract_node_id(document_url):
    """从资料库文档链接最后一个路径段提取并校验 node ID。"""
    if not is_document_url(document_url):
        raise FileIDResolveError("library_file_id_invalid_url - 不是允许的资料库 HTTPS 域名")
    parts = urllib.parse.urlsplit(document_url.strip())
    segments = [urllib.parse.unquote(segment) for segment in parts.path.split("/") if segment]
    if len(segments) != 3 or segments[:2] != ["space", "d"]:
        raise FileIDResolveError(
            "library_file_id_invalid_url - 资料库文档链接必须为 /space/d/<node_id> 格式")
    node_id = segments[-1]
    if not _NODE_ID_RE.fullmatch(node_id):
        raise FileIDResolveError("library_file_id_invalid_node - 资料库 node ID 格式非法")
    return node_id


def find_document_url(value):
    """递归查找 MCP 参数中明确的目标文档链接字段。"""
    if is_space_document_url(value):
        return value.strip()
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() in _DOCUMENT_URL_KEYS and is_space_document_url(item):
                return item.strip()
            if isinstance(item, (dict, list, tuple)):
                found = find_document_url(item)
                if found:
                    return found
    if isinstance(value, (list, tuple)):
        for item in value:
            if isinstance(item, (dict, list, tuple)):
                found = find_document_url(item)
                if found:
                    return found
    return ""


def load_drive_token(document_url, no_proxy=False, timeout=10, debug=None):
    """调用资料库接口获取 MCP access token、有效期、第三方 file ID 和 edition
    （网盘 C 端 toc / SaaS 端 tob，用于配合域名确定 X-App-Id）。
    """
    node_id = extract_node_id(document_url)
    if debug:
        mode = "sandbox" if is_sandbox() else "clawclaw_ipc"
        debug(f"request library drive token via {mode}")
    # 与参考实现 http_request(method, path, ...) 用法一致：调用方只传裸
    # path，沙箱前缀的拼接完全交给 _http_request 内部处理。
    payload = _http_request("POST", _DRIVE_TOKEN_API_PATH,
                            body={"nodeId": node_id}, timeout=timeout, no_proxy=no_proxy)
    return _parse_drive_token(payload)


def _http_request(method, path, body=None, timeout=10, no_proxy=False):
    """按运行模式转发一次 HTTP 请求，对应参考实现 http_request 的分发逻辑。

    调用方只传裸 path；客户端模式下直接把 path 转发给宿主（host 由宿主
    决定），沙箱模式下才在此处内联拼接 agent-gateway 内部前缀。
    """
    if not path.startswith("/"):
        path = "/" + path
    if not is_sandbox():
        return _clawclaw_ipc_request(method, path, body, timeout)
    url = _SANDBOX_BASE + _SANDBOX_PATH_PREFIX + path
    return _sandbox_request(method, url, body, no_proxy, timeout)


def _decode_json_body(raw):
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise TokenError("library_token_invalid_response - JSON 解析失败") from e
    if not isinstance(payload, dict):
        raise TokenError("library_token_invalid_response - 响应不是 JSON 对象")
    return payload


def _check_biz_code(payload):
    """校验响应顶层业务码，语义与参考实现 http_request 内部检查一致。

    只有存在 code/retcode 且不在 _OK_CODES 中才视为失败；缺省该字段视为成功。
    检查发生在传输层返回前，只看顶层 code/retcode，不涉及 data 内部字段，
    与字段级校验（_parse_drive_token 从 payload["data"] 里取值）分层。
    """
    code = payload.get("code", payload.get("retcode"))
    if code is not None and code not in _OK_CODES:
        message = payload.get("msg", payload.get("message", ""))
        detail = f" - {message}" if isinstance(message, str) and message.strip() else ""
        raise TokenError(f"library_token_rejected - code={code}{detail}")


def _parse_drive_token(payload):
    data = payload.get("data")
    if not isinstance(data, dict):
        raise TokenError("library_token_invalid_response - 响应缺少 data 字段")
    access_token = data.get("accessToken")
    third_file_id = data.get("fileId")
    expires_in = data.get("expiresIn")
    edition = data.get("edition")
    if not isinstance(access_token, str) or not access_token.strip():
        raise TokenError("library_token_invalid_response - 响应缺少 data.accessToken")
    if not isinstance(third_file_id, str) or not third_file_id.strip():
        raise TokenError("library_token_invalid_response - 响应缺少 data.fileId")
    if not isinstance(expires_in, int) or isinstance(expires_in, bool) or expires_in <= 0:
        raise TokenError("library_token_invalid_response - data.expiresIn 必须为正整数")
    if edition not in _VALID_EDITIONS:
        raise TokenError("library_token_invalid_response - data.edition 必须为 toc 或 tob")
    return {
        "access_token": access_token.strip(),
        "expires_in": expires_in,
        "third_file_id": third_file_id.strip(),
        "edition": edition,
    }


def _clawclaw_ipc_channel():
    """获取 ClawClaw 客户端的 HTTP 转发通道。

    clawclaw_ipc 是随插件 vendor 的同目录纯标准库模块（skill 脚本可能在
    离线环境跑，不假设宿主预装），实际连接失败（未在 ClawClaw 客户端内
    运行、未登录等）由 connect() 抛出对应异常。异常类型对齐 vendor 源码，
    分别转换为可诊断的 library_token_clawclaw_ipc_* 错误，不合并成一种错误。
    """
    global _clawclaw_ipc_client, _clawclaw_ipc_pipe
    if _clawclaw_ipc_pipe is not None:
        return _clawclaw_ipc_pipe
    try:
        from clawclaw_ipc import (  # type: ignore
            ConsentRequired, EndpointUntrusted, NotClawClawEnv, ClawClawIpcError, connect,
        )
    except ImportError as e:
        raise TokenError(
            "library_token_clawclaw_ipc_unavailable - 未找到 clawclaw_ipc vendor 模块，"
            "请确认插件目录完整（缺少 skills/tencent-saas-docs/clawclaw_ipc/）") from e
    try:
        client = connect(client_id="library-skills", client_kind="skill")
    except NotClawClawEnv as e:
        raise TokenError(
            "library_token_clawclaw_ipc_not_clawclaw - 未连接到 ClawClaw 客户端宿主通道，"
            "请在客户端内运行并确认已登录") from e
    except EndpointUntrusted as e:
        raise TokenError(
            "library_token_clawclaw_ipc_untrusted - 宿主 IPC 端点无法自证身份，已中止请求") from e
    except ConsentRequired as e:
        raise TokenError(
            "library_token_clawclaw_ipc_consent_required - 请在 ClawClaw 客户端完成授权后重试") from e
    except ClawClawIpcError as e:
        raise TokenError(f"library_token_clawclaw_ipc_failed - {e}") from e
    except Exception as e:  # noqa: BLE001
        raise TokenError("library_token_clawclaw_ipc_failed - 宿主通道连接失败") from e
    try:
        if _CLAWCLAW_IPC_PIPE not in (getattr(client, "pipes", None) or []):
            raise TokenError(
                f"library_token_clawclaw_ipc_unavailable - 宿主未开放 {_CLAWCLAW_IPC_PIPE} 通道，"
                "请确认已在 ClawClaw 客户端登录并授权")
        pipe = client.get_pipe(_CLAWCLAW_IPC_PIPE)
        if _CLAWCLAW_IPC_METHOD not in (getattr(pipe, "methods", None) or []):
            raise TokenError(
                f"library_token_clawclaw_ipc_unavailable - {_CLAWCLAW_IPC_PIPE} 未提供 "
                f"{_CLAWCLAW_IPC_METHOD} 方法，请升级 ClawClaw 客户端")
    except TokenError:
        raise
    except Exception as e:  # noqa: BLE001
        raise TokenError("library_token_clawclaw_ipc_failed - 宿主通道连接失败") from e
    _clawclaw_ipc_client, _clawclaw_ipc_pipe = client, pipe
    return pipe


def _clawclaw_ipc_request(method, url, body, timeout):
    """客户端 SDK 环境通过 CLAWCLAW_IPC 宿主通道请求；只转发 path，host 与身份由宿主裁决。"""
    path = urllib.parse.urlsplit(url).path or "/"
    headers = {"accept": "application/json"}
    request = {"method": method, "path": path, "headers": headers}
    if body is not None:
        headers["content-type"] = "application/json"
        request["body_b64"] = base64.b64encode(
            json.dumps(body, ensure_ascii=False).encode("utf-8")).decode("ascii")
    try:
        result = _clawclaw_ipc_channel().invoke(
            _CLAWCLAW_IPC_METHOD, request, timeout=float(timeout) + 5.0)
    except TokenError:
        raise
    except Exception as e:  # noqa: BLE001
        raise TokenError("library_token_clawclaw_ipc_failed - 宿主请求失败") from e
    if not isinstance(result, dict) or "body_b64" not in result:
        raise TokenError("library_token_invalid_response - CLAWCLAW_IPC 响应格式错误")
    try:
        status = int(result.get("status"))
    except (TypeError, ValueError) as e:
        raise TokenError("library_token_invalid_response - CLAWCLAW_IPC 状态码错误") from e
    if not 200 <= status < 300:
        raise TokenError(f"library_token_http_failed - HTTP {status}")
    try:
        raw = base64.b64decode(result.get("body_b64") or "", validate=True)
    except (TypeError, binascii.Error, ValueError) as e:
        raise TokenError("library_token_invalid_response - CLAWCLAW_IPC 响应体错误") from e
    payload = _decode_json_body(raw)
    _check_biz_code(payload)
    return payload


def _build_opener(no_proxy):
    if no_proxy:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener()


def _sandbox_request(method, url, body, no_proxy, timeout):
    """沙箱环境通过 agent-gateway auth-proxy 直连请求，url 由调用方拼好后传入。"""
    headers = {"Accept": "application/json", "User-Agent": "ClawClaw Plugin"}
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    req = urllib.request.Request(url, data=data, headers=headers, method=method)
    try:
        with _build_opener(no_proxy).open(req, timeout=timeout) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read()
    except urllib.error.HTTPError as e:
        raise TokenError(f"library_token_http_failed - HTTP {e.code}") from e
    except (urllib.error.URLError, OSError) as e:
        raise TokenError("library_token_http_failed - 网络请求失败") from e
    if not 200 <= status < 300:
        raise TokenError(f"library_token_http_failed - HTTP {status}")
    payload = _decode_json_body(raw)
    _check_biz_code(payload)
    return payload
