export const zh = {
  nav: 'MCP Servers', title: 'MCP Servers', intro: '管理当前 Profile 的 MCP Server 及其工具连接。',
  refresh: '刷新', loading: '正在加载…', unavailable: '暂时无法读取 MCP 配置。',
  operationFailed: '操作失败，请检查配置后重试。', addServer: '添加 Server', editServer: '编辑',
  removeServer: '删除', testServer: '测试连接', serverName: 'Server 名称', transport: '传输方式',
  command: '命令', arguments: '参数（每行一个）', url: 'MCP URL', save: '保存', cancel: '取消',
  enabled: '已启用', disabled: '已停用', starting: '正在连接', running: '运行中', error: '连接失败',
  tools: '工具', noTools: '尚未发现工具', noServers: '尚未配置 MCP Server。',
  secretNotice: '连接配置只保存凭证引用。输入的凭证值会写入 DSH 凭证库，之后不会显示或导出。',
  confirmRemove: '确认删除', serverNameHint: '1-32 个字母、数字、下划线或连字符', commandHint: '例如 npx',
  urlHint: '例如 http://127.0.0.1:3000/mcp', workingDirectory: '工作目录（可选）', workingDirectoryHint: '留空表示默认目录',
  environmentReferences: '环境变量凭证引用', headerReferences: 'HTTP Header 凭证引用', referencesHint: 'NAME=MY_CREDENTIAL_REF，每行一个',
  credentialValues: '要保存的凭证值（可选）', credentialValuesHint: 'MY_CREDENTIAL_REF=实际值，每行一个', timeout: '工具调用超时（毫秒）', credentialsMissing: '缺少一个或多个凭证引用。',
  importJson: '导入 JSON', import: '导入', invalidImport: '请输入有效的 mcpServers JSON。', importJsonHint: '{"mcpServers":{"server":{"command":"npx","args":["-y","package"],"env":{"API_KEY":"..."}}}}',
} as const

export type DesktopMcpLocaleKey = keyof typeof zh

export const en: Record<DesktopMcpLocaleKey, string> = {
  nav: 'MCP Servers', title: 'MCP Servers', intro: 'Manage MCP servers and tool connections for the current Profile.',
  refresh: 'Refresh', loading: 'Loading…', unavailable: 'MCP configuration is temporarily unavailable.',
  operationFailed: 'The operation failed. Check the configuration and try again.', addServer: 'Add server', editServer: 'Edit',
  removeServer: 'Remove', testServer: 'Test connection', serverName: 'Server name', transport: 'Transport',
  command: 'Command', arguments: 'Arguments (one per line)', url: 'MCP URL', save: 'Save', cancel: 'Cancel',
  enabled: 'Enabled', disabled: 'Disabled', starting: 'Connecting', running: 'Running', error: 'Connection failed',
  tools: 'Tools', noTools: 'No tools discovered yet', noServers: 'No MCP servers configured.',
  secretNotice: 'Connection settings store credential references only. Entered values are written to the DSH credential store and are never displayed or exported.',
  confirmRemove: 'Confirm removal', serverNameHint: '1-32 letters, numbers, underscores, or hyphens', commandHint: 'For example, npx',
  urlHint: 'For example, http://127.0.0.1:3000/mcp', workingDirectory: 'Working directory (optional)', workingDirectoryHint: 'Leave blank for the default directory',
  environmentReferences: 'Environment credential references', headerReferences: 'HTTP header credential references', referencesHint: 'NAME=MY_CREDENTIAL_REF, one per line',
  credentialValues: 'Credential values to save (optional)', credentialValuesHint: 'MY_CREDENTIAL_REF=actual value, one per line', timeout: 'Tool-call timeout (milliseconds)', credentialsMissing: 'One or more credential references are not configured.',
  importJson: 'Import JSON', import: 'Import', invalidImport: 'Enter a valid mcpServers JSON document.', importJsonHint: '{"mcpServers":{"server":{"command":"npx","args":["-y","package"],"env":{"API_KEY":"..."}}}}',
}
