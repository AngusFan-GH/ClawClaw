/** Desktop Settings surface dedicated to MCP servers. */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Menu, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
// @ts-expect-error package subpath has no declaration file
import ChevronDown from 'lucide-react/dist/esm/icons/chevron-down.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import MoreHorizontal from 'lucide-react/dist/esm/icons/ellipsis.mjs'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-expect-error package subpath has no declaration file
import PlugZap from 'lucide-react/dist/esm/icons/plug-zap.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopMcpCatalogEntry, DesktopMcpServerConfig, DesktopMcpServerView } from '../mcp-contract.ts'
import type { DesktopMcpApi } from './mcp-api.ts'
import { McpCredentialFields, newMcpCredential, prepareMcpCredentials, type McpCredentialDraft } from './McpCredentialFields.tsx'
import { validateMcpEditor, type McpEditorField, type McpEditorIssues } from './mcp-editor-validation.ts'
import { SkillCategoryIcon } from './SkillCategoryIcon.tsx'
import { isMcpServerReady } from '../mcp-readiness.ts'
import { SettingsTabs, SettingsEmptyState, SettingsButton, SettingsIconButton, SettingsToggle } from './settings-controls.tsx'

export interface McpSettingsSectionInjected {
  readonly api: DesktopMcpApi
  readonly embedded?: boolean
  readonly onSummary?: (summary: { total: number; enabled: number; available: number }) => void
  readonly onCatalogChange?: () => void
  readonly expertUsage?: ReadonlyMap<string, number>
}
export type McpSettingsSectionProps = PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.mcp'> & InjectFace<McpSettingsSectionInjected>
type Translate = McpSettingsSectionProps['t']

interface McpDraft {
  previousName?: string
  connectorId?: string
  capabilities?: readonly string[]
  serverName: string
  transport: DesktopMcpServerConfig['transport']
  command: string
  args: string
  cwd: string
  environmentRows: readonly McpCredentialDraft[]
  headerRows: readonly McpCredentialDraft[]
  timeoutMs: string
  reconnectEnabled: boolean
  reconnectInitialDelayMs: string
  reconnectMaxDelayMs: string
  reconnectMaxAttempts: string
  url: string
  oauthEnabled: boolean
  oauthIssuer: string
  oauthScope: string
  oauthResource: string
  oauthClientId: string
  oauthSecret: McpCredentialDraft
  oauthTokenEndpointAuthMethod: 'none' | 'client_secret_post' | 'client_secret_basic'
  enabled: boolean
}
interface CatalogInstallDraft {
  readonly entry: DesktopMcpCatalogEntry
  readonly values: Readonly<Record<string, string>>
}
const EMPTY_DRAFT: McpDraft = { serverName: '', transport: 'stdio', command: '', args: '', cwd: '', environmentRows: [], headerRows: [], timeoutMs: '60000',
  reconnectEnabled: true, reconnectInitialDelayMs: '500', reconnectMaxDelayMs: '30000', reconnectMaxAttempts: '10', url: '',
  oauthEnabled: false, oauthIssuer: '', oauthScope: 'mcp:tools', oauthResource: '', oauthClientId: '', oauthSecret: { id: 'oauth-secret', name: 'OAUTH_CLIENT_SECRET', value: '', reference: '', useReference: false },
  oauthTokenEndpointAuthMethod: 'none', enabled: true }

const connectorCategories = { productivity: 'office', development: 'development', data: 'data', design: 'design', research: 'learning', finance: 'finance' } as const
function ConnectorGlyph({ category }: { category?: string | undefined }) {
  const purpose = category !== undefined && Object.hasOwn(connectorCategories, category) ? connectorCategories[category as keyof typeof connectorCategories] : undefined
  return purpose === undefined ? <span className="dshMcpGlyph" aria-hidden="true"><PlugZap /></span> : <span className="dshMcpConnectorIcon" aria-hidden="true"><SkillCategoryIcon category={purpose} /></span>
}
function connectorCategoryLabel(category: string, t: Translate): string {
  const keys = { productivity: 'categoryProductivity', development: 'categoryDevelopment', data: 'categoryData', design: 'categoryDesign', research: 'categoryResearch', finance: 'categoryFinance' } as const
  return Object.hasOwn(keys, category) ? t(keys[category as keyof typeof keys]) : category
}

function integer(value: string, min: number, max: number, error: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(error)
  return parsed
}

function statusLabel(server: DesktopMcpServerView, t: Translate): string {
  if (server.diagnostic.code === 'credentials-missing') return t('diagnosticCredentials')
  if (server.diagnostic.code === 'authorization-required') return t('diagnosticAuthorization')
  if (server.diagnostic.code === 'connection-failed') return t('diagnosticFailed')
  if (server.diagnostic.code === 'tools-pending') return t('diagnosticToolsPending')
  if (server.diagnostic.code === 'ready') return t('diagnosticReady')
  return t(server.diagnostic.code === 'connecting' ? 'starting' : 'disabled')
}
function mcpDraft(server: DesktopMcpServerView): McpDraft {
  return { previousName: server.serverName, ...(server.connectorId === undefined ? {} : { connectorId: server.connectorId }),
    ...(server.capabilities === undefined ? {} : { capabilities: server.capabilities }), serverName: server.serverName, transport: server.transport,
    command: server.transport === 'stdio' ? server.command : '', args: server.transport === 'stdio' ? server.args.join('\n') : '',
    cwd: server.transport === 'stdio' ? server.cwd : '',
    environmentRows: server.transport === 'stdio' ? Object.entries(server.env).map(([name, reference]) => ({ ...newMcpCredential(), name, reference })) : [],
    headerRows: server.transport === 'stdio' ? [] : Object.entries(server.headers).map(([name, reference]) => ({ ...newMcpCredential(), name, reference })),
    timeoutMs: String(server.timeoutMs), reconnectEnabled: server.reconnect.enabled,
    reconnectInitialDelayMs: String(server.reconnect.initialDelayMs), reconnectMaxDelayMs: String(server.reconnect.maxDelayMs),
    reconnectMaxAttempts: String(server.reconnect.maxAttempts), url: server.transport !== 'stdio' ? server.url : '',
    oauthEnabled: server.transport !== 'stdio' && server.oauth !== undefined,
    oauthIssuer: server.transport !== 'stdio' ? server.oauth?.issuer ?? '' : '',
    oauthScope: server.transport !== 'stdio' ? server.oauth?.scope ?? 'mcp:tools' : 'mcp:tools',
    oauthResource: server.transport !== 'stdio' ? server.oauth?.resource ?? '' : '',
    oauthClientId: server.transport !== 'stdio' ? server.oauth?.clientId ?? '' : '',
    oauthSecret: { ...newMcpCredential(), name: 'OAUTH_CLIENT_SECRET', reference: server.transport !== 'stdio' ? server.oauth?.clientSecretRef ?? '' : '' },
    oauthTokenEndpointAuthMethod: server.transport !== 'stdio' ? server.oauth?.tokenEndpointAuthMethod ?? 'none' : 'none', enabled: server.enabled }
}

export function McpSettingsSection({ t, api, embedded = false, onSummary, onCatalogChange, expertUsage }: McpSettingsSectionProps) {
  const id = useId()
  const [servers, setServers] = useState<readonly DesktopMcpServerView[]>([])
  const [catalog, setCatalog] = useState<readonly DesktopMcpCatalogEntry[]>([])
  const [view, setView] = useState<'installed' | 'catalog'>('installed')
  const [catalogInstall, setCatalogInstall] = useState<CatalogInstallDraft>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [editorIssues, setEditorIssues] = useState<McpEditorIssues>({})
  const [notice, setNotice] = useState<string>()
  const editorErrorRef = useRef<HTMLDivElement>(null)
  const revisionRef = useRef(0)
  const [busy, setBusy] = useState<string>()
  const [draft, setDraft] = useState<McpDraft>()
  const [removeName, setRemoveName] = useState<string>()
  const [importText, setImportText] = useState<string>()
  const [search, setSearch] = useState('')
  const [expandedServers, setExpandedServers] = useState<ReadonlySet<string>>(() => new Set())
  const [openMenuName, setOpenMenuName] = useState<string>()
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const applyServers = useCallback((next: readonly DesktopMcpServerView[]): void => {
    setServers(next)
    onCatalogChange?.()
  }, [onCatalogChange])
  useEffect(() => { onSummary?.({
    total: servers.length,
    enabled: servers.filter(server => server.enabled).length,
    available: servers.filter(isMcpServerReady).length,
  }) }, [onSummary, servers])

  const load = useCallback(async (silent = false): Promise<void> => {
    if (busyRef.current) return
    if (!silent) { setLoading(true); setError(undefined) }
    const revision = revisionRef.current
    try {
      const next = await api.read()
      if (mountedRef.current && !busyRef.current && revision === revisionRef.current) { applyServers(next.mcpServers); setCatalog(next.catalog) }
    } catch (cause) {
      if (mountedRef.current && !silent && !busyRef.current && revision === revisionRef.current) setError(cause instanceof Error ? cause.message : t('unavailable'))
    } finally { if (mountedRef.current && !silent) setLoading(false) }
  }, [api, applyServers, t])
  useEffect(() => {
    mountedRef.current = true
    void load()
    const timer = setInterval(() => { void load(true) }, 5_000)
    return () => { mountedRef.current = false; clearInterval(timer) }
  }, [load])
  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
    if (busyRef.current) return
    busyRef.current = true; revisionRef.current++; setBusy(key); setError(undefined); setNotice(undefined)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { busyRef.current = false; setBusy(undefined) }
  }
  const saveServer = (event: FormEvent): void => {
    event.preventDefault()
    if (draft === undefined || busyRef.current) return
    const issues = validateMcpEditor(draft, servers.map(server => server.serverName), t)
    setEditorIssues(issues)
    if (Object.keys(issues).length > 0) { setError(undefined); return }
    let validationField: McpEditorField = 'credentials'
    try {
      const values = prepareMcpCredentials(draft.transport === 'stdio' ? draft.environmentRows : draft.headerRows, t, draft.transport === 'stdio' ? 'environment' : 'header')
      const references = values.references
      const secrets = { ...values.secrets }
      let oauthClientSecretRef: string | undefined
      if (draft.transport !== 'stdio' && draft.oauthEnabled && draft.oauthClientId.trim() !== '' && draft.oauthTokenEndpointAuthMethod !== 'none') {
        validationField = 'oauthConfig'
        if (draft.oauthSecret.value === '' && draft.oauthSecret.reference.trim() === '') throw new Error(t('oauthSecretRequired'))
        const oauth = prepareMcpCredentials([draft.oauthSecret], t, 'environment')
        oauthClientSecretRef = oauth.references.OAUTH_CLIENT_SECRET
        Object.assign(secrets, oauth.secrets)
      }
      validationField = 'advanced'
      const timeoutMs = integer(draft.timeoutMs, 1_000, 600_000, t('timeoutRangeError'))
      const reconnect = { enabled: draft.reconnectEnabled,
        initialDelayMs: integer(draft.reconnectInitialDelayMs, 100, 60_000, t('initialDelayRangeError')),
        maxDelayMs: integer(draft.reconnectMaxDelayMs, 100, 300_000, t('maxDelayRangeError')),
        maxAttempts: integer(draft.reconnectMaxAttempts, 1, 100, t('maxAttemptsRangeError')) }
      if (reconnect.maxDelayMs < reconnect.initialDelayMs) throw new Error(t('reconnectDelayOrderError'))
      const server: DesktopMcpServerConfig = draft.transport === 'stdio'
        ? { serverName: draft.serverName.trim(), transport: 'stdio', command: draft.command.trim(),
            args: draft.args.split(/\r?\n/u).map(value => value.trim()).filter(Boolean), cwd: draft.cwd.trim(), env: references, timeoutMs, reconnect, enabled: draft.enabled,
            ...(draft.connectorId === undefined ? {} : { connectorId: draft.connectorId }), ...(draft.capabilities === undefined ? {} : { capabilities: draft.capabilities }) }
        : { serverName: draft.serverName.trim(), transport: draft.transport, url: draft.url.trim(), headers: references, timeoutMs, reconnect, enabled: draft.enabled,
            ...(draft.oauthEnabled ? { oauth: { ...(draft.oauthIssuer.trim() === '' ? {} : { issuer: draft.oauthIssuer.trim() }), scope: draft.oauthScope.trim(),
              ...(draft.oauthResource.trim() === '' ? {} : { resource: draft.oauthResource.trim() }),
              ...(draft.oauthClientId.trim() === '' ? {} : { clientId: draft.oauthClientId.trim(), tokenEndpointAuthMethod: draft.oauthTokenEndpointAuthMethod,
                ...(oauthClientSecretRef === undefined ? {} : { clientSecretRef: oauthClientSecretRef }) }) } } : {}),
            ...(draft.connectorId === undefined ? {} : { connectorId: draft.connectorId }), ...(draft.capabilities === undefined ? {} : { capabilities: draft.capabilities }) }
      validationField = 'serverName'
      if (draft.previousName !== undefined && draft.previousName !== server.serverName && (expertUsage?.get(draft.previousName) ?? 0) > 0) {
        throw new Error(t('renameBoundServer').replace('{count}', String(expertUsage?.get(draft.previousName) ?? 0)))
      }
      void run('mcp-save', async () => {
        const next = await api.save(server, draft.previousName, Object.keys(secrets).length === 0 ? undefined : secrets)
        applyServers(next)
        const saved = next.find(item => item.serverName === server.serverName)
        if (saved?.state === 'error' && saved.diagnostic.code !== 'authorization-required') {
          setDraft(mcpDraft(saved))
          setError(t('savedConnectionFailed'))
          return
        }
        setDraft(undefined); setSearch(''); setView('installed')
        setNotice(saved?.diagnostic.code === 'authorization-required' ? t('savedNeedsAuthorization')
          : !server.enabled ? t('savedDisabled') : saved?.diagnostic.code === 'ready' ? t('savedConnected') : t('savedDiscovering'))
      })
    } catch (cause) { setEditorIssues({ [validationField]: cause instanceof Error ? cause.message : t('operationFailed') }) }
  }
  const importServers = (): void => {
    if (importText === undefined) { setImportText(''); return }
    try {
      const document = JSON.parse(importText) as unknown
      void run('mcp-import', async () => { applyServers(await api.import(document)); setImportText(undefined) })
    } catch { setError(t('invalidImport')) }
  }
  const editorFieldId = (field: McpEditorField): string => `${id}-mcp-${field}`
  const inlineError = (field: McpEditorField) => editorIssues[field] === undefined ? null
    : <small className="dshMcpFieldError" id={`${editorFieldId(field)}-error`}>{editorIssues[field]}</small>
  useEffect(() => {
    if (draft === undefined && Object.keys(editorIssues).length > 0) setEditorIssues({})
    else if (error !== undefined || Object.keys(editorIssues).length > 0) editorErrorRef.current?.focus()
  }, [draft === undefined, error, editorIssues])
  const connectorFor = (server: DesktopMcpServerView) => catalog.find(entry => entry.id === server.connectorId || entry.installedServerName === server.serverName)
  const query = search.trim().toLocaleLowerCase()
  const filteredServers = query === '' ? servers : servers.filter(server => {
    const endpoint = server.transport === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url
    const connector = connectorFor(server)
    return `${connector?.name ?? ''} ${connector?.description ?? ''} ${server.serverName} ${endpoint} ${server.tools.map(tool => `${tool.name} ${tool.description}`).join(' ')}`.toLocaleLowerCase().includes(query)
  })
  const filteredCatalog = query === '' ? catalog : catalog.filter(entry =>
    `${entry.name} ${entry.description} ${entry.category} ${connectorCategoryLabel(entry.category, t)} ${entry.capabilities.join(' ')}`.toLocaleLowerCase().includes(query))
  const installCatalog = (event: FormEvent): void => {
    event.preventDefault()
    if (catalogInstall === undefined) return
    void run(`mcp-install:${catalogInstall.entry.id}`, async () => {
      const next = await api.install(catalogInstall.entry.id, catalogInstall.values)
      applyServers(next.mcpServers); setCatalog(next.catalog)
      setCatalogInstall(undefined)
      setView('installed')
    })
  }
  const authorize = (serverName: string): void => {
    void run(`mcp-oauth:${serverName}`, async () => {
      const { authorizationUrl } = await api.authorize(serverName)
      window.open(authorizationUrl, '_blank', 'noopener,noreferrer')
    })
  }
  const overlayOpen = draft !== undefined || importText !== undefined || catalogInstall !== undefined
  const closeDraft = (): void => { if (busy === undefined) { setDraft(undefined); setError(undefined) } }
  const closeImport = (): void => { if (busy === undefined) { setImportText(undefined); setError(undefined) } }
  const closeCatalogInstall = (): void => { if (busy === undefined) { setCatalogInstall(undefined); setError(undefined) } }
  const toggleTools = (serverName: string): void => {
    setExpandedServers(current => {
      const next = new Set(current)
      if (next.has(serverName)) next.delete(serverName)
      else next.add(serverName)
      return next
    })
  }

  const selectView = (next: 'installed' | 'catalog'): void => { setView(next); setCatalogInstall(undefined); setDraft(undefined); setImportText(undefined) }
  return <><section className={`dshIntegrations dshMcpPage${embedded ? ' dshIntegrationsEmbedded' : ''}`} aria-label={t('title')} aria-busy={loading || busy !== undefined}>
    {!embedded && <header className="dshIntegrationsHeader"><div><h2>{t('title')}</h2><p>{t('intro')}</p></div></header>}
    {notice !== undefined && !overlayOpen && <div className="dshMcpSaveNotice" role="status">{notice}</div>}
    {error !== undefined && !overlayOpen && <div className="dshIntegrationsError" role="alert">{error}</div>}
    {loading && servers.length === 0 ? <SettingsEmptyState loading>{t('loading')}</SettingsEmptyState> : <div className="dshIntegrationsBody">
      <SettingsTabs id={`${id}-mcp`} label={t('mcpViews')} value={view} onChange={selectView}
        items={[{ value: 'installed', label: t('installed') }, { value: 'catalog', label: t('connectorCatalog') }]} />
      <div className="dshMcpCatalogToolbar">
        <label className="dshIntegrationsSearch"><Search aria-hidden="true" /><input aria-label={t('searchServers')} value={search} onChange={event => { setSearch(event.target.value) }} placeholder={t('searchServers')} /></label>
        <div className="dshIntegrationsRowActions"><SettingsIconButton label={t('refresh')} busy={loading} disabled={loading || busy !== undefined} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton>
          {view === 'installed' && <><SettingsButton type="button" onClick={() => { setError(undefined); setDraft(undefined); setImportText('') }}>{t('importJson')}</SettingsButton>
            <SettingsButton type="button" variant="primary" onClick={() => { setError(undefined); setImportText(undefined); setEditorIssues({}); setNotice(undefined); setDraft({ ...EMPTY_DRAFT }) }}><Plus />{t('addServer')}</SettingsButton></>}</div>
      </div>
      {view === 'installed' ? <div className="dshMcpInstalledList" role="tabpanel" id={`${id}-mcp-panel`} aria-labelledby={`${id}-mcp-installed`} tabIndex={0}>{filteredServers.map(server => {
        const toolsExpanded = expandedServers.has(server.serverName)
        const connector = connectorFor(server)
        return <div className="dshIntegrationsMcp dshMcpServerCard" key={server.serverName}>
        <div className="dshMcpServerMain"><ConnectorGlyph category={connector?.category} /><div className="dshMcpIdentity"><div className="dshMcpServerTitle"><span className="dshIntegrationsRowTitle" title={connector?.name ?? server.serverName}>{connector?.name ?? server.serverName}</span><span className="dshMcpTransport">{server.transport === 'stdio' ? 'stdio' : server.transport === 'sse' ? 'SSE' : 'HTTP'}</span></div>
          {connector !== undefined && <span className="dshMcpServerId">{server.serverName}</span>}<span className="dshMcpEndpoint" title={server.transport === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url}>{server.transport === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url}</span></div>
          <div className="dshMcpServerStatus"><span className="dshMcpStatus" data-state={server.state} data-diagnostic={server.diagnostic.code}>{statusLabel(server, t)}</span>
            <SettingsToggle label={server.enabled ? t('enabled') : t('disabled')} checked={server.enabled}
              disabled={busy !== undefined} onChange={enabled => { void run(`mcp-toggle:${server.serverName}`, async () => { applyServers(await api.toggle(server.serverName, enabled)) }) }} /></div></div>
        {connector !== undefined && <p className="dshMcpServerDescription" title={connector.description}>{connector.description}</p>}
        <div className="dshMcpServerDetails"><div className="dshIntegrationsMeta">{server.tools.length === 0 ? <span>0 {t('tools')}</span> : <button type="button" className="dshMcpToolsToggle"
          aria-expanded={toolsExpanded} aria-label={t(toolsExpanded ? 'collapseTools' : 'expandTools').replace('{count}', String(server.tools.length))}
          onClick={() => { toggleTools(server.serverName) }}><span>{server.tools.length} {t('tools')}</span><ChevronDown aria-hidden="true" /></button>}
          {server.diagnostic.checkedAt !== undefined && <span>{t('lastChecked').replace('{time}', new Date(server.diagnostic.checkedAt).toLocaleString())}</span>}
          {(expertUsage?.get(server.serverName) ?? 0) > 0 && <span>{t('usedByExperts').replace('{count}', String(expertUsage?.get(server.serverName) ?? 0))}</span>}</div>
          <div className="dshMcpServerActions">{server.transport !== 'stdio' && server.oauth !== undefined && <SettingsButton type="button"
            disabled={busy !== undefined} onClick={() => { authorize(server.serverName) }}>{server.diagnostic.code === 'authorization-required' ? t('authorize') : t('reauthorize')}</SettingsButton>}
            <Menu className="dshMcpMore" listClassName="dshMcpMoreMenu" open={openMenuName === server.serverName}
              onClose={() => { setOpenMenuName(undefined) }} align="end" compact portal selection="fill"
              items={[
                { id: 'test', label: t('testServer'), disabled: busy !== undefined },
                { id: 'edit', label: t('editServer'), disabled: busy !== undefined },
                { id: 'remove', label: removeName === server.serverName ? t('confirmRemove') : t('removeServer'), disabled: busy !== undefined, danger: true },
              ]}
              onSelect={action => {
                setOpenMenuName(undefined)
                if (action === 'test') void run(`mcp-test:${server.serverName}`, async () => { applyServers(await api.test(server.serverName)) })
                if (action === 'edit') { setError(undefined); setImportText(undefined); setDraft(mcpDraft(server)) }
                if (action === 'remove') {
                  if (removeName !== server.serverName) { setRemoveName(server.serverName); return }
                  void run(`mcp-remove:${server.serverName}`, async () => { applyServers(await api.remove(server.serverName)); setRemoveName(undefined) })
                }
              }}
              anchor={<button type="button" className="dshMcpMoreTrigger" aria-label={t('more')} title={t('more')} aria-haspopup="menu"
                aria-expanded={openMenuName === server.serverName} disabled={busy !== undefined}
                onClick={() => { setRemoveName(current => current === server.serverName ? current : undefined); setOpenMenuName(current => current === server.serverName ? undefined : server.serverName) }}><MoreHorizontal aria-hidden="true" /></button>} />
          </div></div>
        {server.error !== undefined && <p className="dshIntegrationsServerError">{server.error}</p>}
        {server.diagnostic.code === 'credentials-missing' && <p className="dshIntegrationsServerError">{t('credentialsMissing')}</p>}
        {server.tools.length === 0 ? <div className="dshIntegrationsTools"><span>{t('noTools')}</span></div>
          : toolsExpanded && <div className="dshIntegrationsTools">{server.tools.map(tool => <span key={tool.name} title={tool.description}>{tool.name}</span>)}</div>}
      </div>
      })}{filteredServers.length === 0 && <SettingsEmptyState className="dshMcpEmpty" action={servers.length > 0 && <SettingsButton onClick={() => { setSearch('') }}>{t('clearSearch')}</SettingsButton>}>{t(servers.length === 0 ? 'noServers' : 'noMatches')}</SettingsEmptyState>}</div>
      : <div className="dshMcpCatalogGrid" role="tabpanel" id={`${id}-mcp-panel`} aria-labelledby={`${id}-mcp-catalog`} tabIndex={0}>{filteredCatalog.map(entry => <div className="dshIntegrationsMcp dshMcpCatalogCard" key={entry.id}>
          <div className="dshIntegrationsMcpHeader"><ConnectorGlyph category={entry.category} /><div className="dshMcpIdentity">
            <span className="dshIntegrationsRowTitle">{entry.name}</span><span className="dshMcpCategory">{connectorCategoryLabel(entry.category, t)}</span></div>
            <div className="dshIntegrationsRowActions"><SettingsButton type="button" disabled={busy !== undefined || entry.installedServerName !== undefined}
              onClick={() => { if (entry.credentials.length === 0) { void run(`mcp-install:${entry.id}`, async () => {
                const next = await api.install(entry.id); applyServers(next.mcpServers); setCatalog(next.catalog); setView('installed')
              }) } else { setError(undefined); setDraft(undefined); setImportText(undefined); setCatalogInstall({ entry, values: {} }) } }}>{entry.installedServerName === undefined ? t('installConnector') : t('addedConnector')}</SettingsButton></div></div>
          <p className="dshMcpCatalogDescription" title={entry.description}>{entry.description}</p>
          <div className="dshIntegrationsTools">{entry.capabilities.map(capability => <span key={capability}>{capability}</span>)}</div>
          <div className="dshMcpCatalogFooter"><span className="dshMcpCatalogRequirement">{t(entry.credentials.length === 0 ? 'noCredentialsRequired' : 'credentialsRequired')}</span><span className="dshMcpLicense">{entry.license}</span><a className="dshMcpCatalogSource" href={entry.sourceUrl} target="_blank" rel="noreferrer">{t('viewSource')}</a></div>
        </div>)}{filteredCatalog.length === 0 && <SettingsEmptyState className="dshMcpEmpty" action={search !== '' && <SettingsButton onClick={() => { setSearch('') }}>{t('clearSearch')}</SettingsButton>}>{t('noCatalogMatches')}</SettingsEmptyState>}</div>}
    </div>}
  </section>
  <Modal open={importText !== undefined} title={t('importJson')} closeLabel={t('cancel')} onClose={closeImport} className="dshMcpDialog" contentClassName="dshMcpDialogContent"
    footer={<div className="dshMcpDialogFooter"><SettingsButton type="button" disabled={busy !== undefined} onClick={closeImport}>{t('cancel')}</SettingsButton>
      <SettingsButton type="submit" form={`${id}-mcp-import`} variant="primary" disabled={busy !== undefined}>{t('import')}</SettingsButton></div>}>
    <p className="dshMcpDialogDescription">{t('importDescription')}</p>
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    <form id={`${id}-mcp-import`} className="dshIntegrationsEditor dshMcpDialogForm" onSubmit={event => { event.preventDefault(); importServers() }}>
      <textarea rows={10} value={importText ?? ''} placeholder={t('importJsonHint')} onChange={event => { setImportText(event.target.value) }} />
    </form>
  </Modal>
  <Modal open={draft !== undefined} title={draft?.previousName === undefined ? t('addServer') : t('editServer')} closeLabel={t('cancel')} onClose={closeDraft} className="dshMcpDialog dshMcpEditorDialog" contentClassName="dshMcpDialogContent"
    footer={draft === undefined ? undefined : <div className="dshMcpDialogFooter"><label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.enabled}
      disabled={busy !== undefined} onChange={event => { setDraft({ ...draft, enabled: event.target.checked }) }} />{t('enableAfterSave')}</label><div className="dshIntegrationsRowActions">
        <SettingsButton type="button" disabled={busy !== undefined} onClick={closeDraft}>{t('cancel')}</SettingsButton>
        <SettingsButton type="submit" form={`${id}-mcp-editor`} variant="primary" disabled={busy !== undefined}>{busy === 'mcp-save' ? t('savingConnector') : t(draft.enabled ? 'saveAndConnect' : 'save')}</SettingsButton></div></div>}>
    {draft !== undefined && <>
      {(error !== undefined || Object.keys(editorIssues).length > 0) && <div className="dshIntegrationsError dshMcpErrorSummary" role="alert" ref={editorErrorRef} tabIndex={-1}>
        <strong>{t('reviewFields')}</strong>{error !== undefined && <p>{error}</p>}
        {Object.entries(editorIssues).map(([field, message]) => <a key={field} href={`#${editorFieldId(field as McpEditorField)}`} onClick={event => {
          event.preventDefault()
          const target = document.getElementById(editorFieldId(field as McpEditorField))
          const disclosure = target?.closest('details'); if (disclosure) disclosure.open = true
          target?.focus()
        }}>{message}</a>)}
      </div>}
      <form id={`${id}-mcp-editor`} className="dshIntegrationsEditor dshMcpEditor dshMcpDialogForm" noValidate aria-busy={busy === 'mcp-save'} onSubmit={saveServer}>
        <fieldset className="dshMcpEditorFields" disabled={busy !== undefined}>
        <section className="dshMcpFormSection" aria-label={t('identityAndTransport')}>
          <fieldset className="dshMcpTransportField"><legend>{t('transport')}</legend><div className="dshMcpTransportChoices">{(['stdio', 'streamable-http', 'sse'] as const).map(transport =>
            <button key={transport} type="button" aria-label={transport === 'stdio' ? 'stdio' : transport === 'sse' ? 'SSE' : 'HTTP'} aria-pressed={draft.transport === transport}
              onClick={() => { setEditorIssues({}); setError(undefined); setDraft({ ...draft, transport }) }}>
              <strong>{transport === 'stdio' ? 'stdio' : transport === 'sse' ? 'SSE' : 'HTTP'}</strong><span>{t(transport === 'stdio' ? 'stdioDescription' : transport === 'sse' ? 'sseDescription' : 'httpDescription')}</span>
            </button>)}</div></fieldset>
          <label><span>{t('serverName')}</span><input id={editorFieldId('serverName')} aria-label={t('serverName')} required data-modal-autofocus value={draft.serverName}
            aria-invalid={editorIssues.serverName !== undefined} aria-describedby={`${id}-name-hint${editorIssues.serverName === undefined ? '' : ` ${editorFieldId('serverName')}-error`}`}
            placeholder={t('connectorNameExample')} onChange={event => { setDraft({ ...draft, serverName: event.target.value }) }} />
            <small id={`${id}-name-hint`}>{t('serverNameHint')}</small>{inlineError('serverName')}</label>

        </section>
        <section className="dshMcpFormSection" aria-labelledby={`${id}-mcp-connection-heading`}><h4 id={`${id}-mcp-connection-heading`}>{t('connection')}</h4>
          <div className="dshMcpFormGrid">{draft.transport === 'stdio' ? <><label><span>{t('command')}</span><input id={editorFieldId('command')} aria-label={t('command')} aria-invalid={editorIssues.command !== undefined} aria-describedby={editorIssues.command === undefined ? undefined : `${editorFieldId('command')}-error`} required value={draft.command} placeholder={t('commandHint')}
            onChange={event => { setDraft({ ...draft, command: event.target.value }) }} />{inlineError('command')}</label>
            <label><span>{t('workingDirectory')}</span><input value={draft.cwd} placeholder={t('workingDirectoryHint')}
              onChange={event => { setDraft({ ...draft, cwd: event.target.value }) }} /></label>
            <label className="dshMcpFieldFull"><span>{t('arguments')}</span><textarea rows={3} placeholder={t('argumentsHint')} value={draft.args} onChange={event => { setDraft({ ...draft, args: event.target.value }) }} /><small>{t('commandOnlyHint')}</small></label></>
            : <label className="dshMcpFieldFull"><span>{t('url')}</span><input id={editorFieldId('url')} aria-label={t('url')} aria-invalid={editorIssues.url !== undefined} aria-describedby={editorIssues.url === undefined ? undefined : `${editorFieldId('url')}-error`} required type="url" value={draft.url} placeholder={t(draft.transport === 'sse' ? 'sseUrlHint' : 'urlHint')}
                onChange={event => { setDraft({ ...draft, url: event.target.value }) }} /><small>{t('remoteUrlHint')}</small>{inlineError('url')}</label>}</div>
        </section>
        {draft.transport !== 'stdio' && <section className="dshMcpFormSection" aria-labelledby={`${id}-mcp-auth-heading`}><h4 id={`${id}-mcp-auth-heading`}>{t('authentication')}</h4>
          <div className="dshIntegrationsSegments dshMcpAuthChoices" role="group" aria-label={t('authentication')}>
            <button type="button" aria-pressed={!draft.oauthEnabled} onClick={() => { setDraft({ ...draft, oauthEnabled: false }) }}>{t('headerAuthentication')}</button>
            <button type="button" aria-pressed={draft.oauthEnabled} onClick={() => { setDraft({ ...draft, oauthEnabled: true }) }}>{t('oauthPkce')}</button>
          </div><p className="dshMcpFieldHint">{t(draft.oauthEnabled ? 'oauthFlowHint' : 'headerAuthHint')}</p>
          {draft.oauthEnabled && <>
            <label><span>{t('oauthScope')}</span><input id={editorFieldId('oauthScope')} aria-invalid={editorIssues.oauthScope !== undefined}
              aria-describedby={editorIssues.oauthScope === undefined ? undefined : `${editorFieldId('oauthScope')}-error`}
              required placeholder="mcp:tools" value={draft.oauthScope} onChange={event => { setDraft({ ...draft, oauthScope: event.target.value }) }} />{inlineError('oauthScope')}</label>
            <details className="dshMcpOauthAdvanced">
              <summary>{t('oauthAdvanced')}</summary><div id={editorFieldId('oauthConfig')} tabIndex={-1} className="dshMcpFormGrid">{inlineError('oauthConfig')}
              <label className="dshMcpFieldFull"><span>{t('oauthIssuer')}</span><input type="url" value={draft.oauthIssuer}
                placeholder="https://identity.example.com" onChange={event => { setDraft({ ...draft, oauthIssuer: event.target.value }) }} /></label>
              <label><span>{t('oauthResource')}</span><input type="url" placeholder="https://mcp.example.com/" value={draft.oauthResource}
                onChange={event => { setDraft({ ...draft, oauthResource: event.target.value }) }} /></label>
              <label><span>{t('oauthClientId')}</span><input value={draft.oauthClientId} placeholder={t('oauthClientIdHint')}
                onChange={event => { setDraft({ ...draft, oauthClientId: event.target.value }) }} /></label>
              {draft.oauthClientId.trim() !== '' && <><label><span>{t('oauthClientAuthMethod')}</span><select value={draft.oauthTokenEndpointAuthMethod}
                onChange={event => { setDraft({ ...draft, oauthTokenEndpointAuthMethod: event.target.value as McpDraft['oauthTokenEndpointAuthMethod'] }) }}>
                <option value="none">none</option><option value="client_secret_post">client_secret_post</option><option value="client_secret_basic">client_secret_basic</option>
              </select></label>{draft.oauthTokenEndpointAuthMethod !== 'none' && <div className="dshMcpFieldFull">
                <McpCredentialFields kind="oauth" rows={[draft.oauthSecret]} t={t} onChange={rows => { setDraft({ ...draft, oauthSecret: rows[0]! }) }} />
              </div>}</>}
              </div>
            </details>
          </>}

          <div id={editorFieldId('credentials')} tabIndex={-1}>{inlineError('credentials')}
            <McpCredentialFields kind="header" rows={draft.headerRows} t={t} showNotice={false}
              onChange={headerRows => { setDraft({ ...draft, headerRows }) }} />
          </div>
        </section>}
        {draft.transport === 'stdio' && <details open className="dshMcpFormDisclosure"><summary>{t('credentials')}</summary>
          <div id={editorFieldId('credentials')} tabIndex={-1}>{inlineError('credentials')}
          <McpCredentialFields kind="environment" rows={draft.environmentRows} t={t}
            onChange={environmentRows => { setDraft({ ...draft, environmentRows }) }} />
          </div>
        </details>}

        <details className="dshMcpFormDisclosure"><summary>{t('advancedSettings')}</summary><div id={editorFieldId('advanced')} tabIndex={-1} className="dshMcpFormGrid dshMcpAdvancedFields">
          <label><span>{t('timeout')}</span><input required inputMode="numeric" value={draft.timeoutMs}
            onChange={event => { setDraft({ ...draft, timeoutMs: event.target.value }) }} /></label>
          <fieldset><legend>{t('reconnect')}</legend><label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.reconnectEnabled}
            onChange={event => { setDraft({ ...draft, reconnectEnabled: event.target.checked }) }} />{t('reconnectEnabled')}</label></fieldset>
          <label><span>{t('initialDelay')}</span><input required type="number" min="100" max="60000" step="1" value={draft.reconnectInitialDelayMs}
            onChange={event => { setDraft({ ...draft, reconnectInitialDelayMs: event.target.value }) }} /></label>
          <label><span>{t('maxDelay')}</span><input required type="number" min="100" max="300000" step="1" value={draft.reconnectMaxDelayMs}
            onChange={event => { setDraft({ ...draft, reconnectMaxDelayMs: event.target.value }) }} /></label>
          <label><span>{t('maxAttempts')}</span><input required type="number" min="1" max="100" step="1" value={draft.reconnectMaxAttempts}
            onChange={event => { setDraft({ ...draft, reconnectMaxAttempts: event.target.value }) }} /></label>
        </div></details>
        </fieldset>
      </form></>}
  </Modal>
  <Modal open={catalogInstall !== undefined} title={catalogInstall?.entry.name ?? t('installConnector')} closeLabel={t('cancel')} onClose={closeCatalogInstall} className="dshMcpDialog" contentClassName="dshMcpDialogContent"
    footer={catalogInstall === undefined ? undefined : <div className="dshMcpDialogFooter"><span>{catalogInstall.entry.license}</span><div className="dshIntegrationsRowActions">
      <SettingsButton type="button" disabled={busy !== undefined} onClick={closeCatalogInstall}>{t('cancel')}</SettingsButton>
      <SettingsButton type="submit" form={`${id}-mcp-catalog-install`} variant="primary" disabled={busy !== undefined}>{t('installConnector')}</SettingsButton></div></div>}>
    {catalogInstall !== undefined && <><p className="dshMcpDialogDescription">{catalogInstall.entry.description}</p>
      {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
      <form id={`${id}-mcp-catalog-install`} className="dshIntegrationsEditor dshMcpDialogForm" onSubmit={installCatalog}>
        {catalogInstall.entry.credentials.map(field => <label key={field.id}><span>{field.label}</span><input required={field.required} type={field.secret ? 'password' : 'text'}
          placeholder={t(field.secret ? 'catalogSecretExample' : 'catalogValueExample')} autoComplete="off" value={catalogInstall.values[field.id] ?? ''} onChange={event => { setCatalogInstall({ ...catalogInstall,
            values: { ...catalogInstall.values, [field.id]: event.target.value } }) }} /></label>)}
      </form></>}
  </Modal></>
}
