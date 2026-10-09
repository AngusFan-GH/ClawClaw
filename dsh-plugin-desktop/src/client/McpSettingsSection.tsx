/** Desktop Settings surface dedicated to MCP servers. */

import { useCallback, useEffect, useId, useRef, useState, type FormEvent } from 'react'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
// @ts-expect-error package subpath has no declaration file
import Pencil from 'lucide-react/dist/esm/icons/pencil.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-expect-error package subpath has no declaration file
import PlugZap from 'lucide-react/dist/esm/icons/plug-zap.mjs'
// @ts-expect-error package subpath has no declaration file
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopMcpCatalogEntry, DesktopMcpServerConfig, DesktopMcpServerView } from '../mcp-contract.ts'
import type { DesktopMcpApi } from './mcp-api.ts'
import { SettingsIconButton, SettingsToggle } from './settings-controls.tsx'

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
  references: string
  secrets: string
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
  enabled: boolean
}
interface CatalogInstallDraft {
  readonly entry: DesktopMcpCatalogEntry
  readonly values: Readonly<Record<string, string>>
}
const EMPTY_DRAFT: McpDraft = { serverName: '', transport: 'stdio', command: '', args: '', cwd: '', references: '', secrets: '', timeoutMs: '60000',
  reconnectEnabled: true, reconnectInitialDelayMs: '500', reconnectMaxDelayMs: '30000', reconnectMaxAttempts: '10', url: '',
  oauthEnabled: false, oauthIssuer: '', oauthScope: 'mcp:tools', oauthResource: '', enabled: true }

function linesToMap(value: string, t: Translate): Record<string, string> {
  const entries = value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.indexOf('=')
    if (separator < 1 || separator === line.length - 1) throw new Error(t('lineFormatError'))
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const
  })
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error(t('duplicateCredentialError'))
  return Object.fromEntries(entries)
}
function integer(value: string, min: number, max: number, error: string): number {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) throw new Error(error)
  return parsed
}
function mapToLines(value: Readonly<Record<string, string>>): string { return Object.entries(value).map(([key, item]) => `${key}=${item}`).join('\n') }

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
    cwd: server.transport === 'stdio' ? server.cwd : '', references: mapToLines(server.transport === 'stdio' ? server.env : server.headers), secrets: '',
    timeoutMs: String(server.timeoutMs), reconnectEnabled: server.reconnect.enabled,
    reconnectInitialDelayMs: String(server.reconnect.initialDelayMs), reconnectMaxDelayMs: String(server.reconnect.maxDelayMs),
    reconnectMaxAttempts: String(server.reconnect.maxAttempts), url: server.transport === 'streamable-http' ? server.url : '',
    oauthEnabled: server.transport === 'streamable-http' && server.oauth !== undefined,
    oauthIssuer: server.transport === 'streamable-http' ? server.oauth?.issuer ?? '' : '',
    oauthScope: server.transport === 'streamable-http' ? server.oauth?.scope ?? 'mcp:tools' : 'mcp:tools',
    oauthResource: server.transport === 'streamable-http' ? server.oauth?.resource ?? '' : '', enabled: server.enabled }
}

export function McpSettingsSection({ t, api, embedded = false, onSummary, onCatalogChange, expertUsage }: McpSettingsSectionProps) {
  const id = useId()
  const [servers, setServers] = useState<readonly DesktopMcpServerView[]>([])
  const [catalog, setCatalog] = useState<readonly DesktopMcpCatalogEntry[]>([])
  const [view, setView] = useState<'installed' | 'catalog'>('installed')
  const [catalogInstall, setCatalogInstall] = useState<CatalogInstallDraft>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [draft, setDraft] = useState<McpDraft>()
  const [removeName, setRemoveName] = useState<string>()
  const [importText, setImportText] = useState<string>()
  const [search, setSearch] = useState('')
  const busyRef = useRef(false)
  const mountedRef = useRef(true)
  const applyServers = useCallback((next: readonly DesktopMcpServerView[]): void => {
    setServers(next)
    onCatalogChange?.()
  }, [onCatalogChange])
  useEffect(() => { onSummary?.({
    total: servers.length,
    enabled: servers.filter(server => server.enabled).length,
    available: servers.filter(server => server.enabled && server.state === 'running' && server.tools.length > 0).length,
  }) }, [onSummary, servers])

  const load = useCallback(async (silent = false): Promise<void> => {
    if (busyRef.current) return
    if (!silent) { setLoading(true); setError(undefined) }
    try {
      const next = await api.read()
      if (mountedRef.current) { applyServers(next.mcpServers); setCatalog(next.catalog) }
    } catch (cause) {
      if (mountedRef.current && !silent) setError(cause instanceof Error ? cause.message : t('unavailable'))
    } finally { if (mountedRef.current && !silent) setLoading(false) }
  }, [api, applyServers, t])
  useEffect(() => {
    mountedRef.current = true
    void load()
    const timer = setInterval(() => { void load(true) }, 5_000)
    return () => { mountedRef.current = false; clearInterval(timer) }
  }, [load])
  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
    busyRef.current = true; setBusy(key); setError(undefined)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { busyRef.current = false; setBusy(undefined) }
  }
  const saveServer = (event: FormEvent): void => {
    event.preventDefault()
    if (draft === undefined) return
    try {
      const references = linesToMap(draft.references, t)
      const secrets = linesToMap(draft.secrets, t)
      const referenced = new Set(Object.values(references))
      if (Object.keys(secrets).some(ref => !referenced.has(ref))) throw new Error(t('unreferencedCredentialError'))
      const timeoutMs = integer(draft.timeoutMs, 1_000, 600_000, t('timeoutRangeError'))
      const reconnect = { enabled: draft.reconnectEnabled,
        initialDelayMs: integer(draft.reconnectInitialDelayMs, 100, 60_000, t('initialDelayRangeError')),
        maxDelayMs: integer(draft.reconnectMaxDelayMs, 100, 300_000, t('maxDelayRangeError')),
        maxAttempts: integer(draft.reconnectMaxAttempts, 0, 100, t('maxAttemptsRangeError')) }
      if (reconnect.maxDelayMs < reconnect.initialDelayMs) throw new Error(t('reconnectDelayOrderError'))
      const server: DesktopMcpServerConfig = draft.transport === 'stdio'
        ? { serverName: draft.serverName.trim(), transport: 'stdio', command: draft.command.trim(),
            args: draft.args.split(/\r?\n/u).map(value => value.trim()).filter(Boolean), cwd: draft.cwd.trim(), env: references, timeoutMs, reconnect, enabled: draft.enabled,
            ...(draft.connectorId === undefined ? {} : { connectorId: draft.connectorId }), ...(draft.capabilities === undefined ? {} : { capabilities: draft.capabilities }) }
        : { serverName: draft.serverName.trim(), transport: 'streamable-http', url: draft.url.trim(), headers: references, timeoutMs, reconnect, enabled: draft.enabled,
            ...(draft.oauthEnabled ? { oauth: { ...(draft.oauthIssuer.trim() === '' ? {} : { issuer: draft.oauthIssuer.trim() }), scope: draft.oauthScope.trim(),
              ...(draft.oauthResource.trim() === '' ? {} : { resource: draft.oauthResource.trim() }) } } : {}),
            ...(draft.connectorId === undefined ? {} : { connectorId: draft.connectorId }), ...(draft.capabilities === undefined ? {} : { capabilities: draft.capabilities }) }
      if (draft.previousName !== undefined && draft.previousName !== server.serverName && (expertUsage?.get(draft.previousName) ?? 0) > 0) {
        throw new Error(t('renameBoundServer').replace('{count}', String(expertUsage?.get(draft.previousName) ?? 0)))
      }
      void run('mcp-save', async () => { applyServers(await api.save(server, draft.previousName, Object.keys(secrets).length === 0 ? undefined : secrets)); setDraft(undefined) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
  }
  const importServers = (): void => {
    if (importText === undefined) { setImportText(''); return }
    try {
      const document = JSON.parse(importText) as unknown
      void run('mcp-import', async () => { applyServers(await api.import(document)); setImportText(undefined) })
    } catch { setError(t('invalidImport')) }
  }
  const query = search.trim().toLocaleLowerCase()
  const filteredServers = query === '' ? servers : servers.filter(server => {
    const endpoint = server.transport === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url
    return `${server.serverName} ${endpoint} ${server.tools.map(tool => `${tool.name} ${tool.description}`).join(' ')}`.toLocaleLowerCase().includes(query)
  })
  const filteredCatalog = query === '' ? catalog : catalog.filter(entry =>
    `${entry.name} ${entry.description} ${entry.category} ${entry.capabilities.join(' ')}`.toLocaleLowerCase().includes(query))
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

  return <><section className={`dshIntegrations dshMcpPage${embedded ? ' dshIntegrationsEmbedded' : ''}`} aria-label={t('title')}>
    {!embedded && <header className="dshIntegrationsHeader"><div><h2>{t('title')}</h2><p>{t('intro')}</p></div></header>}
    {error !== undefined && !overlayOpen && <div className="dshIntegrationsError" role="alert">{error}</div>}
    {loading && servers.length === 0 ? <p className="dshIntegrationsEmpty">{t('loading')}</p> : <div className="dshIntegrationsBody">
      <div className="dshIntegrationsSegments dshMcpTabs" role="tablist" aria-label={t('mcpViews')}>
        <button type="button" role="tab" aria-selected={view === 'installed'} onClick={() => { setView('installed'); setCatalogInstall(undefined) }}>{t('installed')}</button>
        <button type="button" role="tab" aria-selected={view === 'catalog'} onClick={() => { setView('catalog'); setDraft(undefined); setImportText(undefined) }}>{t('connectorCatalog')}</button>
      </div>
      <div className="dshMcpCatalogToolbar">
        <label className="dshIntegrationsSearch"><Search aria-hidden="true" /><input aria-label={t('searchServers')} value={search} onChange={event => { setSearch(event.target.value) }} placeholder={t('searchServers')} /></label>
        <div className="dshIntegrationsRowActions"><SettingsIconButton label={t('refresh')} disabled={loading || busy !== undefined} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton>
          {view === 'installed' && <><button type="button" className="dshIntegrationsCommand" onClick={() => { setError(undefined); setDraft(undefined); setImportText('') }}>{t('importJson')}</button>
            <button type="button" className="dshIntegrationsCommand dshCronPrimary" onClick={() => { setError(undefined); setImportText(undefined); setDraft({ ...EMPTY_DRAFT }) }}><Plus />{t('addServer')}</button></>}</div>
      </div>
      {view === 'installed' ? <div className="dshMcpInstalledList">{filteredServers.map(server => <div className="dshIntegrationsMcp dshMcpServerCard" key={server.serverName}>
        <div className="dshMcpServerMain"><span className="dshMcpGlyph" aria-hidden="true"><PlugZap /></span><div className="dshMcpIdentity"><div className="dshMcpServerTitle"><span className="dshIntegrationsRowTitle">{server.serverName}</span><span className="dshMcpTransport">{server.transport === 'stdio' ? 'stdio' : 'HTTP'}</span></div>
          <span className="dshMcpEndpoint" title={server.transport === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url}>{server.transport === 'stdio' ? `${server.command} ${server.args.join(' ')}` : server.url}</span></div>
          <div className="dshMcpServerStatus"><span className="dshMcpStatus" data-state={server.state} data-diagnostic={server.diagnostic.code}>{statusLabel(server, t)}</span>
            <SettingsToggle label={server.enabled ? t('enabled') : t('disabled')} checked={server.enabled}
              disabled={busy !== undefined} onChange={enabled => { void run(`mcp-toggle:${server.serverName}`, async () => { applyServers(await api.toggle(server.serverName, enabled)) }) }} /></div></div>
        <div className="dshMcpServerDetails"><div className="dshIntegrationsMeta"><span>{server.tools.length} {t('tools')}</span>
          {server.diagnostic.checkedAt !== undefined && <span>{t('lastChecked').replace('{time}', new Date(server.diagnostic.checkedAt).toLocaleString())}</span>}
          {(expertUsage?.get(server.serverName) ?? 0) > 0 && <span>{t('usedByExperts').replace('{count}', String(expertUsage?.get(server.serverName) ?? 0))}</span>}</div>
          <div className="dshMcpServerActions">{server.transport === 'streamable-http' && server.oauth !== undefined && <button type="button" className="dshIntegrationsCommand"
            disabled={busy !== undefined} onClick={() => { authorize(server.serverName) }}>{server.diagnostic.code === 'authorization-required' ? t('authorize') : t('reauthorize')}</button>}
            <SettingsIconButton label={t('testServer')} disabled={busy !== undefined} onClick={() => { void run(`mcp-test:${server.serverName}`, async () => { applyServers(await api.test(server.serverName)) }) }}><RotateCw /></SettingsIconButton>
            <SettingsIconButton label={t('editServer')} disabled={busy !== undefined} onClick={() => { setError(undefined); setImportText(undefined); setDraft(mcpDraft(server)) }}><Pencil /></SettingsIconButton>
            <SettingsIconButton label={removeName === server.serverName ? t('confirmRemove') : t('removeServer')} danger disabled={busy !== undefined}
              onClick={() => { if (removeName !== server.serverName) { setRemoveName(server.serverName); return }
                void run(`mcp-remove:${server.serverName}`, async () => { applyServers(await api.remove(server.serverName)); setRemoveName(undefined) }) }}><Trash2 /></SettingsIconButton>
          </div></div>
        {server.error !== undefined && <p className="dshIntegrationsServerError">{server.error}</p>}
        {server.diagnostic.code === 'credentials-missing' && <p className="dshIntegrationsServerError">{t('credentialsMissing')}</p>}
        <div className="dshIntegrationsTools">{server.tools.length === 0 ? <span>{t('noTools')}</span>
          : server.tools.map(tool => <span key={tool.name} title={tool.description}>{tool.name}</span>)}</div>
      </div>)}{filteredServers.length === 0 && <p className="dshIntegrationsEmpty dshMcpEmpty">{t(servers.length === 0 ? 'noServers' : 'noMatches')}{servers.length > 0 && <button type="button" className="dshIntegrationsCommand" onClick={() => { setSearch('') }}>{t('clearSearch')}</button>}</p>}</div>
      : <div className="dshMcpCatalogGrid">{filteredCatalog.map(entry => <div className="dshIntegrationsMcp dshMcpCatalogCard" key={entry.id}>
          <div className="dshIntegrationsMcpHeader"><span className="dshMcpGlyph" aria-hidden="true"><PlugZap /></span><div className="dshMcpIdentity">
            <span className="dshIntegrationsRowTitle">{entry.name}</span><span className="dshIntegrationsMeta"><span>{entry.category}</span><span>{entry.license}</span></span></div>
            <div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined || entry.installedServerName !== undefined}
              onClick={() => { if (entry.credentials.length === 0) { void run(`mcp-install:${entry.id}`, async () => {
                const next = await api.install(entry.id); applyServers(next.mcpServers); setCatalog(next.catalog); setView('installed')
              }) } else { setError(undefined); setDraft(undefined); setImportText(undefined); setCatalogInstall({ entry, values: {} }) } }}>{entry.installedServerName === undefined ? t('installConnector') : t('installed')}</button></div></div>
          <p className="dshMcpCatalogDescription">{entry.description}</p>
          <div className="dshIntegrationsTools">{entry.capabilities.map(capability => <span key={capability}>{capability}</span>)}</div>
          <a className="dshMcpCatalogSource" href={entry.sourceUrl} target="_blank" rel="noreferrer">{t('viewSource')}</a>
        </div>)}{filteredCatalog.length === 0 && <p className="dshIntegrationsEmpty dshMcpEmpty">{t('noCatalogMatches')}</p>}</div>}
    </div>}
  </section>
  <Modal open={importText !== undefined} title={t('importJson')} closeLabel={t('cancel')} onClose={closeImport} className="dshMcpDialog" contentClassName="dshMcpDialogContent"
    footer={<div className="dshMcpDialogFooter"><button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={closeImport}>{t('cancel')}</button>
      <button type="submit" form={`${id}-mcp-import`} className="dshIntegrationsCommand dshCronPrimary" disabled={busy !== undefined}>{t('import')}</button></div>}>
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    <form id={`${id}-mcp-import`} className="dshIntegrationsEditor dshMcpDialogForm" onSubmit={event => { event.preventDefault(); importServers() }}>
      <textarea rows={10} value={importText ?? ''} placeholder={t('importJsonHint')} onChange={event => { setImportText(event.target.value) }} />
    </form>
  </Modal>
  <Modal open={draft !== undefined} title={draft?.previousName === undefined ? t('addServer') : t('editServer')} closeLabel={t('cancel')} onClose={closeDraft} className="dshMcpDialog dshMcpEditorDialog" contentClassName="dshMcpDialogContent"
    footer={draft === undefined ? undefined : <div className="dshMcpDialogFooter"><label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.enabled}
      onChange={event => { setDraft({ ...draft, enabled: event.target.checked }) }} />{t('enabled')}</label><div className="dshIntegrationsRowActions">
        <button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={closeDraft}>{t('cancel')}</button>
        <button type="submit" form={`${id}-mcp-editor`} className="dshIntegrationsCommand dshCronPrimary" disabled={busy !== undefined}>{t('save')}</button></div></div>}>
    {draft !== undefined && <><div className="dshMcpDialogErrors">{error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}</div>
      <form id={`${id}-mcp-editor`} className="dshIntegrationsEditor dshMcpEditor dshMcpDialogForm" onSubmit={saveServer}>
        <section className="dshMcpFormSection" aria-labelledby={`${id}-mcp-identity-heading`}><h4 id={`${id}-mcp-identity-heading`}>{t('identityAndTransport')}</h4>
          <div className="dshMcpFormGrid"><label><span>{t('serverName')}</span><input required pattern="[A-Za-z0-9_-]{1,32}" value={draft.serverName}
            placeholder={t('serverNameHint')} onChange={event => { setDraft({ ...draft, serverName: event.target.value }) }} /></label>
            <fieldset><legend>{t('transport')}</legend><div className="dshIntegrationsSegments">{(['stdio', 'streamable-http'] as const).map(transport =>
              <button key={transport} type="button" aria-pressed={draft.transport === transport}
                onClick={() => { setDraft({ ...draft, transport }) }}>{transport === 'stdio' ? 'stdio' : 'HTTP'}</button>)}</div></fieldset></div>
        </section>
        <section className="dshMcpFormSection" aria-labelledby={`${id}-mcp-connection-heading`}><h4 id={`${id}-mcp-connection-heading`}>{t('connection')}</h4>
          <div className="dshMcpFormGrid">{draft.transport === 'stdio' ? <><label><span>{t('command')}</span><input required value={draft.command} placeholder={t('commandHint')}
            onChange={event => { setDraft({ ...draft, command: event.target.value }) }} /></label>
            <label><span>{t('workingDirectory')}</span><input value={draft.cwd} placeholder={t('workingDirectoryHint')}
              onChange={event => { setDraft({ ...draft, cwd: event.target.value }) }} /></label>
            <label className="dshMcpFieldFull"><span>{t('arguments')}</span><textarea rows={3} value={draft.args} onChange={event => { setDraft({ ...draft, args: event.target.value }) }} /></label></>
            : <label className="dshMcpFieldFull"><span>{t('url')}</span><input required type="url" value={draft.url} placeholder={t('urlHint')}
                onChange={event => { setDraft({ ...draft, url: event.target.value }) }} /></label>}</div>
        </section>
        {draft.transport === 'streamable-http' && <section className="dshMcpFormSection" aria-labelledby={`${id}-mcp-auth-heading`}><div className="dshMcpSectionHeading"><h4 id={`${id}-mcp-auth-heading`}>{t('authentication')}</h4>
          <label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.oauthEnabled}
            onChange={event => { setDraft({ ...draft, oauthEnabled: event.target.checked }) }} />{t('oauthPkce')}</label></div>
          {draft.oauthEnabled && <div className="dshMcpFormGrid"><label className="dshMcpFieldFull"><span>{t('oauthIssuer')}</span><input type="url" value={draft.oauthIssuer}
            placeholder="https://identity.example.com" onChange={event => { setDraft({ ...draft, oauthIssuer: event.target.value }) }} /></label>
            <label><span>{t('oauthScope')}</span><input required value={draft.oauthScope}
              onChange={event => { setDraft({ ...draft, oauthScope: event.target.value }) }} /></label>
            <label><span>{t('oauthResource')}</span><input type="url" value={draft.oauthResource}
              onChange={event => { setDraft({ ...draft, oauthResource: event.target.value }) }} /></label></div>}
        </section>}
        <details className="dshMcpFormDisclosure"><summary>{t('credentials')}</summary>
          <p className="dshMcpCredentialNotice">{t('secretNotice')}</p><div className="dshMcpFormGrid">
            <label><span>{draft.transport === 'stdio' ? t('environmentReferences') : t('headerReferences')}</span><textarea rows={3} value={draft.references} placeholder={t('referencesHint')}
              onChange={event => { setDraft({ ...draft, references: event.target.value }) }} /></label>
            <label><span>{t('credentialValues')}</span><textarea rows={3} value={draft.secrets} placeholder={t('credentialValuesHint')}
              onChange={event => { setDraft({ ...draft, secrets: event.target.value }) }} /></label></div>
        </details>
        <details className="dshMcpFormDisclosure"><summary>{t('advancedSettings')}</summary><div className="dshMcpFormGrid dshMcpAdvancedFields">
          <label><span>{t('timeout')}</span><input required inputMode="numeric" value={draft.timeoutMs}
            onChange={event => { setDraft({ ...draft, timeoutMs: event.target.value }) }} /></label>
          <fieldset><legend>{t('reconnect')}</legend><label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.reconnectEnabled}
            onChange={event => { setDraft({ ...draft, reconnectEnabled: event.target.checked }) }} />{t('reconnectEnabled')}</label></fieldset>
          <label><span>{t('initialDelay')}</span><input required type="number" min="100" max="60000" step="1" value={draft.reconnectInitialDelayMs}
            onChange={event => { setDraft({ ...draft, reconnectInitialDelayMs: event.target.value }) }} /></label>
          <label><span>{t('maxDelay')}</span><input required type="number" min="100" max="300000" step="1" value={draft.reconnectMaxDelayMs}
            onChange={event => { setDraft({ ...draft, reconnectMaxDelayMs: event.target.value }) }} /></label>
          <label><span>{t('maxAttempts')}</span><input required type="number" min="0" max="100" step="1" value={draft.reconnectMaxAttempts}
            onChange={event => { setDraft({ ...draft, reconnectMaxAttempts: event.target.value }) }} /></label>
        </div></details>
      </form></>}
  </Modal>
  <Modal open={catalogInstall !== undefined} title={catalogInstall?.entry.name ?? t('installConnector')} closeLabel={t('cancel')} onClose={closeCatalogInstall} className="dshMcpDialog" contentClassName="dshMcpDialogContent"
    footer={catalogInstall === undefined ? undefined : <div className="dshMcpDialogFooter"><span>{catalogInstall.entry.license}</span><div className="dshIntegrationsRowActions">
      <button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={closeCatalogInstall}>{t('cancel')}</button>
      <button type="submit" form={`${id}-mcp-catalog-install`} className="dshIntegrationsCommand dshCronPrimary" disabled={busy !== undefined}>{t('installConnector')}</button></div></div>}>
    {catalogInstall !== undefined && <><p className="dshMcpDialogDescription">{catalogInstall.entry.description}</p>
      {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
      <form id={`${id}-mcp-catalog-install`} className="dshIntegrationsEditor dshMcpDialogForm" onSubmit={installCatalog}>
        {catalogInstall.entry.credentials.map(field => <label key={field.id}><span>{field.label}</span><input required={field.required} type={field.secret ? 'password' : 'text'}
          autoComplete="off" value={catalogInstall.values[field.id] ?? ''} onChange={event => { setCatalogInstall({ ...catalogInstall,
            values: { ...catalogInstall.values, [field.id]: event.target.value } }) }} /></label>)}
      </form></>}
  </Modal></>
}
