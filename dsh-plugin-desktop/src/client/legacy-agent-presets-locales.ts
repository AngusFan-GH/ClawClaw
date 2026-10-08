export const zh = {
  remove: '删除', confirm: '永久删除“{name}”？', deleted: '已删除。正在重启以应用更改…', loadFailed: '无法加载自定义预设。', operationFailed: '删除失败，请重试。', restartFailed: '预设已删除。请重启 ClawClaw 以应用更改。',
} as const
export const en = {
  remove: 'Delete', confirm: 'Permanently delete “{name}”?', deleted: 'Deleted. Restarting to apply the change…', loadFailed: 'Could not load custom presets.', operationFailed: 'Could not delete the preset. Try again.', restartFailed: 'Preset deleted. Restart ClawClaw to apply the change.',
} as const
export type DesktopLegacyAgentPresetsLocaleKey = keyof typeof zh
