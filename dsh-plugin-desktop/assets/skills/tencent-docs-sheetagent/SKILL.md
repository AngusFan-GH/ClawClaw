---
name: tencent-docs-sheetagent
description: >
  编辑、查询、分析、清洗、透视、排序、筛选、格式化既有 Excel/xlsx/xls/csv 表格文件，
  构造公式、生成图表、增删行列、合并单元格。
  当用户上传、引用或指向一份**既有**表格文件、并对其做上述行为时使用。
  当用户意图是从零产出一份新工作簿时改走 tencent-docs-sheet-generation。
  提供比 openpyxl 更强大的表格处理能力。
description_en: >
  Edit, query, analyze, clean, pivot, sort, filter, and format existing Excel/xlsx/xls/csv
  spreadsheet files; build formulas, generate charts, add/remove rows and columns, merge cells.
  Use when the user references an existing spreadsheet and asks to perform any of the above.
  Route brand-new-workbook creation to tencent-docs-sheet-generation instead.
---

将此任务委派给 **sheet-agent** 子代理处理。

## 传递给子代理的内容（仅限以下四项）

1. **文件路径** — 用户上传或引用的 Excel/CSV 文件的完整路径
2. **用户输入** — 用户的原始自然语言需求，原样转发，不做改写
3. **当前时间** — 主代理上下文中的当前时间信息，原样传递给子代理
4. **期望返回** — 告诉子代理需要返回什么结果给用户（如数据摘要、操作确认等）

## 禁止

- **禁止**添加实现步骤、工具名称、操作流程或任何执行细节
- **禁止**告诉子代理该如何完成任务或该调用哪些工具
- **禁止**主代理直接调用 `mcp__sheetagent__*` 工具

## 前置条件

若用户只上传了文件但没有给出具体指令，先询问用户希望做什么，得到回复后再调用子代理。

