/** Expert center copy for the Desktop client. */

export const DESKTOP_EXPERTS_LOCALE_NAMESPACE = 'desktop.experts'

export const zh = {
  nav: '专家', title: '专家中心',
  intro: '浏览本地专家包，选择一位专家开始新的对话。专家以 Agent 预设的方式生效，不会在每条消息里附加角色说明。',
  refresh: '刷新', loading: '正在加载专家…', loadFailed: '无法读取专家列表。', retry: '重试',
  searchExperts: '搜索专家', filterCategory: '按分类筛选', allCategories: '全部分类',
  empty: '还没有发现专家包。',
  emptyHint: '把专家包放到 {root} 下的 <expert-id> 目录，并同时提供 preset.yml、agent.cordis.yml 和 expert.yml，然后刷新。',
  noMatches: '没有匹配的专家。', clearFilters: '清除筛选',
  statusAvailable: '可用', statusUnavailable: '不可用', statusInvalid: '包无效',
  problemMissingFiles: '缺少必需文件', problemUnreadable: '无法读取', problemUnsafePath: '路径不安全',
  problemInvalidYaml: 'YAML 无法解析', problemInvalidManifest: 'expert.yml 字段不完整',
  problemIdMismatch: 'id 与目录名不一致', problemDuplicateId: '专家 id 重复', problemTooLarge: '文件超过大小限制',
  problemPresetMissing: 'Agent 预设未注册', problemPresetBroken: 'Agent 预设无法激活',
  problemPresetInvalid: 'Agent 预设组合无效', problemPresetRegistryUnavailable: 'Agent 预设注册表不可用',
  start: '开始对话', starting: '正在创建会话…', details: '查看详情', back: '返回专家列表',
  version: '版本', category: '分类', preset: 'Agent 预设', tags: '标签',
  defaultTask: '默认任务', quickTasks: '快捷任务', quickTaskHint: '快捷任务会新建一个对话，并把该任务预填到输入框。',
  packageDirectory: '包目录', unavailableHint: '该专家当前不可用，无法开始对话。',
  summonFailed: '无法开始对话。', detailLoadFailed: '无法读取专家详情。',
  sessionPending: '会话已创建，但界面尚未同步；它已出现在会话列表中，请在那里打开。',
  truncated: '专家包数量超过上限，列表已截断。',
  badge: '专家', badgeTitle: '当前会话使用专家：{name}', close: '关闭',
} as const

export type DesktopExpertsLocaleKey = keyof typeof zh

export const en: Record<DesktopExpertsLocaleKey, string> = {
  nav: 'Experts', title: 'Expert center',
  intro: 'Browse local expert packages and start a new conversation as one of them. An expert works through an Agent preset, never through role text prepended to each message.',
  refresh: 'Refresh', loading: 'Loading experts…', loadFailed: 'The expert list could not be read.', retry: 'Retry',
  searchExperts: 'Search experts', filterCategory: 'Filter by category', allCategories: 'All categories',
  empty: 'No expert package was found yet.',
  emptyHint: 'Place an expert package in a <expert-id> directory under {root} with preset.yml, agent.cordis.yml, and expert.yml, then refresh.',
  noMatches: 'No expert matches.', clearFilters: 'Clear filters',
  statusAvailable: 'Available', statusUnavailable: 'Unavailable', statusInvalid: 'Invalid package',
  problemMissingFiles: 'Required file missing', problemUnreadable: 'Cannot be read', problemUnsafePath: 'Unsafe path',
  problemInvalidYaml: 'YAML cannot be parsed', problemInvalidManifest: 'expert.yml is incomplete',
  problemIdMismatch: 'id does not match the directory', problemDuplicateId: 'Duplicate expert id', problemTooLarge: 'File too large',
  problemPresetMissing: 'Agent preset is not registered', problemPresetBroken: 'Agent preset cannot activate',
  problemPresetInvalid: 'Agent preset composition is invalid', problemPresetRegistryUnavailable: 'Agent preset registry unavailable',
  start: 'Start conversation', starting: 'Creating session…', details: 'Details', back: 'Back to experts',
  version: 'Version', category: 'Category', preset: 'Agent preset', tags: 'Tags',
  defaultTask: 'Default task', quickTasks: 'Quick tasks', quickTaskHint: 'A quick task opens a new conversation with that task prefilled.',
  packageDirectory: 'Package directory', unavailableHint: 'This expert is not available, so it cannot start a conversation.',
  summonFailed: 'The conversation could not be started.', detailLoadFailed: 'The expert detail could not be read.',
  sessionPending: 'The session exists but the UI has not synced yet; find it in the session list.',
  truncated: 'There are more expert packages than the list can show.',
  badge: 'Expert', badgeTitle: 'This conversation runs the expert: {name}', close: 'Close',
}
