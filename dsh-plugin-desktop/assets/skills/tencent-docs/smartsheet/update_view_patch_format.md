# update_view patch_json 格式规范

> 本文档定义 `smartsheet.update_view` 工具 `patch_json` 参数的 JSON 结构。
> 适用 C 端（腾讯文档 docs.qq.com）。参数结构参考方圆智能表格文档（`docs/view/`）。
> 调用前先 `smartsheet.list_views` 拿 `view_id`、`smartsheet.list_fields` 拿 `field_id` 与选项 ID。

## 生成原则

- `patch_json` 是**字符串形式**的 JSON（嵌套在调用参数里需转义），大小不超过 64KB
- 顶层为**局部更新**：只传需要修改的键（至少一个），未列出的键保持原配置不变；传入未定义的键会报错
- `filter` / `sort` / `group` / `fields` 内部均为**全量覆盖**语义：设置时需包含所有希望保留的条目，传空数组 `[]` 表示清除该项配置
- 所有 `field_id` / 选项 ID / 人员 ID 必须来自 `list_fields` / `list_views` 的真实返回，**禁止编造、禁止用规划占位符（F1/V1 等）**
- query 视图不支持本接口；视图内字段数超过 100 时也不支持

## 一、顶层结构

| 键 | 类型 | 说明 |
|------|------|------|
| `title` | string | 视图标题；去除首尾空格后不能为空 |
| `filter` | object | 筛选配置，见第二章 |
| `sort` | object | 排序配置，见第三章 |
| `group` | object | 分组配置，见第四章 |
| `fields` | array | 字段显隐与列宽设置，见第五章 |
| `frozen_field_count` | int | 冻结列数；仅 grid / gantt 视图支持，取值 0 ~ 字段总数，`0` 表示不冻结 |

## 二、filter（筛选）

```json
{
  "conjunction": "and",
  "conditions": [
    { "field_id": "fld_status", "operator": "is", "value": ["opt_in_progress"] },
    { "field_id": "fld_amount", "operator": "is_greater", "value": 100 }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `conjunction` | string | | 条件连接方式：`and` = 满足所有条件（默认），`or` = 满足任一条件 |
| `conditions` | array | ✅ | 筛选条件数组；**全量覆盖**；同一字段只能出现一次 |
| `conditions[].field_id` | string | ✅ | 筛选字段 ID，必须是当前工作表中已存在的字段 |
| `conditions[].operator` | string | ✅ | 筛选操作符，见下表 |
| `conditions[].value` | - | | 筛选值，格式由字段类型决定（见下表）；`is_empty` / `is_not_empty` 时不能传 value |

### operator 枚举

| 值 | 说明 |
|----|------|
| `is` | 等于 |
| `is_not` | 不等于 |
| `contains` | 包含 |
| `does_not_contain` | 不包含 |
| `is_greater` | 大于 / 晚于 |
| `is_greater_or_equal` | 大于等于 / 不早于 |
| `is_less` | 小于 / 早于 |
| `is_less_or_equal` | 小于等于 / 不晚于 |
| `is_empty` | 为空（不能传 value） |
| `is_not_empty` | 非空（不能传 value） |

### value 按字段类型取值

字段类型通过 `list_fields` 获取（类型编号见 [table_plan_format.md](./table_plan_format.md) 第一章）：

| 字段类型 | value 格式 | 示例 | 说明 |
|---------|-----------|------|------|
| 数字 / 货币 / 百分比 / 进度 | number | `100` | 百分比 / 进度字段传数值部分，`50` 表示 50%，`100` 表示 100% |
| 复选框 | boolean | `false` | |
| 日期时间 / 创建时间 / 修改时间 | number[]（毫秒时间戳） | `[1678886400000]` | 单个元素为具体日期；两个元素为日期范围（起止时间）。不支持"今天 / 本月"等动态预设范围 |
| 创建人 / 修改人 / 人员 | string[]（人员 ID） | `["144xxxx"]` | 必须传人员 ID，不能传人员名称 |
| 其他（文本、单选、多选、邮箱、超链接等） | string[] | `["进行中"]` | 单选 / 多选字段必须传**选项 ID** 而非选项文本，选项 ID 从 `list_fields` 返回的字段属性中获取（提取方式见 SKILL.md 自动化章节 b：禁止假设键名为 `property.options`，以实际返回 JSON 为准） |

## 三、sort（排序）

```json
{
  "auto_sort": true,
  "items": [
    { "field_id": "fld_amount", "direction": "desc" },
    { "field_id": "fld_name", "direction": "asc" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `auto_sort` | bool | | `true` = 自动排序（新增 / 修改记录后自动重排），`false` = 仅执行一次排序；不传保持默认 |
| `items` | array | ✅ | 排序条件数组；**按数组顺序决定优先级**（第一个优先级最高）；**全量覆盖**，传 `[]` 表示清除排序 |
| `items[].field_id` | string | ✅ | 排序字段 ID，必须已存在；同一字段只能出现一次 |
| `items[].direction` | string | ✅ | `asc` 升序（小→大 / A→Z / 旧→新），`desc` 降序（大→小 / Z→A / 新→旧） |

## 四、group（分组）

```json
{
  "items": [
    { "field_id": "fld_department", "direction": "asc" },
    { "field_id": "fld_status", "direction": "asc" }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `items` | array | ✅ | 分组条件数组；**按数组顺序决定分组层级**（第一个为一级分组，第二个为二级分组）；**全量覆盖**，传 `[]` 表示清除分组 |
| `items[].field_id` | string | ✅ | 分组字段 ID，必须已存在；同一字段只能出现一次 |
| `items[].direction` | string | ✅ | `asc` 升序分组，`desc` 降序分组 |

> gallery / calendar 视图不支持分组；单选、多选、人员、日期字段适合作为分组字段。

## 五、fields（字段显隐与列宽）

```json
{
  "fields": [
    { "field_id": "fld_remark", "hidden": true },
    { "field_id": "fld_name", "width": 240 },
    { "field_id": "fld_owner", "hidden": false, "width": 180 }
  ]
}
```

| 字段 | 类型 | 必填 | 说明 |
|------|------|------|------|
| `fields[].field_id` | string | ✅ | 字段 ID，必须已存在；同一字段只能出现一次；最多 100 项 |
| `fields[].hidden` | bool | | `true` 隐藏该列，`false` 显示该列；每项至少传 `hidden` 或 `width` 之一 |
| `fields[].width` | int | | 列宽（像素），仅 grid / gantt 视图支持，取值 40 ~ 1000；设置甘特视图列宽只影响左侧表格区域 |

## 六、调用示例

示例一：更新视图标题，设置筛选（状态 = 进行中 且 金额大于 100），并按金额降序自动排序：

```bash
python3 tencentdocs.py tdoc_call tencent-docs smartsheet.update_view '{"file_id":"<fid>","sheet_id":"<sid>","view_id":"<vid>","patch_json":"{\"title\":\"高优任务\",\"filter\":{\"conjunction\":\"and\",\"conditions\":[{\"field_id\":\"fld_status\",\"operator\":\"is\",\"value\":[\"opt_in_progress\"]},{\"field_id\":\"fld_amount\",\"operator\":\"is_greater\",\"value\":100}]},\"sort\":{\"auto_sort\":true,\"items\":[{\"field_id\":\"fld_amount\",\"direction\":\"desc\"}]}}"}'
```

示例二：隐藏备注列、名称列宽调整为 240、冻结第 1 列：

```bash
python3 tencentdocs.py tdoc_call tencent-docs smartsheet.update_view '{"file_id":"<fid>","sheet_id":"<sid>","view_id":"<vid>","patch_json":"{\"fields\":[{\"field_id\":\"fld_remark\",\"hidden\":true},{\"field_id\":\"fld_name\",\"width\":240}],\"frozen_field_count\":1}"}'
```

返回字段：`view`（更新后的最新视图信息：`view_id` / `view_name` / `view_type` / `config`）、`applied_keys`（本次实际应用的 patch 顶层键列表）、`error`、`trace_id`。
