# 公式字段（type: 19）

公式列是计算列，值由系统自动计算，不能直接修改。骨架创建后 `formulaModel` 为 `null`（空壳），需要通过设置字段属性写入真实公式。公式字段的 `property` 包含 `formulaModel`（公式定义）和可选的 `formatter`（结果格式）。

> ⚠️ **查公式结果必须开计算列**：默认 `smartsheet.list_records` **不返回**公式计算结果。要读取公式列（以及查找引用、关联记录等计算列）的值，调用时必须传 `include_computed_values: true`，结果在字段的 `computed_value` 里。默认 `false`；开启会增加耗时，建议同时用 `field_titles` 只取需要的列。

## formulaModel 格式

`formulaModel` 是一个数组，支持以下 type：

| type | 含义 | 格式 |
|------|------|------|
| 1 | 文本（函数名、运算符、括号、逗号、字符串常量） | `{ "type": 1, "text": "内容" }` |
| 2 | 字段引用（当前行某字段的值） | `{ "type": 2, "fieldId": "真实fieldId" }` |
| 3 | 字段属性引用 | `{ "type": 3, "fieldId": "fieldId", "attr": "属性名" }` |
| 4 | 整表数据引用（引用某张表的全部记录） | `{ "type": 4, "tableId": "tableId" }` |
| 5 | 整列数据引用（用于 `[EACH].[列]` 场景） | `{ "type": 5, "fieldId": "fieldId", "tableId": "tableId" }` |
| 6 | 整表.整列数据引用（用于 `[表].[列]` 场景） | `{ "type": 6, "fieldId": "fieldId", "tableId": "tableId" }` |
| 7 | 当前值（EACH，迭代中的当前元素） | `{ "type": 7 }` |

> ⚠️ **type 1 和 2 是最常用的**，适用于大部分简单公式。type 4-7 用于跨表查询、FILTER/COUNTIF 等需要引用整表或整列数据的高级场景。

### 核心约束

1. **fieldId / tableId 必须来自 [SKILL.md](../SKILL.md) 中列出的 `smartsheet.list_fields`（字段 fieldId）/ `smartsheet.list_tables`（表 tableId）等工具的查询结果**，禁止使用规划占位符（如 F3、F5），禁止编造
2. **禁止引用自身**：公式列不能在 formulaModel 中引用自己的 fieldId
3. **字符串转义**：text 中的双引号必须转义为 `\"`
4. 一个 `type: 1` 元素可以包含多个运算符和文本，按语义段落拆分即可
5. **type 4（整表引用）**：用在 FILTER/COUNTIF 等需要遍历整张表记录的场景，tableId 为目标表 ID
6. **type 5（整列引用）**：用在 `[EACH].[字段名]` 中，表示迭代时访问每条记录的某个字段
7. **type 7（当前值）**：等价于 `[EACH]`，在 FILTER 回调中代表当前正在迭代的记录

---

## 常见公式模式

**数值计算 / 函数调用**（`[字段A] * [字段B]`、`SUM(...)`）：
```json
[
  { "type": 2, "fieldId": "fXXX" },
  { "type": 1, "text": " * " },
  { "type": 2, "fieldId": "fYYY" }
]
```
> ⚠️ `SUM([某字段])`（type 2）只返回当前行该字段的值，**不会**对整列求和。如需整列求和，应使用 `SUM([表].[列])` 形式（type 6 引用），或使用 `setFieldStatType` 设置列统计。

**跨表字段引用**（`[本表字段] * [他表].[他字段]`，如 `F5 乘以 T1.F7`）：
```json
[
  { "type": 2, "fieldId": "f1iV3X" },
  { "type": 1, "text": "*" },
  { "type": 6, "fieldId": "f3YHQ9", "tableId": "t4q2t9" }
]
```
> `type: 6` 对应跨表字段（T1.F7），其中 `tableId`（`t4q2t9`）是 T1 的表ID，`fieldId`（`f3YHQ9`）是 T1.F7 的字段ID。
> ⚠️ **跨表引用必须使用 `type: 6`**，禁止用 `type: 2`。`type: 2` 只能引用本表字段，跨表引用需要同时提供 `fieldId`（目标表的字段ID）和 `tableId`（目标表的表ID）。`fieldId` 和 `tableId` 必须来自 [SKILL.md](../SKILL.md) 中列出的 `smartsheet.list_fields` / `smartsheet.list_tables` 等工具的查询结果，禁止编造。

**条件判断 + 字符串转义**（`IF([分数] >= 60, "及格", "不及格")`）：
```json
[
  { "type": 1, "text": "IF(" },
  { "type": 2, "fieldId": "fScore" },
  { "type": 1, "text": " >= 60, \"及格\", \"不及格\")" }
]
```
> ⚠️ text 中的双引号必须转义为 `\"`，**不要多加反斜杠**。

**防错 + 嵌套**（`IFERROR(ROUND([总价]/[数量], 2), 0)`）：
```json
[
  { "type": 1, "text": "IFERROR(ROUND(" },
  { "type": 2, "fieldId": "fTotal" },
  { "type": 1, "text": " / " },
  { "type": 2, "fieldId": "fQty" },
  { "type": 1, "text": ", 2), 0)" }
]
```

**FILTER + EACH 单条件**（`IF([本表].FILTER([EACH].[名称] = [名称]).[名称].COUNTA() > 1, "❗️重复", "")`）：
```json
[
  { "type": 1, "text": "IF(" },
  { "type": 4, "tableId": "thyHrO" },
  { "type": 1, "text": ".FILTER(" },
  { "type": 7 },
  { "type": 1, "text": "." },
  { "type": 5, "fieldId": "fgprCA", "tableId": "thyHrO" },
  { "type": 1, "text": " = " },
  { "type": 2, "fieldId": "fgprCA" },
  { "type": 1, "text": ")." },
  { "type": 5, "fieldId": "fgprCA", "tableId": "thyHrO" },
  { "type": 1, "text": ".COUNTA() > 1, \"❗️重复\", \"\")" }
]
```
> 说明：`type 4` 引用整张表，`type 7` 代表 EACH（当前迭代记录），`type 5` 引用整列（`[EACH].[字段]`），`type 2` 引用当前行字段值。

**FILTER 多条件**（`IF([本表].FILTER(AND([EACH].[名称]=[名称], [EACH].[排序]<[排序])).[名称].COUNTA() >= 1, "❗️重复", "")`）：
```json
[
  { "type": 1, "text": "IF(" },
  { "type": 4, "tableId": "BB08J2" },
  { "type": 1, "text": ".FILTER(AND(" },
  { "type": 7 },
  { "type": 1, "text": "." },
  { "type": 5, "fieldId": "f7TNED", "tableId": "BB08J2" },
  { "type": 1, "text": " = " },
  { "type": 2, "fieldId": "f7TNED" },
  { "type": 1, "text": ", " },
  { "type": 7 },
  { "type": 1, "text": "." },
  { "type": 5, "fieldId": "fTxDpU", "tableId": "BB08J2" },
  { "type": 1, "text": " < " },
  { "type": 2, "fieldId": "fTxDpU" },
  { "type": 1, "text": "))." },
  { "type": 5, "fieldId": "f7TNED", "tableId": "BB08J2" },
  { "type": 1, "text": ".COUNTA() >= 1, \"❗️重复\", \"\")" }
]
```
> ⚠️ **FILTER 内多条件必须用 `AND()` / `OR()` 函数包裹**，不能直接用裸 `AND` / `OR` 关键字。条件之间用逗号分隔。

---

## 常见错误

❌ FILTER 内用裸 AND 连接多条件：
```json
// 错误！FILTER 内不能直接用 AND 关键字
[
  { "type": 1, "text": ".FILTER(" },
  { "type": 7 },
  { "type": 1, "text": ".[字段A] = [字段A] AND " },
  { "type": 7 },
  { "type": 1, "text": ".[字段B] < [字段B])" }
]
```
✅ 正确写法：用 `AND()` 函数包裹，条件用逗号分隔：
```json
[
  { "type": 1, "text": ".FILTER(AND(" },
  { "type": 7 },
  { "type": 1, "text": ".[字段A] = [字段A], " },
  { "type": 7 },
  { "type": 1, "text": ".[字段B] < [字段B]))" }
]
```

❌ 用 type 2 的 SUM 求整列聚合/计算占比：
```json
// 错误！SUM + type 2 只返回当前行的值，不会对整列求和
[
  { "type": 1, "text": "IFERROR(" },
  { "type": 2, "fieldId": "fAmount" },
  { "type": 1, "text": " / SUM(" },
  { "type": 2, "fieldId": "fAmount" },
  { "type": 1, "text": "), 0)" }
]
```
✅ 正确写法：使用 `type 6`（`[表].[列]`）引用整列数据实现占比计算：
```json
[
  { "type": 1, "text": "IFERROR(" },
  { "type": 2, "fieldId": "fAmount" },
  { "type": 1, "text": " / SUM(" },
  { "type": 6, "fieldId": "fAmount", "tableId": "tXXXXX" },
  { "type": 1, "text": "), 0)" }
]
```

❌ 括号使用 type 2：
```json
[{ "type": 2, "fieldId": "(" }]   // 错误！括号必须用 type 1
```

❌ 字符串未转义：
```json
[{ "type": 1, "text": "IF(ISBLANK(F1), "N/A", F1)" }]   // 错误！双引号未转义
```

✅ 正确写法：
```json
[
  { "type": 1, "text": "IF(ISBLANK(" },
  { "type": 2, "fieldId": "fXXX" },
  { "type": 1, "text": "), \"N/A\", " },
  { "type": 2, "fieldId": "fXXX" },
  { "type": 1, "text": ")" }
]
```

---

## 格式化器（formatter）

根据公式的输出格式，附加 `formatter`：

| 格式 | formatterType | 附加属性 |
|------|---------------|----------|
| 文本 | 1 | 无 |
| 数字 | 2 | `decimalPlaces`, `useSeparate` |
| 日期 | 4 | `format: "yyyy-mm-dd"`, `autoFill: false` |
| 货币 | 26 | `currencyType: 1`, `decimalPlaces: 2`, `useSeparate: true` |
| 百分比 | 28 | `decimalPlaces`, `useSeparate` |

---

## property 结构

公式字段的 `property` 对象包含以下字段：

```json
{
  "formulaModel": [
    { "type": 1, "text": "IFERROR((" },
    { "type": 2, "fieldId": "<字段A的fieldId>" },
    { "type": 1, "text": " - " },
    { "type": 2, "fieldId": "<字段B的fieldId>" },
    { "type": 1, "text": ") / " },
    { "type": 2, "fieldId": "<字段A的fieldId>" },
    { "type": 1, "text": ", 0)" }
  ],
  "formatter": { "formatterType": 28, "decimalPlaces": 2 }
}
```

`formulaModel` 和 `formatter` 的构建规则见上方章节。

---

## 函数参考

### 运算符

| 运算符 | 说明 | 示例 |
|--------|------|------|
| `=` | 等于（内容比较，与顺序格式无关） | `1 = "01" => TRUE` |
| `!=` / `<>` | 不等于 | `1 != 2 => TRUE` |
| `==` | 严格相等（内容+顺序+格式） | `1 == "1" => FALSE` |
| `!==` | 严格不相等 | `1 !== "1" => TRUE` |
| `>` `>=` `<` `<=` | 大小比较 | `3 > 1 => TRUE` |
| `+` `-` `*` `/` | 四则运算（操作数需为数值型，非数值会尝试转换） | `[订单量] * [商品单价]` |
| `^` | 求幂 | `2^2 => 4` |
| `&` | 文本拼接 | `[姓名] & "-" & [编号]` |

### 数字函数

| 表达式 | 说明 | 示例 |
|--------|------|------|
| SUM(值1, [值2, ...]) | 对多个参数求和（type 2 仅限当前行多字段/常数；如需整列求和使用 `SUM([表].[列])` 即 type 6） | `SUM(1,2,3) => 6` |
| AVERAGE(值1, [值2, ...]) | 平均值 | `AVERAGE(1,3) => 2` |
| MAX(值1, [值2, ...]) | 最大值 | `MAX(1,3,2) => 3` |
| MIN(值1, [值2, ...]) | 最小值 | `MIN(1,3,2) => 1` |
| COUNT(值1, [值2, ...]) | 统计数字个数 | `COUNT(1,"x") => 1` |
| COUNTA(值1, [值2, ...]) | 统计非空元素个数 | `COUNTA(1,2,"x") => 3` |
| COUNTIF(范围, 条件) | 条件计数 | `LIST(1,2,3,4).COUNTIF([EACH]>2) => 2` |
| SUMIF(范围, 条件) | 条件求和 | `LIST(1,2,3,4).SUMIF([EACH]>2) => 7` |
| ROUND(数值, 位数) | 四舍五入 | `ROUND(2.55, 1) => 2.6` |
| INT(数值) | 向下取整 | `INT(8.9) => 8` |
| ABS(数值) | 绝对值 | `ABS(-2) => 2` |
| CEILING(数值, 基数) | 向上舍入到基数的倍数 | `CEILING(4.4, 0.1) => 4.5` |
| FLOOR(数值, 基数) | 向下舍入到基数的倍数 | `FLOOR(4.4, 0.1) => 4.4` |
| SQRT(数值) | 平方根 | `SQRT(16) => 4` |
| POWER(基数, 指数) | 乘幂 | `POWER(5,2) => 25` |
| LOG(数值, [底数]) | 对数（默认底数10） | `LOG(8, 2) => 3` |
| EXP(数值) | e 的 n 次幂 | `EXP(2) => 7.389` |
| RAND() | 随机数（0~1） | `RAND() => 0.834` |
| VALUE(文本) | 文本转数值 | `VALUE("1,000") => 1000` |

### 文本函数

| 表达式 | 说明 | 示例 |
|--------|------|------|
| CONCAT(文本1, [文本2, ...]) | 拼接文本（双引号用连续两个`""`表示） | `CONCAT("A", "-", "B") => "A-B"` |
| CONCATENATE(文本1, [文本2, ...]) | 连接多个文本 | `CONCATENATE("A","B") => "AB"` |
| LEFT(字符串, [字符数]) | 从左提取 | `LEFT("你好", 1) => "你"` |
| RIGHT(字符串, [字符数]) | 从右提取 | `RIGHT("你好", 1) => "好"` |
| MID(文本, 开始位置, 长度) | 提取中间字符 | `MID("你好世界", 3, 2) => "世界"` |
| LEN(文本) | 字符数（含空格） | `LEN("abcd") => 4` |
| FIND(查找值, 查找范围, [起始位置]) | 查找位置（区分大小写） | `FIND("e","Hello") => 2` |
| SEARCH(查询文本, 被查询文本, [编号]) | 查找位置（不区分大小写） | `SEARCH("e","Hello") => 2` |
| REPLACE(文本, 位置, 长度, 新文本) | 按位置替换 | `REPLACE("你好",1,1,"啊") => "啊好"` |
| SUBSTITUTE(文本, 旧文本, 新文本, [序号]) | 按内容替换 | `SUBSTITUTE("a-b-c","-",":") => "a:b:c"` |
| TRIM(文本) | 去除首尾空格 | `TRIM("  a  ") => "a"` |
| UPPER(文本) | 转大写 | `UPPER("abc") => "ABC"` |
| LOWER(文本) | 转小写 | `LOWER("ABC") => "abc"` |
| SPLIT(文本, 分隔符) | 分割文本 | `SPLIT("a,b,c",",") => ["a","b","c"]` |
| TEXT(数值, 格式) | 格式化为文本 | `TEXT(0.3,"0%") => "30%"` |
| TEXTJOIN(分隔符, 忽略空值, 文本1, ...) | 带分隔符拼接 | `TEXTJOIN(",",TRUE,"a","b") => "a,b"` |
| CHAR(数字) | Unicode 字符 | `CHAR(65) => "A"` |
| CONTAINTEXT(文本, 查找文本) | 判断文本中是否包含要查找的文本 | `CONTAINTEXT("智能表格","表格") => TRUE` |
| TODATE(文本) | 将文本转成日期格式 | `TODATE("2024-8-9") => 2024/08/09` |

### 逻辑函数

| 表达式 | 说明 | 示例 |
|--------|------|------|
| IF(条件, 真值, [假值]) | 条件判断 | `IF([是否完成]="是", 1, 2)` |
| IFS(条件1, 值1, [条件2, 值2, ...]) | 多条件判断 | `IFS([分数]>=80,"优秀",[分数]>=60,"及格",TRUE,"不及格")` |
| AND(条件1, [条件2, ...]) | 全部为真返回 TRUE | `AND(2>1, 92>100) => FALSE` |
| OR(条件1, [条件2, ...]) | 任一为真返回 TRUE | `OR(2>1, 92<100) => TRUE` |
| NOT(条件) | 取反 | `NOT(92>100) => TRUE` |
| SWITCH(表达式, 值1, 结果1, ..., [默认值]) | 匹配分支 | `SWITCH([日期],1,"周日",2,"周一","不匹配")` |
| IFERROR(值, 错误时返回值) | 错误处理 | `IFERROR([总价]/[数量], 0)` |
| IFBLANK(值, 空值时返回值) | 空值处理 | `IFBLANK([商品名称],"未登记")` |
| ISBLANK(值) | 是否为空（空字符串也为空） | `ISBLANK("") => TRUE` |
| ISNULL(值) | 是否为空（空字符串不为空） | `ISNULL("") => FALSE` |
| ISERROR(值) | 是否错误 | `ISERROR(2/0) => TRUE` |
| TRUE() | 返回 TRUE | |
| FALSE() | 返回 FALSE | |
| RECORD_ID() | 当前记录唯一 ID | `RECORD_ID() => "rqeosZ"` |

### 日期函数

| 表达式 | 说明 | 示例 |
|--------|------|------|
| DATE(年, 月, 日) | 构造日期 | `DATE(2018,4,18) => 2018/4/18` |
| TODAY() | 当前日期 | |
| NOW() | 当前日期和时间 | |
| YEAR(日期) | 提取年份 | `YEAR("2018-4-20") => 2018` |
| MONTH(日期) | 提取月份 | `MONTH("2018-4-20") => 4` |
| DAY(日期) | 提取日 | `DAY("2018-4-20") => 20` |
| HOUR(时间) | 提取小时 | `HOUR("10:30:55") => 10` |
| MINUTE(时间) | 提取分钟 | `MINUTE("10:30:55") => 30` |
| SECOND(时间) | 提取秒 | `SECOND("10:30:55") => 55` |
| DATEDIF(起始, 结束, 单位) | 日期差（Y/M/D/MD/YM/YD） | `DATEDIF("2018/4/10","2018/4/18","D") => 8` |
| DATEVALUE(日期字符串) | 日期转数值（距1900-1-1天数） | `DATEVALUE("2018/04/18") => 43208` |
| WEEKDAY(日期, [类型]) | 星期几 | `WEEKDAY("2018-4-18", 3) => 2` |
| WEEKNUM(日期, [类型]) | 第几周 | `WEEKNUM("2000-1-1") => 1` |
| WORKDAY(起始, 天数, [节假日]) | 工作日计算 | `WORKDAY(DATE(2018,4,18), 4)` |
| NETWORKDAYS(开始, 结束, [节假日]) | 净工作日天数 | `NETWORKDAYS("2018-4-18","2018-4-25") => 4` |

### 列表函数

| 表达式 | 说明 | 示例 |
|--------|------|------|
| LIST([值1, 值2, ...]) | 创建列表 | `LIST("智","能","表","格") => [智,能,表,格]` |
| 列表.AT(位置) | 返回列表第N个位置的元素（正数从左，负数从右） | `LIST(1,2,3,4).AT(2) => 2` |
| 列表.FIRST() | 返回列表第一个元素 | `LIST(1,2,3).FIRST() => 1` |
| 列表.LAST() | 返回列表最后一个元素 | `LIST(1,2,3).LAST() => 3` |
| 查找范围.CONTAINS([值1, 值2, ...]) | 判断范围是否包含任一值 | `LIST(1,2,3,4).CONTAINS(2,5) => TRUE` |
| 查找范围.CONTAINSALL([值1, 值2, ...]) | 判断范围是否包含所有值 | `LIST(1,2,3,4).CONTAINSALL(1,2) => TRUE` |
| 查找范围.CONTAINSONLY([值1, 值2, ...]) | 判断范围是否仅包含所有值（不要求顺序） | `LIST(1,2,3,4).CONTAINSONLY(1,2,4,3) => TRUE` |
| 数据范围.FILTER(筛选条件) | 从范围中筛选符合条件的内容（通过 EACH 逐一判断） | `LIST(1,2,3,4).FILTER([EACH]>2) => 3,4` |
| 值1.LISTCOMBINE([值2, ...]) | 合并多个列表为一个列表 | `LISTCOMBINE(LIST(1,2,LIST(3,4)),5,6) => [1,2,3,4,5,6]` |
| 列表.LISTJOIN([分隔符]) | 用分隔符拼接列表中的值（默认英文逗号） | `LIST("智","能","表","格").LISTJOIN("-") => 智-能-表-格` |
| LOOKUP(查找值, 匹配值, 返回字段, [查找模式]) | 在列表中查找符合条件的值 | `LOOKUP([负责人],[人员表].[姓名],[人员表].[部门],1) => 部门1` |
| 值1.UNIQUE([值2, ...]) | 列表去重 | `LIST(1,2,2,3,1).UNIQUE() => [1,2,3]` |
| CHOOSE(索引号, 选择1, [选择2, ...]) | 根据索引号返回对应值（索引从1开始） | `CHOOSE(3,"Hello"," ","World") => World` |
