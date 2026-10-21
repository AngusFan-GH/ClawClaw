import { useEffect, useId, useRef, useState } from 'react'
import type { DesktopMcpLocaleKey } from './mcp-locales.ts'

export interface McpCredentialDraft {
  readonly id: string
  readonly name: string
  readonly value: string
  readonly reference: string
  readonly useReference: boolean
}
export type McpCredentialKind = 'header' | 'environment' | 'oauth'
type Translate = (key: DesktopMcpLocaleKey) => string

export function newMcpCredential(): McpCredentialDraft {
  return { id: crypto.randomUUID(), name: '', value: '', reference: '', useReference: false }
}

/** Actual values travel only in the credential-write payload, never settings.
 * Replacements get a fresh reference so shared credentials remain untouched.
 */
export function prepareMcpCredentials(rows: readonly McpCredentialDraft[], t: Translate, kind: 'header' | 'environment'): { references: Record<string, string>; secrets: Record<string, string> } {
  const names = new Set<string>()
  const entries: Array<[string, string]> = []
  const secrets: Record<string, string> = {}
  for (const row of rows) {
    const name = row.name.trim()
    if (name === '' && row.value === '' && row.reference === '') continue
    const validName = kind === 'header' ? /^[!#$%&'*+.^_`|~0-9A-Za-z-]{1,256}$/u.test(name) : /^[A-Za-z_][A-Za-z0-9_]*$/u.test(name)
    if (!validName) throw new Error(t(kind === 'header' ? 'headerNameError' : 'environmentNameError'))
    const identity = kind === 'header' ? name.toLowerCase() : name
    if (names.has(identity)) throw new Error(t(kind === 'header' ? 'duplicateHeaderError' : 'duplicateEnvironmentError'))
    names.add(identity)
    let reference = row.reference.trim()
    if (row.useReference) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(reference)) throw new Error(t('credentialReferenceError'))
    } else if (row.value !== '') {
      reference = `MCP_${kind === 'header' ? 'HEADER' : 'ENV'}_${crypto.randomUUID().replaceAll('-', '_')}`
      secrets[reference] = row.value
    } else if (reference === '') throw new Error(t(kind === 'header' ? 'headerValueRequired' : 'environmentValueRequired'))
    entries.push([name, reference])
  }
  return { references: Object.fromEntries(entries), secrets }
}

function CredentialRow({ row, kind, t, onChange, onRemove }: { row: McpCredentialDraft; kind: McpCredentialKind; t: Translate; onChange: (row: McpCredentialDraft) => void; onRemove: () => void }) {
  const id = useId()
  const [visible, setVisible] = useState(false)
  const nameRef = useRef<HTMLInputElement>(null)
  useEffect(() => { if (row.name === '' && row.value === '' && row.reference === '') nameRef.current?.focus() }, [row.id])
  return <div className="dshMcpCredentialRow">
    <div className="dshMcpCredentialInputs">
      {kind !== 'oauth' && <label><span>{t(kind === 'header' ? 'headerName' : 'environmentName')}</span><input ref={nameRef} value={row.name} placeholder={t(kind === 'header' ? 'headerNamePlaceholder' : 'environmentNamePlaceholder')} autoComplete="off" spellCheck={false}
        onChange={event => { onChange({ ...row, name: event.target.value }) }} /></label>}
      <label><span>{row.useReference ? t('existingCredential') : t(kind === 'oauth' ? 'oauthClientSecret' : 'headerValue')}</span><div className="dshMcpSecretInput">
        <input id={id} aria-label={row.useReference ? t('existingCredential') : t(kind === 'oauth' ? 'oauthClientSecret' : 'headerValue')} type={row.useReference || visible ? 'text' : 'password'} autoComplete="off" spellCheck={false}
          value={row.useReference ? row.reference : row.value} maxLength={row.useReference ? 256 : 16_384}
          placeholder={row.useReference ? t('credentialRefPlaceholder') : row.reference !== '' ? t('configuredValue') : kind === 'header' ? (row.name.trim() === '' || row.name.toLowerCase() === 'authorization' ? t('bearerValuePlaceholder') : t('headerValuePlaceholder')) : t(kind === 'oauth' ? 'oauthClientSecretPlaceholder' : 'environmentValuePlaceholder')}
          aria-describedby={`${id}-hint`} onChange={event => { onChange(row.useReference ? { ...row, reference: event.target.value } : { ...row, value: event.target.value }) }} />
        {!row.useReference && <button type="button" className="dshIntegrationsCommand" aria-controls={id} aria-pressed={visible}
          onClick={() => { setVisible(!visible) }}>{visible ? t('hideValue') : t('showValue')}</button>}
      </div></label>
      {kind !== 'oauth' && <button type="button" className="dshIntegrationsCommand dshMcpCredentialRemove" aria-label={`${t('removeHeader')} ${row.name}`.trim()} onClick={onRemove}>{t('removeHeader')}</button>}
    </div>
    <div className="dshMcpCredentialMeta"><span id={`${id}-hint`}>{row.useReference ? t('existingCredentialHint') : row.reference !== '' ? t('savedValueHint') : kind === 'header' && row.name.toLowerCase() === 'authorization' ? t('headerValueHint') : t('newValueHint')}</span>
      <button type="button" className="dshMcpReferenceSwitch" onClick={() => { setVisible(false); onChange({ ...row, useReference: !row.useReference }) }}>
        {row.useReference ? t('enterValue') : t('useExistingCredential')}
      </button></div>
  </div>
}

export function McpCredentialFields({ rows, kind, t, onChange, showNotice = true }: { showNotice?: boolean; kind: McpCredentialKind; rows: readonly McpCredentialDraft[]; t: Translate; onChange: (rows: readonly McpCredentialDraft[]) => void }) {
  return <div className={`dshMcpCredentials${kind === 'oauth' ? ' dshMcpCredentialOauth' : ''}`}>
    {showNotice && kind !== 'oauth' && <p className="dshMcpCredentialNotice">{t(kind === 'header' ? 'headerSecretNotice' : 'environmentSecretNotice')}</p>}
    {rows.map(row => <CredentialRow key={row.id} row={row} kind={kind} t={t}
      onChange={next => { onChange(rows.map(item => item.id === row.id ? next : item)) }}
      onRemove={() => { onChange(rows.filter(item => item.id !== row.id)) }} />)}
    {kind !== 'oauth' && <button type="button" className="dshIntegrationsCommand dshMcpCredentialAdd" onClick={() => { onChange([...rows, newMcpCredential()]) }}>{t(kind === 'header' ? 'addHeader' : 'addEnvironment')}</button>}
  </div>
}
