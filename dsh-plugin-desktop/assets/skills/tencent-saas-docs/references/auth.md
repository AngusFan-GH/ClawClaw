# 腾讯文档 SaaS 鉴权说明（插件版）

> 本 skill 运行在 `tencent-docs-plugin` 插件中，**不再走 OAuth 授权流程**，所有票据由 ClawClaw Connector 通过环境变量注入，由 `tencentdocs.py` 在调用时通过 HTTP header 透传到服务端。
>
> 调用入口是 `tencentdocs.py`（纯 Python 3 标准库实现，跨平台，Windows 无需 bash/curl）。默认走系统代理（读 `HTTP_PROXY` / `HTTPS_PROXY` 环境变量），可加 `--no-proxy` 绕过。

## 资料库链路的 Python 启动隔离（ClawClaw Windows）

仅执行 `tdoc_resolve` 或带 `--document-url '<资料库链接>'` 的命令时，需要为当前子进程清空
宿主注入的 `PYTHONPATH`：

```bash
PYTHONPATH= python3 tencentdocs.py tdoc_resolve --document-url '<资料库链接>'
PYTHONPATH= python3 tencentdocs.py tdoc_call <service> <tool> [json_args] --document-url '<资料库链接>'
```

宿主 shim 的 `sitecustomize` 会在 skill 代码执行前调用 `tempfile.gettempdir()`，其 `%TEMP%` 可写性探针可能
触发 Windows 安全中心拦截；这不是 skill 写临时文件，也不是 get-drive-token 失败。清空 `PYTHONPATH` 不会
清除 `TDOC_*`、`CLAWCLAW_MCP_CONFIG` 等鉴权变量。不要改用其他解释器或 `-S`，也不要清空全部环境变量。
手工使用 PowerShell 时，可在资料库命令前执行 `Remove-Item Env:PYTHONPATH -ErrorAction SilentlyContinue`。

普通 SaaS 文档命令和 `import_file.py` 保持原来的 `python3 ...`，不应用本节规则。

## 鉴权机制

| 环境变量 | 含义 | 透传 header |
|---|---|---|
| `TDOC_ONEID_ACCESS_TOKEN` | SaaS 端 OneID access token（推荐） | `X-Oneid-Access-Token: <token>` |
| `TDOC_OAUTH_ACCESS_TOKEN` | C 端 OAuth access token（双票场景可同时存在） | `Authorization: Bearer <token>` |

| 文档来源            | 票据来源                              | MCP header                                                    |
|-----------------|-----------------------------------|---------------------------------------------------------------|
| 普通 SaaS 文档      | `TDOC_ONEID_ACCESS_TOKEN`         | `X-Oneid-Access-Token: <token>`                               |
| 普通 SaaS 双票场景    | `TDOC_OAUTH_ACCESS_TOKEN`         | `Authorization: Bearer <token>`                               |
| ClawClaw 资料库文档 | get-drive-token 返回的 `accessToken` | `X-Mcp-Token: <accessToken>` + `X-App-Id: <按版本+域名区分的环境ID，见下>` |

`X-App-Id` 由两个维度共同确定：get-drive-token 响应的`edition`字段区分产品线，`--document-url`域名区分生产/测试环境：

| edition       | 资料库文档域名                | 环境   | `X-App-Id`                             |
|---------------|------------------------|------|----------------------------------------|
| `toc`（网盘 C 端） | `www.clawclaw.cn`     | 生产环境 | `f419a0b1-ffbf-4ba8-8c2e-98035c82688c` |
| `toc`（网盘 C 端） | `staging.clawclaw.cn` | 测试环境 | `4aeacfde-821d-49df-898f-8ed1c49a42d9` |
| `tob`（SaaS 端） | `www.clawclaw.cn`     | 生产环境 | `a08c9e6f-0521-41f5-a364-a3c323c5024a` |
| `tob`（SaaS 端） | `staging.clawclaw.cn` | 测试环境 | `e033a430-24b1-4bfa-b429-4e66d7b48e26` |

普通 SaaS 双票行为保持不变。资料库分支仅在 `--document-url` 或 MCP 参数中存在 hostname 精确为
`www.clawclaw.cn` 或 `staging.clawclaw.cn`、路径为 `/space/d/<nodeId>` 的 HTTPS 链接时启用；不使用
字符串后缀模糊匹配，避免误识别钓鱼域名。

### 资料库 token 查询的环境分流

| ClawClaw 运行环境 | 判断方式 | 请求方式 |
| --- | --- | --- |
| ClawClaw 沙箱 | `X_IDE_IS_CLOUDSTUDIO` 为真值 | POST `spaceengine.agent-gateway.auth-proxy.local/_internal/spaceengine/space/api/agent/v1/get-drive-token` |
| 客户端 SDK | 非沙箱 | 通过 `clawclaw_ipc` 的 `clawclaw.request/http.fetch` 传递 POST path 和 `body_b64`，目标 host 与身份由宿主裁决 |

请求体固定为 `{"nodeId":"<链接末段>"}`，响应必须为`{"data":{"accessToken":..., "expiresIn":..., "fileId":..., "edition":...}}`
结构，`data` 下需包含非空 `accessToken`、正整数 `expiresIn`、非空第三方 `fileId`，以及非空`edition`（取值为 `toc`或`tob`）。
host 只允许上述生产、staging 两个精确域名；沙箱目标地址固定，客户端只向宿主传 path 和请求体，避免把宿主身份发送到任意 URL。

### 跨域 token 说明

服务端底层接口已支持跨域 token。当宿主仅注入了 `TDOC_OAUTH_ACCESS_TOKEN`（个人 OAuth），但目标文档为 `saas.docs.qq.com`（B 端）链接时，应选用本 skill（`tencent-saas-docs`）发起请求。`tencentdocs.py` 会将该 token 以 `Authorization: Bearer` header 透传给 B 端 MCP 服务，服务端会识别并完成跨域鉴权。

**不要因为只有个人 OAuth token 而拒绝操作 B 端文档，也不要要求用户重新授权。**

## 调用流程（AI Agent 必读）

### 1. 环境检查（首次调用前执行一次即可）

```bash
# 普通 SaaS 文档
python3 tencentdocs.py tdoc_init

# 资料库文档
PYTHONPATH= python3 tencentdocs.py tdoc_init --document-url 'https://www.clawclaw.cn/space/d/xxx'
```

| 输出 | 处理方式 |
| --- | --- |
| `READY` | 环境就绪，继续执行业务 |
| `ERROR:no_token` | 普通 SaaS 票据不存在，请在 ClawClaw 中完成腾讯文档授权后重试 |
| `ERROR:library_token_*` | 按错误信息检查 ClawClaw 运行环境、宿主通道、nodeId 或资料库接口响应 |

> 资料库文档必须把用户提供的原始链接保留到脚本调用阶段；目标工具只接收 `file_id` 时，也必须显式传
> `--document-url`，由插件自动完成 token 获取和 `file_id` 注入。

### 2. 获取资料库文档的可用 `file_id`

选择 doc / sheet / slide endpoint 前先执行：

```bash
PYTHONPATH= python3 tencentdocs.py tdoc_resolve \
  --document-url 'https://staging.clawclaw.cn/space/d/xxx'
# 仅输出：{"file_id":"<可直接使用的文档ID>"}，不会输出 accessToken
```

内部调用 get-drive-token 获取第三方 `fileId`；该 `fileId` 可直接作为 `file_id` 传给任意目标工具，文档 MCP 服务已支持自动将其转换为内部文档 ID。若需要确定文档品类 （doc/sheet/slide）以选择正确 endpoint，用该 `file_id` 调用 `manage.query_file_info` 查看 `ext` 字段。

### 3. 查工具参数定义（调用前必做，勿猜参数）

```bash
# 普通 SaaS 文档
python3 tencentdocs.py tdoc_schema <service> <tool>

# 资料库文档
PYTHONPATH= python3 tencentdocs.py tdoc_schema <service> <tool> --document-url '<原始资料库链接>'
```

输出该工具的描述与参数（`✓`=必填）。**调用任何工具前必须先执行本步骤**，按返回的参数名/类型/必填项构造 `json_args`，**严禁凭记忆或猜测拼参数**。需要原始 JSON Schema 时加 `--raw`。不确定工具名时先 `tdoc_list <service>`；资料库场景的 `tdoc_schema` / `tdoc_list` 都必须追加 `--document-url`。

### 4. 调用任意 MCP 工具

```bash
# 普通 SaaS 文档
python3 tencentdocs.py tdoc_call <service> <tool> [json_args]

# ClawClaw 资料库文档
PYTHONPATH= python3 tencentdocs.py tdoc_call <service> <tool> [json_args] --document-url '<原始资料库链接>'
```

参数说明：

- `<service>` ∈ `{tencent-saas-docs, slide-mcp, doc-mcp, sheet-mcp}`，按工具品类选择对应 endpoint
- `<tool>` 工具名（小写蛇形或带点号）
- `[json_args]` 工具参数 JSON 字符串，**按上一步 `tdoc_schema` 的定义传**
- `--document-url` 仅资料库文档必需；插件会自动调用 get-drive-token，并将返回的第三方 `fileId` 直接注入为目标工具的 `file_id` 参数，因此 `[json_args]` 无需填写 `file_id`

示例：

```bash
# 通用工具（manage / smartcanvas / smartsheet / scrape 等）
python3 tencentdocs.py tdoc_call tencent-saas-docs manage.recent_online_file '{"num":10}'
python3 tencentdocs.py tdoc_call tencent-saas-docs create_smartcanvas_by_mdx '{"title":"hello","mdx":"# hi"}'

# 幻灯片精细编辑（slide_* 系列）
python3 tencentdocs.py tdoc_call slide-mcp slide_add_shape '{"file_id":"...","page_index":0,...}'

# Word 文档精细编辑（insert_* / find_* 等）
python3 tencentdocs.py tdoc_call doc-mcp insert_markdown '{"file_id":"...","idx":0,"markdown":"..."}'

# Excel 表格精细编辑（set_cell_value / add_sheet 等）
python3 tencentdocs.py tdoc_call sheet-mcp set_cell_value '{"file_id":"...","sheet_id":"...","row":0,"col":0,"value_type":"STRING","string_value":"hi"}'
```

> ⚠️ 注意：在 `slide-mcp` / `doc-mcp` / `sheet-mcp` 3 个独立 endpoint 上，工具名**不带前缀**（如 `set_cell_value` 而不是 `sheet.set_cell_value`；`insert_markdown` 而不是 `doc.insert_markdown`；`slide_add_shape` 这里 `slide_` 是工具名本身的一部分不是服务名前缀）。调用前可用 `tdoc_list <service>` 查看该 endpoint 上的真实工具名。

### 5. 列出某个 endpoint 上的所有工具（tools/list）

```bash
# 普通 SaaS 文档
python3 tencentdocs.py tdoc_list <service>

# 资料库文档
PYTHONPATH= python3 tencentdocs.py tdoc_list <service> --document-url '<原始资料库链接>'
```

示例：

```bash
python3 tencentdocs.py tdoc_list tencent-saas-docs   # 主入口通用工具
python3 tencentdocs.py tdoc_list slide-mcp           # slide_* 工具
python3 tencentdocs.py tdoc_list doc-mcp             # doc 工具（insert_* / find_* / replace_* 等）
python3 tencentdocs.py tdoc_list sheet-mcp           # sheet 工具（set_cell_value / add_sheet 等）
```

返回原始 JSON-RPC 响应，工具列表在 `result.tools[]`，每个包含 `name` / `description` / `inputSchema`。

## 4 个 MCP endpoint 路由说明

| service 名 | endpoint | 适用工具 |
| --- | --- | --- |
| `tencent-saas-docs` | `https://saas.docs.qq.com/api/v6/open/agent/mcp` | 通用工具：`manage.*` / `create_*` / `smartcanvas.*` / `smartsheet.*` / `scrape_url` 等 |
| `slide-mcp` | `https://saas.docs.qq.com/api/v6/slide/mcp` | 幻灯片精细编辑：`slide_*` 系列 |
| `doc-mcp` | `https://saas.docs.qq.com/api/v6/doc/mcp` | Word 文档精细编辑：`doc.*` 系列 |
| `sheet-mcp` | `https://saas.docs.qq.com/api/v6/sheet/mcp` | Excel 表格精细编辑：`sheet.*` 系列 |

> 选择规则：**所有 `slide_*` 工具走 `slide-mcp`，所有 `doc.*` 工具走 `doc-mcp`，所有 `sheet.*` 工具走 `sheet-mcp`，其余通用工具一律走 `tencent-saas-docs`**。详见 SKILL.md 的"场景路由表"。

## 错误说明

| 错误 | 含义 | 处理 |
| --- | --- | --- |
| `ERROR:no_token` | 普通 SaaS 所需的两个环境变量都为空 | 由宿主环境（ClawClaw 等）注入票据 |
| `ERROR:library_token_clawclaw_ipc_*` | 客户端宿主通道不可用或请求失败 | 确认在 ClawClaw 客户端内运行、已授权且客户端版本支持 `clawclaw.request/http.fetch` |
| `ERROR:library_token_http_failed` | 沙箱 auth-proxy 或资料库接口失败 | 检查沙箱网络、接口路由和服务状态 |
| `ERROR:library_token_invalid_response` | get-drive-token 响应格式不符合约定 | 确认响应为 `{"data":{"accessToken":..., "expiresIn":..., "fileId":..., "edition":...}}` 结构，且 `edition` 为 `toc`/`tob` |
| `ERROR:library_file_id_invalid_url` | 资料库链接格式不正确 | 确认 hostname 在白名单且路径为 `/space/d/<nodeId>` |
| `ERROR:library_file_id_invalid_edition` | get-drive-token 返回的 `data.edition` 不是 `toc`/`tob` | 检查资料库接口版本，确认已下发 `edition` 字段 |
| `ERROR:bad_args_json` | args 不是合法 JSON 对象 | 检查 `[json_args]` 是否为合法 `{...}` 字符串 |
| `ERROR:unknown_service` | service 名不在白名单 | 改用 `tencent-saas-docs / slide-mcp / doc-mcp / sheet-mcp` 之一 |
| `ERROR:http_failed` | 网络/HTTP 请求失败 | 检查网络与代理；公司网络下若超时可尝试加 `--no-proxy` 或设置 `HTTPS_PROXY` |
| `Token 鉴权失败 / 400006` | 服务端返回票据无效 | 由宿主环境刷新票据后重试 |
| `需要升级专业版 / 400014` | 当前操作需要升级专业版 | 引导用户升级：https://saas.docs.qq.com/scenario/saas-website-payment.html |
