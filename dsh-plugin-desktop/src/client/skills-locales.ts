export const zh = {
  nav: '技能', title: '技能', intro: '创建和维护 Agent 的专业能力，管理每个技能的调用方式与适用场景。',
  refresh: '刷新', loading: '正在加载…', unavailable: '暂时无法读取技能。',
  operationFailed: '操作失败，请重试。', searchSkills: '搜索技能', noSkills: '默认 Agent 预设中尚未发现技能。', noMatches: '没有匹配的技能。',
  modelVisible: '模型可用', modelHidden: '模型不可用', userVisible: '可手动调用', userHidden: '不可手动调用', readOnly: '只读来源',
  newSkill: '新建技能', create: '创建', edit: '编辑', editSkill: '编辑技能', save: '保存', cancel: '取消',
  createHint: '填写基本信息与 Agent 执行时遵循的指令。', editHint: '名称不可修改，其他内容保存后将在后续调用中生效。',
  name: '名称', namePlaceholder: '例如 release-check', nameHint: '使用小写字母、数字和连字符。', description: '简介', descriptionPlaceholder: '简要说明这个技能能完成什么',
  whenToUse: '何时使用', whenToUsePlaceholder: '说明适用场景，帮助 Agent 判断何时选择它', instructions: '执行指令', instructionsPlaceholder: '输入 Agent 执行此技能时应遵循的步骤、约束和输出要求',
  importSkill: '导入原始 SKILL.md', importRaw: '导入文件内容', importHint: '高级方式：粘贴包含 YAML frontmatter 的完整文档。', rawDocument: 'SKILL.md 内容', importPlaceholder: '粘贴完整的 SKILL.md 内容', import: '导入', recycle: '移至回收站', recycleBin: '回收站', restore: '恢复', confirmRecycle: '确定将此技能移至回收站吗？',
  closeDetails: '关闭详情', expand: '展开', collapse: '收起', manage: '管理', source: '来源', provider: 'Provider', path: '文件位置', skillContent: '技能指令',
  sourceUserDsh: 'ClawClaw 用户技能', sourceUserAgents: 'Agents 用户技能', sourceBundled: '内置技能', sourcePlugin: '插件技能', sourceOther: '其他来源',
} as const

export type DesktopSkillsLocaleKey = keyof typeof zh

export const en: Record<DesktopSkillsLocaleKey, string> = {
  nav: 'Skills', title: 'Skills', intro: 'Create and maintain Agent capabilities, invocation behavior, and guidance for when each Skill applies.',
  refresh: 'Refresh', loading: 'Loading…', unavailable: 'Skills are temporarily unavailable.',
  operationFailed: 'The operation failed. Try again.', searchSkills: 'Search Skills', noSkills: 'No Skills were discovered in the default Agent preset.', noMatches: 'No Skills match.',
  modelVisible: 'Model visible', modelHidden: 'Hidden from model', userVisible: 'User invocable', userHidden: 'Hidden from users', readOnly: 'Read-only source',
  newSkill: 'New Skill', create: 'Create', edit: 'Edit', editSkill: 'Edit Skill', save: 'Save', cancel: 'Cancel',
  createHint: 'Define the capability and the instructions the Agent should follow.', editHint: 'The name cannot be changed. Saved updates apply to future invocations.',
  name: 'Name', namePlaceholder: 'For example, release-check', nameHint: 'Use lowercase letters, numbers, and hyphens.', description: 'Description', descriptionPlaceholder: 'Briefly explain what this Skill can do',
  whenToUse: 'When to use', whenToUsePlaceholder: 'Describe the situations that should lead the Agent to choose this Skill', instructions: 'Instructions', instructionsPlaceholder: 'Enter the steps, constraints, and output requirements the Agent should follow',
  importSkill: 'Import raw SKILL.md', importRaw: 'Import file content', importHint: 'Advanced: paste a complete document containing YAML frontmatter.', rawDocument: 'SKILL.md content', importPlaceholder: 'Paste the complete SKILL.md content', import: 'Import', recycle: 'Move to recycle bin', recycleBin: 'Recycle bin', restore: 'Restore', confirmRecycle: 'Move this Skill to the recycle bin?',
  closeDetails: 'Close details', expand: 'Expand', collapse: 'Collapse', manage: 'Manage', source: 'Source', provider: 'Provider', path: 'File location', skillContent: 'Skill instructions',
  sourceUserDsh: 'ClawClaw user Skills', sourceUserAgents: 'Agents user Skills', sourceBundled: 'Built-in Skills', sourcePlugin: 'Plugin Skills', sourceOther: 'Other sources',
}
