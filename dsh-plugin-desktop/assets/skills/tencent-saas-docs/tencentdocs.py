#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""tencentdocs.py —— 腾讯文档 MCP Skill 调用入口（插件版，纯 Python 标准库 / 跨平台 / 不落盘）。

与 setup.sh 等价的 Python 实现，解决 Windows 下无 bash/curl 无法使用的问题。

设计要点：
  1. 普通 SaaS 文档保持原鉴权：宿主注入 TDOC_OAUTH_ACCESS_TOKEN / TDOC_ONEID_ACCESS_TOKEN。
  2. ClawClaw 资料库文档用链接 nodeId 获取 accessToken/第三方 fileId（get-drive-token）；
     文档 MCP 服务已支持自动将第三方 fileId 转换为内部 file_id，因此该 fileId 可直接作为
     目标工具的 file_id 参数使用，无需再调用 manage.resolve_third_file_id；沙箱走
     auth-proxy，客户端走 CLAWCLAW_IPC。
  3. 纯标准库 urllib，无 curl / requests / mcporter 依赖；票据仅在内存里通过 HTTP
     header 即时透传，不写入任何文件。
  4. 默认走系统代理（读 HTTP_PROXY / HTTPS_PROXY 环境变量）；可用 --no-proxy 绕过。
  5. 4 个 MCP endpoint，按 service 名路由：tencent-saas-docs / slide-mcp / doc-mcp / sheet-mcp

用法（供 AI Agent 调用）：
    python3 tencentdocs.py tdoc_init
        → READY 或 ERROR:*

    PYTHONPATH= python3 tencentdocs.py tdoc_resolve --document-url <资料库链接>
        → 输出可直接使用的文档 file_id（即 get-drive-token 返回的第三方 fileId），不输出 accessToken

    python3 tencentdocs.py tdoc_call <service> <tool> [json_args]
        例：python3 tencentdocs.py tdoc_call tencent-saas-docs manage.recent_online_file '{"num":10}'
            python3 tencentdocs.py tdoc_call slide-mcp slide_add_shape '{"file_id":"xxx"}'

    python3 tencentdocs.py tdoc_list <service>
        → 原样输出该 endpoint 的 tools/list JSON-RPC 响应

    python3 tencentdocs.py tdoc_schema <service> <tool>
        → 输出单个工具的描述与完整参数（inputSchema）。
        ★ 调用 tdoc_call 之前，必须先用本命令拿到该工具的真实参数定义，
          按定义传参，严禁凭记忆/猜测拼参数。

可选参数：
    --no-proxy              本次请求绕过所有代理（默认走系统代理）
    --timeout <秒>          覆盖 HTTP 超时（默认取 TDOC_HTTP_TIMEOUT 或 120）
    --document-url <链接>   资料库原始链接；用于获取 token，第三方 fileId 直接作为 file_id 注入
"""

import argparse
import json
import os
import sys
import urllib.error
import urllib.request
import clawclaw_library

# ── 端点配置（SaaS 版 saas.docs.qq.com；个人版仅需改这三行） ────────────────────────
API_BASE = os.environ.get("TDOC_API_BASE_URL", "https://saas.docs.qq.com")
MAIN_SERVICE = "tencent-saas-docs"
# service → path（与 API base 解耦，便于专享版/私有化在运行时用 provider 下发的
# apiBase 覆盖 base，见 #90200）。
_MCP_PATHS = {
    MAIN_SERVICE: "/api/v6/open/agent/mcp",
    "slide-mcp": "/api/v6/slide/mcp",
    "doc-mcp": "/api/v6/doc/mcp",
    "sheet-mcp": "/api/v6/sheet/mcp",
}


def _build_mcp_urls(api_base):
    """按给定 base 生成 service→url 映射；base 为空时回退到默认 API_BASE。"""
    base = (api_base or API_BASE).rstrip("/")
    return {service: f"{base}{path}" for service, path in _MCP_PATHS.items()}


MCP_URLS = _build_mcp_urls(API_BASE)
HTTP_TIMEOUT = int(os.environ.get("TDOC_HTTP_TIMEOUT", "120"))
_SERVICE_HINT = " / ".join(MCP_URLS)


def _debug(msg):
    if os.environ.get("TDOC_DEBUG") == "1" or os.environ.get("CLAWCLAW_TDOC_DEBUG") == "1":
        print(f"[TencentDocsSkillCredential] {msg}", file=sys.stderr)


# 最近一次网关凭据回退的失败原因（短标记，不含任何票据内容）；由 _load_tokens 写入，
# 拼进 ERROR:no_token 带出来。issue #101620 里这条链路静默失败：宿主日志零命中、
# skill 只吐一句 no_token，"配置缺失 / 网关不可达 / 401 / 连接器没连"四种失败模式无法区分。
_gateway_error = ""


def _no_token_hint():
    """no_token 报错后缀：把凭据回退的失败原因带出来，便于一次定位。"""
    return f"（凭据获取失败：{_gateway_error}）" if _gateway_error else ""


def _resolve_document_url(document_url="", arguments=None):
    """优先使用显式文档链接，否则从 MCP 参数中识别资料库链接。"""
    if document_url:
        return document_url.strip()
    return clawclaw_library.find_document_url(arguments)


# ── 票据加载：环境变量优先，回退 V2 MCP Gateway session provider ──────────────
def _load_tokens():
    """返回 (oauth_token, oneid_token, api_base)，缺省为空串 / None。

    api_base：专享版/私有化部署下由宿主 token provider 下发的腾讯文档站 origin
    （如 https://xxx-docs.copilot-staging.qq.com）；公有云为 None，调用方回退默认域。
    """
    global _gateway_error
    _gateway_error = ""
    oauth = os.environ.get("TDOC_OAUTH_ACCESS_TOKEN", "")
    oneid = os.environ.get("TDOC_ONEID_ACCESS_TOKEN", "")
    api_base = os.environ.get("TDOC_API_BASE_URL", "") or None
    if oauth or oneid:
        _debug("using existing TDOC_* env tokens")
        return oauth, oneid, api_base

    cfg_raw = os.environ.get("CLAWCLAW_MCP_CONFIG")
    if not cfg_raw:
        _gateway_error = "no_mcp_config"
        _debug("no CLAWCLAW_MCP_CONFIG; skip V2 MCP Gateway credential provider")
        return oauth, oneid, api_base

    try:
        cfg = json.loads(cfg_raw)
        servers = cfg.get("mcpServers") or {}
        # 宿主 V2 MCP Gateway 条目名是 connector-proxy（CLAWCLAW_MCP_SERVER_NAME，
        # 见 clawclaw-mcp-protocol.ts）；clawclaw 是迁移期保留的旧名，兜底兼容。
        server = servers.get("connector-proxy") or servers.get("clawclaw") or {}
        gateway_url = server.get("url") or ""
        # 网关这一组认证头必须整组透传：除 Authorization 外还有 X-ClawClaw-MCP-Context
        # （宿主签发的会话信封）。local-mcp-host.ts::resolveRequestContext 对每条
        # authenticated route 都要求两者同时成立，只带 Authorization 会被判 401
        # invalid_mcp_context —— 凭据永远取不到，且宿主侧不会留下任何日志（issue #101620）。
        # 逐个挑头名会在宿主再加必需头时重蹈覆辙，所以整组照搬。
        gateway_headers = {
            name: value
            for name, value in (server.get("headers") or {}).items()
            if isinstance(name, str) and isinstance(value, str) and value
        }
    except Exception as e:  # noqa: BLE001
        _gateway_error = "bad_mcp_config"
        _debug(f"parse CLAWCLAW_MCP_CONFIG failed: {e}")
        return oauth, oneid, api_base

    has_authorization = any(name.lower() == "authorization" for name in gateway_headers)
    if not (gateway_url.endswith("/mcp") and has_authorization):
        _gateway_error = "no_gateway_entry"
        _debug("connector-proxy/clawclaw V2 MCP Gateway entry not found in CLAWCLAW_MCP_CONFIG")
        return oauth, oneid, api_base

    token_url = gateway_url + "/internal/tencent-docs/tokens"
    _debug(f"request V2 MCP Gateway credential provider: {token_url} "
           f"headers={sorted(gateway_headers)}")
    try:
        req = urllib.request.Request(token_url, headers=gateway_headers, method="GET")
        # token provider 走宿主本地，固定不走代理
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
        with opener.open(req, timeout=10) as resp:
            data = json.loads(resp.read().decode("utf-8"))
        personal = data.get("personal") or {}
        enterprise = data.get("enterprise") or {}
        if personal.get("available") and personal.get("token"):
            oauth = str(personal["token"])
        if enterprise.get("available") and enterprise.get("token"):
            oneid = str(enterprise["token"])
        # 专享版/私有化：provider 下发的文档站 origin 覆盖默认域（#90200）。
        # 环境变量 TDOC_API_BASE_URL 若已显式指定则优先，不被 provider 覆盖。
        provider_api_base = data.get("apiBase")
        if not api_base and isinstance(provider_api_base, str) and provider_api_base.strip():
            api_base = provider_api_base.strip()
        if not oauth and not oneid:
            # provider 答了但两侧都没票：reason 就是连接器态（connector_disabled /
            # not_connected / token_unavailable），直接透出去，别再让人猜。
            _gateway_error = (f"provider personal={personal.get('reason') or 'token_unavailable'}"
                              f" enterprise={enterprise.get('reason') or 'token_unavailable'}")
    except urllib.error.HTTPError as e:
        _gateway_error = f"provider HTTP {e.code}"
        _debug(f"V2 MCP Gateway credential provider request failed: HTTP {e.code} {e.reason}")
    except Exception as e:  # noqa: BLE001
        _gateway_error = f"provider unreachable ({type(e).__name__})"
        _debug(f"V2 MCP Gateway credential provider request failed: {e}")
    _debug(f"token provider result personal={'available' if oauth else 'unavailable'} "
           f"enterprise={'available' if oneid else 'unavailable'} "
           f"api_base={api_base or 'default'}")
    return oauth, oneid, api_base


def _build_opener(no_proxy):
    """no_proxy=True 时绕过所有代理；否则走系统代理（urllib 默认读 *_PROXY 环境变量）。"""
    if no_proxy:
        return urllib.request.build_opener(urllib.request.ProxyHandler({}))
    return urllib.request.build_opener()  # 默认 ProxyHandler 读取系统/环境代理


# ── 发一条 JSON-RPC 请求，返回原始响应文本（兼容 SSE） ─────────────────────────
def _post_jsonrpc(url, payload, oauth, oneid, no_proxy, timeout, x_mcp_token="", x_app_id=""):
    headers = {
        "Content-Type": "application/json",
        "Accept": "application/json, text/event-stream",
        "User-Agent": "ClawClaw Plugin",
    }
    if x_mcp_token:
        # 资料库 accessToken：X-Mcp-Token + X-App-Id，不进 Authorization，不叠加 Bearer。
        # X-App-Id 由 get-drive-token 返回的 data.edition（网盘C端 toc / SaaS端 tob）与
        # 资料库文档链接域名（生产/测试）共同确定，见 clawclaw_library.get_drive_app_id。
        headers["X-Mcp-Token"] = x_mcp_token
        headers["X-App-Id"] = x_app_id
    elif oauth:
        headers["Authorization"] = f"Bearer {oauth}"
    if oneid:
        headers["X-Oneid-Access-Token"] = oneid

    body = json.dumps(payload).encode("utf-8")
    req = urllib.request.Request(url, data=body, headers=headers, method="POST")
    opener = _build_opener(no_proxy)
    try:
        with opener.open(req, timeout=timeout) as resp:
            raw = resp.read().decode("utf-8", errors="replace")
            ctype = resp.headers.get("Content-Type", "")
    except urllib.error.HTTPError as e:
        # --fail-with-body 等价：把后端原始报文带出来
        detail = ""
        try:
            detail = e.read().decode("utf-8", errors="replace")
        except (OSError, TypeError, ValueError):
            pass
        print(f"ERROR:http_failed - HTTP {e.code} {e.reason} {detail}", file=sys.stderr)
        return None
    except urllib.error.URLError as e:
        print(f"ERROR:http_failed - {e.reason}", file=sys.stderr)
        return None
    except OSError as e:
        print(f"ERROR:http_failed - {e}", file=sys.stderr)
        return None

    # SSE（text/event-stream）：抽取 data: 行拼回 JSON；普通 JSON 原样返回
    if "text/event-stream" in ctype:
        return _extract_sse_json(raw)
    return raw


def _extract_sse_json(raw):
    """从 SSE 报文里抽取最后一条 data: 负载（MCP 流式响应的最终结果）。"""
    data_lines = [ln[len("data:"):].strip() for ln in raw.splitlines()
                  if ln.startswith("data:")]
    if not data_lines:
        return raw  # 不是预期 SSE，原样返回
    # 取最后一个能解析为 JSON 的 data 段
    for chunk in reversed(data_lines):
        try:
            json.loads(chunk)
            return chunk
        except json.JSONDecodeError:
            continue
    return data_lines[-1]


def _resolve_url(service, api_base=None):
    """按 service 解析 MCP endpoint URL；api_base 非空时用它覆盖默认站点域。"""
    if api_base:
        return _build_mcp_urls(api_base).get(service)
    return MCP_URLS.get(service)


def put_upload(upload_url, file_path, no_proxy=False, timeout=None):
    """把本地文件以 PUT 方式上传到 COS 预签名 URL（import_file.py 复用）。

    返回 HTTP 状态码；网络失败抛 OSError。Content-Type 固定 application/octet-stream，
    与原 setup.sh + curl --data-binary 行为一致。
    """
    with open(file_path, "rb") as f:
        data = f.read()
    req = urllib.request.Request(
        upload_url, data=data, method="PUT",
        headers={"Content-Type": "application/octet-stream"})
    opener = _build_opener(no_proxy)
    with opener.open(req, timeout=timeout or HTTP_TIMEOUT) as resp:
        return resp.status


def _load_request_auth(document_url="", no_proxy=False, timeout=10):
    """按文档来源返回 (oauth, oneid, x_mcp_token, x_app_id, api_base)，以及错误信息。

    资料库场景 x_app_id 由 get-drive-token 返回的 data.edition（网盘C端/SaaS端）
    与文档链接域名（生产/测试）共同确定。
    api_base 只在普通 SaaS 链路上有意义（专享版/私有化由 provider 下发，见 #90200）。
    """
    if clawclaw_library.is_document_url(document_url):
        try:
            drive = clawclaw_library.load_drive_token(
                document_url, no_proxy, timeout, _debug)
            app_id = clawclaw_library.get_drive_app_id(document_url, drive["edition"])
            return ("", "", drive["access_token"], app_id, None), None
        except (clawclaw_library.TokenError, clawclaw_library.FileIDResolveError) as e:
            return None, str(e)
    oauth, oneid, api_base = _load_tokens()
    if not oauth and not oneid:
        return None, "no_token"
    return (oauth, oneid, "", "", api_base), None


def _prepare_call(document_url, arguments, no_proxy, timeout):
    """准备目标工具参数与鉴权；资料库场景直接注入 get-drive-token 返回的第三方 file_id。

    文档 MCP 服务已支持自动将第三方 file_id 转换为内部 file_id，因此这里不再调用
    manage.resolve_third_file_id，直接把 get-drive-token 的 fileId 作为 file_id 注入。
    x_app_id 由 get-drive-token 返回的 data.edition（网盘C端/SaaS端）与文档链接域名
    （生产/测试）共同确定。
    """
    if not clawclaw_library.is_document_url(document_url):
        auth, err = _load_request_auth(document_url, no_proxy, min(timeout, 10))
        return arguments, auth, err
    try:
        drive = clawclaw_library.load_drive_token(
            document_url, no_proxy, min(timeout, 10), _debug)
        app_id = clawclaw_library.get_drive_app_id(document_url, drive["edition"])
    except (clawclaw_library.TokenError, clawclaw_library.FileIDResolveError) as e:
        return None, None, str(e)
    prepared = dict(arguments)
    prepared["file_id"] = drive["third_file_id"]
    return prepared, ("", "", drive["access_token"], app_id, None), None


def call_tool(service, tool, arguments, no_proxy=False, timeout=None, document_url=""):
    """以模块方式调用 MCP 工具；资料库场景直接注入第三方 file_id（服务端自动转换）。

    返回 (result_dict, error_str)：成功时 error_str 为 None。资料库链接可通过
    document_url 显式传入，也会从 arguments 的链接字段中自动识别。
    """
    if service not in _MCP_PATHS:
        return None, f"unknown_service: {service}"
    request_timeout = timeout or HTTP_TIMEOUT
    document_url = _resolve_document_url(document_url, arguments)
    prepared, auth, err = _prepare_call(
        document_url, arguments, no_proxy, request_timeout)
    if err:
        return None, err
    url = _resolve_url(service, auth[4])
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/call",
               "params": {"name": tool, "arguments": prepared}}
    rsp = _post_jsonrpc(url, payload, auth[0], auth[1], no_proxy,
                        request_timeout, auth[2], auth[3])
    if rsp is None:
        return None, "http_failed"
    try:
        return json.loads(rsp), None
    except json.JSONDecodeError:
        return None, f"non_json_response: {rsp[:200]}"


def fetch_tools(service, oauth, oneid, no_proxy=False, timeout=None, x_mcp_token="",
                x_app_id="", api_base=None):
    """拉取某 endpoint 的 tools/list，返回 (tools_list, error_str)。"""
    url = _resolve_url(service, api_base)
    if not url:
        return None, f"unknown_service: {service}"
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    rsp = _post_jsonrpc(url, payload, oauth, oneid, no_proxy,
                        timeout or HTTP_TIMEOUT, x_mcp_token, x_app_id)
    if rsp is None:
        return None, "http_failed"
    try:
        obj = json.loads(rsp)
    except json.JSONDecodeError:
        return None, f"non_json_response: {rsp[:200]}"
    if obj.get("error"):
        return None, f"jsonrpc_error: {obj['error']}"
    return (obj.get("result") or {}).get("tools", []), None


def _require_tokens(document_url="", no_proxy=False, timeout=10):
    """按文档来源获取请求票据，失败时输出错误并返回 None。"""
    auth, err = _load_request_auth(document_url, no_proxy, timeout)
    if err == "no_token":
        print("ERROR:no_token - 未检测到腾讯文档登录票据，请在 ClawClaw 中打开并授权腾讯文档连接器后重试"
              + _no_token_hint())
        return None
    if err:
        print(f"ERROR:{err}")
        return None
    return auth


# ── 主入口 A：环境检查 ────────────────────────────────────────────────────────
def cmd_init(args):
    if not clawclaw_library.is_document_url(args.document_url):
        oauth, oneid, _api_base = _load_tokens()
        if not oauth and not oneid:
            print("ERROR:no_token - 未检测到环境变量 TDOC_OAUTH_ACCESS_TOKEN 或 "
                  "TDOC_ONEID_ACCESS_TOKEN，请由宿主环境注入" + _no_token_hint())
            return 1
        print("READY")
        return 0

    tokens = _require_tokens(args.document_url, args.no_proxy, min(args.timeout, 10))
    if tokens is None:
        return 1
    print("READY")
    return 0


# ── 主入口 B：解析资料库文档 ──────────────────────────────────────────────────
def cmd_resolve(args):
    try:
        drive = clawclaw_library.load_drive_token(
            args.document_url, args.no_proxy, min(args.timeout, 10), _debug)
    except (clawclaw_library.TokenError, clawclaw_library.FileIDResolveError) as e:
        print(f"ERROR:{e}")
        return 1
    # accessToken 仅用于当前进程内的 MCP 调用，禁止输出。
    print(json.dumps({"file_id": drive["third_file_id"]}, ensure_ascii=False))
    return 0


# ── 主入口 C：调用工具（tools/call） ──────────────────────────────────────────
def cmd_call(args):
    service, tool = args.service, args.tool
    url = _resolve_url(service)
    if not url:
        print(f"ERROR:unknown_service - 未知 service: {service}（应为 {_SERVICE_HINT}）")
        return 1

    arguments_str = args.json_args if args.json_args else "{}"
    try:
        arguments = json.loads(arguments_str)
    except json.JSONDecodeError:
        print(f"ERROR:bad_args_json - args 必须是合法的 JSON 对象字符串，收到: {arguments_str}")
        return 1
    if not isinstance(arguments, dict):
        print(f"ERROR:bad_args_json - args 必须是 JSON 对象（{{...}}），收到: {arguments_str}")
        return 1

    response, err = call_tool(
        service,
        tool,
        arguments,
        no_proxy=args.no_proxy,
        timeout=args.timeout,
        document_url=args.document_url,
    )
    if err:
        print(f"ERROR:{err}")
        return 1
    print(json.dumps(response, ensure_ascii=False))
    return 0


# ── 主入口 D：列工具（tools/list） ────────────────────────────────────────────
def cmd_list(args):
    service = args.service
    if service not in _MCP_PATHS:
        print(f"ERROR:unknown_service - 未知 service: {service}（应为 {_SERVICE_HINT}）")
        return 1

    tokens = _require_tokens(args.document_url, args.no_proxy, min(args.timeout, 10))
    if tokens is None:
        return 1

    url = _resolve_url(service, tokens[4])
    payload = {"jsonrpc": "2.0", "id": 1, "method": "tools/list", "params": {}}
    rsp = _post_jsonrpc(url, payload, tokens[0], tokens[1], args.no_proxy,
                        args.timeout, tokens[2], tokens[3])
    if rsp is None:
        return 1
    print(rsp)
    return 0


# ── 主入口 E：查单个工具的参数定义（调用前必做） ──────────────────────────────
def cmd_schema(args):
    service, tool = args.service, args.tool
    if service not in _MCP_PATHS:
        print(f"ERROR:unknown_service - 未知 service: {service}（应为 {_SERVICE_HINT}）")
        return 1

    tokens = _require_tokens(args.document_url, args.no_proxy, min(args.timeout, 10))
    if tokens is None:
        return 1

    tools, err = fetch_tools(service, tokens[0], tokens[1], args.no_proxy,
                             args.timeout, tokens[2], tokens[3], tokens[4])
    if err:
        print(f"ERROR:{err}")
        return 1

    t = next((x for x in tools if x.get("name") == tool), None)
    if t is None:
        names = ", ".join(sorted(x.get("name", "") for x in tools)[:60])
        print(f"ERROR:tool_not_found - 工具 {tool!r} 不在 {service}（可用工具名见 tdoc_list；部分：{names}）")
        return 1

    schema = t.get("inputSchema") or {}
    props = schema.get("properties") or {}
    required = set(schema.get("required") or [])

    if args.raw:
        # 原样输出该工具完整定义 JSON（name/description/inputSchema）
        print(json.dumps(t, ensure_ascii=False, indent=2))
        return 0

    # 人类可读：工具名 + 描述 + 参数表（✓=必填）
    print(f"# {t.get('name')}")
    desc = (t.get("description") or "").strip()
    if desc:
        print(f"\n{desc}")
    if not props:
        print("\n（无参数）")
    else:
        print("\n参数（✓=必填，调用前按此传参，勿猜）：")
        ordered = [k for k in schema.get("required") or [] if k in props] + \
                  [k for k in props if k not in required]
        for k in ordered:
            spec = props.get(k) or {}
            typ = spec.get("type", "")
            if typ == "array" and isinstance(spec.get("items"), dict):
                typ = f"array<{spec['items'].get('type', '')}>"
            mark = "✓" if k in required else " "
            d = (spec.get("description") or "").replace("\n", " ").strip()
            print(f"  [{mark}] {k} ({typ}): {d}")
    print("\n★ 用 tdoc_call 调用时，arguments 必须严格按以上参数定义传入；"
          "需要原始 JSON Schema 加 --raw。")
    return 0


def _add_document_url_arg(parser, required=False):
    parser.add_argument(
        "--document-url", default="", required=required,
        help="资料库原始链接；用于获取 token，第三方 fileId 直接作为 file_id 使用")


def main(argv=None):
    ap = argparse.ArgumentParser(prog="tencentdocs.py", add_help=True,
                                 description="腾讯文档 MCP 调用入口（纯 Python，跨平台）")
    ap.add_argument("--no-proxy", action="store_true", help="本次请求绕过所有代理（默认走系统代理）")
    ap.add_argument("--timeout", type=int, default=HTTP_TIMEOUT, help="HTTP 超时秒数（默认 120）")
    sub = ap.add_subparsers(dest="cmd", required=True)

    p = sub.add_parser("tdoc_init", help="环境检查（token 检测）")
    _add_document_url_arg(p)
    p.set_defaults(func=cmd_init)

    p = sub.add_parser("tdoc_resolve", help="获取资料库链接对应的可直接使用的 file_id")
    _add_document_url_arg(p, required=True)
    p.set_defaults(func=cmd_resolve)

    p = sub.add_parser("tdoc_call", help="调用 MCP 工具（tools/call）。调用前先用 tdoc_schema 查参数，勿猜")
    p.add_argument("service", help=_SERVICE_HINT)
    p.add_argument("tool", help="工具名，如 manage.create_file / slide_add_shape")
    p.add_argument("json_args", nargs="?", default="", help="工具参数 JSON 对象字符串；须按 tdoc_schema 的定义传")
    _add_document_url_arg(p)
    p.set_defaults(func=cmd_call)

    p = sub.add_parser("tdoc_list", help="列出指定 endpoint 的所有 MCP 工具（tools/list）")
    p.add_argument("service", help=_SERVICE_HINT)
    _add_document_url_arg(p)
    p.set_defaults(func=cmd_list)

    p = sub.add_parser("tdoc_schema",
                       help="查单个工具的描述与参数定义（★ 调用 tdoc_call 前必做，按定义传参勿猜）")
    p.add_argument("service", help=_SERVICE_HINT)
    p.add_argument("tool", help="工具名，如 manage.create_file / slide_add_shape")
    p.add_argument("--raw", action="store_true", help="原样输出该工具完整定义 JSON（含 inputSchema）")
    _add_document_url_arg(p)
    p.set_defaults(func=cmd_schema)

    args = ap.parse_args(argv)
    return args.func(args)


if __name__ == "__main__":
    sys.exit(main())
