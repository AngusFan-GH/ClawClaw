# -*- coding: utf-8 -*-
"""Taihu HTTP client.

优先使用环境变量 TAI_PAT_TOKEN 作为 Bearer token；未设置时才走 OAuth。PAT 401 直接失败，不回落浏览器授权。

默认非交互：需要浏览器授权时先打开系统浏览器，立刻以 E_AUTH_REQUIRED 失败并在 stdout
给出 auth_url 作为备用入口；PKCE verifier 落入 pending-auth.json，下一次调用短轮询换票。
长轮询仅 TAIHU_INTERACTIVE=1。
"""
from __future__ import annotations

import base64
import hashlib
import json
import os
import ssl
import subprocess
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import webbrowser

DEFAULT_OAUTH2_BASE = "https://iam.it.woa.com"
DEFAULT_CLIENT_ID = "taihu_proxy_client"
DEFAULT_SCOPE = "*"
GLOBAL_SCOPE_KEY = "__global_scope_star__"
# IAM 服务端确认：允许 GET /oauth2/par/poll 拉取 authorization code。
POLL_INTERVAL_SEC = 5
POLL_MAX_ATTEMPTS = 60
SHORT_POLL_INTERVAL_SEC = 2
SHORT_POLL_MAX_ATTEMPTS = 3
DEFAULT_PAR_EXPIRES_SEC = 300
DEFAULT_API_BASE = "https://clawclaw.mcp.woa.com"
DEFAULT_APP_NAME = "library"


def _user_home():
    if sys.platform == "win32":
        return os.environ.get("USERPROFILE") or os.path.expanduser("~")
    return os.path.expanduser("~")


CONFIG_DIR = os.path.join(_user_home(), ".config", "tof4-auth")
TOKEN_CACHE_PATH = os.path.join(CONFIG_DIR, "tokens.json")
PENDING_AUTH_PATH = os.path.join(CONFIG_DIR, "pending-auth.json")


class TaihuError(Exception):
    def __init__(self, code, message, data=None):
        super().__init__("%s: %s" % (code, message))
        self.code = code
        self.message = message
        self.data = data or {}


def _log(msg):
    sys.stderr.write("[taihu] %s\n" % msg)
    try:
        sys.stderr.flush()
    except Exception:
        pass


def _b64url(raw):
    return base64.urlsafe_b64encode(raw).rstrip(b"=").decode("ascii")


def _now_ms():
    return int(time.time() * 1000)


def _oauth2_base():
    return (os.environ.get("TOF4_OAUTH2_BASE", "").strip() or DEFAULT_OAUTH2_BASE).rstrip("/")


def _client_id():
    return os.environ.get("TOF4_CLIENT_ID", "").strip() or DEFAULT_CLIENT_ID


def _scope():
    return os.environ.get("TOF4_SCOPE", "").strip() or DEFAULT_SCOPE


def _ssl_context():
    if os.environ.get("KS_SSL_INSECURE") == "1":
        return ssl._create_unverified_context()
    return ssl.create_default_context()


def resource_from_url(url):
    parts = urllib.parse.urlsplit(url)
    host = parts.hostname or ""
    return "%s://%s%s" % (parts.scheme, host, parts.path or "")


def is_woa_url(url):
    try:
        host = (urllib.parse.urlsplit(url).hostname or "").lower()
    except Exception:
        return False
    return host == "woa.com" or host.endswith(".woa.com")


def _cache_key(client_id, resource):
    if isinstance(resource, (list, tuple)):
        resource = ",".join(str(x) for x in resource)
    return "%s::%s" % (client_id, resource)


def _new_pkce():
    verifier = _b64url(os.urandom(32))
    challenge = _b64url(hashlib.sha256(verifier.encode("ascii")).digest())
    return verifier, challenge


def _new_state():
    return os.urandom(8).hex()


def _form_body(pairs):
    return urllib.parse.urlencode(pairs).encode("utf-8")


def _header_map(headers):
    if not headers:
        return {}
    try:
        return {str(k).lower(): str(v) for k, v in headers.items()}
    except Exception:
        return {}


def _raw_http(method, url, *, headers=None, data=None, timeout=30.0):
    req = urllib.request.Request(
        url, data=data, method=method.upper(), headers=headers or {})
    try:
        with urllib.request.urlopen(req, timeout=timeout, context=_ssl_context()) as resp:
            status = getattr(resp, "status", 200)
            raw = resp.read()
            return status, _header_map(getattr(resp, "headers", None)), raw
    except urllib.error.HTTPError as e:
        try:
            raw = e.read()
        except Exception:
            raw = b""
        return int(e.code), _header_map(getattr(e, "headers", None)), raw
    except urllib.error.URLError as e:
        raise TaihuError("NETWORK_ERROR", "network error: %s" % e) from e


def _read_json(raw):
    if not raw:
        return {}
    try:
        payload = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
        try:
            payload = json.loads(raw)
        except (TypeError, json.JSONDecodeError):
            return {}
    return payload if isinstance(payload, dict) else {}


def _ensure_config_dir():
    os.makedirs(CONFIG_DIR, exist_ok=True)
    if sys.platform != "win32":
        try:
            os.chmod(CONFIG_DIR, 0o700)
        except OSError:
            pass


def _read_cache():
    try:
        with open(TOKEN_CACHE_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return {"entries": []}
    entries = data.get("entries") if isinstance(data, dict) else None
    if not isinstance(entries, list):
        return {"entries": []}
    return {"entries": entries}


def _write_json_file(path, payload):
    _ensure_config_dir()
    raw = json.dumps(payload, ensure_ascii=False)
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as handle:
        handle.write(raw)
    try:
        os.replace(tmp, path)
    except OSError:
        with open(path, "w", encoding="utf-8", newline="\n") as handle:
            handle.write(raw)
        try:
            os.remove(tmp)
        except OSError:
            pass


def _write_cache(cache):
    _write_json_file(TOKEN_CACHE_PATH, cache)


def _env_flag(name):
    return os.environ.get(name, "").strip().lower() in ("1", "true", "yes", "on")


def _interactive_oauth_enabled():
    if "TAIHU_INTERACTIVE" in os.environ:
        return _env_flag("TAIHU_INTERACTIVE")
    if _env_flag("TAIHU_NO_BROWSER") or _env_flag("CI"):
        return False
    if sys.platform not in ("win32", "darwin") and not os.environ.get("DISPLAY"):
        return False
    try:
        return bool(sys.stdin.isatty())
    except Exception:
        return False


def _should_open_browser():
    return not (_env_flag("TAIHU_NO_BROWSER") or _env_flag("CI"))


def _read_pending():
    try:
        with open(PENDING_AUTH_PATH, "r", encoding="utf-8") as handle:
            data = json.load(handle)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def _save_pending(req_uri, verifier, *, auth_url, client_id, resource, expires_in):
    try:
        exp = int(expires_in or DEFAULT_PAR_EXPIRES_SEC)
    except (TypeError, ValueError):
        exp = DEFAULT_PAR_EXPIRES_SEC
    now = _now_ms()
    _write_json_file(PENDING_AUTH_PATH, {
        req_uri: {
            "code_verifier": verifier,
            "created_at": now,
            "auth_url": auth_url,
            "client_id": client_id,
            "resource": resource,
            "expires_at": now + max(1, exp) * 1000,
        },
    })


def _clear_pending(req_uri=None):
    if req_uri is None:
        _write_json_file(PENDING_AUTH_PATH, {})
        return
    data = _read_pending()
    if req_uri in data:
        data.pop(req_uri, None)
        _write_json_file(PENDING_AUTH_PATH, data)


def _latest_pending(client_id):
    now = _now_ms()
    best = None
    for req_uri, entry in _read_pending().items():
        if not req_uri or not isinstance(entry, dict):
            continue
        stored_client = entry.get("client_id")
        if stored_client not in (None, "", client_id):
            continue
        try:
            expires_at = int(entry.get("expires_at") or 0)
        except (TypeError, ValueError):
            expires_at = 0
        if expires_at and expires_at <= now:
            continue
        if not entry.get("code_verifier"):
            continue
        try:
            created = int(entry.get("created_at") or 0)
        except (TypeError, ValueError):
            created = 0
        if best is None or created > best[2]:
            best = (req_uri, entry, created)
    if best is None:
        return None, None
    return best[0], best[1]


def _build_auth_url(base, client_id, req_uri):
    return "%s/oauth2/authorize?client_id=%s&request_uri=%s" % (
        base,
        urllib.parse.quote(client_id, safe=""),
        urllib.parse.quote(req_uri, safe=""),
    )


def _auth_required(auth_url, *, open_browser=False):
    if open_browser:
        _open_browser(auth_url)
    raise TaihuError(
        "E_AUTH_REQUIRED",
        "please complete authorization in the browser, then retry",
        data={"auth_url": auth_url},
    )


def _open_browser(url):
    if not url or not _should_open_browser():
        return
    try:
        if sys.platform == "win32":
            os.startfile(url)
            return
        if sys.platform == "darwin":
            subprocess.Popen(
                ["open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
            return
        try:
            subprocess.Popen(
                ["xdg-open", url],
                stdout=subprocess.DEVNULL,
                stderr=subprocess.DEVNULL,
            )
        except OSError:
            webbrowser.open(url)
    except Exception as e:
        _log("Failed to open browser: %s" % e)


def _entry_resource(entry):
    resource = entry.get("resource") if isinstance(entry, dict) else None
    if isinstance(resource, list):
        return ",".join(str(x) for x in resource)
    return "" if resource is None else str(resource)


def _find_entry(cache, client_id, resource):
    key = _cache_key(client_id, resource)
    for entry in cache.get("entries") or []:
        if not isinstance(entry, dict):
            continue
        if _cache_key(entry.get("client_id"), _entry_resource(entry)) == key:
            return entry
    return None


def _save_token(client_id, resource, access_token, refresh_token, expires_in=3600,
                also_save_global=True):
    cache = _read_cache()
    expires_at = _now_ms() + int(expires_in or 3600) * 1000
    new_entry = {
        "client_id": client_id,
        "resource": [resource],
        "access_token": access_token,
        "refresh_token": refresh_token or "",
        "expires_at": expires_at,
    }
    keys = {_cache_key(client_id, resource)}
    if also_save_global:
        keys.add(_cache_key(client_id, GLOBAL_SCOPE_KEY))
    kept = []
    for entry in cache.get("entries") or []:
        if not isinstance(entry, dict):
            continue
        ek = _cache_key(entry.get("client_id"), _entry_resource(entry))
        if ek in keys:
            continue
        kept.append(entry)
    kept.append(new_entry)
    if also_save_global:
        kept.append({
            "client_id": client_id,
            "resource": [GLOBAL_SCOPE_KEY],
            "access_token": access_token,
            "refresh_token": refresh_token or "",
            "expires_at": expires_at,
        })
    _write_cache({"entries": kept})


def _remove_token(client_id, resource, also_remove_global=False):
    cache = _read_cache()
    drop = {_cache_key(client_id, resource)}
    if also_remove_global:
        drop.add(_cache_key(client_id, GLOBAL_SCOPE_KEY))
    kept = []
    for entry in cache.get("entries") or []:
        if not isinstance(entry, dict):
            continue
        ek = _cache_key(entry.get("client_id"), _entry_resource(entry))
        if ek in drop:
            continue
        kept.append(entry)
    _write_cache({"entries": kept})


def _invoke_par(base, client_id, resource, challenge, state, scope, app_name):
    pairs = [
        ("client_id", client_id),
        ("response_type", "code"),
        ("code_challenge", challenge),
        ("code_challenge_method", "S256"),
        ("state", state),
    ]
    for item in str(resource).split(","):
        item = item.strip()
        if item:
            pairs.append(("resource", item))
    if scope:
        pairs.append(("scope", scope))
    if app_name:
        pairs.append(("app_name", app_name))
    status, _, raw = _raw_http(
        "POST", base + "/oauth2/par",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=_form_body(pairs), timeout=30.0)
    payload = _read_json(raw)
    req_uri = payload.get("request_uri")
    if status >= 400 or not req_uri:
        raise TaihuError(
            "E_AUTH_FAILED",
            payload.get("error_description") or payload.get("error") or "PAR failed")
    return payload


def _wait_for_auth(base, client_id, request_uri, *, max_attempts=None,
                   interval_sec=None, expires_in=None):
    attempts = POLL_MAX_ATTEMPTS if max_attempts is None else int(max_attempts)
    interval = POLL_INTERVAL_SEC if interval_sec is None else float(interval_sec)
    interval = max(1.0, min(interval, 10.0))
    try:
        exp = int(expires_in) if expires_in is not None else None
    except (TypeError, ValueError):
        exp = None
    if exp and max_attempts is None:
        attempts = max(1, min(attempts, int(exp / interval) + 1))
    _log("Waiting for authorization... (timeout: %s s)" % int(attempts * interval))
    poll = "%s/oauth2/par/poll?request_uri=%s&client_id=%s" % (
        base,
        urllib.parse.quote(request_uri, safe=""),
        urllib.parse.quote(client_id, safe=""),
    )
    for i in range(attempts):
        if i > 0:
            time.sleep(interval)
        try:
            status, _, raw = _raw_http("GET", poll, timeout=30.0)
        except TaihuError:
            continue
        if status == 404:
            raise TaihuError("E_AUTH_FAILED", "Auth request expired")
        payload = _read_json(raw)
        try:
            srv_interval = payload.get("interval")
            if srv_interval is not None:
                interval = max(1.0, min(float(srv_interval), 10.0))
        except (TypeError, ValueError):
            pass
        state = payload.get("status")
        if state == "completed":
            code = payload.get("code")
            if not code:
                raise TaihuError("E_AUTH_FAILED", "Auth completed but no code returned")
            return code, payload.get("redirect_uri") or ""
        if state == "error":
            raise TaihuError(
                "E_AUTH_FAILED",
                payload.get("error_description") or "Auth failed")
    raise TaihuError("E_AUTH_TIMEOUT", "Auth timeout")


def _token_exchange(base, client_id, code, redirect_uri, verifier):
    status, _, raw = _raw_http(
        "POST", base + "/oauth2/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=_form_body([
            ("grant_type", "authorization_code"),
            ("code", code),
            ("client_id", client_id),
            ("redirect_uri", redirect_uri or ""),
            ("code_verifier", verifier),
        ]),
        timeout=30.0)
    payload = _read_json(raw)
    if status >= 400 or not payload.get("access_token"):
        raise TaihuError(
            "E_AUTH_FAILED",
            payload.get("error_description") or payload.get("error") or "token exchange failed")
    return payload


def _token_refresh(base, client_id, refresh_token):
    status, _, raw = _raw_http(
        "POST", base + "/oauth2/token",
        headers={"Content-Type": "application/x-www-form-urlencoded"},
        data=_form_body([
            ("grant_type", "refresh_token"),
            ("refresh_token", refresh_token),
            ("client_id", client_id),
        ]),
        timeout=30.0)
    payload = _read_json(raw)
    if status >= 400 or not payload.get("access_token"):
        err = payload.get("error") or ""
        if err in ("invalid_grant", "invalid_token"):
            _log("refresh_token invalid, please re-authorize")
        return None
    return payload


def _entry_remaining(entry):
    try:
        expires_at = int(entry.get("expires_at") or 0)
    except (TypeError, ValueError):
        return 0
    return int((expires_at - _now_ms()) / 1000)


def _access_from_entry(base, client_id, resource, entry, *, also_save_global=True):
    remaining = _entry_remaining(entry)
    token = entry.get("access_token")
    refresh = entry.get("refresh_token") or ""
    if remaining > 60 and token:
        _log("Using cached token (expires in: %s min)" % (remaining // 60))
        return token
    if refresh:
        _log("Token expiring soon, refreshing...")
        tok = _token_refresh(base, client_id, refresh)
        if tok and tok.get("access_token"):
            _save_token(
                client_id, resource, tok["access_token"],
                tok.get("refresh_token") or "", tok.get("expires_in") or 3600,
                also_save_global=also_save_global)
            _log("Token refreshed successfully")
            return tok["access_token"]
        _log("Token refresh failed, need re-auth")
        return None
    if remaining > 0 and token:
        _log("Token expiring soon (%s sec) and no refresh_token" % remaining)
        return token
    return None


def _valid_token(base, client_id, resource):
    entry = _find_entry(_read_cache(), client_id, resource)
    if not entry:
        return None
    return _access_from_entry(base, client_id, resource, entry)


def _valid_global_token(base, client_id):
    entry = _find_entry(_read_cache(), client_id, GLOBAL_SCOPE_KEY)
    if not entry:
        return None
    return _access_from_entry(
        base, client_id, GLOBAL_SCOPE_KEY, entry, also_save_global=False)


def _exchange_and_save(base, client_id, resource, code, redirect_uri, verifier):
    tok = _token_exchange(base, client_id, code, redirect_uri, verifier)
    _save_token(
        client_id, resource, tok["access_token"],
        tok.get("refresh_token") or "", tok.get("expires_in") or 3600)
    _log("Auth success! Token cached (resource + global scope=*)")
    return tok["access_token"]


def _resume_pending_auth(base, client_id, resource):
    req_uri, entry = _latest_pending(client_id)
    if not req_uri:
        return None
    verifier = entry.get("code_verifier") or ""
    auth_url = entry.get("auth_url") or _build_auth_url(base, client_id, req_uri)
    _log("Resuming pending OAuth (short poll)...")
    try:
        code, redirect_uri = _wait_for_auth(
            base, client_id, req_uri,
            max_attempts=SHORT_POLL_MAX_ATTEMPTS,
            interval_sec=SHORT_POLL_INTERVAL_SEC)
    except TaihuError as e:
        if e.code == "E_AUTH_FAILED" and "expired" in (e.message or "").lower():
            _clear_pending(req_uri)
            return None
        if e.code == "E_AUTH_TIMEOUT":
            _auth_required(auth_url, open_browser=True)
        if e.code == "E_AUTH_FAILED":
            _clear_pending(req_uri)
        raise
    token = _exchange_and_save(base, client_id, resource, code, redirect_uri, verifier)
    _clear_pending(req_uri)
    return token


def _full_auth(base, client_id, resource, scope, app_name):
    resumed = _resume_pending_auth(base, client_id, resource)
    if resumed:
        return resumed

    verifier, challenge = _new_pkce()
    par = _invoke_par(base, client_id, resource, challenge, _new_state(), scope, app_name)
    req_uri = par["request_uri"]
    try:
        expires_in = int(par.get("expires_in") or DEFAULT_PAR_EXPIRES_SEC)
    except (TypeError, ValueError):
        expires_in = DEFAULT_PAR_EXPIRES_SEC
    auth_url = _build_auth_url(base, client_id, req_uri)
    _save_pending(
        req_uri, verifier, auth_url=auth_url, client_id=client_id,
        resource=resource, expires_in=expires_in)
    _open_browser(auth_url)
    _log("")
    _log("OAuth2 auth required (scope=*), please complete in browser")
    _log("  %s" % auth_url)
    _log("")

    if not _interactive_oauth_enabled():
        _auth_required(auth_url)

    code, redirect_uri = _wait_for_auth(
        base, client_id, req_uri, expires_in=expires_in)
    token = _exchange_and_save(
        base, client_id, resource, code, redirect_uri, verifier)
    _clear_pending(req_uri)
    return token


def _pat_token():
    return os.environ.get("TAI_PAT_TOKEN", "").strip()


def _oauth_cached_token(base, client_id, resource):
    token = _valid_token(base, client_id, resource)
    if token:
        return token, "resource"
    token = _valid_global_token(base, client_id)
    if token:
        return token, "global"
    return None, None


def _acquire_token(url, app_name):
    base = _oauth2_base()
    client_id = _client_id()
    resource = os.environ.get("TOF4_RESOURCE", "").strip() or resource_from_url(url)
    scope = _scope()

    pat = _pat_token()
    if pat:
        _log("Using TAI_PAT_TOKEN from environment")
        return pat, "pat", base, client_id, resource, scope

    token, source = _oauth_cached_token(base, client_id, resource)
    if not token:
        token = _full_auth(base, client_id, resource, scope, app_name)
        source = "new"
    return token, source, base, client_id, resource, scope


def _full_url(url, params):
    if not params:
        return url
    qs = urllib.parse.urlencode(
        {k: v for k, v in params.items() if v is not None}, doseq=True)
    if not qs:
        return url
    return "%s%s%s" % (url, "&" if "?" in url else "?", qs)


def _request_once(method, url, *, token, body, extra_headers, timeout):
    headers = {
        "Authorization": "Bearer %s" % token,
        "Accept": "application/json, text/event-stream",
    }
    data = None
    if body is not None:
        headers["Content-Type"] = "application/json; charset=utf-8"
        if isinstance(body, (bytes, bytearray)):
            data = bytes(body)
        elif isinstance(body, str):
            data = body.encode("utf-8")
        else:
            data = json.dumps(body, ensure_ascii=False).encode("utf-8")
    for key, value in (extra_headers or {}).items():
        if key and value is not None:
            headers[str(key)] = str(value)
    return _raw_http(method, url, headers=headers, data=data, timeout=timeout)


def http_fetch(method, url, *, params=None, body=None, timeout=30.0,
               extra_headers=None, app_name=None):
    if not url:
        raise TaihuError("INVALID_PARAMS", "missing url")
    if not is_woa_url(url):
        raise TaihuError("INVALID_PARAMS", "URL is not *.woa.com domain")

    app_name = app_name or os.environ.get("TOF4_APP_NAME", "").strip() or DEFAULT_APP_NAME
    full_url = _full_url(url, params)
    token, source, base, client_id, resource, scope = _acquire_token(full_url, app_name)

    status, headers, raw = _request_once(
        method, full_url, token=token, body=body,
        extra_headers=extra_headers, timeout=float(timeout))
    if status == 401 and source != "new":
        if source == "pat":
            raise TaihuError(
                "E_AUTH_FAILED",
                "TAI_PAT_TOKEN rejected (401); replace the token or unset TAI_PAT_TOKEN to use browser OAuth")
        _remove_token(client_id, resource, also_remove_global=True)
        _log("Token rejected (401, source=%s). Re-authorizing..." % source)
        token = _full_auth(base, client_id, resource, scope, app_name)
        status, headers, raw = _request_once(
            method, full_url, token=token, body=body,
            extra_headers=extra_headers, timeout=float(timeout))
    return status, headers, raw


def http_request(method, url, *, params=None, body=None, timeout=30.0,
                 extra_headers=None, app_name=None):
    from _common import HttpError, decode_http_payload, extract_traceid

    if url and not url.lower().startswith(("http://", "https://")):
        path = url if url.startswith("/") else "/" + url
        url = DEFAULT_API_BASE + path

    try:
        status, headers, raw = http_fetch(
            method, url, params=params, body=body, timeout=timeout,
            extra_headers=extra_headers, app_name=app_name or DEFAULT_APP_NAME)
    except TaihuError as e:
        raise HttpError(
            "taihu request rejected",
            error_code=getattr(e, "code", "") or "TEMPORARY_ERROR",
            backend_message=getattr(e, "message", ""),
            auth_url=(getattr(e, "data", None) or {}).get("auth_url"),
            traceid=_header_map(getattr(e, "data", None)).get("traceid") or None,
        ) from e
    except Exception as e:
        raise HttpError("taihu request failed", error_code="TEMPORARY_ERROR") from e

    traceid = extract_traceid(headers)
    payload = None
    if raw:
        try:
            payload = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError, AttributeError):
            payload = None
    if not (200 <= int(status) < 300):
        if payload is None:
            raise HttpError("http request rejected", error_code="HTTP_%s" % status,
                            traceid=traceid)
        return decode_http_payload(payload, status=status, traceid=traceid)
    if payload is None:
        raise HttpError("json parse failed", error_code="INVALID_RESPONSE",
                        traceid=traceid)
    return decode_http_payload(payload, status=status, traceid=traceid)


__all__ = [
    "TaihuError",
    "http_fetch",
    "http_request",
    "resource_from_url",
    "is_woa_url",
    "DEFAULT_API_BASE",
]
