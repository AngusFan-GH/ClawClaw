---
name: clawclaw-smartsheet
version: "0.1.1"
description: "操作 ClawClaw 智能表：列举 / 新建 / 重命名 / 删除智能表文档，管理子表、视图、记录、列与仪表盘，按规划文本一次建表建盘，并追加公式列、关联列与查找引用列。当用户提到智能表、多维表、数据表、建一张表、批量录数、加一列、改视图筛选排序、做仪表盘或统计图表，或给出一份 ClawClaw 智能表文档时使用。工具名均以 `wb_smartsheet.` 开头，只作用于 ClawClaw 智能表，不操作腾讯文档等其它文档产品的表格。"
description_en: "Operate ClawClaw Smartsheet documents. Use to list, create, rename, or delete smartsheet documents; manage sub-tables, views, records, fields, and dashboards; build a table or a dashboard in one call from a plan text; and append formula, link, and lookup columns. Use when the user mentions a smartsheet, multi-dimensional table, data table, creating a table, bulk data entry, adding a column, changing view filters or sorting, or building a dashboard or chart. All tools are prefixed `wb_smartsheet.` and act only on ClawClaw Smartsheet, never on tables in other document products such as Tencent Docs."
license: Internal
allowed-tools:
disable: false
---

# ClawClaw 智能表

## 一、域声明：本工具集只操作 ClawClaw 智能表（先读本节，再选工具）

本工具集的 30 个工具全部以 `wb_smartsheet.` 开头，**只作用于 ClawClaw 智能表**。

**同一个会话里很可能同时挂着腾讯文档的表格能力。** 那些工具真实存在、可被调用、也会正常返回——它们操作的是另一个文档域。它们不是本工具集的替代品，本工具集也不是它们的替代品。

两个域的标识**互不通用**：

| 标识来自 | 能传给 `wb_smartsheet.*` 吗 | 传错的表现 |
|---|---|---|
| `wb_smartsheet.list_documents` / `wb_smartsheet.create_document` | ✅ 这是唯一合法来源 | — |
| 腾讯文档系工具的返回（`file_id`、文档链接等） | ⛔ | 返回「不存在」 |
| 用户粘贴的 `docs.qq.com` 链接、其它产品的链接或 ID | ⛔ | 返回「不存在」 |
| 历史对话里出现过、来源不明的一串 ID | ⛔ | 返回「不存在」 |

「不存在」不是权限问题，也不是稍后重试能解决的问题——它就是拿错了域。**每次操作 ClawClaw 智能表前，先用 `wb_smartsheet.list_documents` 拿到 `smartsheet_id`**；不要复用任何来自其它工具的标识。反向同理：`smartsheet_id` 不要传给腾讯文档系的工具。

用户说「我的智能表」「多维表」「数据表」而未点名外部产品时，一律走本工具集。

## 二、工具总览（30 个）

### 文档管理（5）

| 工具 | 说明 |
|---|---|
| `wb_smartsheet.list_documents` | 列举调用者有权访问的智能表文档；返回 `smartsheet_id`、标题、`status`、时刻、权限档位。**获取合法 `smartsheet_id` 的入口** |
| `wb_smartsheet.create_document` | 新建智能表文档；**异步受理**，返回 `status: initializing`；必填 `idempotency_key` |
| `wb_smartsheet.get_document` | 读单份文档元信息与 `status`；用于轮询初始化是否 `ready` |
| `wb_smartsheet.rename_document` | 改文档标题；不触碰表格内容 |
| `wb_smartsheet.delete_document` | 删除整份文档；软删且幂等 |

### 子表（4）

| 工具 | 说明 |
|---|---|
| `wb_smartsheet.list_tables` | 列举文档下全部子表的 `sheet_id` 与标题 |
| `wb_smartsheet.add_table` | 新增一张空白子表；自带一个含全部列的默认表格视图 |
| `wb_smartsheet.rename_table` | 改子表名；只动标题，列 / 记录 / 视图都不受影响。改**列**名用 `update_fields`，两者不要搞混 |
| `wb_smartsheet.delete_table` | 删除指定子表；**文档内仅剩一张子表时被拒绝** |

### 视图（4）

| 工具 | 说明 |
|---|---|
| `wb_smartsheet.list_views` | 列举子表下视图的 `view_id`、标题、类型 |
| `wb_smartsheet.add_view` | 新增**额外**视图（新子表已自带默认表格视图，不需要为「有个视图」而调它）。甘特 / 日历视图必须同时给 `start_date_field_id` 与 `end_date_field_id`（两个真实日期列），查询视图必须给 `query_field_ids` |
| `wb_smartsheet.update_view` | 局部更新视图配置（标题 / 筛选 / 排序 / 分组 / 字段显隐 / 列宽 / 冻结列），格式见 [update_view_patch_format.md](./update_view_patch_format.md) |
| `wb_smartsheet.delete_view` | 删除视图；记录数据不受影响 |

### 记录（4）

| 工具 | 说明 |
|---|---|
| `wb_smartsheet.list_records` | 分页读记录；可带 `view_id` 按视图顺序与筛选取数，`include_computed` 决定是否透出公式 / 关联 / 查找列的**计算值**（不额外打一次引擎） |
| `wb_smartsheet.add_records` | 批量新增记录；每条 `fields` 是 `field_id → 值` 的映射，可选 `before_record_id` 指定插入位置 |
| `wb_smartsheet.update_records` | 按 `record_id` 批量局部改字段；未提及的字段保持原值 |
| `wb_smartsheet.delete_records` | 按 `record_id` 批量删记录 |

### 列（4）

| 工具 | 说明 |
|---|---|
| `wb_smartsheet.list_fields` | 列举子表各列的 `field_id`、标题、类型与类型配置（含单选 / 多选的选项集合与选项 ID）。**写记录、写公式、配视图前的必经一步** |
| `wb_smartsheet.add_fields` | 批量新增列；可用 `before_field_id` 插到指定列之前；公式列见 [formula.md](./formula.md)，关联列 / 查找引用列见 [link_and_lookup_fields.md](./link_and_lookup_fields.md) |
| `wb_smartsheet.update_fields` | 批量改列名 / 类型 / 类型配置；不支持位置参数 |
| `wb_smartsheet.delete_fields` | 批量删列；同时清掉各视图中对该列的配置引用 |

### 仪表盘（7）

| 工具 | 说明 |
|---|---|
| `wb_smartsheet.get_dashboard` | 仪表盘概览：`dashboard_id` + 组件索引（`component_id`、类型、标题、位置）。查 / 改 / 删单个组件前先调它拿 `component_id` |
| `wb_smartsheet.add_dashboard` | 新建空仪表盘，返回真实 `dashboard_id` |
| `wb_smartsheet.delete_dashboard` | 删除仪表盘；被引用的子表数据不受影响。传子表标识会被拒——删子表用 `delete_table` |
| `wb_smartsheet.get_dashboard_component` | 读单个组件的类型、标题、位置与数据配置 |
| `wb_smartsheet.add_dashboard_component` | 在仪表盘中新增单个组件；位置 `[offsetX, offsetY, width, height]` 可省略，省略时自动找一处空地。组件规划语法见 [dashboard_plan_format.md](./dashboard_plan_format.md) |
| `wb_smartsheet.update_dashboard_component` | 按完整组件规划整体更新单个组件，位置保持不变；不支持只改一个属性 |
| `wb_smartsheet.delete_dashboard_component` | 删除单个组件 |

### 规划文本建构（2）

| 工具 | 说明 |
|---|---|
| `wb_smartsheet.create_table_from_plan` | 按规划文本一次建出含全部列与视图的子表。**新建表的主路径**，一次调用建**恰好一张**表；格式见 [table_plan_format.md](./table_plan_format.md) |
| `wb_smartsheet.create_dashboard_from_plan` | 按规划文本一次建出仪表盘及其组件；格式见 [dashboard_plan_format.md](./dashboard_plan_format.md) |

## 三、参考文档（同目录）

| 文档 | 什么时候必须先读 |
|---|---|
| [table_plan_format.md](./table_plan_format.md) | 调 `create_table_from_plan` 前 |
| [dashboard_plan_format.md](./dashboard_plan_format.md) | 调 `create_dashboard_from_plan` / `add_dashboard_component` / `update_dashboard_component` 前 |
| [formula.md](./formula.md) | 用 `add_fields` 建公式列前 |
| [link_and_lookup_fields.md](./link_and_lookup_fields.md) | 用 `add_fields` 建关联列或查找引用列前 |
| [update_view_patch_format.md](./update_view_patch_format.md) | 调 `update_view` 前 |

> 这五份不是背景资料，是参数规范。不读就拼参数的失败率极高，且失败发生在服务端，你只会拿到一句「格式不合规」。

## 四、标识层级与「真实标识」铁律

```
smartsheet_id                 文档（权限与生命周期的单位）
└── sheet_id                  子表
    ├── field_id              列
    ├── record_id             记录
    └── view_id               视图
smartsheet_id
└── dashboard_id              仪表盘
    └── component_id          图表组件
```

- 下层标识必须由上层的列举工具现取：`list_tables` → `sheet_id`；`list_fields` → `field_id` 与选项 ID；`list_records` → `record_id`；`list_views` → `view_id`；`get_dashboard` → `component_id`。
- **规划文本里的 `F1` / `F2` / `T1` / `V1` 只在那段文本内部互指**，用来表达「按这一列分组」。建表返回后它们立即失效。后续任何调用都必须换成响应里的真实标识；拿占位符去写记录、写公式、配视图，一定失败。
- 任何标识都不许凭规律推测或凭印象复述。没有现取过，就先去取。

## 五、从零新建一张可用智能表：必经顺序

按下面 7 步串行执行，**不要跳步、不要并行、不要调换**。

| # | 动作 | 关键点 |
|---|---|---|
| 1 | `wb_smartsheet.create_document` | 一次建表意图**只生成一个** `idempotency_key`，重试时**复用同一个** |
| 2 | `wb_smartsheet.get_document` 轮询 | 直到 `status` 为 `ready` 才能继续；`failed` 则停止，不要再试写 |
| 3 | `wb_smartsheet.create_table_from_plan` | 建主表。规划文本里**不能**含公式 / 关联 / 查找列；记下返回的真实 `sheet_id` 与各列 `field_id` |
| 4 | `wb_smartsheet.add_records` | 用第 3 步返回的**真实** `field_id` 填示例记录，默认至少 4 条，内容要与列语义匹配（禁止 `xxx` / `test` / 空串） |
| 5 | `wb_smartsheet.add_fields` | 补公式列 / 关联列 / 查找引用列（先 `list_fields` / `list_tables` 现取真实标识） |
| 6 | `wb_smartsheet.create_dashboard_from_plan` | 规划文本里的 `tableId` / `fieldId` / `viewId` 必须来自 `list_tables` / `list_fields` / `list_views` 的实际返回 |
| 7 | `wb_smartsheet.delete_table`（默认空表） | 新文档自带一张默认空子表；主表建好并填完记录后删掉它。用排除法识别：`list_tables` 结果里不在第 3 步已建集合中的那张 |

### 调换顺序的后果（用于自检）

| 调换 | 具体后果 |
|---|---|
| 2 前置到 1 之前 | 没有 `smartsheet_id` 可查，无从轮询 |
| 3 提前到 2 之前（文档还在 initializing） | 建表调用被拒绝为「未就绪」；此时应轮询而不是重试建表 |
| 4 提前到 3 之前 | 没有 `sheet_id`，写记录无处可落 |
| 4 用第 3 步规划文本里的占位 `F1`/`F2` 而非真实 `field_id` | 整批写入被拒绝为「未知 field_id」，一条都不会落库 |
| 5 提前到 4 之前（记录还没写） | 列建得出来，但每一行的值都是空的，直到有数据才会算出结果；关联列此刻也无从校验目标 |
| 5 的内容塞进第 3 步的规划文本 | 这三类列**不会**被建出来。`create_table_from_plan` 会照常建表并在回执的 `deferred_columns` 里列出它们——看到这个字段就照第 5 步补建，不要重发建表 |
| 6 提前到 3 / 4 之前 | 仪表盘规划里的 `tableId` / `fieldId` 无处可取，只能编造；编造的标识会被整单拒绝 |
| 6 在 4 之前（表已建、记录未填） | 组件建得出来但全是空图，统计值为 0 |
| 7 提前到 3 之前（先删默认表） | 此刻默认表是文档内唯一的子表，删除被拒绝 |
| 7 提前到 4 之前 | 默认表虽能删掉，但主表还是空表，用户看到的是一份没有数据的文档 |

> 只是往**已有**表里写数据时，起点是第 4 步：先 `list_tables` → `list_fields` 拿真实标识，再写。

**默认表是删掉的，不是拿来改造的。** 第 3 步建的是一张全新子表，第 7 步把默认表删掉；不要把默认表当主表去改列名、删列。改造它得到的结果是一张名字仍叫「智能表1」、还残留着模板示例空记录的表。真的走到这一步（比如建表反复失败），改完之后至少要用 `wb_smartsheet.rename_table` 把表名改对，并用 `list_records` 找出 `values` 为空的模板记录删掉。

## 六、列类型

`add_fields` 与规划文本可用的类型名（**这些是对外名字，不要传数字**）：

| 类型名 | 含义 |
|---|---|
| `text` | 文本 |
| `number` | 数字 |
| `checkbox` | 复选框 |
| `date` | 日期时间 |
| `image` | 图片 |
| `attachment` | 附件 |
| `user` | 人员 |
| `url` | 链接 |
| `single_select` | **单选** |
| `multi_select` | **多选** |
| `progress` | 进度 |
| `phone` | 电话 |
| `email` | 邮箱 |
| `currency` | 货币 |
| `percentage` | 百分比 |
| `formula` | 公式（见 [formula.md](./formula.md)） |
| `link` | 关联（见 [link_and_lookup_fields.md](./link_and_lookup_fields.md)） |
| `lookup` | 查找引用（见 [link_and_lookup_fields.md](./link_and_lookup_fields.md)） |

> ⚠️ **没有 `select` 这个类型名。** 单选是 `single_select`，多选是 `multi_select`；写 `select` 会被拒绝。

只读 / 系统维护的类型：`created_user`、`modified_user`、`created_time`、`modified_time`、`auto_number`、`title`、`location`、`barcode`。它们会出现在 `list_fields` 的返回里，但**不能创建**——用 `add_fields` 建它们会被拒绝。

### 各类型的 `property`

`property` 是列的类型配置。**省略它是安全的**——工具会替这些类型补一份合法默认值，不需要为了「让它别报错」而随便填一个键。想要非默认效果时才写：

| 类型 | 可配置的键 | 省略时的默认 |
|---|---|---|
| `number` / `percentage` | `decimal_places`（-1 ~ 4，`-1` 表示不规整）、`use_separate`（千分位） | 0 位小数 |
| `progress` | `decimal_places` | 0 位小数 |
| `currency` | `currency_type`（`1` 人民币、`2` 美元、`3` 欧元、`4` 英镑、`5` 日元、`7` 港币、`22` 新加坡元…）、`decimal_places`、`use_separate` | 人民币、2 位小数 |
| `date` | `format`（见下表）、`auto_fill` | `yyyy-mm-dd` |
| `url` | `type`：`icon_text` / `pure_text` | `icon_text` |
| `single_select` / `multi_select` | `options`：`[{"text":"高"},{"text":"低"}]` | **必填**，没有默认 |
| `formula` | 见 [formula.md](./formula.md) | **必填** |
| `link` / `lookup` | 见 [link_and_lookup_fields.md](./link_and_lookup_fields.md) | **必填** |

其余类型（`text`、`checkbox`、`image`、`attachment`、`user`、`phone`、`email`）没有可配置项，传 `property` 会被拒绝。

**`date` 的 `format` 是一份封闭白名单**，只接受下列十种写法（注意月份是小写 `mm`；`yyyy-MM-dd` 这种写法会被自动纠正，其它写法直接报错并列出候选）：

`yyyy-mm-dd`、`yyyy-mm-dd hh:mm`、`yyyy/m/d`、`m/d/yyyy`、`d/m/yyyy`、`yyyy"年"m"月"d"日"`、`yyyy"年"m"月"d"日" dddd`、`yyyy"年"m"月"d"日" hh:mm`、`m"月"d"日"`、`[$-804]yyyy"年"m"月"d"日" dddd`

## 七、记录值格式速查

`add_records` / `update_records` 的每条记录里，`fields` 是 `field_id → 值` 的映射。**键必须是 `list_fields` 返回的真实 `field_id`**，不是列标题，也不是规划文本里的 `F1`。值按该列的类型给：

| 列类型 | 值的 JSON 形态 |
|---|---|
| `text` | `[{"type":"text","text":"内容"}]` |
| `number` / `progress` / `currency` / `percentage` | 一个 JSON 数字，如 `42.5` |
| `checkbox` | `true` / `false` |
| `date` | 毫秒时间戳的**字符串**，如 `"1735689600000"` |
| `single_select` / `multi_select` | `[{"id":"<optionId>"}]` 或 `[{"text":"选项文本"}]`；`single_select` 恰好一个元素 |
| `user` | `[{"id":"<userId>"}]` |
| `url` | `[{"type":"url","text":"显示文本","link":"https://..."}]` |
| `image` | `[{"id":"...","title":"...","imageUrl":"..."}]` |
| `attachment` | `[{"name":"...","fileId":"..."}]` |
| `phone` / `email` | 一个 JSON **字符串**，如 `"13800138000"`、`"a@b.com"` |

> ⚠️ **电话与邮箱不是文本列。** 它们看着像文本，值却是裸字符串，不是 `[{"type":"text","text":"..."}]`。写成文本片段的后果不是报错，而是**写入返回成功、回读却是空的**。

示例：

```json
{
  "smartsheet_id": "<真实 smartsheet_id>",
  "sheet_id": "<真实 sheet_id>",
  "records": [
    {
      "fields": {
        "<项目名称的 field_id>": [{ "type": "text", "text": "官网改版" }],
        "<项目状态的 field_id>": [{ "text": "进行中" }],
        "<开始日期的 field_id>": "1735689600000",
        "<项目预算的 field_id>": 120000
      }
    }
  ]
}
```

**写不进去的列**：`formula`、`lookup`、`created_time`、`modified_time`、`created_user`、`modified_user`、`auto_number`。给它们赋值会被拒绝——它们的值由系统计算或维护。要改公式列的结果，改它引用的那些列。

**选项值**：单选 / 多选优先传 `list_fields` 返回的 `optionId`。用 `text` 时，文本必须与该列已定义的选项完全一致，否则会写出一个游离的新选项。选项 ID 藏在 `list_fields` 返回的列属性里——**不要假设它一定在 `property.options` 路径下**，按实际返回的 JSON 结构去找那个同时含选项文本与选项 ID 的数组，按文本匹配取 ID。

## 八、建表与建列的硬约束

这些是引擎的硬规则，违反时整单被拒，不是部分成功：

- **建表时不能带 `formula` / `lookup` / `link` 列。** 原因：子表刚创建时自身还没有记录，关联目标甚至可能就是它自己。这三类列必须在表建好、记录填完之后用 `add_fields` 追加。两个建表工具对它们的处理**不一样**，别记混：

  | 工具 | 出现这三类列时 |
  |---|---|
  | `wb_smartsheet.add_table` | **整次调用被拒绝**，一列都不会建出来。把这几列从 `fields` 里去掉再发 |
  | `wb_smartsheet.create_table_from_plan` | **建表照常成功**，这几列被跳过并列在回执的 `deferred_columns` 里。照 `deferred_note` 用 `add_fields` 补建即可，**不要重发建表**——重发只会多出一张同名表 |
- **新表至少要有一列能当主列。** 可作主列的类型：`text`、`number`、`date`、`url`、`phone`、`email`、`currency`、`percentage`、`progress`。一张只有复选框和附件的表会被拒绝。
- **新表自带一个含全部列的默认表格视图。** 不要为了「有个视图」而调 `add_view`；只有需要**额外**视图（看板、甘特、带筛选的表格视图等）时才调它。
- **`delete_table` 不能删掉文档内最后一张子表。** 被拒绝时的正确动作：先 `add_table` 增一张，或者改为 `delete_document` 删整份文档。不要用 `delete_document` 去替代删单表——那删的是整份文档，包括你已经建好的其它表。
- **一份文档至少要留一张普通子表，仪表盘不算。** 「最后一张」数的是子表，一份「一张表 + 一个盘」的文档里那张表仍然是最后一张。仪表盘的读写在引擎侧也要落到一张真实子表上，因此只剩仪表盘的文档连 `get_dashboard` 都做不了——遇到这个错误就先 `add_table`。
- **`create_table_from_plan` 一次只建一张表。** 要建多张就多次调用，每张走完「建表 → 填记录 → 补公式/关联列」再建下一张，避免 `sheet_id` 串表。
- **规划文本里的占位标识建完即失效**，后续必须用响应里的真实标识（见第四节）。

## 九、指定位置插入行 / 列

用户要求「插到某行 / 某列之前」「插在中间」「不要追加到末尾」时，**必须**传锚点；省略锚点永远是追加到末尾。

| 场景 | 工具 | 锚点参数 | 前置查询 |
|---|---|---|---|
| 插到某行之前 | `wb_smartsheet.add_records` | 每条记录的 `before_record_id` | 先 `list_records` 取目标行 `record_id` |
| 插到某列之前 | `wb_smartsheet.add_fields` | 每个列定义的 `before_field_id` | 先 `list_fields` 取目标列 `field_id` |

规则：

- 语义是插到该标识**之前**。要「插到某列 / 某行**之后**」，就取列举结果里它的**下一个**标识作锚点；已是最后一个则省略锚点。
- 推算「之后」时，列举**必须带正确的 `view_id`**（用户看到的顺序由视图决定），否则算出来的邻居是错的。
- 锚点必须是表中**已存在**的标识。同一次请求内新插入的行 / 列还没有标识，不能互相引用——要连续定位就先写一批、再列举、再带锚点写下一批。
- `update_fields` / `update_records` **不支持**位置参数，传了会被忽略。

## 十、规模上限

| 项 | 上限 |
|---|---|
| `list_records` 单页 | 200 条（默认 50） |
| `list_documents` 单页 | 100 条（默认 20） |
| 单次 `add_records` / `update_records` / `delete_records` | 100 条 |
| 单次 `add_fields` / `update_fields` / `delete_fields` | 50 列 |

超限时返回上限值而**不会**静默截断。收到超限错误就按上限拆批，不要原样重试。读大表用 `offset` 翻页，不要一次要几千行——那会挤掉你自己的上下文。

## 十一、错误处理

| 错误语义 | 该做什么 |
|---|---|
| 文档不存在 | 先怀疑拿错了域（见第一节），用 `list_documents` 重新取 `smartsheet_id`；不要重试同一个标识 |
| 权限不足 | 停止写操作并告知用户；重试无用 |
| 文档初始化中 / 引擎仍在加载 | 轮询 `get_document`，稍后重试 |
| 文档创建已失败 | 停止，不要再对它写；必要时重新创建（用**新的** `idempotency_key`） |
| 文档配额超限 | **不要重试**，重试不会变好；告知用户需要先清理已有文档 |
| 参数校验失败 / 未知 `field_id` | 按错误文案改参数：多半是用了占位标识或列标题当键，先 `list_fields` 现取真实 `field_id` |
| 整批校验失败 | 整批都没写入，不存在部分成功。修正后整批重提，不要只补写「剩下的」 |
| 计算列写入被拒 | 该列由公式 / 查找得出，改它引用的源列 |
| 删除末子表被拒 | 先 `add_table`，或改为 `delete_document` |
| 规划文本不合规 | 错误里带位置与原因；对照 [table_plan_format.md](./table_plan_format.md) / [dashboard_plan_format.md](./dashboard_plan_format.md) 改文本后重试 |
| 视图重名 | 同一张子表内视图名必须唯一。先 `list_views` 看现有名字，换个名字重提，不要原样重试 |
| 公式列被拒 | 多半是公式里引用了本表没有的列。先 `list_fields` 核对每个 `fieldId` 都真实存在 |
| 版本冲突 | 有人同时在改这份表。重新读取当前数据再写，**不要**把同一批改动重放一遍 |
| 上游暂时不可用 | 读操作可重试；写操作重试前先读一次确认上一次到底有没有生效 |
| 引擎判载荷不合规 | **不是瞬时故障，等待与重试都不会变好。** 错误文案会点出具体是哪一条约束没满足（列不存在、表名为空、缺主列、表里没有可用视图……），照它说的改载荷，不要用同一份参数再发一次 |
| 回执读不出来 / 结果未知 | **这一条与「引擎拒绝」相反：改动很可能已经生效了。** 先用对应的 `list_*` 工具读一次当前状态，确认到底写进去了没有，再决定要不要补写。直接重发会把同一批数据写两遍 |
| 「操作无法完成」且没给具体原因 | 引擎出了本工具集无法归类的错。别原样重试，换条路走或告知用户 |

> ⚠️ **同一个调用连续失败两次就该停下来换做法，而不是继续重试。** 这套工具的失败里没有「多试几次就好」的一类：瞬时问题只出现在「文档初始化中」与「上游不可用」两种语义上，它们的文案会明确说「稍后重试」。其余一律是参数问题。

> 错误文案里点名的工具名与字段名是可以直接照做的：写「先调 `list_fields`」就是指这一步真的没做或做早了，重读一次拿到真实标识再重发即可。

## 十二、输出纪律

规划文本（`table_plan` / `dashboard_plan` / 组件规划）**只作参数传入，严禁展示给用户**——里面的 `T1`/`F3`、`tableId`、`fieldId`、主题色编号对用户没有意义。用户可见的只应是简短过渡文案（如「正在创建表格」）与最终结果说明。
