#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mindx-page skill：lint HTML database SDK usage（用法与输出协议见 data-page-flow.md 第二道）。"""

from __future__ import annotations

import argparse
import json
import re
import sys
from typing import Any


_ALLOWED_METHODS = {
    "query", "addRecord", "getRecord", "updateRecord", "deleteRecord", "getSchema",
    "aggregate", "uploadImage", "onUpdated",
    # 附件方法（§9）：入口同为 __SMART_PAGE__.database，但用 nodeId 而非 databaseId。
    "uploadFile", "getDownloadUrl", "getPreviewUrl",
}

# 豁免 DSDK002（不携带 databaseId 键）：
#   - uploadImage（§7）/ onUpdated（§8）：完全无 id；
#   - uploadFile / getDownloadUrl / getPreviewUrl（§9）：用 nodeId（即 databaseId 值）而非 databaseId 键。
_METHODS_WITHOUT_DATABASE_ID = {
    "uploadImage", "onUpdated",
    "uploadFile", "getDownloadUrl", "getPreviewUrl",
}

# db.query 返回契约封闭（见 database-sdk-contract.md §6）
_QUERY_RESULT_KEYS = ("results", "nextCursor", "hasMore")
_FORBIDDEN_RESULT_KEYS = ("records", "success", "data")

# §1.5.5 database 绑定标注：两属性必须成对，data-sp-bindable 取值恒为 "database"。
# 标签正则容忍属性值内出现 ">"（引号包裹的属性值不会误截断）。
_SP_TAG_RE = re.compile(r"<([a-zA-Z][\w:-]*)((?:\"[^\"]*\"|'[^']*'|[^>\"'])*)>", re.S)
_SP_BINDABLE_RE = re.compile(r"data-sp-bindable\s*=\s*(['\"])(.*?)\1", re.S)
_SP_DBID_RE = re.compile(r"data-sp-database-id\s*=\s*(['\"])(.*?)\1", re.S)

# database「渲染意图」信号：把数据写进 DOM 的常见 API。用于 DSDK012 判断页面是否在展示
# database 数据——刻意不依赖函数名（renderData 只是示例名，agent 可能任意命名或内联渲染）。
_DOM_WRITE_RE = re.compile(
    r"\.(?:textContent|innerText|innerHTML|outerHTML|value)\s*=(?!=)"
    r"|\.(?:insertAdjacentHTML|insertAdjacentText|appendChild|append|prepend|replaceChildren)\s*\("
    r"|\.src\s*=(?!=)",
    re.S,
)


def _emit_fail(rule: str, target: str, reason: str, fails: list[tuple[str, str, str]]) -> None:
    fails.append((rule, target, reason))


def _read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _load_schema(args: argparse.Namespace) -> dict[str, Any]:
    raw = ""
    if args.schema_file:
        raw = _read_text_file(args.schema_file)
    elif args.schema:
        raw = args.schema
    else:
        raw = sys.stdin.read()

    try:
        data = json.loads(raw)
    except json.JSONDecodeError as e:
        raise ValueError(f"schema JSON 解析失败: {e}") from e
    if not isinstance(data, dict):
        raise ValueError("schema 必须是 JSON object")
    return data


def _schema_fields(schema: dict[str, Any]) -> set[str]:
    props = schema.get("properties")
    if isinstance(props, dict):
        return {k for k in props.keys() if isinstance(k, str) and k}
    if isinstance(props, list):
        fields = set()
        for item in props:
            if not isinstance(item, dict):
                continue
            name = item.get("name")
            if isinstance(name, str) and name:
                fields.add(name)
        return fields
    return set()


def _strip_comments(js: str) -> str:
    """保留代码与字符串，移除注释，降低注释样例误报概率。"""
    out: list[str] = []
    i = 0
    n = len(js)
    while i < n:
        ch = js[i]
        nxt = js[i + 1] if i + 1 < n else ""

        if ch == "/" and nxt == "/":
            j = i + 2
            while j < n and js[j] not in "\r\n":
                j += 1
            out.append(" ")
            i = j
            continue

        if ch == "/" and nxt == "*":
            j = i + 2
            while j + 1 < n and not (js[j] == "*" and js[j + 1] == "/"):
                j += 1
            out.append(" ")
            i = min(j + 2, n)
            continue

        if ch in ("'", '"', "`"):
            quote = ch
            out.append(ch)
            i += 1
            escaped = False
            while i < n:
                c = js[i]
                out.append(c)
                if escaped:
                    escaped = False
                    i += 1
                    continue
                if c == "\\":
                    escaped = True
                    i += 1
                    continue
                if c == quote:
                    i += 1
                    break
                i += 1
            continue

        out.append(ch)
        i += 1
    return "".join(out)


def _find_matching_paren(text: str, open_pos: int) -> int:
    depth = 0
    quote = ""
    escaped = False
    for i in range(open_pos, len(text)):
        ch = text[i]
        if quote:
            if escaped:
                escaped = False
            elif ch == "\\":
                escaped = True
            elif ch == quote:
                quote = ""
            continue
        if ch in ("'", '"', "`"):
            quote = ch
            continue
        if ch == "(":
            depth += 1
        elif ch == ")":
            depth -= 1
            if depth == 0:
                return i
    return -1


def _iter_sdk_calls(html: str) -> list[tuple[str, str]]:
    """返回 (method, call_body) 列表。"""
    calls: list[tuple[str, str]] = []
    pattern = re.compile(
        r"(?:window\.__SMART_PAGE__\.database|__SMART_PAGE__\.database|\bdb)\.(\w+)\s*\(",
        re.S,
    )
    for m in pattern.finditer(html):
        method = m.group(1)
        open_pos = m.end() - 1
        close_pos = _find_matching_paren(html, open_pos)
        body = html[open_pos + 1:close_pos] if close_pos != -1 else ""
        calls.append((method, body))
    return calls


def _has_database_id(body: str, html: str) -> bool:
    if re.search(r"\bdatabaseId\s*:\s*['\"][^'\"]+['\"]", body):
        return True
    if re.search(r"\bdatabaseId\s*:\s*DATABASE_ID\b", body):
        return bool(re.search(r"\b(?:var|let|const)\s+DATABASE_ID\s*=\s*['\"][^'\"]+['\"]", html))
    return False


def _check_query_param_fields(body: str, fields: set[str], fails: list) -> None:
    """DSDK009：校验 db.query 入参中引用的字段名都存在于 schema.properties。

    覆盖三处字段引用（见 database-sdk-contract.md §4）：
      - sorts[].property          : { property: "字段名", direction: ... }
      - filter 叶子的 property     : { property: { property: "字段名", text: {...} } }
      - fields[]                  : ["字段名A", "字段名B"]
    注：filter 外层 `property:` 后跟对象 `{`，不会被字符串字面量正则命中，只匹配到真正的字段名。
    """
    if not fields:
        return
    qbody = _strip_comments(body)
    for fm in re.finditer(r"\bproperty\s*:\s*['\"]([^'\"]+)['\"]", qbody):
        fld = fm.group(1)
        if fld not in fields:
            _emit_fail("DSDK009", fld,
                       "query 的 sorts/filter 引用了 schema.properties 中不存在的字段", fails)
    fm2 = re.search(r"\bfields\s*:\s*\[([^\]]*)\]", qbody)
    if fm2:
        for sm in re.finditer(r"['\"]([^'\"]+)['\"]", fm2.group(1)):
            fld = sm.group(1)
            if fld not in fields:
                _emit_fail("DSDK009", fld,
                           "query 的 fields 引用了 schema.properties 中不存在的字段", fails)


def _first_callback_param(cb_text: str) -> str | None:
    """从 .then( 回调表达式文本中取第一个形参名（含解构形参原文）。"""
    s = cb_text.lstrip()
    m = (re.match(r"function\s*\*?\s*\(\s*([^)]*)\)", s)
         or re.match(r"\(\s*([^)]*)\)\s*=>", s)
         or re.match(r"([A-Za-z_$][\w$]*)\s*=>", s))
    if not m:
        return None
    params = m.group(1).strip()
    if not params:
        return None
    return params.split(",")[0].strip()


def _iter_query_result_scopes(code: str) -> list[tuple[str | None, str]]:
    """定位每个 db.query(...) 之后访问结果的作用域，返回 (结果标识符, 作用域文本)。

    覆盖两种形态：
      1) db.query(...).then(function(res){ ... })  → 标识符=res，作用域=回调体
      2) var res = await db.query(...);            → 标识符=res，作用域=其后同段文本（截断）
    """
    scopes: list[tuple[str | None, str]] = []
    qpat = re.compile(
        r"(?:window\.__SMART_PAGE__\.database|__SMART_PAGE__\.database|\bdb)\.query\s*\(",
        re.S,
    )
    for m in qpat.finditer(code):
        open_pos = m.end() - 1
        close_pos = _find_matching_paren(code, open_pos)
        if close_pos == -1:
            continue
        rest = code[close_pos + 1:]
        then_m = re.match(r"\s*\.\s*then\s*\(", rest)
        if then_m:
            cb_open = close_pos + then_m.end()  # code 中 .then 的 '(' 位置
            cb_close = _find_matching_paren(code, cb_open)
            if cb_close != -1:
                cb_text = code[cb_open + 1:cb_close]
                scopes.append((_first_callback_param(cb_text), cb_text))
                continue
        prefix = code[max(0, m.start() - 80):m.start()]
        assign_m = re.search(r"(\w+)\s*=\s*await\s*$", prefix)
        if assign_m:
            scopes.append((assign_m.group(1), code[close_pos + 1: close_pos + 601]))
    return scopes


def _check_query_result_access(code: str, fails: list) -> None:
    """DSDK010：db.query 结果属性必须属于 _QUERY_RESULT_KEYS。"""
    for ident, scope in _iter_query_result_scopes(code):
        if not ident:
            continue
        if ident.startswith("{"):  # 解构形参需真解析，退回黑名单避免误报
            for key in _FORBIDDEN_RESULT_KEYS:
                if re.search(r"\b" + key + r"\b", ident):
                    _emit_fail("DSDK010", key,
                               f"db.query 结果不含 '{key}'，应从 results 解构/取数", fails)
            continue

        redecl = re.search(r"\b(?:var|let|const)\s+" + re.escape(ident) + r"\b", scope)
        if redecl:  # 同名变量被复用，截断以免把 DOM 属性算进来
            scope = scope[:redecl.start()]

        seen: set[str] = set()
        pat = re.compile(r"(^|[^\w$.])" + re.escape(ident) + r"\s*\.\s*([A-Za-z_$][\w$]*)")
        for am in pat.finditer(scope):
            key = am.group(2)
            if key in _QUERY_RESULT_KEYS or key in seen:
                continue
            seen.add(key)
            _emit_fail("DSDK010", key,
                       f"db.query 结果不含 '{key}'，只能访问 "
                       f"{'/'.join(_QUERY_RESULT_KEYS)}（记录数组取 results）", fails)


def _collect_valid_db_ids(html: str) -> set[str]:
    """收集 HTML 中可信的 databaseId 字面量：DATABASE_ID 常量声明 + SDK 调用里的 databaseId。"""
    ids: set[str] = set()
    for m in re.finditer(r"\b(?:var|let|const)\s+DATABASE_ID\s*=\s*['\"]([^'\"]+)['\"]", html):
        ids.add(m.group(1))
    for m in re.finditer(r"\bdatabaseId\s*:\s*['\"]([^'\"]+)['\"]", html):
        ids.add(m.group(1))
    return ids


def _check_sp_binding_attrs(html: str, has_read: bool, fails: list) -> None:
    """DSDK011 / DSDK012：database 绑定标注的低误报校验（见 data-page-flow.md §1.5.5）。

    DSDK011（逐元素、纯语法）：
      - data-sp-bindable 与 data-sp-database-id 必须成对出现；
      - data-sp-bindable 取值恒为 "database"；
      - data-sp-database-id 非空，且与 HTML 中出现的 databaseId 字面量一致。
    DSDK012（全局、防「整体漏标」）：
      - 页面有读取类调用（query/getRecord）+ DOM 写入 API（在展示 database 数据）
        却零绑定标注 → 判定整体漏标。用 DOM 写入信号而非函数名，agent 换名/内联也拦得住。

    刻意不逐元素判定「某文本是否语义来自 database」（尤其统计派生），避免高误报污染 lint。
    注意：属性检查基于原始 html，不能用 _strip_comments（会误删 HTML 中 URL 的 //）。
    """
    valid_ids = _collect_valid_db_ids(html)
    any_bindable = False

    for tag_m in _SP_TAG_RE.finditer(html):
        tag = tag_m.group(1)
        attrs = tag_m.group(2)
        bind_m = _SP_BINDABLE_RE.search(attrs)
        dbid_m = _SP_DBID_RE.search(attrs)
        if not bind_m and not dbid_m:
            continue

        if bool(bind_m) != bool(dbid_m):
            missing = "data-sp-database-id" if bind_m else "data-sp-bindable"
            _emit_fail("DSDK011", tag,
                       f"绑定标注属性必须成对出现，<{tag}> 缺少 {missing}", fails)

        if bind_m:
            any_bindable = True
            val = bind_m.group(2).strip()
            if val != "database":
                _emit_fail("DSDK011", tag,
                           f"data-sp-bindable 取值应为 'database'，实际为 '{val}'", fails)

        if dbid_m:
            dbid = dbid_m.group(2).strip()
            if not dbid:
                _emit_fail("DSDK011", tag, "data-sp-database-id 取值不能为空", fails)
            elif valid_ids and dbid not in valid_ids:
                _emit_fail("DSDK011", tag,
                           f"data-sp-database-id='{dbid}' 与 HTML 中出现的 databaseId 不一致",
                           fails)

    if has_read and not any_bindable:
        if _DOM_WRITE_RE.search(_strip_comments(html)):
            _emit_fail("DSDK012", "_binding",
                       "页面读取并渲染了 database 数据（query/getRecord + DOM 写入）"
                       "却未发现任何 data-sp-bindable，判定整体漏标：须对文本直接来自或"
                       "间接派生自 database 的元素加 data-sp-bindable + data-sp-database-id"
                       "（见 §1.5.5）", fails)


def _check_on_updated(on_updated_bodies: list[str], fails: list) -> None:
    """DSDK013：db.onUpdated 重复注册。是否注册、回调内容由业务定，不校验。"""
    if len(on_updated_bodies) > 1:
        _emit_fail("DSDK013", "onUpdated",
                   f"db.onUpdated 被注册 {len(on_updated_bodies)} 次，整页只能注册一个 handler，"
                   "重复注册会让一次数据变更触发多次处理", fails)


# ── 数据完整性（DSDK014/015/016，见 page-quality-check.md）──────────────────

# 续翻信号：hasMore + nextCursor/startCursor 组合出现即视为做了分页拉全量
_HASMORE_RE = re.compile(r"\bhasMore\b")
_CURSOR_RE = re.compile(r"\bnextCursor\b|\bstartCursor\b")

# 显式截断信号：对 query 结果做定长切片 / 限制渲染条数
_SLICE_RE = re.compile(r"\.\s*slice\s*\(\s*0\s*,\s*(\d+)\s*\)")
_SPLICE_RE = re.compile(r"\.\s*splice\s*\(")
# for 循环上限写死为字面量（如 for(i=0;i<10;i++)），且循环体在渲染 database 数据
_FIXED_FOR_RE = re.compile(r"for\s*\([^;]*;\s*[A-Za-z_$][\w$]*\s*<\s*(\d+)\s*;")


def _query_is_list_read(body: str) -> bool:
    """粗判某 db.query 是「列表读取」而非取单条 / 纯聚合：无一定取单条的强信号即视为列表读。

    取单条信号：filter 命中唯一键（这里不深判），或后续只读一条。保守起见：只要不是明显
    的 count / 单条用途，都按列表处理——宁可要求分页，也不放过真列表漏翻页。
    """
    return True


def _check_pagination_fulltake(html: str, code: str, calls, fails: list) -> bool:
    """DSDK014：有列表渲染的 db.query 却无 hasMore+nextCursor 续翻（只查一次当全量 → 超页丢数据）。

    判定：存在 query 调用 + DOM 写入（在渲染）+ 全页无 (hasMore & nextCursor) 续翻信号 → FAIL。
    返回是否命中（供 DSDK015 去重：命中 014 则不再报 015 的"只查一次"类）。
    """
    query_bodies = [b for (mth, b) in calls if mth == "query"]
    if not query_bodies:
        return False
    if not _DOM_WRITE_RE.search(code):
        return False  # 只查不渲染（如仅统计写入某个变量后不落 DOM）不强制
    has_pagination = bool(_HASMORE_RE.search(code) and _CURSOR_RE.search(code))
    if has_pagination:
        return False
    # 全部 query 都非列表读（取单条/聚合）时豁免；当前保守恒为列表读
    if not any(_query_is_list_read(b) for b in query_bodies):
        return False
    _emit_fail("DSDK014", "query",
               "有列表渲染的 db.query 未做分页拉全量（缺 hasMore + nextCursor 续翻）：单次 query "
               "只返回一页（上限 200），数据超一页会被静默截断、统计也会算错。请用 hasMore/nextCursor "
               "递归拉全量再渲染（模板见 data-page-flow.md §3 阶段 4）", fails)
    return True


def _check_illegal_truncate(html: str, code: str, dsdk014_hit: bool, fails: list) -> None:
    """DSDK015：对 database 数据做显式截断（slice(0,N)/splice/固定 for 上限）。

    只查"agent 偷懒式截断"的明显信号——结果作用域内对 query 数据定长切片。
    用户明确要截断（Top N 榜单等）属合法场景，不靠标注豁免，改由 QUALITY_OK 回执自检声明
    （见 page-quality-check.md §5）兜底——避免引入 data-sp-truncate 标注增加 agent 认知负荷。
    """
    for ident, scope in _iter_query_result_scopes(code):
        detail = ""
        if _SLICE_RE.search(scope):
            detail = "results.slice(0,N)"
        elif _SPLICE_RE.search(scope):
            detail = "splice()"
        elif _FIXED_FOR_RE.search(scope) and _DOM_WRITE_RE.search(scope):
            detail = "for 循环写死上限"
        if detail:
            _emit_fail("DSDK015", "query",
                       f"检测到对 database 数据做显式截断（{detail}）：疑似漏渲染数据。"
                       "若确为用户要求（如 Top N 榜单 / 只显示最新几条），在回执 QUALITY_OK 信号"
                       "中标注 数据完整=已确认截断(<原因>) 即可放行；否则请渲染全量", fails)
            return


def _check_mock_fallback(code: str, fails: list) -> None:
    """DSDK016：catch 块内回填假数据 / 硬编码示例数据进入渲染（读不到时给假数据而非空态）。

    信号：catch 回调体内出现「数组字面量赋值 / 调用渲染函数传数组字面量」。保守判定：
    catch 内含 [ {...}, ... ] 这类含对象的数组字面量即视为 mock 兜底。
    """
    for m in re.finditer(r"\.\s*catch\s*\(", code):
        open_pos = m.end() - 1
        close = _find_matching_paren(code, open_pos)
        if close == -1:
            continue
        body = code[open_pos + 1:close]
        # 含对象元素的数组字面量：[ { ... } ] —— 典型的假数据行
        if re.search(r"=\s*\[\s*\{", body) or re.search(r"\(\s*\[\s*\{", body):
            _emit_fail("DSDK016", "catch",
                       "query/addRecord 的 catch 块内疑似回填 mock / 假数据数组：读取失败时应显示"
                       "空态提示（如\"暂无数据\"），禁止用假数据兜底冒充真实数据", fails)
            return


def lint_database_sdk_usage(schema: dict[str, Any], html: str) -> list[tuple[str, str, str]]:
    fails: list[tuple[str, str, str]] = []
    fields = _schema_fields(schema)
    if not fields and not schema.get("sdk_calls_found"):
        _emit_fail("DSDK000", "_schema", "schema.properties 为空或格式非法；请传入 get_database_schema.py 的 stdout JSON", fails)
        return fails

    calls = _iter_sdk_calls(html)
    if not calls:
        _emit_fail(
            "DSDK007",
            "_sdk",
            "HTML 中未找到 database SDK 调用",
            fails,
        )
        return fails

    has_add_record = False
    has_read = False
    has_upload_image = False
    on_updated_bodies: list[str] = []
    for method, body in calls:
        if method not in _ALLOWED_METHODS:
            _emit_fail(
                "DSDK001",
                method,
                f"database SDK 方法应为 {sorted(_ALLOWED_METHODS)}",
                fails,
            )
            continue
        if method == "addRecord":
            has_add_record = True
        if method == "uploadImage":
            has_upload_image = True
        if method == "onUpdated":
            on_updated_bodies.append(body)
        if method in ("query", "getRecord"):
            has_read = True
        if method == "query":
            _check_query_param_fields(body, fields, fails)
        if not _has_database_id(body, html) and method not in _METHODS_WITHOUT_DATABASE_ID:
            _emit_fail(
                "DSDK002",
                method,
                "SDK 调用需要 databaseId 字符串，或使用硬编码 DATABASE_ID 常量",
                fails,
            )

    code_for_keys = _strip_comments(html)

    # DSDK008：出现 addRecord 即必须接入 localStorage 缓存链路——同时命中读、写、清三个动作。
    # 用 _strip_comments 后的代码源匹配，避免注释里写 localStorage 骗过校验。
    if has_add_record:
        need = {
            "localStorage.getItem": r"\blocalStorage\s*\.\s*getItem\s*\(",
            "localStorage.setItem": r"\blocalStorage\s*\.\s*setItem\s*\(",
            "localStorage.removeItem/clear": r"\blocalStorage\s*\.\s*(?:removeItem|clear)\s*\(",
        }
        missing = [k for k, pat in need.items() if not re.search(pat, code_for_keys)]
        if missing:
            _emit_fail(
                "DSDK008",
                "addRecord",
                "含 addRecord 的 HTML 必须接入 localStorage 表单缓存，缺失: " + ", ".join(missing),
                fails,
            )

    # DSDK008（图片）：含 uploadImage 须写 IndexedDB 缓存（见 §7.1）。存在性哨兵，用专属 API 组合，
    # 不泛匹配 .get(/.delete(（会被 formData.get() 等骗过）；不要求 createObjectStore（库已存在时可无）。
    if has_upload_image:
        need_idb = {
            "indexedDB.open": r"\bindexedDB\s*\.\s*open\s*\(",
            ".transaction()": r"\.\s*transaction\s*\(",
            ".objectStore()": r"\.\s*objectStore\s*\(",
            ".put()": r"\.\s*put\s*\(",
            ".delete()": r"\.\s*delete\s*\(",
        }
        missing_idb = [k for k, pat in need_idb.items() if not re.search(pat, code_for_keys)]
        if missing_idb:
            _emit_fail(
                "DSDK008",
                "uploadImage",
                "含 uploadImage 的 HTML 必须用 IndexedDB 缓存待提交图片（防登录重定向丢失，见 §7.1），缺失: "
                + ", ".join(missing_idb),
                fails,
            )

    for m in re.finditer(r"\bproperties\s*\[\s*['\"]([^'\"]+)['\"]\s*\]", code_for_keys):
        key = m.group(1)
        if fields and key not in fields:
            _emit_fail("DSDK003", key, "properties 字段名不在 schema.properties 中", fails)

    for m in re.finditer(r"\brow\s*\[\s*['\"]([^'\"]+)['\"]\s*\]", code_for_keys):
        key = m.group(1)
        if fields and key not in fields:
            _emit_fail("DSDK006", key, "row 字段名不在 schema.properties 中", fails)

    _check_query_result_access(code_for_keys, fails)

    _check_sp_binding_attrs(html, has_read, fails)

    _check_on_updated(on_updated_bodies, fails)

    # 数据完整性（DSDK014/015/016）：仅当页面确有读取类调用时才判
    if has_read:
        dsdk014_hit = _check_pagination_fulltake(html, code_for_keys, calls, fails)
        _check_illegal_truncate(html, code_for_keys, dsdk014_hit, fails)
    _check_mock_fallback(code_for_keys, fails)

    return fails


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--schema", default="")
    parser.add_argument("--schema-file", dest="schema_file", default="")
    parser.add_argument("--html", default="")
    try:
        args, _ = parser.parse_known_args()
    except SystemExit:
        sys.stderr.write("参数解析失败\n")
        return 1

    if not args.html:
        sys.stderr.write("--html 缺失\n")
        return 1

    try:
        schema = _load_schema(args)
        html = _read_text_file(args.html)
    except (OSError, ValueError) as e:
        sys.stderr.write(f"{e}\n")
        return 1

    fails = lint_database_sdk_usage(schema, html)
    if fails:
        for rule, target, reason in fails:
            print(f"MINDX_DBSDK_LINT_FAIL {rule} {target}: {reason}")
        return 2

    print("MINDX_DBSDK_LINT_OK")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
