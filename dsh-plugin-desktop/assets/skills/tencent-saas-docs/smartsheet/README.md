# smartsheet（智能表格 / 多维表）

- service：`tencent-saas-docs`
- endpoint：`https://saas.docs.qq.com/api/v6/open/agent/mcp`
- 调用：`python3 tencentdocs.py tdoc_call tencent-saas-docs <工具> '{"file_id":"<id>","sheet_id":"<sid>",...}'`

> 上级：[SKILL.md](../SKILL.md)。字段/记录/视图均为批量接口；先 `list_tables` 拿 sheet_id 再操作。
> `commit_changeset` / `fetch` 系 App 内部链路，AI 勿调。

| 工具 | 说明 |
|---|---|
| `smartsheet.add_fields` | 批量新增字段；可用 `before_field_id` 插到指定列之前；支持公式、双向关联、查找引用列（均需按参考文档构建 property） |
| `smartsheet.add_records` | 批量添加记录；可用 `before_record_id` 插到指定行之前 |
| `smartsheet.add_table` | 在文档中新增空白默认工作表 |
| `smartsheet.add_view` | 新增视图 |
| `smartsheet.commit_changeset` | 提交智能表的编辑变更 |
| `smartsheet.create_dashboard_from_plan` | 根据仪表盘规划文本创建仪表盘，适用于用户对仪表盘有要求（统计图表、KPI 展示等）的场景；`dashboard_plan` 格式见 [dashboard_plan_format.md](./dashboard_plan_format.md) |
| `smartsheet.create_table_from_plan` | 根据结构规划文本创建工作表，适用于用户对表格功能有要求的场景；`table_plan` 格式见 [table_plan_format.md](./table_plan_format.md) |
| `smartsheet.create_automation_from_plan` | 根据规划文本创建智能表自动化；支持新增记录、修改记录、到达记录时间触发，查找记录、新增记录、修改记录、发送消息等动作；创建默认关闭，规划明确声明开启时才会开启  格式见 [automation_plan_format.md](./automation_plan_format.md)|
| `smartsheet.get_dashboard` | 获取仪表盘概览：标题 + 组件索引列表（组件ID、类型、标题、位置）；查/改/删单个组件前先调此接口拿 componentId |
| `smartsheet.get_dashboard_component` | 获取仪表盘单个组件的类型、标题、位置和数据配置 |
| `smartsheet.update_automation_from_plan` | 根据完整规划文本更新智能表自动化，先读取现有流程再整体替换，不支持局部字段更新；一次调用**必须恰好一条流程**，含多条流程会报错，需拆分为多次调用 |
| `smartsheet.update_dashboard_component_from_plan` | 根据完整组件规划更新仪表盘单个组件，组件位置保持不变 格式见 [dashboard_plan_format.md](./dashboard_plan_format.md) |
| `smartsheet.add_dashboard_component_from_plan` | 根据组件规划在仪表盘中新增单个组件；需同时指定组件位置布局 `[offsetX, offsetY, width, height]`（宽度2-12，高度≥2，offsetX+width≤12，不能与其他组件重叠） |
| `smartsheet.delete_automation` | 按 `file_id` + `workflow_id` 删除单条自动化；删除前先用 `list_automations` 按名称确认目标 ID |
|`smartsheet.delete_dashboard_component` | 删除仪表盘单个组件 |
| `smartsheet.delete_fields` | 批量删除字段 |
| `smartsheet.delete_records` | 批量删除记录 |
| `smartsheet.delete_table` | 删除指定的工作表 |
| `smartsheet.delete_view` | 删除指定的视图 |
| `smartsheet.fetch` | 打开智能表 |
| `smartsheet.get_client_var` | 获取智能表文档的 clientVar 配置信息 |
| `smartsheet.list_automations` | 列出文档内自动化摘要（workflow_id、名称、状态、触发器类型/表、动作数）；更新/删除自动化前按名称确认目标 workflow_id |
| `smartsheet.list_fields` | 列出工作表字段；有选区时**必须**传 `view_id`，否则列序可能不是用户所见顺序 |
| `smartsheet.list_records` | 分页列出工作表记录；有选区时**必须**传 `view_id`，否则行序可能不是用户所见顺序。查公式 / 查找引用 / 关联列结果时必须传 `include_computed_values: true`（结果在 `computed_value`，默认不返回） |
| `smartsheet.list_tables` | 列出文档下的工作表 |
| `smartsheet.list_views` | 列出工作表视图 |
| `smartsheet.update_fields` | 批量更新字段 |
| `smartsheet.update_records` | 批量更新记录 |
| `smartsheet.update_view` | 局部更新视图配置（标题 / 筛选 / 排序 / 分组 / 字段显隐 / 列宽 / 冻结列）；`patch_json` 只传要改的键，筛选值按字段类型传选项 ID / 人员 ID / 毫秒时间戳，格式见 [update_view_patch_format.md](./update_view_patch_format.md) |

## 参考文档（同目录下）

| 文档 | 功能说明 |
|------|---------|
| [table_plan_format.md](./table_plan_format.md) | `smartsheet.create_table_from_plan` 的 `table_plan` 参数文本格式规范 |
| [dashboard_plan_format.md](./dashboard_plan_format.md) | `smartsheet.create_dashboard_from_plan` 的 `dashboard_plan` 参数格式规范|
| [formula.md](./formula.md) | 新增公式字段（type 19）的 `formulaModel` 构建规范|
| [link_and_lookup_fields.md](./link_and_lookup_fields.md) | 新增双向关联（`twoWayLinkRecords`）/ 查找引用（`lookup`）字段的 property 构建规范（含 filter 筛选条件与 formatter 格式） |
| [automation_plan_format.md](./automation_plan_format.md) | `smartsheet.create_automation_from_plan` / `update_automation_from_plan` 的 `automation_plan` 参数文本格式规范 |
| [update_view_patch_format.md](./update_view_patch_format.md) | `smartsheet.update_view` 的 `patch_json` 参数 JSON 格式规范（filter / sort / group / fields 顶层键与各字段类型 value 格式） |

> 调用 `create_table_from_plan` / `create_dashboard_from_plan` / `create_automation_from_plan` / `add_fields`（公式列 / 双向关联列 / 查找引用列）/ `update_view` 前，务必先阅读对应参考文档按规范生成参数。

## 选区与 view_id（强制）

用户通过「添加到对话」选中行/列时，prompt 里会有 `<selection_payload>` JSON（camelCase）。**必须**映射到 MCP 参数（snake_case），禁止丢弃 `viewId`：

| selection_payload | MCP 参数 |
|-------------------|----------|
| `fileId` | `file_id` |
| `sheetId` | `sheet_id` |
| `viewId` | `view_id` |
| `selection.fieldIds[]` | 选中列的 `field_id` |
| `selection.recordIds[]` | 选中行的 `record_id` |

硬约束：

- 有选区时，调用 `list_fields` / `list_records` **必须**带 `view_id=<selection.viewId>`。不传则返回顺序可能不是用户当前视图顺序，会导致 `before_field_id` / `before_record_id` 算错、插错位置。
- 无选区时可不传 `view_id`（服务端按首个公开视图排序）；若刚通过 `list_views` 拿到表格视图 id，仍建议传入。

选区下列插入：

| 用户意图 | 做法 |
|----------|------|
| 插到选中列**之前** | `before_field_id = selection.fieldIds[0]`（可直接用选区 id，不必靠 list 找锚点） |
| 插到选中列**之后** | `list_fields`（**带 view_id**）→ 按返回数组顺序取选中列的**下一个** `field_id` 作为 `before_field_id`；若已是最后一列则省略锚点（追加末尾） |

选区下行插入同理：`before_record_id` 用 `recordIds`；「之后」须 `list_records(view_id=...)` 取下一行。

```bash
# 有选区时 list_fields 必须带 view_id
python3 tencentdocs.py tdoc_call tencent-saas-docs smartsheet.list_fields '{"file_id":"<fid>","sheet_id":"<sid>","view_id":"<viewId>"}'
```

## 指定位置插入行 / 列（强制）

用户要求「插到某行/某列之前、中间插入、不要追加到末尾」时，**必须**传锚点字段；省略则永远追加到末尾。

| 场景 | 工具 | 锚点参数 | 前置查询 |
|------|------|----------|----------|
| 插到某行之前 | `smartsheet.add_records` | 每条 record 的 `before_record_id` | 先 `list_records`（有选区则带 `view_id`）取目标行 `record_id` |
| 插到某列之前 | `smartsheet.add_fields` | 每个 field 的 `before_field_id` | 先 `list_fields`（有选区则带 `view_id`）取目标列 `field_id`；选中列「之前」可直接用选区 `fieldIds` |

规则：

- 语义是插到该 id **之前**；省略锚点 = 追加末尾（旧行为）。
- 锚点必须是表中**已存在**的 id（来自 list 返回或 selection_payload），禁止编造；同一次请求内新插入的行/列一般还没有 id，不能互指，需先写入再 list，再带锚点插下一条。
- 同一锚点的多条按 `records` / `fields` 数组顺序连续插在锚点前。
- `update_fields` / `update_records` **不支持**位置参数，忽略 `before_*`。
- 靠 list 结果推算「某列/行之后」时，list **必须**带正确 `view_id`（见上一节），否则邻接 id 会错。

行插入示例：

```bash
python3 tencentdocs.py tdoc_call tencent-saas-docs smartsheet.add_records '{"file_id":"<fid>","sheet_id":"<sid>","records":[{"before_record_id":"<已有 record_id>","field_values":[{"field":"厂商","option_value":{"items":[{"text":"OpenAI"}]}},{"field":"模型名称","text_value":{"items":[{"text":"GPT-5.6 Terra","type":"text"}]}}]}]}'
```

列插入示例：

```bash
python3 tencentdocs.py tdoc_call tencent-saas-docs smartsheet.add_fields '{"file_id":"<fid>","sheet_id":"<sid>","fields":[{"field_title":"插在优先级之前","field_type":"text","before_field_id":"<已有 field_id>","property_text":{}}]}'
```

## add_records 记录值格式速查

`smartsheet.add_records` 的 `records` 中，每条记录用 `field_values` 数组结构承载各字段值；可选 `before_record_id` 控制插入位置（见上一节）。数组元素的字段标识填**真实字段标题**（即 `table_plan` 里的字段名，或 `list_fields` 返回的字段名）——规划文本中的 `F1`/`F2`/`T1` 等编号只是 `table_plan` 内部视图引用的占位符，**不能**作为字段标识传入 `add_records`，写记录时必须换成真实字段标题。

> ⚠️ 写记录前先 `smartsheet.list_fields` 确认字段标题与类型，按类型传对应值结构，避免 `22015`。需要指定位置时还要先 `list_records` 拿 `before_record_id`。

各字段按 `list_fields` 返回的字段类型传对应值：

| 值类型 | 示例值 | 说明 |
|------|------|------|
| `text_value` | `{"items":[{"text":"xxx","type":"text"}]}` | 文本字段；item 的 `type` **必填**且必须为 `"text"`，缺失会报 `code:22015` |
| `option_value` | `{"items":[{"text":"选项文本"}]}` | 单选/多选字段；只传 `text` 即可，`id` 由服务端解析 |
| `number_value` | `60` | 数字 / 进度 / 货币 / 百分比字段 |
| `string_value` | `"1785686400000"` | 日期字段用毫秒级时间戳字符串 |
| `reference_value` | `{"items":["recA1","recB2"]}` | 关联（reference）/ 双向关联（twoWayLinkRecords）字段；items 传目标表的 recordId 数组（来自目标表 `list_records` 实际返回） |
| 自动编号字段 | 不传值 | 由系统自动生成，不要填 |

## 创建编排：从零搭建智能表格（含记录）

当用户要**新建智能表格**且描述了业务需求时，按以下顺序串行执行，**不要跳步、不要并行**。

### 编排流程

```
manage.create_file  →  [对每张表: smartsheet.create_table_from_plan → smartsheet.add_records → 创建公式/双向关联/查找引用列 smartsheet.list_fields + smartsheet.add_fields]  →  smartsheet.list_tables(用排除法找默认表)  →  smartsheet.delete_table(默认表)  →  [ smartsheet.list_tables + smartsheet.list_fields 取信息 → smartsheet.create_dashboard_from_plan]  →  (可选) [smartsheet.list_tables + smartsheet.list_fields 取真实 tableId/fieldId/optionId → smartsheet.create_automation_from_plan]
```

**1. 建空智能表格文档** — `manage.create_file` 拿到 `file_id`：


> 新建文档会**自带一个默认空工作表**，需在最后清理（步骤 3）。

**2. 逐表串行：建骨架 → 填记录 → 建公式/关联/查找引用列**

对 `table_plan` 中的**每一张表**（plan 文本按 [table_plan_format.md](./table_plan_format.md) 生成），依次执行；多张表也**一张一张串行**，每张表完整走完 a→b→c 再下一张：

a. **建表骨架** — `smartsheet.create_table_from_plan` 按规划文本一次性建出字段 + 视图，**返回新表的 `sheet_id`**（记下来）：

```bash
python3 tencentdocs.py tdoc_call tencent-saas-docs smartsheet.create_table_from_plan '{"file_id":"<file_id>","properties":{},"table_plan":"<plan 文本>"}'
```

> `properties` 为必填参数（schema required 含 `properties`），传空对象 `{}` 即可，标题/下标由 `table_plan` 补齐。
>
> **第一张表骨架创建完成后**，用内部访问链接的工具访问腾讯文档链接，打开文档确认已建好。

b. **填充记录（强制，禁止跳过）** — `smartsheet.add_records` 向刚建出的表批量写入记录。**每张表建完骨架后必须立即填充示例记录，不得跳过、不得留空表**；除非用户明确要求不填，否则默认至少填四条示例记录。

> ⚠️ **硬约束**：
> - 建表后**必须**紧跟 `smartsheet.add_records`，不允许只建表骨架就进入下一张表或进入删默认表 / 建仪表盘步骤。
> - 示例记录内容要与字段语义匹配（如"姓名"字段填真实人名、"状态"字段填合法选项文本），禁止填占位符（`xxx` / `test` / `示例值` / 空字符串）。
> - 多选 / 单选字段的选项文本必须与 `table_plan` 中定义的选项一致，否则会写入游离选项；拿不准时先 `smartsheet.list_fields` 确认。
> - 各字段值格式见上方「[add_records 记录值格式速查](#add_records-记录值格式速查)」，按字段类型传对应值结构，避免 `code:22015`。

c. **创建公式列 / 双向关联列 / 查找引用列** 可选 — `create_table_from_plan` 不支持这三类列（公式 type 19、双向关联、查找引用），需在填完记录后通过 `smartsheet.add_fields` 单独创建：

  1. **公式列** — `formulaModel` 格式详见 [formula.md](./formula.md)：

     - **取真实 fieldId** — 调 `smartsheet.list_fields` 列出本表已建字段，拿到各字段真实 `fieldId`。formulaModel 中引用的 `fieldId` / `tableId` **必须来自此返回**，禁止用规划占位符（F1/F2/T1）或编造。
     - **新增公式列** — 调 `smartsheet.add_fields` 创建公式字段，每个字段的 `property` 包含 `formulaModel`（公式定义数组）和可选 `formatter`（结果格式），构建规则与常见模式见 [formula.md](./formula.md)。

     > ⚠️ 关键约束：公式列不能引用自身 fieldId；text 中双引号转义为 `\"`；跨表引用必须用 type 6（同时给 `tableId` + `fieldId`），禁止用 type 2；FILTER 内多条件必须用 `AND()` / `OR()` 函数包裹。

  2. **双向关联列 / 查找引用列** — property 构建规范见 [link_and_lookup_fields.md](./link_and_lookup_fields.md)：

     - **双向关联列**：先 `list_tables` 拿目标表 `sheet_id` 作 `sub_id`；请求中**禁止**传 `back_field_id`（服务端自动生成反向字段）。写入关联值用 `reference_value` 传目标表 recordId 数组。
     - **查找引用列**：按关联查找（`upgrade_type=0`）需先有本表关联列，`lookup_sub_id` 必须与关联列目标表一致；按条件查找（`upgrade_type=1`）用 `filter` 直接筛目标表，无需关联列。
     - 所有 `sub_id` / `field_id` / `link_records_field_id` / `lookup_field_id` / 选项 ID **必须**来自 `list_tables` / `list_fields`（目标表字段需带目标 `sheet_id` 查询）的实际返回，**禁止编造或用占位符**；`lookup_field_id` 的统计类型（求和/平均等）需与被引用字段类型匹配。


**3. 删除默认空表** — 全部业务表建完并填好记录后，`smartsheet.list_tables` 列出所有工作表，挑出 `sheet_id` **不在步骤 2 已建集合**里的那张（即默认表），调 `smartsheet.delete_table` 删除：

**4. 创建仪表盘** 必选 —在表格全部建好并填完记录后执行：

a. **先取信息** — 依次调用 `smartsheet.list_tables` 列出所有工作表拿到 `tableId`；对仪表盘要引用的每张表再调 `smartsheet.list_fields` 拿字段信息（`fieldId`），有合适视图时调 `smartsheet.list_views` 拿 `viewId`：

b. **建仪表盘** — 调用 `smartsheet.create_dashboard_from_plan` 按规划文本创建仪表盘，`dashboard_plan` 格式见 [dashboard_plan_format.md](./dashboard_plan_format.md)；该工具所需参数请模型通过工具说明自行查询，这里不再罗列：

> 规划文本中的 `tableId` / `fieldId` / `viewId` 必须来自步骤 a 的实际返回，**严禁编造**；仪表盘规划文本**严禁向用户展示**（仅作参数传入）。


**5. 创建自动化（可选）** — 用户明确需要自动化（如"状态变更时通知/同步""到期自动改状态""新增记录时自动建关联记录"等），或基于业务场景判断适合补充自动化时，在表格与仪表盘都就绪后执行：

a. **先取真实 ID（强制，禁止跳过）** — 依次调用 `smartsheet.list_tables` 拿 `tableId`，对涉及的每张表调 `smartsheet.list_fields` 拿字段信息：

> ⚠️ **真实 ID 必须现取，不能从规划占位符推**（与 add_records 同源坑点）：
> - `table_plan` 文本里的 `F1`~`F10`、`T1`、`V1` 等是**建表阶段的内部占位符**，建表完成后即失效，**绝不能**作为 `fieldId` / `tableId` 写进 automation_plan。
> - automation_plan 中所有 `[fieldId]` / `[tableId]` 必须是 `list_fields` / `list_tables` 返回的真实 ID（如 `fyz3Ih`、`tvmijz`），**禁止**用 `F1`/`F2`/`T1` 占位符，**禁止**编造。

b. **取真实 optionId（强制）** — automation_plan 里单选(17)/多选(9)字段的筛选条件、设置字段值若用 `["optionId"]` 形式，其中的 optionId 必须来自 `list_fields` 返回：

> ⚠️ **optionId 结构键名不能想当然**（真实踩坑）：
> - 不要假设选项数组在 `property.options` 路径下——`list_fields` 返回的原始 JSON 结构以**实际返回为准**，不同字段类型/版本的键名可能不同，直接按 `property.options` 取多半取不到。
> - 正确做法：调用 `list_fields` 后，定位到单选/多选字段的完整 property 原始 JSON，在其中找到选项数组（每个选项对象同时含**选项文本**和**optionId**），按选项文本匹配取出对应 optionId（如 `已完成 → oQKhzE`、`中 → o0tunT`）。
> - 拿不准时，把该字段的 property 原始 JSON 完整输出查看，**不要猜键名、不要编造 optionId**。

c. **建自动化** — 调用 `smartsheet.create_automation_from_plan` 按规划文本创建自动化，`automation_plan` 格式见 [automation_plan_format.md](./automation_plan_format.md)；创建默认关闭，规划中明确声明开启时才会开启：

> ⚠️ automation_plan 中所有 `tableId` / `fieldId` / `optionId` 必须来自步骤 a/b 的实际返回，**严禁编造、严禁用占位符**；automation_plan 规划文本**严禁向用户展示**（仅作参数传入）。


### 顺序约束（务必遵守）

- **先建文档再建表**：`smartsheet.create_table_from_plan` / `smartsheet.add_records` 都依赖 `file_id`，必须先 `manage.create_file`。
- **先建骨架再填记录**：`smartsheet.add_records` 需要表已存在的 `sheet_id` 与字段，必须紧跟 `create_table_from_plan` 之后。
- **先填记录再建公式列 / 双向关联列 / 查找引用列**：公式列的 `formulaModel` 需引用本表真实 `fieldId`，双向关联 / 查找引用列需引用真实表 ID 和字段 ID，都必须在 `smartsheet.add_records` 之后调 `smartsheet.list_fields`（目标表字段带目标 `sheet_id` 查询）取真实 ID，再调 `smartsheet.add_fields` 创建；`fieldId` / `tableId` / `sub_id` 禁止编造或用占位符，详见 [formula.md](./formula.md) 与 [link_and_lookup_fields.md](./link_and_lookup_fields.md)。
- **先建关联列再建按关联查找的查找引用列**：`upgrade_type=0` 的查找引用列依赖本表已存在的关联列（`reference` / `twoWayLinkRecords`），须先建关联列拿到返回 `field_id` 再建查找引用列；反向约束见 [link_and_lookup_fields.md](./link_and_lookup_fields.md)。
- **建表必填记录（强制）**：每张表走完 `create_table_from_plan` 后**必须**紧接着调 `smartsheet.add_records` 填充示例记录，默认至少四条；未填记录的空表不得进入下一张表、删默认表或建仪表盘步骤。仅在用户**明确**表示不需要示例数据时才可跳过，且需在继续前向用户确认。
- **多表串行**：每张表完整走完「建骨架 → 填记录 → 建公式/关联/查找引用列」再下一张，避免 `sheet_id` 串表。
- **默认表用排除法识别**：保留步骤 2 每个 `smartsheet.create_table_from_plan` 返回的 `sheet_id`，删前 `smartsheet.list_tables` 一次取差集即可，无需提前查。
- **先建表再建仪表盘**：`smartsheet.create_dashboard_from_plan` 依赖表已存在，且规划中的 `tableId` / `fieldId` / `viewId` 必须通过 `smartsheet.list_tables` / `smartsheet.list_fields` / `smartsheet.list_views` 实际获取，禁止凭空编造。
- **先取真实 ID 再建自动化**：`smartsheet.create_automation_from_plan` 的 automation_plan 中所有 `tableId` / `fieldId` 必须来自 `smartsheet.list_tables` / `smartsheet.list_fields` 的实际返回，**禁止用 `table_plan` 占位符（F1/F2/T1 等）**；单选/多选字段的 `optionId` 必须从 `list_fields` 原始返回 JSON 中按选项文本提取，**禁止假设键名为 `property.options`、禁止编造**。
- **更新/删除自动化先取 workflow_id**：`smartsheet.update_automation_from_plan` / `smartsheet.delete_automation` 所需的 `workflow_id` 必须来自 `smartsheet.list_automations` 的实际返回，禁止凭名称猜 ID；update 一次调用必须恰好一条流程，多条流程需拆分为多次调用。
