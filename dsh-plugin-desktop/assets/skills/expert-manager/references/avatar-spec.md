# 预置头像规范

专家头像必须复用 ClawClaw 手动创建专家时使用的同一套预置头像，不生成、不复制，也不引用包内图片文件。

## 数据格式

- `plugin.json` 的 `avatar` 是 `0` 到 `35` 的整数。
- Agent 型使用顶层 `avatar`。
- Team 型每个 `members[]` 成员分别设置 `avatar`；顶层 `avatar` 保留为主理人的编号。
- 专家团头像由界面使用成员头像自动组合，不设置独立团队图片。

## 选择原则

1. 根据专家职业、行业分类和工作气质选择最合适的预置头像。
2. 同一专家团的成员尽量使用不同编号，便于快速识别。
3. 主理人与成员的头像编号必须稳定，修改其他内容时不要无故更换。
4. 无法判断时使用 `0`，不要创建 `avatars/` 目录或图片占位文件。

## 示例

Agent 型：

```json
"avatar": 6
```

Team 型：

```json
"avatar": 0,
"members": [
  { "id": "team-lead", "profession": { "zh": "项目主理人", "en": "Project Lead" }, "avatar": 0, "role": "lead" },
  { "id": "reviewer", "profession": { "zh": "质量评审专家", "en": "Quality Reviewer" }, "avatar": 9, "role": "member" }
]
```

运行时会把这些编号解析为 ClawClaw 内置头像。编号超出范围必须视为校验错误。
