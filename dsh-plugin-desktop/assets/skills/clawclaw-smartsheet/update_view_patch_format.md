# update_view patch 格式规范

> 本文档定义 `wb_smartsheet.update_view` 的 patch 参数的 JSON 结构。参数名与其余入参以该工具的 schema 为准；若 schema 要求 patch 是**字符串**，就把本文档定义的 JSON 序列化后传入（嵌套引号需转义）。
>
> 调用前先 `wb_smartsheet.list_views` 拿 `view_id`、`wb_smartsheet.list_fields` 拿 `field_id` 与选项 ID。

## 生成原则

- 顶层是**局部更新**：只传要改的键（至少一个），未列出的键保持原配置不变；传入未定义的键会报错
- `filter` / `sort` / `group` / `fields` 内部是**全量覆盖**语义：设置时要包含所有希望保留的条目。清除某一项有两种写法：把该键传 `null`，或把 `items` / `conditions` 传空数组
- `sort` / `group` 的每一条既可以写 `direction: "asc"|"desc"`，也可以写 `desc: true|false`；两种都认
- 所有 `field_id` / 选项 ID / 人员 ID 必须来自 `wb_smartsheet.list_fields` / `wb_smartsheet.list_views` 的真实返回。**禁止编造，禁止用规划文本占位符（`F1` / `V1` 一类）**——引用不存在的列会导致整单被拒绝，而不是静默忽略那一条配置
- patch 大小不超过 64KB
- 查询（query）视图不支持本接口；视图内字段数超过 100 时也不支持

## 一、顶层结构

| 键 | 类型 | 说明 |
|---|---|---|
| `title` | string | 视图标题；去掉首尾空格后不能为空 |
| `filter` | object | 筛选配置，见第二节 |
| `sort` | object | 排序配置，见第三节 |
| `group` | object | 分组配置，见第四节 |
| `fields` | array | 字段显隐与列宽，见第五节 |
| `frozen_field_count` | int | 冻结列数；仅表格 / 甘特视图支持，取值 0 ~ 字段总数，`0` 表示不冻结（也接受 `frozen` 这个键名） |

## 二、filter（筛选）

```json
{
  "conjunction": "and",
  "conditions": [
    { "field_id": "<状态列的 field_id>", "operator": "is", "value": ["<进行中的选项 ID>"] },
    { "field_id": "<金额列的 field_id>", "operator": "is_greater", "value": 100 }
  ]
}
```

| 键 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `conjunction` | string | | `and` 满足所有条件（默认），`or` 满足任一条件 |
| `conditions` | array | ✅ | 筛选条件数组；**全量覆盖**；同一字段只能出现一次 |
| `conditions[].field_id` | string | ✅ | 筛选字段 ID，必须是当前子表中已存在的列 |
| `conditions[].operator` | string | ✅ | 见下表 |
| `conditions[].value` | — | | 格式由列类型决定，见下表；`is_empty` / `is_not_empty` 时**不能**传 |

### operator 枚举

| 值 | 说明 |
|---|---|
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

### value 按列类型取值

列类型从 `wb_smartsheet.list_fields` 的返回里读：

| 列类型 | value 格式 | 示例 | 说明 |
|---|---|---|---|
| `number` / `currency` / `percentage` / `progress` | number | `100` | 百分比 / 进度传数值部分：`50` 表示 50% |
| `checkbox` | boolean | `false` | |
| `date` / `created_time` / `modified_time` | number[]（毫秒时间戳） | `[1735689600000]` | 一个元素是具体日期；两个元素是日期范围（起止）。不支持「今天 / 本月」这类动态预设 |
| `user` / `created_user` / `modified_user` | string[]（人员 ID） | `["144xxxx"]` | 必须传人员 ID，不能传人名 |
| 其他（`text`、`single_select`、`multi_select`、`email`、`url` 等） | string[] | `["oQKhzE"]` | **单选 / 多选必须传选项 ID，不是选项文本** |

> ⚠️ **选项 ID 的取法**：调 `wb_smartsheet.list_fields`，找到该单选 / 多选列的完整属性 JSON，在里面定位那个同时含**选项文本**与**选项 ID** 的数组，按文本匹配取出 ID（如 `已完成 → oQKhzE`）。**不要假设它一定在 `property.options` 路径下**，以实际返回的结构为准；拿不准就把该列的属性完整输出看一遍，不要猜键名、不要编造 ID。

## 三、sort（排序）

```json
{
  "auto_sort": true,
  "items": [
    { "field_id": "<金额列的 field_id>", "direction": "desc" },
    { "field_id": "<名称列的 field_id>", "direction": "asc" }
  ]
}
```

| 键 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `auto_sort` | bool | | `true` 自动排序（新增 / 修改记录后自动重排），`false` 只排一次；不传保持默认 |
| `items` | array | ✅ | 排序条件；**数组顺序即优先级**（第一个最高）；**全量覆盖**，传 `[]` 清除排序 |
| `items[].field_id` | string | ✅ | 排序列 ID，必须已存在；同一列只能出现一次 |
| `items[].direction` | string | ✅ | `asc` 升序（小→大 / A→Z / 旧→新），`desc` 降序 |

> 不要用自动编号列作排序依据。

## 四、group（分组）

```json
{
  "items": [
    { "field_id": "<部门列的 field_id>", "direction": "asc" },
    { "field_id": "<状态列的 field_id>", "direction": "asc" }
  ]
}
```

| 键 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `items` | array | ✅ | 分组条件；**数组顺序即分组层级**（第一个是一级分组）；**全量覆盖**，传 `[]` 清除分组 |
| `items[].field_id` | string | ✅ | 分组列 ID，必须已存在；同一列只能出现一次 |
| `items[].direction` | string | ✅ | `asc` 升序分组，`desc` 降序分组 |

> 画廊 / 日历视图不支持分组。适合作分组字段的是 `single_select`、`multi_select`、`user`、`date`。

## 五、fields（字段显隐与列宽）

```json
{
  "fields": [
    { "field_id": "<备注列的 field_id>", "hidden": true },
    { "field_id": "<名称列的 field_id>", "width": 240 },
    { "field_id": "<负责人列的 field_id>", "hidden": false, "width": 180 }
  ]
}
```

| 键 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `fields[].field_id` | string | ✅ | 列 ID，必须已存在；同一列只能出现一次；最多 100 项 |
| `fields[].hidden` | bool | | `true` 隐藏，`false` 显示；每项至少要传 `hidden` 或 `width` 之一 |
| `fields[].width` | int | | 列宽（像素），仅表格 / 甘特视图支持，取值 40 ~ 1000；甘特视图只影响左侧表格区域 |

## 六、调用示例

示例一：改视图标题，设置筛选（状态 = 进行中 且 金额 > 100），并按金额降序自动排序：

```json
{
  "smartsheet_id": "<真实 smartsheet_id>",
  "sheet_id": "<真实 sheet_id>",
  "view_id": "<真实 view_id>",
  "patch": {
    "title": "高优任务",
    "filter": {
      "conjunction": "and",
      "conditions": [
        { "field_id": "<状态列>", "operator": "is", "value": ["<进行中的选项 ID>"] },
        { "field_id": "<金额列>", "operator": "is_greater", "value": 100 }
      ]
    },
    "sort": {
      "auto_sort": true,
      "items": [{ "field_id": "<金额列>", "direction": "desc" }]
    }
  }
}
```

示例二：隐藏备注列、名称列宽调整为 240、冻结第 1 列：

```json
{
  "smartsheet_id": "<真实 smartsheet_id>",
  "sheet_id": "<真实 sheet_id>",
  "view_id": "<真实 view_id>",
  "patch": {
    "fields": [
      { "field_id": "<备注列>", "hidden": true },
      { "field_id": "<名称列>", "width": 240 }
    ],
    "frozen_field_count": 1
  }
}
```

示例三：清除该视图的全部筛选与分组（注意是空数组，不是省略这两个键）：

```json
{
  "patch": {
    "filter": { "conditions": [] },
    "group": { "items": [] }
  }
}
```

返回里会带更新后的视图信息（`view_id` / 名称 / 类型 / 配置）以及本次实际应用的 patch 顶层键列表——用它核对自己想改的键是不是都生效了。

## 七、常见错误

| ❌ 错误 | ✅ 正确 |
|---|---|
| 单选 / 多选筛选值传选项**文本** | 传 `list_fields` 里的选项 ID |
| 人员筛选值传人名 | 传人员 ID |
| 日期筛选值传 `"2026-05-01"` 字符串 | 传毫秒时间戳数组，如 `[1735689600000]` |
| 只想加一条筛选，于是只传那一条 | `filter.conditions` 是全量覆盖：把要保留的条件一起传 |
| 想清空排序，于是省略 `sort` | 省略等于「不改」；清空要传 `{"items": []}` |
| patch 传空对象 `{}` | 至少要有一个顶层键 |
| 用 `add_view` 重建一个视图来「改配置」 | 用 `update_view` 局部改；重建会丢掉视图 ID 和用户的其它设置 |
