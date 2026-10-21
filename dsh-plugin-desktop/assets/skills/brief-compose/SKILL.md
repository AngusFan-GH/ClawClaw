---
name: brief-compose
description: 起草千字以内的通知、简介、备忘录、说明和工作小结；按用户要求交付正文或生成本地 Word 文档。
user-invocable: true
disable-model-invocation: false
---

# 短文与通知快写

用于无已有文档的短篇创作，通常少于 1000 字。已有文件的修订使用 `office-word-workflow`；长篇材料按对应写作技能处理。

## 撰写与交付

1. 从用户材料提取受众、用途、事实与口吻；缺失日期、联系人、金额等用明确待填项，不编造。
2. 直接完成用户所需正文，核对字数、行动要求和前后事实。只有用户要求 Word 文件时才进入转换流程。
3. Word 文件优先使用当前可用的文档生成工具；也可使用下面随包附带的 HTML 转换器。工具与 Python 依赖必须先确认，技能加载不代表工具已安装。
4. 写入用户指定路径或当前工作区内的输出目录，避免覆盖已有文件。读取生成的 DOCX 检查正文、标题及关键数据；有渲染工具时检查版面。
5. 交付已存在文件的绝对路径链接；仅在环境确有预览工具时调用预览。无法生成文件时说明原因并提供正文，不声称已生成或预览。

## 随包 HTML 转换器

以本次加载的 SKILL.md 所在目录为 `skill_dir`。迁移后所有技能是平级目录，不存在旧宿主的 plugin_root。读取 `../html-to-docx/SKILL.md` 了解转换能力；转换器位于 `../html-to-docx/scripts/html_to_docx/`。

选用已配置且具备转换依赖的 Python（例如 `python-docx`、`lxml`、`Pillow`、`click`，以实际 import 检查结果为准）。不要自动下载运行时或安装包；缺失时使用已可用的文档工具，或说明需要配置环境。

在 `../html-to-docx/scripts/` 的绝对目录下执行（将占位符替换成真实路径）：

```bash
<python绝对路径> -m html_to_docx convert <输入HTML绝对路径> -o <输出DOCX绝对路径> --page-size A4
```

转换成功标志：退出码为 0、返回 success 为 true、输出文件存在且可读。仍需检查内容，不能只凭返回路径判定完成。失败时保留正文，说明实际错误。

## HTML 生成

按用户创作指令撰写正文，输出**完整 HTML 文件**（`<!DOCTYPE html>`、`<head>` 含 `charset`、内嵌 `<style>` 均可，UTF-8、无 BOM）。篇幅控制在用户给出的 X 字以内。

**最低要求**：必须有 `<body>` 且含实际正文；用户明确要求新建空白文档时例外。其他创作请求若生成后 body 无可渲染正文，必须重新生成 HTML，禁止转换或交付空 docx。

**其余版式**（标题层级、段落样式、是否用表格分栏等）由模型自行决定，无固定骨架。

### 字体与字号建议

字号请用 **`pt`（磅）**，**不要用 `px`**。`html-to-docx` 按 pt 写入 Word；常见误用 `13px` 在 Word 里约 **9.5pt**，正文偏小。

| 层级 | 建议字号 | 建议字体 |
|------|----------|----------|
| 正文 `p` / `li` / `td` | **12pt**（默认） | 宋体 / SimSun |
| 一级标题 `h1` | 18–22pt | 黑体 / SimHei |
| 二级标题 `h2` | 14–16pt | 黑体 / SimHei |
| 三级标题 `h3` | 12–14pt | 黑体 / SimHei |
| 辅助说明、落款 | 10–10.5pt | 宋体 / SimSun |

- 用户未指定字号时，正文**默认 12pt**，不要小于 **10.5pt**。
- 因转换器**块级 CSS 不继承**（见下节），`font-size` / `font-family` 须写在各 `p`、`h1`、`h2`、`li`、`td` 等块级元素上，不要只写在 `body` 上。

```

---

## HTML → docx 转换约束（仅引擎硬限制）

以下规则来自 `html-to-docx` 转换器能力边界；**违反会导致 docx 排版错乱或信息丢失**，其余 HTML/CSS 写法不受限。

### 1. 禁止 Grid / 定义列表

- **禁** `display:grid` / `grid-template-*` → 多列对齐改用 `<table>`
- **禁** `<dl>/<dt>/<dd>` → 键值对改用两列 `<table>`

### 2. 块级 CSS 不继承

转换器**不做**块级样式继承。父元素上的 `text-align` / `font-family` / `color` / `font-size` **不会**下发到子 `<p>` / `<h1>` 等；需要生效的样式请写在各块级元素自身上。

### 3. `<hr>` 装饰线

`<hr>` 在 docx 中只能变成**满版下边框**，无法保留居中短线/定宽装饰线；不要用 `<hr>` 做标题区装饰分隔。

### 4. 左边框段落

带 `border-left` 的块，文字开头加 `&nbsp;&nbsp;`（Word 左边框无可靠间距）。

### 5. 多段落底纹块

整块底纹 + 多段落富文本 → 用裸单列 `<table><tr><td>…</td></tr></table>`，不要用多个 `<div>` 拼底纹。

### 6. 分节 / 页眉页脚（仅需要时）

- 需要分页结构：顶层 `<section role="...">`（无 section 则单节）
- 需要页码/页眉：`<style>` 内 `@page` 子集（`counter(page)` / `counter(pages)` / `string-set` + `STYLEREF`）
- **不支持** `@page :first`、`@page { size }` 等扩展语法（忽略 + warning）
- 需要封面时用户须明确要求；配合 `@page cover { … content: none }` + `section[role="cover"] { page: cover; }`

### 7. 可选扩展标签（用了才需遵守其契约）

| 标签 / 属性 | 说明 |
|-------------|------|
| `<div data-component="callout\|divider\|section-marker\|data-card">` | 装饰组件 |
| `<span data-docx-field="..." data-placeholder="...">` | 转 docx 书签；同 HTML 内唯一，匹配 `^[A-Za-z][A-Za-z0-9_-]{0,63}$` |
| `<meta name="docx-page-size" content="A4">` | 声明页面尺寸（默认 A4） |

---
