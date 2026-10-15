#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""mindx-page skill：lint HTML 产物质量（报错 / 性能 / 安全 / 体验）。

用法：
    python3 page/lint_page_quality.py --html <path/to/final.html>
    python3 page/lint_page_quality.py --html <path> --has-database   # 关联 database 的数据页
    python3 page/lint_page_quality.py --html <path> --strict         # WARN 升级为 FAIL
    python3 page/lint_page_quality.py --html <path> --ack "<原因>"    # 声明放行 FAIL（不阻塞上传）

输出协议（见 page-quality-check.md）：
    - 全部通过           → stdout `MINDX_PAGE_QUALITY_OK`，exit 0
    - 仅有 WARN          → stdout `MINDX_PAGE_QUALITY_OK` + 逐行 `MINDX_PAGE_QUALITY_WARN <PQxxx> <target>: <原因>`，exit 0
    - 任一 FAIL          → stdout 逐行 `MINDX_PAGE_QUALITY_FAIL <PQxxx> <target>: <原因>` + 放行提示，exit 2
    - FAIL 但 --ack      → stdout 逐行 `MINDX_PAGE_QUALITY_ACK ...`（如实交代）+ `MINDX_PAGE_QUALITY_OK`，exit 0
    - 输入错误           → stderr 简短提示，exit 1

定位：纯静态、纯本地，不触网、不读 token、不依赖 database schema。核心原则：
**质量门绝不阻塞用户上传**——FAIL 是强修复信号（agent 应尽力修），非上传禁令；修不掉/
确属误报时带 --ack 声明放行，并在回执如实交代。ES6 兼容性（PQ110）为 WARN 不阻塞。
"""

from __future__ import annotations

import argparse
import re
import sys

# ──────────────────────────────────────────────────────────────────────────
# 凭证 / 密钥特征（与 md_to_html.py 的 _SECRET_PATTERNS 同源，此处独立一份用于产物侧硬门）
# ──────────────────────────────────────────────────────────────────────────
_SECRET_PATTERNS = [
    (r"eyJ[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{15,}\.[A-Za-z0-9_-]{10,}", "疑似 JWT / 登录态 token"),
    (r"\bop_[A-Za-z0-9]{16,}\b", "疑似 open-platform token"),
    (r"\btk_[A-Za-z0-9]{16,}\b", "疑似临时令牌 tempToken"),
    (r"Bearer\s+[A-Za-z0-9._-]{20,}", "疑似 Bearer 凭证"),
    (r"(?i)X-Skill-Token\s*[:=]\s*\S+", "疑似 X-Skill-Token 凭证"),
    (r'"(maskedToken|tempToken|tempTokenExpiresAt)"\s*:', "疑似凭证返回信封字段"),
    (r"(?i)\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|private[_-]?key)\b\s*[:=]\s*['\"][^'\"]{12,}['\"]",
     "疑似硬编码密钥 / API Key"),
]

# 本地绝对路径特征（写进 src/href 即泄露本机路径）
_LOCAL_PATH_RE = re.compile(
    r"""(?:src|href)\s*=\s*['\"]\s*(?:file://)?(/Users/|/home/|/root/|/var/|[A-Za-z]:\\)""",
    re.I,
)

# ES5 违规特征（只查 agent 自己写的内联业务脚本）
_ES6_LET_CONST_RE = re.compile(r"\b(?:let|const)\s+[A-Za-z_$]")
_ES6_ARROW_RE = re.compile(r"\([^()]*\)\s*=>|[A-Za-z_$][\w$]*\s*=>")
_ES6_TEMPLATE_RE = re.compile(r"`[^`]*`")
# async/await：排除作对象键（async:）与成员访问（.async）的误报
_ES6_ASYNC_RE = re.compile(r"\basync\s+function\b|\basync\s*\(|\basync\s+[A-Za-z_$]|\bawait\s+[A-Za-z_$('\"]")
_ES6_SPREAD_RE = re.compile(r"\.\.\.[A-Za-z_$\[{]")
# class：排除作对象键（class:）与成员访问（.class）；只认声明形态 class X {/extends
_ES6_CLASS_RE = re.compile(r"(?<![.\w$])class\s+[A-Za-z_$][\w$]*\s*(?:extends|\{)")

# 第三方脚本域名（这些脚本内容不纳入 ES5 / catch 检查，只查 agent 自写业务脚本）
_THIRDPARTY_SRC_HINT = re.compile(r"(?:mermaid|tailwind|font|cdn|jsdelivr|unpkg|bootcdn|staticfile)", re.I)

# SDK 调用（用于 PQ003 catch 检查、PQ004 守卫检查）
_SDK_CALL_RE = re.compile(
    r"(?:window\.__SMART_PAGE__\.database|__SMART_PAGE__\.database|\bdb)\.(\w+)\s*\(",
    re.S,
)

# innerHTML/outerHTML/insertAdjacentHTML 赋值/调用（PQ005 XSS）
_INNERHTML_ASSIGN_RE = re.compile(r"\.(?:innerHTML|outerHTML)\s*=(?!=)\s*(.+?)(?:;|\n|$)")
_INSERT_ADJ_HTML_RE = re.compile(r"\.insertAdjacentHTML\s*\(\s*[^,]+,\s*(.+?)\)", re.S)

# CDN 外链 script
_SCRIPT_TAG_RE = re.compile(r"<script\b([^>]*)>(.*?)</script>", re.S | re.I)
_IMG_TAG_RE = re.compile(r"<img\b([^>]*?)/?>", re.S | re.I)
_STYLE_BLOCK_RE = re.compile(r"<style\b[^>]*>(.*?)</style>", re.S | re.I)
_VIEWPORT_META_RE = re.compile(r"<meta\b[^>]*name\s*=\s*['\"]viewport['\"][^>]*>", re.I)
_GRID_COLS_RE = re.compile(r"grid-template-columns\s*:\s*([^;}]+)", re.I)
# 选择器含 img 的规则块里有 max-width:100%（基线 `img{max-width:100%}` 及变体）
_IMG_MAXW_CSS_RE = re.compile(r"img\b[^{}]*\{[^}]*max-width\s*:\s*100", re.I)
_BIG_PX_WIDTH_RE = re.compile(r"(?:^|[\s:;{])(?:min-)?width\s*:\s*(\d{3,})px", re.I | re.M)

# ── CDN 版本与境外域名（PQ401-402，见 beautify/beautify-guide.md 红线）──
# @latest 版本（不固定 → 升级可能破坏页面）
_LATEST_VERSION_RE = re.compile(r"@latest\b", re.I)
# 境外原始域名（beautify-guide 红线：禁 googleapis/gstatic/jsdelivr 境外原始）
_FORBIDDEN_HOST_RE = re.compile(
    r"https?://(?:[a-z0-9-]+\.)*(?:fonts\.googleapis\.com|fonts\.gstatic\.com|cdn\.jsdelivr\.net|cdnjs\.cloudflare\.com)",
    re.I,
)
_BIG_FONT_PX_RE = re.compile(r"font-size\s*:\s*(\d+)px", re.I)


# ──────────────────────────────────────────────────────────────────────────
# 通用工具（部分逻辑与 lint_database_sdk_usage.py 同构，此处独立实现避免跨脚本 import）
# ──────────────────────────────────────────────────────────────────────────
def _read_text_file(path: str) -> str:
    with open(path, "r", encoding="utf-8") as f:
        return f.read()


def _strip_comments(js: str) -> str:
    """移除 JS 注释（保留字符串字面量原文），降低注释样例误报。"""
    out: list[str] = []
    i, n = 0, len(js)
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


def _strip_regex_literals(js: str) -> str:
    """把正则字面量 /.../ 替换为空串占位，避免其内容（如 [(]、=>、...）干扰括号配平与 ES6 检测。

    判定"是正则而非除法"：一个 / 前的最后一个非空白有效 token 是标识符/数字/`)`/`]`/字符串结尾
    → 除法；否则（前是运算符/逗号/分号/括号开/行首等）→ 正则起始。近似实现，边缘写法宁可漏判
    （漏判时正则被当除法保留原文，不影响多数场景）。
    """
    out: list[str] = []
    i, n = 0, len(js)
    while i < n:
        ch = js[i]
        if ch == "/" and i + 1 < n and js[i + 1] not in ("/", "*"):
            # 回看：决定这个 / 是除法还是正则起始
            prev_txt = "".join(out).rstrip()
            prev = prev_txt[-1] if prev_txt else ""
            is_regex_start = not (prev and (prev.isalnum() or prev in "_$)]}\"'`"))
            if is_regex_start:
                j = i + 1
                escaped = False
                closed = False
                in_class = False
                while j < n:
                    c = js[j]
                    if escaped:
                        escaped = False
                    elif c == "\\":
                        escaped = True
                    elif c == "[":
                        in_class = True
                    elif c == "]":
                        in_class = False
                    elif c == "/" and not in_class:
                        closed = True
                        j += 1
                        break
                    elif c == "\n":
                        break  # 正则字面量不含换行，跨行说明判错，放弃
                    j += 1
                if closed:
                    out.append('""')  # 等长占位（语法上等效空串），吞掉正则内容
                    i = j
                    continue
        out.append(ch)
        i += 1
    return "".join(out)


def _attr(attrs: str, name: str) -> str | None:
    """从标签属性串取某属性值；无值属性（如 async）返回空串标记存在。"""
    m = re.search(r"\b" + re.escape(name) + r"\s*=\s*(['\"])(.*?)\1", attrs, re.S)
    if m:
        return m.group(2)
    if re.search(r"\b" + re.escape(name) + r"\b", attrs):
        return ""
    return None


def _extract_inline_scripts(html: str) -> list[str]:
    """提取 agent 自写的内联 <script> 文本（排除有 src 的外链、第三方库）。"""
    scripts: list[str] = []
    for m in _SCRIPT_TAG_RE.finditer(html):
        attrs, body = m.group(1), m.group(2)
        if _attr(attrs, "src") is not None:
            continue  # 外链脚本不看内容
        if _THIRDPARTY_SRC_HINT.search(attrs):
            continue
        if body.strip():
            scripts.append(body)
    return scripts


def _emit(bucket: list[tuple[str, str, str]], rule: str, target: str, reason: str) -> None:
    bucket.append((rule, target, reason))


# ──────────────────────────────────────────────────────────────────────────
# 报错维度（FAIL）
# ──────────────────────────────────────────────────────────────────────────
def _check_js_syntax(scripts: list[str], fails: list) -> None:
    """PQ001：内联业务脚本存在明显括号 / 引号不配平（无法解析）。

    不做完整 JS parse（无依赖），只查括号配平与未闭合字符串这类"必然报错"信号，保守判定。
    """
    for idx, raw in enumerate(scripts):
        js = _strip_regex_literals(_strip_comments(raw))
        depth = {"(": 0, "[": 0, "{": 0}
        pairs = {")": "(", "]": "[", "}": "{"}
        i, n = 0, len(js)
        unbalanced = False
        while i < n:
            c = js[i]
            if c in ("'", '"', "`"):
                q = c
                i += 1
                esc = False
                closed = False
                while i < n:
                    cc = js[i]
                    if esc:
                        esc = False
                    elif cc == "\\":
                        esc = True
                    elif cc == q:
                        closed = True
                        i += 1
                        break
                    i += 1
                if not closed:
                    _emit(fails, "PQ001", f"script#{idx + 1}", "内联脚本存在未闭合的字符串字面量，页面必然运行报错")
                    unbalanced = True
                    break
                continue
            if c in depth:
                depth[c] += 1
            elif c in pairs:
                depth[pairs[c]] -= 1
                if depth[pairs[c]] < 0:
                    _emit(fails, "PQ001", f"script#{idx + 1}", f"内联脚本括号 '{c}' 多余 / 不配平，页面必然运行报错")
                    unbalanced = True
                    break
            i += 1
        if not unbalanced and any(v != 0 for v in depth.values()):
            kinds = ", ".join(f"'{k}'" for k, v in depth.items() if v != 0)
            _emit(fails, "PQ001", f"script#{idx + 1}", f"内联脚本括号未配平（{kinds}），页面必然运行报错")


def _check_es5(scripts: list[str], warns: list) -> None:
    """PQ102 之后的 ES6 提示（WARN）：内联业务脚本含 ES6+ 语法。

    现代环境大多能跑 ES6，不构成"必然报错"；降为 WARN 提醒兼容性（老 webview 风险），
    不阻塞上传（原则：质量门绝不阻塞用户上传）。
    """
    for idx, raw in enumerate(scripts):
        js = _strip_regex_literals(_strip_comments(raw))
        # 模板字符串先单独查，再从代码里剔除模板字符串内容，避免其内部反引号内的 => 等误伤
        hits: list[str] = []
        if _ES6_TEMPLATE_RE.search(js):
            hits.append("模板字符串(``)")
        js_no_tpl = _ES6_TEMPLATE_RE.sub('""', js)
        if _ES6_LET_CONST_RE.search(js_no_tpl):
            hits.append("let/const")
        if _ES6_ARROW_RE.search(js_no_tpl):
            hits.append("箭头函数(=>)")
        if _ES6_ASYNC_RE.search(js_no_tpl):
            hits.append("async/await")
        if _ES6_SPREAD_RE.search(js_no_tpl):
            hits.append("展开运算符(...)")
        if _ES6_CLASS_RE.search(js_no_tpl):
            hits.append("class")
        if hits:
            _emit(warns, "PQ110", f"script#{idx + 1}",
                  "内联脚本含 ES6+ 语法（" + "、".join(dict.fromkeys(hits)) +
                  "），老 webview 可能不兼容；如需最大兼容请改用 var/function（不阻塞上传）")


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


def _check_sdk_catch(scripts: list[str], fails: list) -> None:
    """PQ003：SDK Promise 调用链缺少 .catch（错误冒泡导致页面异常）。

    对每个 db.xxx( 调用，向后扫描其所在的 Promise 链（.then/.catch/.finally 串联区段），
    要求链上出现 .catch。onUpdated 是同步订阅、不返回 Promise，豁免。
    """
    for idx, raw in enumerate(scripts):
        js = _strip_comments(raw)
        for m in _SDK_CALL_RE.finditer(js):
            method = m.group(1)
            if method == "onUpdated":
                continue
            open_pos = m.end() - 1
            close_pos = _find_matching_paren(js, open_pos)
            if close_pos == -1:
                continue
            # 向后取 Promise 链：连续的 .then(...)/.catch(...)/.finally(...)
            i = close_pos + 1
            chain_has_catch = False
            saw_chain = False
            while True:
                mm = re.match(r"\s*\.\s*(then|catch|finally)\s*\(", js[i:])
                if not mm:
                    break
                saw_chain = True
                link = mm.group(1)
                link_open = i + mm.end() - 1
                link_close = _find_matching_paren(js, link_open)
                if link_close == -1:
                    break
                if link == "catch":
                    chain_has_catch = True
                # then 的第二个实参（onRejected）也算错误处理
                if link == "then":
                    inner = js[link_open + 1:link_close]
                    if _then_has_reject_handler(inner):
                        chain_has_catch = True
                i = link_close + 1
            if saw_chain and not chain_has_catch:
                _emit(fails, "PQ003", f"db.{method}",
                      "SDK 调用的 Promise 链缺少 .catch（或 then 的 onRejected），"
                      "错误会冒泡导致页面异常，请补 .catch 做降级")


def _then_has_reject_handler(then_body: str) -> bool:
    """粗判 .then(onFulfilled, onRejected)：顶层是否有第二个逗号分隔的实参。"""
    depth = 0
    quote = ""
    escaped = False
    for ch in then_body:
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
        elif ch in "([{":
            depth += 1
        elif ch in ")]}":
            depth -= 1
        elif ch == "," and depth == 0:
            return True
    return False


def _check_sdk_guard(scripts: list[str], fails: list) -> None:
    """PQ004：使用了 __SMART_PAGE__ 却无存在性守卫（无 SDK 环境会白屏）。

    守卫信号（任一即可）：对 window.__SMART_PAGE__ / __SMART_PAGE__ 做 typeof / && / ?. / if 判断，
    或对取到的 db 变量做真值判断。整页维度判定，不逐调用点判。
    """
    joined = _strip_comments("\n".join(scripts))
    if "__SMART_PAGE__" not in joined:
        return
    guard_patterns = [
        r"typeof\s+(?:window\.)?__SMART_PAGE__",
        r"(?:window\.)?__SMART_PAGE__\s*&&",
        r"(?:window\.)?__SMART_PAGE__\s*\?\.",
        r"if\s*\(\s*(?:window\.)?__SMART_PAGE__",
        r"window\.__SMART_PAGE__\s*(?:===|!==|==|!=)",
        r"\bif\s*\(\s*!?\s*db\b",
        r"\bif\s*\(\s*db\s*&&",
        r"\bif\s*\(\s*!\s*db\s*\)",
        r"\bdb\s*&&\s*",
    ]
    for pat in guard_patterns:
        if re.search(pat, joined):
            return
    _emit(fails, "PQ004", "__SMART_PAGE__",
          "使用了 __SMART_PAGE__ 但无存在性守卫，无 SDK 环境（离线预览 / 老环境）会整页白屏，"
          "请加 typeof/if 判断并降级为静态或空状态")


# ──────────────────────────────────────────────────────────────────────────
# 安全维度（FAIL）
# ──────────────────────────────────────────────────────────────────────────
def _check_xss(scripts: list[str], html: str, fails: list) -> None:
    """PQ005：innerHTML / outerHTML / insertAdjacentHTML 拼接了未转义变量（XSS 风险）。

    豁免：右值整体被已知转义/消毒函数包裹（escapeHtml / DOMPurify.sanitize / encodeURI 等，
    客观可查）；不再提供"根级声明安全"的后门豁免，避免被滥用绕过检测。
    """
    for idx, raw in enumerate(scripts):
        js = _strip_comments(raw)
        for m in _INNERHTML_ASSIGN_RE.finditer(js):
            rhs = m.group(1).strip()
            if _is_dynamic_html_rhs(rhs) and not _is_sanitized(rhs):
                _emit(fails, "PQ005", f"script#{idx + 1}",
                      "innerHTML/outerHTML 赋值含动态变量拼接，database / 用户数据未转义直接入 DOM 存在 XSS 风险，"
                      "请改用 textContent，或用 escapeHtml/DOMPurify.sanitize/encodeURI 等转义函数包裹")
                break
        for m in _INSERT_ADJ_HTML_RE.finditer(js):
            rhs = m.group(1).strip()
            if _is_dynamic_html_rhs(rhs) and not _is_sanitized(rhs):
                _emit(fails, "PQ005", f"script#{idx + 1}",
                      "insertAdjacentHTML 传入动态变量拼接内容，存在 XSS 风险，"
                      "请用转义函数包裹后再插入")
                break


# 已知转义 / 消毒函数白名单：右值被其一整体包裹 → 视为已转义
_SANITIZE_FN_RE = re.compile(
    r"^(?:[\w$.]*escapeHtml|DOMPurify\.sanitize|[\w$.]*sanitize[\w$]*|"
    r"encodeURI(?:Component)?|escape|[\w$.]*escapeHTML)\s*\(",
    re.I,
)


def _is_sanitized(rhs: str) -> bool:
    """右值是否被已知转义/消毒函数整体包裹。"""
    return bool(_SANITIZE_FN_RE.match(rhs))


def _is_dynamic_html_rhs(rhs: str) -> bool:
    """右值是否为动态 HTML：纯字符串字面量→否；含变量/拼接/模板插值→是。"""
    if not rhs:
        return False
    # 模板字符串带插值 ${...} → 动态
    if "`" in rhs and "${" in rhs:
        return True
    # 逐段剔除字符串字面量后仍有变量样 token（拼接 / 变量引用）→ 动态；
    # 纯字符串字面量剔除后无 token → 安全。
    stripped = _remove_string_literals(rhs)
    if re.search(r"[A-Za-z_$][\w$]*", stripped):
        return True
    return False


def _remove_string_literals(text: str) -> str:
    """逐字符扫描剔除引号字符串 / 模板串（正确配对，不被 .*? 跨字符串误吞）。"""
    out: list[str] = []
    i, n = 0, len(text)
    while i < n:
        c = text[i]
        if c in ("'", '"', "`"):
            q = c
            i += 1
            esc = False
            while i < n:
                cc = text[i]
                if esc:
                    esc = False
                elif cc == "\\":
                    esc = True
                elif cc == q:
                    i += 1
                    break
                i += 1
            continue
        out.append(c)
        i += 1
    return "".join(out)


def _check_secrets(html: str, fails: list) -> None:
    """PQ006：产物残留凭证 / 密钥特征。"""
    hits: list[str] = []
    for pat, label in _SECRET_PATTERNS:
        if re.search(pat, html):
            hits.append(label)
    if hits:
        _emit(fails, "PQ006", "_secret",
              "产物疑似残留凭证 / 密钥（命中：" + "；".join(dict.fromkeys(hits)) +
              "），严禁把 token / key 写进 HTML，请剥离后重生成")


def _check_local_path(html: str, fails: list) -> None:
    """PQ007：src/href 写了本机绝对路径（泄露路径且线上必然 404）。"""
    m = _LOCAL_PATH_RE.search(html)
    if m:
        _emit(fails, "PQ007", "_local_path",
              "src/href 引用了本机绝对路径（如 /Users/.../ 或 C:\\），会泄露本地路径且线上加载失败，"
              "本地图片请走 entry.md §2 图片托管转 COS 直链")


# ──────────────────────────────────────────────────────────────────────────
# 性能 / 体验维度（WARN）
# ──────────────────────────────────────────────────────────────────────────
def _check_img_lazy(html: str, warns: list) -> None:
    """PQ101：<img> 缺 loading="lazy"（前 2 张视为首屏图豁免，无需任何标注）。"""
    imgs = list(_IMG_TAG_RE.finditer(html))
    missing = 0
    for idx, m in enumerate(imgs):
        if idx < 2:
            continue  # 前 2 张默认首屏（hero 区），豁免
        attrs = m.group(1)
        loading = _attr(attrs, "loading")
        if loading is None or loading.strip().lower() != "lazy":
            missing += 1
    if missing:
        _emit(warns, "PQ101", "_img",
              f"{missing} 张非首屏 <img> 缺 loading=\"lazy\"，建议懒加载（页面首屏前 2 张已自动豁免）")


def _check_async_defer(html: str, warns: list) -> None:
    """PQ102：外链 CDN <script> 缺 async/defer（阻塞首屏解析）。"""
    blocking = 0
    for m in _SCRIPT_TAG_RE.finditer(html):
        attrs = m.group(1)
        if _attr(attrs, "src") is None:
            continue
        if _attr(attrs, "async") is not None or _attr(attrs, "defer") is not None:
            continue
        # type="module" 天然 defer
        if (_attr(attrs, "type") or "").strip().lower() == "module":
            continue
        blocking += 1
    if blocking:
        _emit(warns, "PQ102", "_script",
              f"{blocking} 个外链 <script> 缺 async/defer，会阻塞首屏渲染，建议加 defer")


def _check_base64_size(html: str, warns: list) -> None:
    """PQ103：新增大体积 base64 内联图（体积膨胀、首屏慢，见 entry.md §2）。"""
    big = 0
    for m in re.finditer(r"data:image/[a-z0-9.+-]+;base64,([A-Za-z0-9+/=]+)", html, re.I):
        # base64 长度 / 4 * 3 ≈ 字节数；>50KB 记一处
        if len(m.group(1)) * 3 / 4 > 50 * 1024:
            big += 1
    if big:
        _emit(warns, "PQ103", "_base64",
              f"{big} 处 base64 内联图超过 50KB，建议走图片托管转 COS 直链（见 entry.md §2），"
              "减小产物体积、加快首屏与移动端加载")


def _check_img_dims(html: str, warns: list) -> None:
    """PQ104：<img> 缺显式 width/height（布局偏移 CLS 风险）。"""
    missing = 0
    for m in _IMG_TAG_RE.finditer(html):
        attrs = m.group(1)
        style = _attr(attrs, "style") or ""
        has_w = _attr(attrs, "width") is not None or re.search(r"\bwidth\s*:", style)
        has_h = _attr(attrs, "height") is not None or re.search(r"\b(?:height|aspect-ratio)\s*:", style)
        if not (has_w and has_h):
            missing += 1
    if missing:
        _emit(warns, "PQ104", "_img",
              f"{missing} 张 <img> 缺显式尺寸（width/height 或 CSS），加载时易产生布局偏移(CLS)，建议补齐")


def _check_states(scripts: list[str], has_database: bool, warns: list) -> None:
    """PQ105/106/107：关联 database 的页面缺加载态 / 空态 / 错误态。仅 --has-database 时检查。"""
    if not has_database:
        return
    joined = _strip_comments("\n".join(scripts))
    if not _SDK_CALL_RE.search(joined):
        return
    # 加载态：出现 loading / 骨架 / skeleton / spinner / 加载中 等迹象
    if not re.search(r"loading|skeleton|骨架|加载中|spinner|placeholder", joined, re.I):
        _emit(warns, "PQ105", "_state",
              "关联 database 但未见加载态迹象（loading/骨架屏），数据拉取期间可能白屏，建议加载中提示")
    # 空态：暂无数据 / empty / 没有 等
    if not re.search(r"暂无|empty|无数据|没有.{0,4}数据|no\s*data|空", joined, re.I):
        _emit(warns, "PQ106", "_state",
              "关联 database 但未见空态提示（如\"暂无数据\"），表内无数据时页面会空白，建议补空态")
    # 错误态：catch 里是否有用户可见提示（非仅 console）
    has_visible_err = False
    for m in re.finditer(r"\.catch\s*\(", joined):
        open_pos = m.end() - 1
        close = _find_matching_paren(joined, open_pos)
        if close == -1:
            continue
        body = joined[open_pos + 1:close]
        # 去掉 console.* 后仍有 DOM 写入 / alert / 提示函数 → 视为有可见错误处理
        body_wo_console = re.sub(r"console\s*\.\s*\w+\s*\([^)]*\)", "", body)
        if re.search(r"textContent|innerText|innerHTML|alert\s*\(|show\w*|toast|提示|失败|错误|error",
                     body_wo_console, re.I):
            has_visible_err = True
            break
    if not has_visible_err:
        _emit(warns, "PQ107", "_state",
              "关联 database 但 query/addRecord 的错误处理未见用户可见提示（仅 console），"
              "失败时用户无感知，建议加错误态提示")


def _check_submit_disable(scripts: list[str], html: str, warns: list) -> None:
    """PQ108：表单 submit 后按钮无 disable（可重复提交）。"""
    joined = _strip_comments("\n".join(scripts))
    if "addEventListener" not in joined and "onsubmit" not in html.lower():
        return
    if not re.search(r"addEventListener\s*\(\s*['\"]submit['\"]", joined) and "onsubmit" not in html.lower():
        return
    if not re.search(r"\.disabled\s*=\s*true", joined):
        _emit(warns, "PQ108", "_submit",
              "表单提交处理未见按钮 disabled=true，用户可能重复点击造成重复提交，"
              "建议提交期间禁用按钮")


def _check_large_dom(scripts: list[str], warns: list) -> None:
    """PQ109：疑似超大 DOM 一次性渲染（大列表 innerHTML 全量拼接，无分批 / 虚拟滚动迹象）。

    保守判定：出现 forEach/for + innerHTML += 累加拼接，且未见分批(slice/batch/虚拟滚动)迹象时提示。
    """
    joined = _strip_comments("\n".join(scripts))
    if not re.search(r"\.innerHTML\s*\+=|innerHTML\s*=\s*\w+\s*\.\s*(?:map|join)", joined):
        return
    loop_render = re.search(r"(?:forEach|for\s*\()[^;]*\{[^}]*innerHTML\s*\+=", joined, re.S)
    if not loop_render:
        return
    if re.search(r"virtual|virtualScroll|虚拟|requestAnimationFrame|slice\s*\(|documentFragment|createDocumentFragment",
                 joined, re.I):
        return
    _emit(warns, "PQ109", "_dom",
          "疑似循环内 innerHTML += 逐条拼接大列表（无分批 / 虚拟滚动迹象），数据量大时会卡顿，"
          "建议 DocumentFragment 批量插入或虚拟滚动")


# ──────────────────────────────────────────────────────────────────────────
# 移动端兼容维度（PQ201-205）
# ──────────────────────────────────────────────────────────────────────────
def _extract_css(html: str) -> str:
    """提取全部 <style> 块内容（布局主体在 <style>，内联 style 不查）。"""
    return "\n".join(m.group(1) for m in _STYLE_BLOCK_RE.finditer(html))


def _is_presentation(html: str) -> bool:
    """presentation 档（根标记 data-wbp）：16:9 设计盒固定尺寸是设计意图，
    靠播放器等比缩放适配移动端 → 豁免多列降级 / px 宽度 / 大字号检查。"""
    m = re.search(r"<html\b[^>]*>", html, re.I)
    return bool(m and re.search(r"\bdata-wbp\b", m.group(0)))


def _check_mobile_viewport(html: str, fails: list) -> None:
    """PQ201：缺 viewport meta（width=device-width）。"""
    m = _VIEWPORT_META_RE.search(html)
    if not m or "width=device-width" not in re.sub(r"\s+", "", m.group(0).lower()):
        _emit(fails, "PQ201", "_viewport",
              "缺少 <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">，"
              "移动端会被当桌面宽渲染后整体缩小，版式必然错乱（模板已内置，富化时不得删除）")


def _is_multi_col_grid(value: str) -> bool:
    """grid-template-columns 值是否多列（≥2 track）。auto-fit/auto-fill 天然自适应豁免。"""
    v = value.strip()
    if re.search(r"repeat\(\s*(?:auto-fit|auto-fill)", v):
        return False  # 自适应列数，容器变窄自动降列
    m = re.search(r"repeat\(\s*(\d+)", v)
    if m:
        return int(m.group(1)) >= 2
    # 无 repeat：数顶层 track token（minmax(...) 整体算一个 track）
    v2 = re.sub(r"(?:minmax|fit-content)\s*\([^)]*\)", "T", v)
    tokens = [t for t in v2.split()
              if t == "T" or re.match(r"^[\d.]+(?:fr|px|rem|em|%|vw|vh)$", t) or t in ("auto", "min-content", "max-content")]
    return len(tokens) >= 2


def _iter_media_blocks(css: str):
    """提取每个顶层 @media ... { ... } 块内容（大括号配对，容忍嵌套规则块）。"""
    for m in re.finditer(r"@media[^{]*\{", css):
        start = m.end() - 1
        depth = 0
        i = start
        while i < len(css):
            if css[i] == "{":
                depth += 1
            elif css[i] == "}":
                depth -= 1
                if depth == 0:
                    yield css[start + 1:i]
                    break
            i += 1


def _check_mobile_grid(css: str, html: str, fails: list) -> None:
    """PQ202：多列 grid 布局但 @media 内无单列降级（移动端挤爆的最常见根因）。

    覆盖 <style> 块与元素内联 style；内联 style 上的多列 grid 无法用 @media 降级，
    直接判违规（内联样式不支持媒体查询，注定移动端不降列）。
    """
    # 内联 style 上的多列 grid：无法媒体查询降级，直接违规
    for m in re.finditer(r"style\s*=\s*(['\"])(.*?)\1", html, re.S | re.I):
        for v in _GRID_COLS_RE.findall(m.group(2)):
            if _is_multi_col_grid(v):
                _emit(fails, "PQ202", "_mobile",
                      "元素内联 style 写了多列 grid（无法用 @media 降级，移动端必挤爆）："
                      "请把多列 grid 移到 <style> 并加 @media (max-width:640px) 单列降级，"
                      "或改用 repeat(auto-fit, minmax(...)) 自适应")
                return
    # <style> 块内的多列 grid：需有 @media 单列降级
    if not any(_is_multi_col_grid(v) for v in _GRID_COLS_RE.findall(css)):
        return
    for block in _iter_media_blocks(css):
        for v in _GRID_COLS_RE.findall(block):
            if not _is_multi_col_grid(v):  # @media 内出现单列降级
                return
    _emit(fails, "PQ202", "_mobile",
          "存在多列 grid 布局（grid-template-columns ≥2 列）但 @media 内无单列降级："
          "移动端多列不降级会挤爆/横向滚动。请在 @media (max-width: 640px) 内加 "
          "grid-template-columns: 1fr（或用 repeat(auto-fit, minmax(...)) 自适应）")


def _check_img_maxwidth(html: str, css: str, fails: list) -> None:
    """PQ203：<img> 无 max-width:100% 约束（大图撑破移动端布局）。"""
    if not _IMG_TAG_RE.search(html):
        return
    if _IMG_MAXW_CSS_RE.search(css):
        return
    # 内联 style 兜底：每个 img 都带 max-width:100% / width:100%
    for m in _IMG_TAG_RE.finditer(html):
        attrs = m.group(1)
        style = (_attr(attrs, "style") or "")
        if not re.search(r"max-width\s*:\s*100|width\s*:\s*100\s*%", style):
            _emit(fails, "PQ203", "_img",
                  "CSS 缺少 img { max-width: 100%; height: auto; } 约束：大图在移动端会撑破"
                  "布局产生横向滚动（基线模板已内置，富化重写 CSS 时不得丢失）")
            return


def _check_mobile_px_width(css: str, warns: list) -> None:
    """PQ204：写死大 px 宽度（>480px 的 width/min-width），窄屏溢出风险。"""
    big = [int(m.group(1)) for m in _BIG_PX_WIDTH_RE.finditer(css) if int(m.group(1)) > 480]
    if big:
        _emit(warns, "PQ204", "_mobile",
              f"{len(big)} 处 width/min-width 写死超过 480px（最大 {max(big)}px），"
              "窄屏可能横向溢出；建议改 max-width + 百分比 / min() / clamp()")


def _check_mobile_font_size(css: str, warns: list) -> None:
    """PQ205：大字号（≥40px，Display Hero 级）固定 px 无 clamp，小屏溢出/过大。"""
    big = [int(m.group(1)) for m in _BIG_FONT_PX_RE.finditer(css) if int(m.group(1)) >= 40]
    if big:
        _emit(warns, "PQ205", "_mobile",
              f"{len(big)} 处 font-size ≥40px 用固定 px（最大 {max(big)}px），"
              "建议 Hero/大标题用 clamp() 随视口缩放（如 clamp(28px, 5vw, 56px)）")


# ──────────────────────────────────────────────────────────────────────────
# CDN 版本与境外域名（PQ401-402）
# ──────────────────────────────────────────────────────────────────────────
def _check_cdn_version(html: str, warns: list) -> None:
    """PQ401：外链资源用 @latest（版本飘移破坏页面）。WARN 不强制（境外资源/最新版仅建议）。"""
    for m in _SCRIPT_TAG_RE.finditer(html):
        src = _attr(m.group(1), "src") or ""
        if _LATEST_VERSION_RE.search(src):
            _emit(warns, "PQ401", "script@latest",
                  "外链脚本用 @latest 版本，升级可能破坏页面，建议固定版本号"
                  "（beautify-guide 红线）")
            return
    for m in re.finditer(r"<link\b[^>]*?/?>", html, re.I):
        href = _attr(m.group(0), "href") or ""
        if _LATEST_VERSION_RE.search(href):
            _emit(warns, "PQ401", "link@latest",
                  "外链样式用 @latest 版本，升级可能破坏样式，建议固定版本号")
            return


def _check_cdn_forbidden_host(html: str, warns: list) -> None:
    """PQ402：外链资源指向境外原始域名（国内打不开/慢）。WARN。"""
    hits = set()
    for m in _SCRIPT_TAG_RE.finditer(html):
        src = _attr(m.group(1), "src") or ""
        h = _FORBIDDEN_HOST_RE.search(src)
        if h:
            hits.add(h.group(0))
    for m in re.finditer(r"<link\b[^>]*?/?>", html, re.I):
        href = _attr(m.group(0), "href") or ""
        h = _FORBIDDEN_HOST_RE.search(href)
        if h:
            hits.add(h.group(0))
    if hits:
        _emit(warns, "PQ402", "_cdn",
              f"{len(hits)} 处外链用境外原始域名（{', '.join(sorted(hits))}），"
              "国内访问慢/不可达，建议换国内镜像（fonts.font.im / cdn.bootcdn.net 等，"
              "见 beautify-guide CDN 镜像表）")


# ──────────────────────────────────────────────────────────────────────────
# 主流程
# ──────────────────────────────────────────────────────────────────────────
def lint_page_quality(html: str, has_database: bool) -> tuple[list, list]:
    """返回 (fails, warns)，各元素为 (rule, target, reason)。"""
    fails: list[tuple[str, str, str]] = []
    warns: list[tuple[str, str, str]] = []
    scripts = _extract_inline_scripts(html)

    # FAIL：报错
    _check_js_syntax(scripts, fails)
    _check_sdk_catch(scripts, fails)
    _check_sdk_guard(scripts, fails)
    # FAIL：安全
    _check_xss(scripts, html, fails)
    _check_secrets(html, fails)
    _check_local_path(html, fails)

    # WARN：性能 / 兼容性
    _check_img_lazy(html, warns)
    _check_async_defer(html, warns)
    _check_base64_size(html, warns)
    _check_img_dims(html, warns)
    _check_es5(scripts, warns)
    # WARN：体验
    _check_states(scripts, has_database, warns)
    _check_submit_disable(scripts, html, warns)
    _check_large_dom(scripts, warns)

    # 移动端兼容：viewport/img 约束恒查；多列降级/px 宽/大字号在 presentation 档豁免（设计盒固定是意图）
    css = _extract_css(html)
    presentation = _is_presentation(html)
    _check_mobile_viewport(html, fails)
    _check_img_maxwidth(html, css, fails)
    if not presentation:
        _check_mobile_grid(css, html, fails)
        _check_mobile_px_width(css, warns)
        _check_mobile_font_size(css, warns)

    # CDN 版本与境外域名（均为 WARN 不强制）
    _check_cdn_version(html, warns)
    _check_cdn_forbidden_host(html, warns)

    return fails, warns


def main() -> int:
    parser = argparse.ArgumentParser(add_help=False)
    parser.add_argument("--html", default="")
    parser.add_argument("--has-database", dest="has_database", action="store_true")
    parser.add_argument("--strict", action="store_true")
    parser.add_argument("--ack", dest="ack", default="",
                        help="带说明放行 FAIL（agent 已尽力修复/人工确认，质量门不阻塞上传）")
    try:
        args, _ = parser.parse_known_args()
    except SystemExit:
        sys.stderr.write("参数解析失败\n")
        return 1

    if not args.html:
        sys.stderr.write("--html 缺失\n")
        return 1

    try:
        html = _read_text_file(args.html)
    except OSError as e:
        sys.stderr.write(f"{e}\n")
        return 1

    fails, warns = lint_page_quality(html, args.has_database)

    if args.strict:
        fails = fails + warns
        warns = []

    if fails and not args.ack:
        for rule, target, reason in fails:
            print(f"MINDX_PAGE_QUALITY_FAIL {rule} {target}: {reason}")
        print("MINDX_PAGE_QUALITY_NOTE: FAIL 为强修复信号但不阻塞上传——尽力修复后重跑；"
              "确属误报或无法修复时，带 --ack \"<原因>\" 声明后放行")
        return 2

    if fails and args.ack:
        # 已声明放行：如实列出未修复项（供回执交代），但不阻塞
        for rule, target, reason in fails:
            print(f"MINDX_PAGE_QUALITY_ACK {rule} {target}: {reason}")

    print("MINDX_PAGE_QUALITY_OK")
    if args.ack:
        print(f"MINDX_PAGE_QUALITY_NOTE: ack={args.ack}")
    for rule, target, reason in warns:
        print(f"MINDX_PAGE_QUALITY_WARN {rule} {target}: {reason}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
