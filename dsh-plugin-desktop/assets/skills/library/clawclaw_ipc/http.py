# -*- coding: utf-8 -*-
from __future__ import annotations

import base64
import binascii
import json
import urllib.parse
from typing import Any, Dict, List, Mapping, Optional, Tuple

from . import (
    ConsentRequired,
    EndpointUntrusted,
    NotClawClawEnv,
    ClawClawIpcError,
    connect,
)

_PIPE = "clawclaw.request"
_METHOD = "http.fetch"
_CODE_MAP = {
    "E_TIMEOUT": "TEMPORARY_ERROR",
    "E_REVOKED": "TEMPORARY_ERROR",
    "E_INTERNAL": "TEMPORARY_ERROR",
    "E_UPSTREAM": "TEMPORARY_ERROR",
    "E_BUSY": "TEMPORARY_ERROR",
    "E_CANCELLED": "TEMPORARY_ERROR",
    "E_BAD_REQUEST": "INVALID_PARAMS",
    "E_NOT_CONNECTED": "AUTH_REQUIRED",
    "E_POLICY_DENIED": "AUTH_REQUIRED",
}

_client: Any = None
_pipe: Any = None
_ipc_method: str = ""
_failure: Any = None


def _http():
    from _common import HttpError, HttpResponse, decode_http_payload, extract_traceid
    return HttpError, HttpResponse, decode_http_payload, extract_traceid


def _header_value(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        value = next((item for item in value if item is not None), None)
    return "" if value is None else str(value).strip()


def _close(client: Any) -> None:
    try:
        client.close()
    except Exception:
        pass


def _map_error(err: Any):
    HttpError, _, _, _ = _http()
    data = getattr(err, "data", None)
    data = data if isinstance(data, Mapping) else {}
    hint = _header_value(data.get("hint"))
    return HttpError(
        "clawclaw_ipc request rejected",
        error_code=_CODE_MAP.get(getattr(err, "code", ""), getattr(err, "code", "E_INTERNAL")),
        backend_message=hint or getattr(err, "message", ""),
        traceid=_header_value(data.get("traceid", data.get("traceId"))) or None,
    )


def _open() -> Tuple[Any, str, Any]:
    HttpError, _, _, _ = _http()
    try:
        client = connect(client_id="library-skills", client_kind="skill")
    except NotClawClawEnv as e:
        raise HttpError(
            "not running inside clawclaw", error_code="E_NOT_CLAWCLAW",
            backend_message="未连接到 ClawClaw 客户端宿主通道；请在客户端内运行并确认已登录",
        ) from e
    except EndpointUntrusted as e:
        raise HttpError(
            "clawclaw_ipc endpoint untrusted", error_code="E_ENDPOINT_UNTRUSTED",
            backend_message="宿主 IPC 端点无法自证身份（可能被抢占），已中止请求",
        ) from e
    except ConsentRequired as e:
        raise HttpError(
            "clawclaw_ipc consent required", error_code="E_CONSENT_REQUIRED",
            backend_message="请在 ClawClaw 客户端完成授权后重试",
        ) from e
    except ClawClawIpcError as e:
        raise _map_error(e) from e
    except Exception as e:
        raise HttpError("clawclaw_ipc connect failed", error_code="TEMPORARY_ERROR") from e

    try:
        if _PIPE not in (getattr(client, "pipes", None) or []):
            raise HttpError(
                "clawclaw_ipc pipe unavailable", error_code="AUTH_REQUIRED",
                backend_message=f"宿主未开放 {_PIPE} 通道；请确认已在 ClawClaw 客户端登录并授权",
            )
        pipe = client.get_pipe(_PIPE)
        if _METHOD not in (getattr(pipe, "methods", None) or []):
            raise HttpError(
                "clawclaw_ipc forward method unavailable", error_code="E_METHOD_UNKNOWN",
                backend_message=f"{_PIPE} 未提供 {_METHOD} 方法；请升级 ClawClaw 客户端",
            )
    except HttpError:
        _close(client)
        raise
    except ConsentRequired as e:
        _close(client)
        raise HttpError(
            "clawclaw_ipc consent required", error_code="E_CONSENT_REQUIRED",
            backend_message="请在 ClawClaw 客户端完成授权后重试",
        ) from e
    except ClawClawIpcError as e:
        _close(client)
        raise _map_error(e) from e
    except Exception as e:
        _close(client)
        raise HttpError("clawclaw_ipc bind pipe failed", error_code="TEMPORARY_ERROR") from e
    return pipe, _METHOD, client


def _channel() -> Tuple[Any, str]:
    global _client, _pipe, _ipc_method, _failure
    HttpError, _, _, _ = _http()
    if _pipe is not None:
        return _pipe, _ipc_method
    if _failure is not None:
        raise _failure
    try:
        pipe, method, client = _open()
    except HttpError as e:
        _failure = e
        raise
    _client, _pipe, _ipc_method = client, pipe, method
    return pipe, method


def _headers(extra_headers: Optional[Mapping[str, str]], has_body: bool) -> Dict[str, str]:
    headers: Dict[str, str] = {"accept": "*/*"}
    if has_body:
        headers["content-type"] = "application/json"
    for k, v in (extra_headers or {}).items():
        if k and v is not None:
            headers[str(k).strip().lower()] = str(v)
    return headers


def _query(url_query: str, params: Optional[Mapping[str, Any]]) -> Dict[str, str]:
    HttpError, _, _, _ = _http()
    out: Dict[str, str] = {}
    pairs: List[Tuple[Any, Any]] = []
    if url_query:
        pairs.extend(urllib.parse.parse_qsl(url_query, keep_blank_values=True))
    pairs.extend((k, v) for k, v in (params or {}).items() if v is not None)
    for key, value in pairs:
        if isinstance(value, (list, tuple, set, dict)):
            raise HttpError(
                "query value must be scalar", error_code="INVALID_PARAMS",
                backend_message="宿主通道的 query 不支持多值参数")
        name = str(key)
        if name in out:
            raise HttpError("duplicate query key", error_code="INVALID_PARAMS")
        out[name] = str(value)
    return out


def _decode_body(b64: Any, traceid: Optional[str]) -> Any:
    HttpError, _, _, _ = _http()
    if not b64:
        return {}
    try:
        return json.loads(base64.b64decode(b64, validate=True).decode("utf-8"))
    except (TypeError, binascii.Error, ValueError, UnicodeDecodeError) as e:
        raise HttpError("json parse failed", error_code="INVALID_RESPONSE",
                        traceid=traceid) from e


def http_request(
    method: str, url: str, *,
    params: Optional[Mapping[str, Any]] = None,
    body: Optional[Mapping[str, Any]] = None,
    timeout: float = 30.0,
    extra_headers: Optional[Mapping[str, str]] = None,
):
    HttpError, _, decode_http_payload, extract_traceid = _http()
    pipe, ipc_method = _channel()

    parts = urllib.parse.urlsplit(url)
    request: Dict[str, Any] = {
        "method": method.upper(),
        "path": parts.path or "/",
        "headers": _headers(extra_headers, body is not None),
    }
    query = _query(parts.query, params)
    if query:
        request["query"] = query
    if body is not None:
        try:
            raw = json.dumps(body, ensure_ascii=False).encode("utf-8")
        except (TypeError, ValueError) as e:
            raise HttpError("invalid body", error_code="INVALID_PARAMS") from e
        request["body_b64"] = base64.b64encode(raw).decode("ascii")

    try:
        result = pipe.invoke(ipc_method, request, timeout=float(timeout) + 5.0)
    except ClawClawIpcError as e:
        raise _map_error(e) from e
    except Exception as e:
        raise HttpError("clawclaw_ipc request failed", error_code="TEMPORARY_ERROR") from e

    if not isinstance(result, Mapping) or "body_b64" not in result:
        raise HttpError("invalid clawclaw_ipc result", error_code="INVALID_RESPONSE")
    try:
        status = int(result.get("status"))
    except (TypeError, ValueError) as e:
        raise HttpError("invalid clawclaw_ipc status", error_code="INVALID_RESPONSE") from e
    traceid = extract_traceid(result.get("headers"))
    payload = _decode_body(result.get("body_b64"), traceid)
    return decode_http_payload(payload, status=status, traceid=traceid)
