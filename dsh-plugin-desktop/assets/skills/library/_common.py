# -*- coding: utf-8 -*-

from __future__ import annotations

import json
import os
import re
import sys
import urllib.error
import urllib.parse
from typing import Any, Dict, Mapping, Optional, Tuple

_SANDBOX_ENV_KEY = "X_IDE_IS_CLOUDSTUDIO"
_WB_CONFIG_DIR_ENV = "CLAWCLAW_CONFIG_DIR"
_TRUE_VALUES = frozenset({"1", "true", "yes", "y", "on", "enabled"})
_SANDBOX_BASE = "http://spaceengine.agent-gateway.auth-proxy.local"
_SANDBOX_PATH_PREFIX = "/_internal/spaceengine"
_OK_CODES: Tuple[Any, ...] = (0, "0", "OK", "ok")
_TRACEID_HEADERS: Tuple[str, ...] = ("traceid", "x-request-id")

USER_AGENT = f"library-skills/{os.environ.get('KS_SKILL_VERSION', '0.1.0')}"


def is_sandbox() -> bool:
    return os.environ.get(_SANDBOX_ENV_KEY, "").strip().lower() in _TRUE_VALUES


def is_clawclaw() -> bool:
    return bool(os.environ.get(_WB_CONFIG_DIR_ENV, "").strip())


def redact(text: Any) -> str:
    """输出前的统一归一化出口。"""
    try:
        return text if isinstance(text, str) else str(text)
    except Exception:
        return "[REDACTED]"


def _safe_auth_url(value: Any) -> Optional[str]:
    if value is None:
        return None
    text = str(value).strip()
    if not text.startswith("https://") or any(ch in text for ch in " \t\r\n"):
        return None
    return text[:2048]


class HttpError(Exception):
    """HTTP / 业务层错误。"""

    def __init__(self, message: str, *, error_code: Any = "UNKNOWN",
                 backend_message: Any = "", traceid: Optional[str] = None,
                 auth_url: Any = None) -> None:
        super().__init__(message)
        self.error_code = _safe_error_code(error_code)
        self.backend_message = _safe_backend_message(backend_message)
        self.traceid = traceid
        self.auth_url = _safe_auth_url(auth_url)

    def __str__(self) -> str:
        parts = [f"code={self.error_code}"]
        if self.backend_message:
            parts.append(f"msg={self.backend_message}")
        if self.auth_url:
            parts.append(f"auth_url={self.auth_url}")
        return "; ".join(parts)


class HttpResponse(dict):
    """JSON 响应体 dict，附带 traceid。"""

    def __init__(self, payload: Mapping[str, Any], *, traceid: Optional[str] = None) -> None:
        super().__init__(payload)
        self.traceid = traceid


def _header_value(value: Any) -> str:
    if isinstance(value, (list, tuple)):
        value = next((item for item in value if item is not None), None)
    return "" if value is None else str(value).strip()


def extract_traceid(headers: Any) -> Optional[str]:
    if not headers:
        return None
    try:
        items = [(str(k).lower(), v) for k, v in headers.items()]
    except Exception:
        return None
    for name in _TRACEID_HEADERS:
        for key, value in items:
            if key == name:
                val = _header_value(value)
                if val:
                    return val
    return None


def _safe_error_code(value: Any) -> str:
    text = str(value if value is not None else "UNKNOWN").strip()
    if not text or len(text) > 64:
        return "UNKNOWN"
    if not all(ch.isalnum() or ch in "_.-" for ch in text):
        return "UNKNOWN"
    return text


def _safe_backend_message(value: Any) -> str:
    if value is None:
        return ""
    text = redact(value).strip()
    if not text:
        return ""
    if "Traceback (most recent call last)" in text or "goroutine " in text:
        return "[INTERNAL_DETAIL_REDACTED]"
    text = re.sub(r"https?://\S+", "[URL_REDACTED]", text, flags=re.I)
    text = re.sub(
        r"(?i)(?:bearer\s+|(?:token|cookie)\s*[:=]\s*|authorization\s*[:=]\s*(?:bearer\s+)?|x-skill-token\s*[:=]\s*)\S+",
        "[CREDENTIAL_REDACTED]", text)
    text = re.sub(r"(?i)\b(?:request_?id|trace_?id)\s*[:=]\s*\S+", "[ID_REDACTED]", text)
    text = re.sub(r"(?i)\b(?:request|body|payload)\s*[:=].*$", "[REQUEST_BODY_REDACTED]", text)
    text = re.sub(r"\{.*\}", "[REQUEST_BODY_REDACTED]", text, flags=re.S)
    text = re.sub(r"(?:/Users|/home|/var|[A-Za-z]:\\)\S+", "[PATH_REDACTED]", text)
    return " ".join(text.split())[:256]


def decode_http_payload(payload: Any, *, status: int = 200,
                        traceid: Optional[str] = None) -> HttpResponse:
    if not (200 <= int(status) < 300):
        code: Any = f"HTTP_{status}"
        msg = ""
        if isinstance(payload, Mapping):
            biz = payload.get("code", payload.get("retcode"))
            if biz is not None and biz not in _OK_CODES:
                code = biz
            msg = payload.get("msg", payload.get("message", ""))
        raise HttpError("http request rejected", error_code=code,
                        backend_message=msg, traceid=traceid)
    if not isinstance(payload, Mapping):
        raise HttpError("json payload is not object", error_code="INVALID_RESPONSE",
                        traceid=traceid)
    response = HttpResponse(payload, traceid=traceid)
    biz_code = response.get("code", response.get("retcode"))
    if biz_code is not None and biz_code not in _OK_CODES:
        raise HttpError("business request rejected", error_code=biz_code,
                        backend_message=response.get("msg", response.get("message", "")),
                        traceid=traceid)
    return response


def _read_http_error_meta(error: urllib.error.HTTPError) -> Tuple[Any, str]:
    try:
        payload = json.loads(error.read(65537).decode("utf-8"))
    except Exception:
        return f"HTTP_{error.code}", ""
    if not isinstance(payload, Mapping):
        return f"HTTP_{error.code}", ""
    code = payload.get("code", payload.get("retcode"))
    msg = payload.get("msg", payload.get("message", ""))
    if code in (None, 0, "0", "OK", "ok"):
        code = f"HTTP_{error.code}"
    return code, _safe_backend_message(msg)


def _do_http_request(
    method: str, url: str, *,
    params: Optional[Mapping[str, Any]] = None,
    body: Optional[Mapping[str, Any]] = None,
    timeout: float = 30.0,
    extra_headers: Optional[Mapping[str, str]] = None,
) -> HttpResponse:
    import ssl
    import urllib.error
    import urllib.request

    if not url:
        raise HttpError("missing url", error_code="INVALID_PARAMS")

    full_url = url
    if params:
        qs = urllib.parse.urlencode(
            {k: v for k, v in params.items() if v is not None}, doseq=True)
        if qs:
            full_url = f"{full_url}{'&' if '?' in full_url else '?'}{qs}"

    headers: Dict[str, str] = {
        "Accept": "*/*", "Accept-Language": "zh-CN", "User-Agent": USER_AGENT,
    }
    data: Optional[bytes] = None
    if body is not None:
        headers["Content-Type"] = "application/json"
        try:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
        except (TypeError, ValueError) as e:
            raise HttpError("invalid body", error_code="INVALID_PARAMS") from e
    if extra_headers:
        for k, v in extra_headers.items():
            if k and v is not None:
                headers[str(k)] = str(v)

    req = urllib.request.Request(full_url, data=data, method=method.upper(), headers=headers)
    ctx = (ssl._create_unverified_context() if os.environ.get("KS_SSL_INSECURE") == "1"
           else ssl.create_default_context())

    traceid: Optional[str] = None
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=ctx) as resp:
            status = getattr(resp, "status", 200)
            resp_headers = getattr(resp, "headers", None)
            if not resp_headers:
                try:
                    resp_headers = resp.info()
                except Exception:
                    resp_headers = None
            traceid = extract_traceid(resp_headers)
            raw = resp.read()
    except urllib.error.HTTPError as e:
        traceid = extract_traceid(getattr(e, "headers", None))
        ec, msg = _read_http_error_meta(e)
        raise HttpError("http request rejected", error_code=ec,
                        backend_message=msg, traceid=traceid) from e
    except urllib.error.URLError as e:
        raise HttpError("network error", error_code="NETWORK_ERROR") from e
    except Exception as e:
        raise HttpError("request failed", error_code="TEMPORARY_ERROR", traceid=traceid) from e

    if not (200 <= status < 300):
        raise HttpError("http request rejected", error_code=f"HTTP_{status}", traceid=traceid)

    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError) as e:
        raise HttpError("json parse failed", error_code="INVALID_RESPONSE", traceid=traceid) from e
    return decode_http_payload(payload, status=status, traceid=traceid)


def http_request(
    method: str, path: str, *,
    params: Optional[Mapping[str, Any]] = None,
    body: Optional[Mapping[str, Any]] = None,
    timeout: float = 30.0,
    extra_headers: Optional[Mapping[str, str]] = None,
) -> Dict[str, Any]:
    if not path.startswith("/"):
        path = "/" + path
    kwargs = dict(params=params, body=body, timeout=timeout, extra_headers=extra_headers)

    if is_sandbox():
        return _do_http_request(method, _SANDBOX_BASE + _SANDBOX_PATH_PREFIX + path, **kwargs)

    if is_clawclaw():
        try:
            from clawclaw_ipc import http_request as send  # type: ignore
        except ImportError as e:
            raise HttpError(
                "clawclaw_ipc unavailable", error_code="E_NOT_CLAWCLAW",
                backend_message="缺少 clawclaw_ipc 模块，无法接入宿主通道；请在 ClawClaw 客户端内运行",
            ) from e
        return send(method, path, **kwargs)

    # 非 ClawClaw 客户端、非沙箱：内网 OA 默认走太湖鉴权。
    try:
        from taihu import http_request as send  # type: ignore
    except ImportError as e:
        raise HttpError(
            "taihu unavailable", error_code="E_TAIHU_UNAVAILABLE",
            backend_message="缺少 taihu 模块，无法走太湖鉴权",
        ) from e
    return send(method, path, **kwargs)


def unwrap_data(envelope: Mapping[str, Any]) -> Dict[str, Any]:
    """从 {code, msg, data} 信封中取出 data；非成功抛 HttpError。"""
    traceid = getattr(envelope, "traceid", None)
    if not isinstance(envelope, Mapping):
        raise HttpError("invalid envelope", error_code="INVALID_RESPONSE", traceid=traceid)
    code = envelope.get("code", envelope.get("retcode"))
    if code not in _OK_CODES:
        raise HttpError("business request rejected", error_code=code,
                        backend_message=envelope.get("msg", envelope.get("message", "")),
                        traceid=traceid)
    data = envelope.get("data") or envelope.get("result", {}) or {}
    if not isinstance(data, Mapping):
        raise HttpError("data is not object", error_code="INVALID_RESPONSE", traceid=traceid)
    return dict(data)


def safe_print(line: str) -> None:
    """stdout 唯一出口；自动 redact。"""
    try:
        sys.stdout.write(redact(line))
        if not line.endswith("\n"):
            sys.stdout.write("\n")
    except Exception:
        pass


def emit_user_reply(reply: str) -> None:
    """输出脚本产出的最终用户回执，供上层原样透传。"""
    safe_print(f"KS_USER_REPLY\t{reply}")


def build_review_submit_user_reply(affected_count: int, anchor_url: str) -> str:
    """构造审阅式编辑成功回执；有锚点时必须返回完整 anchor URL。"""
    n = max(int(affected_count), 0)
    if anchor_url:
        return f"已生成 {n} 处修订建议，需在审阅栏接受后才会落入正文，点击查看并接受/拒绝：{anchor_url}"
    return f"已生成 {n} 处修订建议，需在审阅栏接受后才会落入正文；请在文档右侧审阅栏逐条查看并接受/拒绝。"


def build_direct_edit_user_reply(affected_count: int, anchor_url: str) -> str:
    """构造直接编辑成功回执；有锚点时必须返回完整 anchor URL。"""
    n = max(int(affected_count), 0)
    if anchor_url:
        return f"已完成 {n} 处直接编辑，已即时落入正文，无需审阅；点击查看：{anchor_url}"
    return f"已完成 {n} 处直接编辑，已即时落入正文，无需审阅；请在文档中查看。"


_AUTH_URL_RE = re.compile(r"auth_url=(https://[^\s;]+)")


def error_exit(message: str, code: int = 0, traceid: Optional[str] = None,
               auth_url: Optional[str] = None) -> "None":
    """输出结构化错误 JSON 后退出。"""
    payload: Dict[str, str] = {"error": redact(message)}
    if traceid:
        payload["traceid"] = redact(traceid)
    url = _safe_auth_url(auth_url)
    if not url:
        match = _AUTH_URL_RE.search(str(message))
        if match:
            url = _safe_auth_url(match.group(1))
    if url:
        payload["auth_url"] = url
    safe_print(json.dumps(payload, ensure_ascii=False))
    try:
        sys.stdout.flush()
    except Exception:
        pass
    sys.exit(code)


__all__ = [
    "USER_AGENT",
    "HttpError", "HttpResponse",
    "http_request", "unwrap_data",
    "decode_http_payload", "extract_traceid",
    "redact", "safe_print", "emit_user_reply",
    "build_review_submit_user_reply", "build_direct_edit_user_reply",
    "error_exit",
]
