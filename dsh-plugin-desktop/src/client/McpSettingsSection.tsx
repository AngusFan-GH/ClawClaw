/** Desktop Settings surface dedicated to MCP servers. */

import { useEffect, useState, type FormEvent } from 'react'
// @ts-expect-error package subpath has no declaration file
import Pencil from 'lucide-react/dist/esm/icons/pencil.mjs'
// @ts-expect-error package subpath has no declaration file
import Plus from 'lucide-react/dist/esm/icons/plus.mjs'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import RotateCw from 'lucide-react/dist/esm/icons/rotate-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Trash2 from 'lucide-react/dist/esm/icons/trash-2.mjs'
// @ts-expect-error package subpath has no declaration file
import X from 'lucide-react/dist/esm/icons/x.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopMcpServerConfig, DesktopMcpServerView } from '../mcp-contract.ts'
import type { DesktopMcpApi } from './mcp-api.ts'
import type { DesktopMcpLocaleKey } from './mcp-locales.ts'
import { SettingsIconButton, SettingsToggle } from './settings-controls.tsx'

export interface McpSettingsSectionInjected { readonly api: DesktopMcpApi }
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
  url: string
  enabled: boolean
}
const EMPTY_DRAFT: McpDraft = { serverName: '', transport: 'stdio', command: '', args: '', cwd: '', references: '', secrets: '', timeoutMs: '60000', url: '', enabled: true }

function linesToMap(value: string): Record<string, string> {
  const entries = value.split(/\r?\n/u).map(line => line.trim()).filter(Boolean).map(line => {
    const separator = line.indexOf('=')
    if (separator < 1 || separator === line.length - 1) throw new Error('Use NAME=VALUE, one entry per line')
    return [line.slice(0, separator).trim(), line.slice(separator + 1).trim()] as const
  })
  if (new Set(entries.map(([key]) => key)).size !== entries.length) throw new Error('Credential names must be unique')
  return Object.fromEntries(entries)
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
    timeoutMs: String(server.timeoutMs), url: server.transport === 'streamable-http' ? server.url : '', enabled: server.enabled }
}

export function McpSettingsSection({ t, api }: McpSettingsSectionProps) {
  const [servers, setServers] = useState<readonly DesktopMcpServerView[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState<string>()
  const [draft, setDraft] = useState<McpDraft>()
  const [removeName, setRemoveName] = useState<string>()
  const [importText, setImportText] = useState<string>()

  const load = async (): Promise<void> => {
    setLoading(true); setError(undefined)
    try { setServers(await api.read()) } catch (cause) { setError(cause instanceof Error ? cause.message : t('unavailable')) }
    finally { setLoading(false) }
  }
  useEffect(() => { void load() }, [])
  const run = async (key: string, operation: () => Promise<void>): Promise<void> => {
    setBusy(key); setError(undefined)
    try { await operation() } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
    finally { setBusy(undefined) }
  }
  const saveServer = (event: FormEvent): void => {
    event.preventDefault()
    if (draft === undefined) return
    try {
      const references = linesToMap(draft.references)
      const secrets = linesToMap(draft.secrets)
      const timeoutMs = Number(draft.timeoutMs)
      if (!Number.isInteger(timeoutMs)) throw new Error('Timeout must be a whole number of milliseconds')
      const reconnect = { enabled: true, initialDelayMs: 500, maxDelayMs: 30_000, maxAttempts: 10 }
      const server: DesktopMcpServerConfig = draft.transport === 'stdio'
        ? { serverName: draft.serverName.trim(), transport: 'stdio', command: draft.command.trim(),
            args: draft.args.split(/\r?\n/u).map(value => value.trim()).filter(Boolean), cwd: draft.cwd.trim(), env: references, timeoutMs, reconnect, enabled: draft.enabled }
        : { serverName: draft.serverName.trim(), transport: 'streamable-http', url: draft.url.trim(), headers: references, timeoutMs, reconnect, enabled: draft.enabled }
      void run('mcp-save', async () => { setServers(await api.save(server, draft.previousName, Object.keys(secrets).length === 0 ? undefined : secrets)); setDraft(undefined) })
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('operationFailed')) }
  }
  const importServers = (): void => {
    if (importText === undefined) { setImportText(''); return }
    try {
      const document = JSON.parse(importText) as unknown
      void run('mcp-import', async () => { setServers(await api.import(document)); setImportText(undefined) })
    } catch { setError(t('invalidImport')) }
  }

  return <section className="dshIntegrations" aria-label={t('title')}>
    <header className="dshIntegrationsHeader"><div><h2>{t('title')}</h2><p>{t('intro')}</p></div>
      <SettingsIconButton label={t('refresh')} disabled={loading || busy !== undefined} onClick={() => { void load() }}><RefreshCw /></SettingsIconButton></header>
    {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}
    {loading && servers.length === 0 ? <p className="dshIntegrationsEmpty">{t('loading')}</p> : <div className="dshIntegrationsBody">
      <div className="dshIntegrationsToolbar"><p>{t('secretNotice')}</p>
        <div className="dshIntegrationsRowActions"><button type="button" className="dshIntegrationsCommand" onClick={() => { setImportText(importText === undefined ? '' : undefined) }}>{t('importJson')}</button>
          <button type="button" className="dshIntegrationsCommand" onClick={() => { setDraft({ ...EMPTY_DRAFT }) }}><Plus />{t('addServer')}</button></div></div>
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
        <div className="dshIntegrationsEditorFooter"><label className="dshIntegrationsEnabled"><input type="checkbox" checked={draft.enabled}
          onChange={event => { setDraft({ ...draft, enabled: event.target.checked }) }} />{t('enabled')}</label>
          <button type="submit" className="dshIntegrationsCommand" disabled={busy !== undefined}>{t('save')}</button></div>
      </form>}
      <div className="dshIntegrationsList">{servers.map(server => <div className="dshIntegrationsMcp" key={server.serverName}>
        <div className="dshIntegrationsMcpHeader"><div><span className="dshIntegrationsRowTitle">{server.serverName}</span>
          <span className="dshIntegrationsMeta"><span>{server.transport === 'stdio' ? server.command : server.url}</span>
            <span data-state={server.state}>{statusLabel(server, t)}</span><span>{server.tools.length} {t('tools')}</span></span></div>
          <div className="dshIntegrationsRowActions"><SettingsToggle label={server.enabled ? t('enabled') : t('disabled')} checked={server.enabled}
            disabled={busy !== undefined} onChange={enabled => { void run(`mcp-toggle:${server.serverName}`, async () => { setServers(await api.toggle(server.serverName, enabled)) }) }} />
            <SettingsIconButton label={t('testServer')} disabled={busy !== undefined} onClick={() => { void run(`mcp-test:${server.serverName}`, async () => { setServers(await api.test(server.serverName)) }) }}><RotateCw /></SettingsIconButton>
            <SettingsIconButton label={t('editServer')} disabled={busy !== undefined} onClick={() => { setDraft(mcpDraft(server)) }}><Pencil /></SettingsIconButton>
            <SettingsIconButton label={removeName === server.serverName ? t('confirmRemove') : t('removeServer')} danger disabled={busy !== undefined}
              onClick={() => { if (removeName !== server.serverName) { setRemoveName(server.serverName); return }
                void run(`mcp-remove:${server.serverName}`, async () => { setServers(await api.remove(server.serverName)); setRemoveName(undefined) }) }}><Trash2 /></SettingsIconButton>
          </div></div>
        {server.error !== undefined && <p className="dshIntegrationsServerError">{server.error}</p>}
        {!server.credentialsReady && <p className="dshIntegrationsServerError">{t('credentialsMissing')}</p>}
        <div className="dshIntegrationsTools">{server.tools.length === 0 ? <span>{t('noTools')}</span>
          : server.tools.map(tool => <span key={tool.name} title={tool.description}>{tool.name}</span>)}</div>
      </div>)}{servers.length === 0 && <p className="dshIntegrationsEmpty">{t('noServers')}</p>}</div>
    </div>}
  </section>
}
