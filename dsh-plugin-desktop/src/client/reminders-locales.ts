export const zh = {
  nav: '叮嘱', title: '叮嘱', intro: '为 ClawClaw 添加跨工作区、跨会话持续生效的长期指令。',
  notice: '叮嘱会在下一次模型请求生效；它们不能替代文件、网络或工具的安全限制。', add: '添加叮嘱', clear: '清空', placeholder: '例如：对外发送、删除或发布前先征求我的确认。',
  active: '已启用 {count} 条', presets: '常用叮嘱', privacy: '不要公开、上传或分享我的私密信息。', files: '修改或删除文件前先说明影响并征求确认。', mail: '发送邮件或消息前先展示草稿并征求确认。', approval: '任何不可逆操作前都必须征求确认。', external: '不要向外部服务发送内容，除非我明确要求。',
  current: '当前叮嘱', empty: '尚未添加叮嘱。', enabled: '启用', paused: '已暂停', edit: '编辑', save: '保存', cancel: '取消', remove: '删除', refresh: '刷新', loadFailed: '无法读取叮嘱。', operationFailed: '操作失败，请重试。',
} as const
export type DesktopRemindersLocaleKey = keyof typeof zh
export const en: Record<DesktopRemindersLocaleKey, string> = {
  nav: 'Reminders', title: 'Reminders', intro: 'Add standing instructions that apply across ClawClaw workspaces and conversations.',
  notice: 'Changes apply to the next model request. Reminders do not replace file, network, or tool security controls.', add: 'Add reminder', clear: 'Clear', placeholder: 'For example: Ask for confirmation before sending, deleting, or publishing anything.',
  active: '{count} active', presets: 'Common reminders', privacy: 'Do not disclose, upload, or share my private information.', files: 'Explain the impact and ask before modifying or deleting files.', mail: 'Show a draft and ask before sending email or messages.', approval: 'Ask for confirmation before any irreversible operation.', external: 'Do not send content to external services unless I explicitly request it.',
  current: 'Current reminders', empty: 'No reminders yet.', enabled: 'Enabled', paused: 'Paused', edit: 'Edit', save: 'Save', cancel: 'Cancel', remove: 'Delete', refresh: 'Refresh', loadFailed: 'Unable to load reminders.', operationFailed: 'The operation failed. Please try again.',
}
