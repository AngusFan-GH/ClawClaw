import type { DesktopMcpLocaleKey } from './mcp-locales.ts'
import type { McpCredentialDraft } from './McpCredentialFields.tsx'

type Translate = (key: DesktopMcpLocaleKey) => string
export type McpEditorField = 'serverName' | 'command' | 'url' | 'oauthScope' | 'oauthConfig' | 'credentials' | 'advanced'
export type McpEditorIssues = Partial<Record<McpEditorField, string>>

/** Validate user-facing fields before creating any credential-write payload. */
export function validateMcpEditor(draft: {
  serverName: string; previousName?: string; transport: string; command: string; url: string
  oauthEnabled: boolean; oauthScope: string; oauthIssuer: string; oauthResource: string; headerRows: readonly McpCredentialDraft[]
}, existingNames: readonly string[], t: Translate): McpEditorIssues {
  const issues: McpEditorIssues = {}
  const name = draft.serverName.trim()
  if (!/^[A-Za-z0-9_-]{1,32}$/u.test(name)) issues.serverName = t('serverNameHint')
  else if (existingNames.some(existing => existing === name && existing !== draft.previousName)) issues.serverName = t('duplicateServerName')
  if (draft.transport === 'stdio') {
    if (draft.command.trim() === '') issues.command = t('commandRequired')
  } else {
    try {
      const url = new URL(draft.url.trim())
      const loopback = url.hostname === 'localhost' || url.hostname === '[::1]' || /^127(?:\.\d{1,3}){3}$/u.test(url.hostname)
      if (!['http:', 'https:'].includes(url.protocol) || url.username !== '' || url.password !== '' || (url.protocol === 'http:' && !loopback)) {
        issues.url = t('remoteUrlError')
      }
    } catch { issues.url = t('remoteUrlError') }
    if (draft.oauthEnabled) {
      for (const value of [draft.oauthIssuer, draft.oauthResource]) {
        if (value.trim() === '') continue
        try {
          const url = new URL(value.trim())
          if (url.protocol !== 'https:' || url.username !== '' || url.password !== '' || url.hash !== '') issues.oauthConfig = t('oauthUrlError')
        } catch { issues.oauthConfig = t('oauthUrlError') }
      }
      if (draft.oauthScope.trim() === '') issues.oauthScope = t('oauthScopeRequired')
      if (draft.headerRows.some(row => row.name.trim().toLowerCase() === 'authorization')) issues.credentials = t('oauthHeaderConflict')
    }
  }
  return issues
}
