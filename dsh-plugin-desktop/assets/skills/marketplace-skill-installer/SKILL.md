---
name: marketplace-skill-installer
description: |
  在 ClawClaw 对话中通过一句话搜索并安装 Skill。
  触发词：安装 skill、安装技能、install skill、添加技能、装个 X 技能、帮我安装 X、search skill。
description_en: |
  Search for and install skills through natural-language requests. Use when the user asks to find, add, or install a skill.
allowed-tools: search_and_install_skills
license: Internal
disable: false
---

# Marketplace Skill Installer

使用 `search_and_install_skills` 搜索并安装技能。

1. 从用户需求中提取 1–5 个关键词短语，调用搜索：

   ```json
   { "action": "search", "keywords": ["code review"] }
   ```

2. 搜索返回 `{ "skills": [{ "name": "...", "display_name": "...", "description": "..." }] }`。
   向用户展示显示名和描述；只安装用户明确要求或在看到候选后同意的技能。
3. 名称必须逐字复制当前会话最近一次搜索结果的 `name`，每次安装前都要重新搜索：

   ```json
   { "action": "install", "skill_names": ["<name from search>"] }
   ```

4. 按安装结果逐项报告 `installed`、`already_installed` 或 `refused`，不宣称失败项已安装。
   此工具不升级已安装技能；查询或关闭当前已启用技能使用 `skill_management`。
