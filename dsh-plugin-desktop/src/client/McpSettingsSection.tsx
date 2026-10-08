/** Desktop Settings surface dedicated to MCP servers. */

import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react'
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
// @ts-expect-error package subpath has no declaration file
import X from 'lucide-react/dist/esm/icons/x.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopMcpServerConfig, DesktopMcpServerView } from '../mcp-contract.ts'
import type { DesktopMcpApi } from './mcp-api.ts'
import type { DesktopMcpLocaleKey } from './mcp-locales.ts'
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
  enabled: boolean
}
const EMPTY_DRAFT: McpDraft = { serverName: '', transport: 'stdio', command: '', args: '', cwd: '', references: '', secrets: '', timeoutMs: '60000',
  reconnectEnabled: true, reconnectInitialDelayMs: '500', reconnectMaxDelayMs: '30000', reconnectMaxAttempts: '10', url: '', enabled: true }

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
  if (!server.enabled) return t('disabled')
  return t(server.state as Extract<DesktopMcpLocaleKey, 'starting' | 'running' | 'error' | 'disabled'>)
}
function mcpDraft(server: DesktopMcpServerView): McpDraft {
  return { previousName: server.serverName, serverName: server.serverName, transport: server.transport,
    command: server.transport === 'stdio' ? server.command : '', args: server.transport === 'stdio' ? server.args.join('\n') : '',
    cwd: server.transport === 'stdio' ? server.cwd : '', references: mapToLines(server.transport === 'stdio' ? server.env : server.headers), secrets: '',
    timeoutMs: String(server.timeoutMs), reconnectEnabled: server.reconnect.enabled,
    reconnectInitialDelayMs: String(server.reconnect.initialDelayMs), reconnectMaxDelayMs: String(server.reconnect.maxDelayMs),
    reconnectMaxAttempts: String(server.reconnect.maxAttempts), url: server.transport === 'streamable-http' ? server.url : '', enabled: server.enabled }
}

export function McpSettingsSection({ t, api, embedded = false, onSummary, onCatalogChange, expertUsage }: McpSettingsSectionProps) {
  const [servers, setServers] = useState<readonly DesktopMcpServerView[]>([])
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
      if (mountedRef.current) applyServers(next)
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
            args: draft.args.split(/\r?\n/u).map(value => value.trim()).filter(Boolean), cwd: draft.cwd.trim(), env: references, timeoutMs, reconnect, enabled: draft.enabled }
        : { serverName: draft.serverName.trim(), transport: 'streamable-http', url: draft.url.trim(), headers: references, timeoutMs, reconnect, enabled: draft.enabled }
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

  return <section className={`dshIntegrations dshMcpPage${embedded ? ' dshIntegrationsEmbedded' : ''}`} aria-label={t('title')}>
    {!embedded && <header className="dshIntegrationsHeader"><div><h2>{t('title')}</h2><p>{t('intro')}</p></div></header>}
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    {loading && servers.length === 0 ? <p className="dshIntegrationsEmpty">{t('loading')}</p> : <div className="dshIntegrationsBody">
      <div className="dshMcpCatalogToolbar">
        <label className="dshIntegrationsSearch"><Search aria-hidden="true" /><input aria-label={t('searchServers')} value={search} onChange={event => { setSearch(event.target.value) }} placeholder={t('searchServers')} /></label>
        <div className="dshIntegrationsRowActions"><SettingsIconButton label={t('refresh')} disabled={loading || busy !== undefined} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton>
          <button type="button" className="dshIntegrationsCommand" onClick={() => { setImportText(importText === undefined ? '' : undefined) }}>{t('importJson')}</button>
          <button type="button" className="dshIntegrationsCommand dshCronPrimary" onClick={() => { setDraft({ ...EMPTY_DRAFT }) }}><Plus />{t('addServer')}</button></div>
      </div>
      <p className="dshMcpCredentialNotice">{t('secretNotice')}</p>
      {importText !== undefined && <div className="dshIntegrationsEditor"><div className="dshIntegrationsEditorHeader"><h3>{t('importJson')}</h3><SettingsIconButton label={t('cancel')} onClick={() => { setImportText(undefined) }}><X /></SettingsIconButton></div>
        <textarea rows={8} value={importText} placeholder={t('importJsonHint')} onChange={event => { setImportText(event.target.value) }} />
        <div className="dshIntegrationsEditorFooter"><span /><button type="button" className="dshIntegrationsCommand" disabled={busy !== undefined} onClick={importServers}>{t('import')}</button></div></div>}
      {draft !== undefined && <form className="dshIntegrationsEditor" onSubmit={saveServer}>
        <div className="dshIntegrationsEditorHeader"><h3>{draft.previousName === undefined ? t('addServer') : t('editServer')}</h3>
          <SettingsIconButton label={t('cancel')} onClick={() => { setDraft(undefined) }}><X /></SettingsIconButton></div>
        <label><span>{t('serverName')}</span><input required pattern="[A-Za-z0-9_-]{1,32}" value={draft.serverName}
          placeholder={t('serverNameHint')} onChange={event => { setDraft({ ...draft, serverName: event.target.value }) }} /></label>
        <fieldset><legend>{t('transport')}</legend><div className="dshIntegrationsSegments">{(['stdio', 'streamable-http'] as const).map(transport =>
          <button key={transport} type="button" aria-pressed={draft.transport === transport}
            onClick={() => { setDraft({ ...draft, transport }) }}>{transport === 'stdio' ? 'stdio' : 'HTTP'}</button>)}</div></fieldset>
        {draft.transport === 'stdio' ? <><label><span>{t('command')}</span><input required value={draft.command} placeholder={t('commandHint')}
          onChange={event => { setDraft({ ...draft, command: event.target.value }) }} /></label>
          <label><span>{t('workingDirectory')}</span><input value={draft.cwd} placeholder={t('workingDirectoryHint')}
            onChange={event => { setDraft({ ...draft, cwd: event.target.value }) }} /></label>
          <label><span>{t('arguments')}</span><textarea rows={4} value={draft.args} onChange={event => { setDraft({ ...draft, args: event.target.value }) }} /></label></>
          : <label><span>{t('url')}</span><input required type="url" value={draft.url} placeholder={t('urlHint')}
              onChange={event => { setDraft({ ...draft, url: event.target.value }) }} /></label>}
        <label><span>{draft.transport === 'stdio' ? t('environmentReferences') : t('headerReferences')}</span><textarea rows={3} value={draft.references} placeholder={t('referencesHint')}
          onChange={event => { setDraft({ ...draft, references: event.target.value }) }} /></label>
        <label><span>{t('credentialValues')}</span><textarea rows={3} value={draft.secrets} placeholder={t('credentialValuesHint')}
          onChange={event => { setDraft({ ...draft, secrets: event.target.value }) }} /></label>
        <label><span>{t('timeout')}</span><input required inputMode="numeric" value={draft.timeoutMs}
          onChange={event => { setDraft({ ...draft, timeoutMs: event.target.value }) }} /></label>
        <fieldset><legend>{t('reconnect')}</legend>
          <label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.reconnectEnabled}
            onChange={event => { setDraft({ ...draft, reconnectEnabled: event.target.checked }) }} />{t('reconnectEnabled')}</label>
          <label><span>{t('initialDelay')}</span><input required type="number" min="100" max="60000" step="1" value={draft.reconnectInitialDelayMs}
            onChange={event => { setDraft({ ...draft, reconnectInitialDelayMs: event.target.value }) }} /></label>
          <label><span>{t('maxDelay')}</span><input required type="number" min="100" max="300000" step="1" value={draft.reconnectMaxDelayMs}
            onChange={event => { setDraft({ ...draft, reconnectMaxDelayMs: event.target.value }) }} /></label>
          <label><span>{t('maxAttempts')}</span><input required type="number" min="0" max="100" step="1" value={draft.reconnectMaxAttempts}
            onChange={event => { setDraft({ ...draft, reconnectMaxAttempts: event.target.value }) }} /></label>
        </fieldset>
        <div className="dshIntegrationsEditorFooter"><label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.enabled}
          onChange={event => { setDraft({ ...draft, enabled: event.target.checked }) }} />{t('enabled')}</label>
          <button type="submit" className="dshIntegrationsCommand" disabled={busy !== undefined}>{t('save')}</button></div>
      </form>}
      <div className="dshIntegrationsList dshMcpGrid">{filteredServers.map(server => <div className="dshIntegrationsMcp" key={server.serverName}>
        <div className="dshIntegrationsMcpHeader"><span className="dshMcpGlyph" aria-hidden="true"><PlugZap /></span><div className="dshMcpIdentity"><span className="dshIntegrationsRowTitle">{server.serverName}</span>
          <span className="dshIntegrationsMeta"><span>{server.transport === 'stdio' ? server.command : server.url}</span>
            <span data-state={server.state}>{statusLabel(server, t)}</span><span>{server.tools.length} {t('tools')}</span>{(expertUsage?.get(server.serverName) ?? 0) > 0 && <span>{t('usedByExperts').replace('{count}', String(expertUsage?.get(server.serverName) ?? 0))}</span>}</span></div>
          <div className="dshIntegrationsRowActions"><SettingsToggle label={server.enabled ? t('enabled') : t('disabled')} checked={server.enabled}
            disabled={busy !== undefined} onChange={enabled => { void run(`mcp-toggle:${server.serverName}`, async () => { applyServers(await api.toggle(server.serverName, enabled)) }) }} />
            <SettingsIconButton label={t('testServer')} disabled={busy !== undefined} onClick={() => { void run(`mcp-test:${server.serverName}`, async () => { applyServers(await api.test(server.serverName)) }) }}><RotateCw /></SettingsIconButton>
            <SettingsIconButton label={t('editServer')} disabled={busy !== undefined} onClick={() => { setDraft(mcpDraft(server)) }}><Pencil /></SettingsIconButton>
            <SettingsIconButton label={removeName === server.serverName ? t('confirmRemove') : t('removeServer')} danger disabled={busy !== undefined}
              onClick={() => { if (removeName !== server.serverName) { setRemoveName(server.serverName); return }
                void run(`mcp-remove:${server.serverName}`, async () => { applyServers(await api.remove(server.serverName)); setRemoveName(undefined) }) }}><Trash2 /></SettingsIconButton>
          </div></div>
        {server.error !== undefined && <p className="dshIntegrationsServerError">{server.error}</p>}
        {!server.credentialsReady && <p className="dshIntegrationsServerError">{t('credentialsMissing')}</p>}
        <div className="dshIntegrationsTools">{server.tools.length === 0 ? <span>{t('noTools')}</span>
          : server.tools.map(tool => <span key={tool.name} title={tool.description}>{tool.name}</span>)}</div>
      </div>)}{filteredServers.length === 0 && <p className="dshIntegrationsEmpty dshMcpEmpty">{t(servers.length === 0 ? 'noServers' : 'noMatches')}{servers.length > 0 && <button type="button" className="dshIntegrationsCommand" onClick={() => { setSearch('') }}>{t('clearSearch')}</button>}</p>}</div>
    </div>}
  </section>
}
