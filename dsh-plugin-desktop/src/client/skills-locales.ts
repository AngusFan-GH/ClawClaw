export const zh = {
  nav: 'Skills', title: 'Skills', intro: '查看默认 Agent 预设的全局与用户 Skills，并管理用户 Skill 的模型可见性。',
  refresh: '刷新', loading: '正在加载…', unavailable: '暂时无法读取 Skills。',
  operationFailed: '操作失败，请重试。', searchSkills: '搜索 Skills', noSkills: '默认 Agent 预设中尚未发现 Skill。', noMatches: '没有匹配的 Skill。',
  modelVisible: '模型可用', modelHidden: '模型不可用', userVisible: '可手动调用', userHidden: '不可手动调用', readOnly: '只读来源',
  importSkill: '导入 SKILL.md 内容', importPlaceholder: '粘贴带 YAML frontmatter 的 SKILL.md 内容', import: '导入', recycle: '移至回收站', recycleBin: '回收站', restore: '恢复', confirmRecycle: '将此 Skill 移至回收站？',
  closeDetails: '关闭详情', expand: '展开', collapse: '收起', manage: '管理', source: '来源', sourceGroup: '来源', provider: 'Provider', path: '文件位置', skillContent: 'Skill 指令',
} as const

export type DesktopSkillsLocaleKey = keyof typeof zh

export const en: Record<DesktopSkillsLocaleKey, string> = {
  nav: 'Skills', title: 'Skills', intro: 'Inspect global and user Skills in the default Agent preset and manage model visibility.',
  refresh: 'Refresh', loading: 'Loading…', unavailable: 'Skills are temporarily unavailable.',
  operationFailed: 'The operation failed. Try again.', searchSkills: 'Search Skills', noSkills: 'No Skills were discovered in the default Agent preset.', noMatches: 'No Skills match.',
  modelVisible: 'Model visible', modelHidden: 'Hidden from model', userVisible: 'User invocable', userHidden: 'Hidden from users', readOnly: 'Read-only source',
  importSkill: 'Import SKILL.md content', importPlaceholder: 'Paste SKILL.md content with YAML frontmatter', import: 'Import', recycle: 'Move to recycle bin', recycleBin: 'Recycle bin', restore: 'Restore', confirmRecycle: 'Move this Skill to the recycle bin?',
  closeDetails: 'Close details', expand: 'Expand', collapse: 'Collapse', manage: 'Manage', source: 'Source', sourceGroup: 'Source', provider: 'Provider', path: 'File location', skillContent: 'Skill instructions',
}
