export const zh = {
  panel: '专家', nav: '专家', title: '专家中心', intro: '浏览本地专家，以专家身份发起新对话。专家基于 Agent Preset 生效，会带上对应的工具与提示词。',
  search: '搜索专家', searchPlaceholder: '按名称、职称、标签或分类搜索', category: '分类', allCategories: '全部分类',
  startConversation: '开始对话', quickTask: '快捷任务', defaultTask: '默认任务',
  loading: '正在加载专家…', refresh: '刷新', error: '加载专家失败', empty: '还没有本地专家',
  emptyHint: '把专家包放入 DSH_HOME/.agent-presets/<expert-id>/ 后刷新。',
  noSearchResults: '没有找到匹配的专家。',
  unavailable: '不可用', summonFailed: '无法开始对话',
  invalidPackages: '无效专家包', invalidHint: '以下专家包缺少文件或包含无效内容，已被跳过：',
  version: '版本', preset: 'Agent Preset',
  backToList: '返回列表', expertDetail: '专家详情',
  summonSuccess: '已创建会话',
} as const

export type ExpertsLocaleKey = keyof typeof zh

export const en: Record<ExpertsLocaleKey, string> = {
  panel: 'Experts', nav: 'Experts', title: 'Expert Center', intro: 'Browse local experts and start a conversation as one. Experts take effect through Agent Presets, carrying their tools and instructions.',
  search: 'Search experts', searchPlaceholder: 'Search by name, title, tags, or category', category: 'Category', allCategories: 'All categories',
  startConversation: 'Start conversation', quickTask: 'Quick task', defaultTask: 'Default task',
  loading: 'Loading experts…', refresh: 'Refresh', error: 'Failed to load experts', empty: 'No local experts yet',
  emptyHint: 'Place expert packages in DSH_HOME/.agent-presets/<expert-id>/ and refresh.',
  noSearchResults: 'No experts match your search.',
  unavailable: 'Unavailable', summonFailed: 'Could not start conversation',
  invalidPackages: 'Invalid expert packages', invalidHint: 'The following packages are missing files or contain invalid content and were skipped:',
  version: 'Version', preset: 'Agent Preset',
  backToList: 'Back to list', expertDetail: 'Expert detail',
  summonSuccess: 'Session created',
}
