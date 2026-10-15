# 双向关联与查找引用字段

本文档定义 `smartsheet.add_fields` 创建**双向关联列**（field_type: `twoWayLinkRecords`）和**查找引用列**（field_type: `lookup`）时的 property 构建规范。两种列都不能通过 `create_table_from_plan` 创建，必须在建表/填记录后用 `smartsheet.add_fields` 单独创建。

> ⚠️ 本文档以 MCP 工具 schema 为准。**不要**照抄底层 OpenAPI 文档里的以下写法，MCP 层已由服务端处理：
> - `backFieldId`：MCP 层**禁止**在请求中传（服务端自动生成反向字段并返回 `back_field_id`），不要自行构造 `f`+5位随机串
> - `mode` / `linkFilterInfo`：MCP 层 property 中**不存在**这两个字段
> - `conditionId`（`cdt` 前缀格式）：MCP 层 filter 条件**没有**此字段

## 前置约束（强制）

1. **所有 ID 必须现取**：`sub_id` 来自 `smartsheet.list_tables` 返回的 `sheet_id`；`link_records_field_id` / `lookup_field_id` / `field_id` 来自 `smartsheet.list_fields` 返回的真实 `field_id`（目标表的字段需带目标 `sheet_id` 再查一次 `list_fields`）。**禁止**编造、禁止用规划占位符（F1/F2/T1）。
2. **创建顺序**：查找引用列（按关联查找）依赖本表已存在的关联列（`reference` 单向关联或 `twoWayLinkRecords` 双向关联）→ 先建关联列并拿到返回的 `field_id`，再建查找引用列。
3. **跨表合法性**：`lookup_sub_id` 必须等于 `link_records_field_id` 所指关联列的目标表（即该关联列 `sub_id` 指向的表）；`link_records_field_id` 必须存在于**本表**。

---

## 一、双向关联列（field_type: `twoWayLinkRecords`）

在当前表中创建一个关联到**同文档另一张表**的双向关联列；系统会自动在目标表生成反向关联字段（响应中的 `back_field_id` 为反向字段 ID，如需修改反向字段标题，可在目标表上用 `update_fields` 改标题）。

### property 结构（`property_two_way_link_records`）

| 字段 | 必填 | 说明 |
|------|------|------|
| `sub_id` | ✅ | 目标子表 ID（`list_tables` 返回的 `sheet_id`），必须与当前表不同；首期仅支持同文档跨子表关联 |
| `is_multiple` | ❌ | 是否允许多选，默认单选 |
| `field_id` | ❌ | 目标表展示字段 ID，省略时用目标表主字段（标题列） |
| `view_id` | ❌ | 目标视图 ID |
| `back_field_id` | ⛔ | **请求时禁止传**，仅响应中返回（服务端生成的反向字段 ID） |

### 示例

```bash
python3 tencentdocs.py tdoc_call tencent-saas-docs smartsheet.add_fields '{"file_id":"<fid>","sheet_id":"<当前表sid>","fields":[{"field_title":"相关任务","field_type":"twoWayLinkRecords","property_two_way_link_records":{"sub_id":"<目标表sid>","is_multiple":true}}]}'
```

### 写入关联值（add_records / update_records）

双向关联列的记录值用 `reference_value` 传**目标表的 recordId 数组**（recordId 来自对目标表 `list_records` 的实际返回，禁止编造）：

```json
{"field":"相关任务","reference_value":{"items":["recA1","recB2"]}}
```

---

## 二、查找引用列（field_type: `lookup`）

从本表关联列（或按筛选条件直接）引用**另一张表**的字段值，可附带统计（求和/计数/平均等）。property 键为 `property_lookup`。

### property 结构

| 字段 | 必填 | 说明 |
|------|------|------|
| `upgrade_type` | ✅ | 查找方式：`0`-按关联查找（以本表关联列为桥梁），`1`-按条件查找（通过 `filter` 筛选目标表，**无需**关联列） |
| `link_records_field_id` | ⚠️ | 本表中已存在的关联列 `field_id`；**仅 `upgrade_type=0` 时必填** |
| `lookup_field_id` | ✅ | 被查找目标表中的列 `field_id`（必须是目标表已存在的列） |
| `lookup_sub_id` | ❌ | 被查找目标表的 `sheet_id`，为空表示本表 |
| `rollup_type` | ✅ | 统计类型：`0`-原样引用，`1`-去重引用，`2`-求和，`3`-计数，`4`-去重计数，`5`-平均值，`6`-最大值，`7`-最小值 |
| `filter` | ❌ | 筛选条件，**仅 `upgrade_type=1` 时生效** |
| `formatter` | ❌ | 统计结果展示格式，见下文 |

### 示例 1：按关联查找 + 求和（最常用）

本表"订单"通过关联列"客户"（field_id=fLink）引用"客户"表（sheet_id=sCustomer）的"消费总额"字段（field_id=fAmount）并求和：

```json
{
  "field_title": "客户消费总额",
  "field_type": "lookup",
  "property_lookup": {
    "upgrade_type": 0,
    "link_records_field_id": "fLink",
    "lookup_field_id": "fAmount",
    "lookup_sub_id": "sCustomer",
    "rollup_type": 2,
    "formatter": { "type": 26, "property_currency": { "currency_type": 1, "decimal_places": 2, "use_separate": true } }
  }
}
```

### 示例 2：按关联查找 + 原样引用文本

```json
{
  "field_title": "客户行业",
  "field_type": "lookup",
  "property_lookup": {
    "upgrade_type": 0,
    "link_records_field_id": "fLink",
    "lookup_field_id": "fIndustry",
    "lookup_sub_id": "sCustomer",
    "rollup_type": 0
  }
}
```

### 示例 3：按条件查找（无需本表关联列）

不经关联列，直接筛选目标表中"状态=已完成"的记录并计数（筛选字段 `field_id`/选项 ID 均来自目标表的 `list_fields` 实际返回）：

```json
{
  "field_title": "已完成订单数",
  "field_type": "lookup",
  "property_lookup": {
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
    "formatter": { "type": 2, "property_number": { "decimal_places": 0, "use_separate": false } }
  }
}
```

---

## 三、filter 筛选条件结构（仅 upgrade_type=1）

```json
{
  "conjunction": 1,
  "conditions": [
    {
      "field_id": "<目标表列ID>",
      "field_type": 17,
      "operator": 1,
      "match_value": { "value_type": 0, "computed_key_type": 17, "value_selects": ["optXxx"] }
    }
  ]
}
```

### 条件字段

| 字段 | 说明 |
|------|------|
| `field_id` | 筛选条件作用的列 ID，必须是**目标表**中已存在的列 |
| `field_type` | 该列的类型编号：1-文本，2-数字，3-勾选，4-日期，8-URL，9-多选，12-创建时间，13-修改时间，14-进度，15-电话，16-邮箱，17-单选，18-引用，24-标题，28-百分比 |
| `operator` | 1-等于，2-不等于，3-包含，4-不包含，5-大于，6-大于等于，7-小于，8-小于等于，9-为空，10-不为空 |
| `match_value` | 匹配值；operator 为 9/10（为空/不为空）时**无需**传，其余 operator **必须**传 |
| `conjunction` | 多条件组合方式：1-and，2-or |

### match_value 字段

| 字段 | 说明 |
|------|------|
| `value_type` | `0`-与具体值比较，`1`-与目标表另一列比较 |
| `field_id` | 仅 `value_type=1` 时生效：被比较的目标表列 ID（此时禁止再传 value_* 字段） |
| `computed_key_type` | 被比较值的列类型编号（同上枚举），`value_type=0` 时必填，决定用哪个 `value_*` 字段 |
| `value_text` | 文本类匹配值（类型 1/8/15/16/18/24） |
| `value_number` | 数字类匹配值（类型 2/14/28） |
| `value_bool` | 勾选类匹配值（类型 3） |
| `value_selects` | 选项 ID 数组（类型 9/17 及人员类）；选项 ID 来自目标表 `list_fields` 返回 |
| `value_date_time` | 日期类匹配值（类型 4/12/13）：`{"type": 1, "timestamps": [1785686400000]}`；type：1-具体时间(1个时间戳)，2-时间范围(2个起止时间戳)，3-今天，4-明天，5-昨天，6-本周，7-上周，8-本月（相对类型可不填 timestamps） |

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

## 四、formatter 统计结果格式

`formatter` 按统计结果的展示类型选择 `type` 与对应 `property_*`，结构同公式列：

| type | 格式 | property |
|------|------|----------|
| 1 | 文本 | 无需 property |
| 2 | 数字 | `property_number`：`decimal_places`、`use_separate` |
| 4 | 日期 | `property_date_time`：`format`、`auto_fill` |
| 26 | 货币 | `property_currency`：`currency_type`（1-CNY 等）、`decimal_places`、`use_separate` |
| 28 | 百分比 | `property_percentage`：`decimal_places`、`use_separate` |

> 统计类型需与被引用字段类型匹配：求和(2)/平均值(5)/最大值(6)/最小值(7) 只适用于数字类字段；计数(3)不限类型。省略 `formatter` 时使用被引用字段的原始格式。

---

## 五、常见错误

| ❌ 错误写法 | ✅ 正确写法 |
|-----------|-----------|
| property 里传 `tableId` 指定目标表 | 用 `sub_id`（双向关联）/ `lookup_sub_id`（查找引用） |
| 双向关联请求里传 `back_field_id` / `mode` / `linkFilterInfo` | 全部删除，MCP 层不存在这些字段，反向字段由服务端自动生成 |
| 查找引用用 `sourceFieldId` / `refFieldId` | `lookup_field_id` |
| 查找引用用 `rollupFunction` | `rollup_type` |
| 查找引用用 `filters` | `filter` |
| filter 条件里带 `conditionId`（cdt 前缀） | 删除该字段，MCP 层无此字段 |
| `upgrade_type=0` 时不传 `link_records_field_id` | 按关联查找必须传本表真实关联列 ID |
| `upgrade_type=1` 时仍依赖关联列 | 按条件查找无需 `link_records_field_id`，用 `filter` 直接筛目标表 |
| `lookup_sub_id` 与关联列目标表不一致 | 两者必须指向同一张表，否则引用无效 |
| `link_records_field_id` 填了其他表的关联列 | 必须是**本表**的关联列 field_id |
