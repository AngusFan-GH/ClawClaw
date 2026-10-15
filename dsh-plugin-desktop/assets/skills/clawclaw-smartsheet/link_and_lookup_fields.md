# 关联列与查找引用列

本文档定义用 `wb_smartsheet.add_fields` 创建**关联列**（type: `link`）和**查找引用列**（type: `lookup`）时的 `property` 构建规范。

## 零、两条不能绕过的前提

1. **这两类列都必须在表建好之后用 `add_fields` 追加。** 引擎在建表那一刻不接受 `link` / `lookup`（以及 `formula`）。两个建表工具的表现不同：`wb_smartsheet.add_table` 会**整次拒绝**；`wb_smartsheet.create_table_from_plan` 会照常建表、跳过这几列，并在回执的 `deferred_columns` 里列出来等你补建。规划文本里最好一开始就不写这两类列。
2. **所有标识必须现取，禁止编造、禁止用规划文本占位符（`F1` / `T1` 一类）**：

| 需要什么 | 从哪来 |
|---|---|
| `sub_id` / `lookup_sub_id`（目标表） | `wb_smartsheet.list_tables` 返回的 `sheet_id` |
| 本表的 `link_records_field_id`（关联列） | `wb_smartsheet.list_fields`（带本表 `sheet_id`）返回的 `field_id`，或建关联列时的响应 |
| 目标表的 `lookup_field_id` / `field_id` / 选项 ID | `wb_smartsheet.list_fields`（**带目标表的 `sheet_id` 再查一次**） |

顺序上还有一条：**按关联查找的 `lookup` 列依赖本表已存在的 `link` 列** —— 先建关联列并拿到它返回的 `field_id`，再建查找引用列。

---

## 一、关联列（type: `link`）

在当前表里创建一列，关联到**同一份文档内的另一张子表**。首期只支持同文档跨子表关联，不能关联到别的文档。服务端会自动在目标表生成反向关联字段，响应里的 `back_field_id` 就是它的 ID；要改反向字段的标题，到目标表上用 `wb_smartsheet.update_fields` 改。

### property 结构

| 键 | 必填 | 说明 |
|---|---|---|
| `sub_id` | ✅ | 目标子表的 `sheet_id`（来自 `list_tables`），**必须与当前表不同** |
| `is_multiple` | ❌ | 是否允许关联多条记录，默认单选 |
| `field_id` | ❌ | 目标表用于展示的列 `field_id`；省略时用目标表的主列 |
| `view_id` | ❌ | 目标表的视图 `view_id`，用于限定可选记录范围 |
| `back_field_id` | ⛔ | **请求里禁止传**，只在响应中返回（反向字段由服务端生成） |

### 示例

```json
{
  "smartsheet_id": "<真实 smartsheet_id>",
  "sheet_id": "<当前表的 sheet_id>",
  "fields": [
    {
      "title": "相关任务",
      "type": "link",
      "property": {
        "sub_id": "<目标表的 sheet_id>",
        "is_multiple": true
      }
    }
  ]
}
```

### 给关联列写值

关联列的值是**目标表的 `record_id` 列表**：

```json
{
  "fields": {
    "<关联列的 field_id>": [{ "id": "<目标表的 record_id>" }]
  }
}
```

`record_id` 必须来自对**目标表**调用 `wb_smartsheet.list_records` 的实际返回，禁止编造。目标表还没有记录时，先给目标表 `add_records`，再回来写关联值。`is_multiple` 为 false 时只能给一条。

---

## 二、查找引用列（type: `lookup`）

从本表的关联列（或按筛选条件直接）引用**另一张表**的字段值，可附带统计（求和 / 计数 / 平均等）。查找引用列是计算列，**不能直接写入**。

### property 结构

| 键 | 必填 | 说明 |
|---|---|---|
| `upgrade_type` | ✅ | 查找方式：`0` 按关联查找（以本表关联列为桥梁），`1` 按条件查找（用 `filter` 直接筛目标表，**不需要**关联列） |
| `link_records_field_id` | ⚠️ | 本表中已存在的关联列 `field_id`；**仅 `upgrade_type=0` 时必填** |
| `lookup_field_id` | ✅ | 被查找的目标表中那一列的 `field_id`（必须是目标表已存在的列） |
| `lookup_sub_id` | ❌ | 被查找目标表的 `sheet_id`；为空表示本表 |
| `rollup_type` | ✅ | 统计类型，见下表 |
| `filter` | ❌ | 筛选条件，**仅 `upgrade_type=1` 时生效**，结构见第三节 |
| `formatter` | ❌ | 统计结果展示格式，见第四节 |

`rollup_type` 取值：

| 值 | 含义 | 适用被引用字段 |
|---|---|---|
| 0 | 原样引用 | 任意 |
| 1 | 去重引用 | 任意 |
| 2 | 求和 | 数字类 |
| 3 | 计数 | 任意 |
| 4 | 去重计数 | 任意 |
| 5 | 平均值 | 数字类 |
| 6 | 最大值 | 数字类 |
| 7 | 最小值 | 数字类 |

> 统计类型必须与被引用字段的类型匹配：求和 / 平均 / 最大 / 最小只适用于 `number`、`currency`、`percentage`、`progress`；对文本列求和会失败。

### 示例 1：按关联查找 + 求和（最常用）

本表「订单」通过关联列「客户」（`field_id=fLink`）引用「客户」表（`sheet_id=sCustomer`）的「消费总额」列（`field_id=fAmount`）并求和：

```json
{
  "title": "客户消费总额",
  "type": "lookup",
  "property": {
    "upgrade_type": 0,
    "link_records_field_id": "fLink",
    "lookup_field_id": "fAmount",
    "lookup_sub_id": "sCustomer",
    "rollup_type": 2,
    "formatter": {
      "type": 26,
      "property_currency": { "currency_type": 1, "decimal_places": 2, "use_separate": true }
    }
  }
}
```

### 示例 2：按关联查找 + 原样引用文本

```json
{
  "title": "客户行业",
  "type": "lookup",
  "property": {
    "upgrade_type": 0,
    "link_records_field_id": "fLink",
    "lookup_field_id": "fIndustry",
    "lookup_sub_id": "sCustomer",
    "rollup_type": 0
  }
}
```

### 示例 3：按条件查找（不需要本表关联列）

不经关联列，直接筛出目标表中「状态 = 已完成」的记录并计数：

```json
{
  "title": "已完成订单数",
  "type": "lookup",
  "property": {
    "upgrade_type": 1,
    "lookup_field_id": "fStatus",
    "lookup_sub_id": "sOrders",
    "rollup_type": 3,
    "filter": {
      "conjunction": 1,
      "conditions": [
        {
          "field_id": "fStatus",
          "field_type": 17,
          "operator": 1,
          "match_value": { "value_type": 0, "computed_key_type": 17, "value_selects": ["optDone"] }
        }
      ]
    },
    "formatter": {
      "type": 2,
      "property_number": { "decimal_places": 0, "use_separate": false }
    }
  }
}
```

### 跨表合法性

- `lookup_sub_id` 必须等于 `link_records_field_id` 所指关联列的目标表（即那个关联列 `sub_id` 指向的表）。两者不一致时引用无效。
- `link_records_field_id` 必须是**本表**的关联列，不能填别的表里的关联列。

---

## 三、filter 筛选条件结构（仅 `upgrade_type=1`）

```json
{
  "conjunction": 1,
  "conditions": [
    {
      "field_id": "<目标表列的 field_id>",
      "field_type": 17,
      "operator": 1,
      "match_value": { "value_type": 0, "computed_key_type": 17, "value_selects": ["optXxx"] }
    }
  ]
}
```

| 键 | 说明 |
|---|---|
| `conjunction` | 多条件组合方式：`1` and，`2` or |
| `conditions[].field_id` | 筛选条件作用的列 ID，必须是**目标表**中已存在的列 |
| `conditions[].field_type` | 该列的**数字类型码**，见下表 |
| `conditions[].operator` | `1` 等于，`2` 不等于，`3` 包含，`4` 不包含，`5` 大于，`6` 大于等于，`7` 小于，`8` 小于等于，`9` 为空，`10` 不为空 |
| `conditions[].match_value` | 匹配值；`operator` 为 9 / 10 时**不传**，其余 operator **必须传** |

> ⚠️ **`filter` 内部用数字类型码，这是引擎层的表示，和 `add_fields` 的 `type` 名字不是一套。** 不要把 `"text"` 之类的名字写进 `field_type`，也不要把数字写进 `add_fields` 的 `type`。

| 数字码 | 对应的列类型名 |
|---|---|
| 1 | `text` |
| 2 | `number` |
| 3 | `checkbox` |
| 4 | `date` |
| 8 | `url` |
| 9 | `multi_select` |
| 12 | `created_time` |
| 13 | `modified_time` |
| 14 | `progress` |
| 15 | `phone` |
| 16 | `email` |
| 17 | `single_select` |
| 18 | `link`（关联） |
| 24 | `title` |
| 26 | `currency` |
| 28 | `percentage` |

### match_value 各键

| 键 | 说明 |
|---|---|
| `value_type` | `0` 与具体值比较；`1` 与目标表的另一列比较 |
| `field_id` | 仅 `value_type=1` 时生效：被比较的目标表列 ID（此时禁止再传任何 `value_*`） |
| `computed_key_type` | 被比较值的数字类型码（同上表）；`value_type=0` 时必填，它决定该用哪个 `value_*` |
| `value_text` | 文本类匹配值（类型码 1 / 8 / 15 / 16 / 18 / 24） |
| `value_number` | 数字类匹配值（类型码 2 / 14 / 26 / 28） |
| `value_bool` | 勾选类匹配值（类型码 3） |
| `value_selects` | 选项 ID 数组（类型码 9 / 17 及人员类）；选项 ID 来自对目标表调用 `list_fields` 的返回 |
| `value_date_time` | 日期类匹配值（类型码 4 / 12 / 13）：`{"type": 1, "timestamps": [1735689600000]}`。`type`：`1` 具体时间（1 个时间戳）、`2` 时间范围（起止两个时间戳）、`3` 今天、`4` 明天、`5` 昨天、`6` 本周、`7` 上周、`8` 本月（相对类型可不填 `timestamps`） |

### 多条件 OR 示例

```json
{
  "conjunction": 2,
  "conditions": [
    { "field_id": "fStatus", "field_type": 17, "operator": 1, "match_value": { "value_type": 0, "computed_key_type": 17, "value_selects": ["optDoing"] } },
    { "field_id": "fStatus", "field_type": 17, "operator": 1, "match_value": { "value_type": 0, "computed_key_type": 17, "value_selects": ["optDone"] } }
  ]
}
```

---

## 四、formatter（统计结果格式）

按统计结果的展示类型选 `type` 与对应的 `property_*`：

| type | 格式 | property |
|---|---|---|
| 1 | 文本 | 不需要 property |
| 2 | 数字 | `property_number`：`decimal_places`、`use_separate` |
| 4 | 日期 | `property_date_time`：`format`、`auto_fill` |
| 26 | 货币 | `property_currency`：`currency_type`（`1` 人民币等）、`decimal_places`、`use_separate` |
| 28 | 百分比 | `property_percentage`：`decimal_places`、`use_separate` |

`decimal_places` 取值 -1 ~ 4（`-1` 表示不规整小数位）；日期的 `format` 只接受 [SKILL.md](./SKILL.md) 第六节列出的十种写法。

省略 `formatter` 时沿用被引用字段的原始格式。

> 这套键名（`type` + `property_*` + 下划线命名）只用于查找引用列。**公式列的 formatter 键名不同**（`formatterType` / `decimalPlaces`），见 [formula.md](./formula.md)，两者不要互相套用。

---

## 五、常见错误

| ❌ 错误写法 | ✅ 正确写法 |
|---|---|
| 把 `link` / `lookup` 列写进 `table_plan` 或 `add_table` | 建表成功、`add_records` 填完记录后，用 `add_fields` 追加 |
| `property` 里用 `tableId` 指定目标表 | 用 `sub_id`（关联列）/ `lookup_sub_id`（查找引用列） |
| 关联列请求里传 `back_field_id` | 删掉，反向字段由服务端自动生成 |
| 查找引用列用 `sourceFieldId` / `refFieldId` | `lookup_field_id` |
| 查找引用列用 `rollupFunction` | `rollup_type` |
| 查找引用列用 `filters` | `filter` |
| `upgrade_type=0` 时不传 `link_records_field_id` | 按关联查找必须传本表真实关联列 ID |
| `upgrade_type=1` 时还去建关联列 | 按条件查找不需要关联列，用 `filter` 直接筛目标表 |
| `lookup_sub_id` 与关联列的目标表不一致 | 两者必须指向同一张表 |
| `link_records_field_id` 填了别的表的关联列 | 必须是**本表**的关联列 `field_id` |
| `sub_id` 填当前表自己的 `sheet_id` | 目标表必须与当前表不同 |
| 关联到另一份文档的子表 | 只支持同文档跨子表 |
| 用 `F1` / `T1` 当 `sub_id` / `field_id` | 先 `list_tables` / `list_fields` 现取真实标识 |
| 给 `lookup` 列直接 `update_records` 赋值 | 它是计算列；要改结果，改被引用的源数据或关联关系 |
