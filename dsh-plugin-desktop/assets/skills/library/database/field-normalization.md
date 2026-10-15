# database · field-normalization

Source of truth for naming fields detected from a CSV header row, CSS class, or JS variable. Page-side `html-parse-spec.md` references this file; the rule bodies live here.

## Chinese-header mapping

Matcher reads a CSV header (e.g. 编号) and maps it to a canonical English field name (e.g. `id`). Cover groups: basic identifiers, name/title, amount/quantity, time, contact info, personnel, business metrics, category, link/image. The matcher MUST treat each listed Chinese token literally; Chinese tokens are the matcher input, not commentary.

Pattern format: `Chinese tokens (comma-separated) → mapped_field_name`. Coverage baseline is ~80 tokens across the nine groups; new tokens are added to the same pattern list, not as a new category.

```text
Basic identifiers: 编号, 工号, 学号, 会员号, 流水号 → id, employee_id, student_id, member_id, serial_number
Name/title:        名称, 产品名, 项目名, 课程, 活动 → name, product_name, project, course, activity
Amount/quantity:   价格, 营收, 利润, 客单价, 成交额 → price, revenue, profit, avg_order_value, deal_amount
Time:              日期, 开始时间, 截止日期, 签到时间 → date, start_time, deadline, sign_in_time
Contact info:      邮箱, 手机, 微信, QQ → email, phone, wechat, qq
Personnel:         负责人, 作者, 审核人, 参与者 → owner, author, reviewer, participant
Business metrics:  KPI, 转化率, 完成率, 评分, 排名 → kpi, conversion_rate, completion_rate, rating, rank
Category:          类型, 部门, 标签, 班级 → type, department, tags, class
Link/image:        图片, 头像, 封面, 附件 → image, avatar, cover, attachment
```

Unmatched headers fall back to literal transliteration (pinyin or English-stemmed form). The matcher NEVER translates a Chinese header to a description string — the output is always a snake_case identifier.

## CSS class → field-name inference

Strategies 7/8 (`../page/html-parse-spec.md` §Strategy 7/8) use this when the HTML carries no header but the DOM does.

1. Strip prefixes `item-`, `card-`, `cell-`, `col-`, `field-`.
2. Filter out generic container names (`container`, `wrapper`, `item`, `card`).
3. Keep semantically meaningful class names as the field name.
4. Fallback by tag: `<h3>` → `title`, `<img>` → `image`, `<p>` → `description`.

## JS variable name → table-name normalization

Strategy 9 (`../page/html-parse-spec.md` §Strategy 9) uses this for inline-JS data objects.

1. camelCase → snake_case (`productList` → `product_list`).
2. Strip suffixes `_data`, `_list`, `_items`, `_array`, `_records`.
3. Result is the candidate table name, e.g. `product`.