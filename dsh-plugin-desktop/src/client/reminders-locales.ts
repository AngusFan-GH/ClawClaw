export const zh = {
  nav: '叮嘱', title: '叮嘱', intro: '为 ClawClaw 设置跨工作区、跨会话的长期偏好与要求。',
  notice: '已启用的叮嘱会作为指令提供给模型，具体执行仍受模型能力、上下文和权限限制。叮嘱不能替代文件、网络或工具的安全限制。', usage: '使用说明', add: '添加叮嘱', clear: '清空', placeholder: '例如：对外发送、删除或发布前先征求我的确认。',
  active: '已启用 {count} / 共 {total} 条', presets: '从常用叮嘱开始', presetsHint: '选择一项加入草稿，确认后添加。', added: '已添加', privacyLabel: '隐私保护', filesLabel: '文件修改前确认', mailLabel: '发送前确认', approvalLabel: '不可逆操作前确认', externalLabel: '外部服务限制', privacy: '不要公开、上传或分享我的私密信息。', files: '修改或删除文件前先说明影响并征求确认。', mail: '发送邮件或消息前先展示草稿并征求确认。', approval: '任何不可逆操作前都必须征求确认。', external: '不要向外部服务发送内容，除非我明确要求。',
  current: '我的叮嘱', empty: '还没有叮嘱，添加一条你希望 ClawClaw 遵循的要求。', enabled: '已启用', paused: '已暂停', edit: '编辑', save: '保存', cancel: '取消', remove: '删除', refresh: '刷新', loadFailed: '无法读取叮嘱。', operationFailed: '操作失败，请重试。',
} as const
export type DesktopRemindersLocaleKey = keyof typeof zh
export const en: Record<DesktopRemindersLocaleKey, string> = {
  nav: 'Reminders', title: 'Reminders', intro: 'Set long-term preferences and requirements across ClawClaw workspaces and conversations.',
  notice: 'Enabled reminders are provided to the model as instructions. How they are followed depends on model capabilities, context, and permissions. Reminders do not replace file, network, or tool security controls.', usage: 'About reminders', add: 'Add reminder', clear: 'Clear', placeholder: 'For example: Ask for confirmation before sending, deleting, or publishing anything.',
  active: '{count} active / {total} total', presets: 'Start with a common reminder', presetsHint: 'Choose one to add to your draft, then review and add it.', added: 'Added', privacyLabel: 'Privacy', filesLabel: 'Confirm file changes', mailLabel: 'Confirm before sending', approvalLabel: 'Confirm irreversible actions', externalLabel: 'External services', privacy: 'Do not disclose, upload, or share my private information.', files: 'Explain the impact and ask before modifying or deleting files.', mail: 'Show a draft and ask before sending email or messages.', approval: 'Ask for confirmation before any irreversible operation.', external: 'Do not send content to external services unless I explicitly request it.',
  current: 'My reminders', empty: 'No reminders yet. Add something you want ClawClaw to follow.', enabled: 'Enabled', paused: 'Paused', edit: 'Edit', save: 'Save', cancel: 'Cancel', remove: 'Delete', refresh: 'Refresh', loadFailed: 'Unable to load reminders.', operationFailed: 'The operation failed. Please try again.',
}
