import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { validHtmlState, type GenuiHtmlState, type GenuiStateIdentity } from '../genui-state-contract.ts'
import { htmlStateStorage, type HtmlStateStorage } from './genui-html-state.ts'
import type { GenuiHtml } from '../genui-contract.ts'
import { createGenuiHtmlDocument, GENUI_HTML_CHANNEL } from './genui-html-document.ts'

function isDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme') || document.documentElement.hasAttribute('data-ds-dark-theme')
}

export function GenuiHtmlView({ node, zh, identity, storage }: { node: GenuiHtml; zh: boolean;
  identity?: Omit<GenuiStateIdentity, 'sourceHash'>; storage?: HtmlStateStorage }) {
  const persistence = useMemo(() => storage ?? (identity ? htmlStateStorage(identity, node.html) : undefined),
    [storage, identity?.sessionId, identity?.callId, identity?.path, node.html])
  const [bootState, setBootState] = useState<GenuiHtmlState | null | undefined>(persistence ? undefined : null)
  const latest = useRef<GenuiHtmlState | null>(null)
  const [loadAttempt, setLoadAttempt] = useState(0)
  const [loadError, setLoadError] = useState(false)
  const [saveError, setSaveError] = useState<'save' | 'reset' | 'unsupported'>()
  const [retrying, setRetrying] = useState(false)
  const [resetting, setResetting] = useState(false)
  const ignoreState = useRef(false)
  useEffect(() => {
    if (!persistence) return
    let active = true
    setLoadError(false); setBootState(undefined)
    void persistence.load().then(state => { if (active) { latest.current = state; setBootState(state) } })
      .catch(() => { if (active) setLoadError(true) })
    return () => { active = false }
  }, [persistence, loadAttempt])
  const frame = useRef<HTMLIFrameElement>(null)
  const [revision, setRevision] = useState(0)
  const [height, setHeight] = useState(240)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'stopped'>('loading')
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const srcDoc = useMemo(() => createGenuiHtmlDocument(node.html, { dark: isDark(), zh, state: bootState ?? null }), [node.html, zh, bootState])
  useEffect(() => {
    const observer = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ channel: GENUI_HTML_CHANNEL, type: 'theme', value: isDark() }, '*'))
    for (const target of [document.body, document.documentElement]) observer.observe(target, {
      attributes: true, attributeFilter: ['data-ds-dark-theme'],
    })
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (status === 'stopped' || bootState === undefined) return
    setStatus('loading')
    let ready = false
    const timeout = window.setTimeout(() => { if (!ready) setStatus('error') }, 8000)
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return
      const data = event.data
      if (!data || typeof data !== 'object' || !('channel' in data) || data.channel !== GENUI_HTML_CHANNEL || !('type' in data)) return
      if (data.type === 'ready') { frame.current?.contentWindow?.postMessage({ channel: GENUI_HTML_CHANNEL, type: 'theme', value: isDark() }, '*'); ready = true; window.clearTimeout(timeout); setStatus(previous => previous === 'error' ? previous : 'ready') }
      if (data.type === 'error') { ready = true; window.clearTimeout(timeout); setStatus('error') }
      if (data.type === 'state-error') setSaveError('unsupported')
      if (data.type === 'state' && 'value' in data && !ignoreState.current) {
        if (!validHtmlState(data.value)) { setSaveError('unsupported'); return }
        latest.current = data.value
        if (persistence) void persistence.save(data.value).then(() => setSaveError(undefined)).catch(() => setSaveError('save'))
      }
      if (data.type === 'height' && 'value' in data && typeof data.value === 'number' && Number.isFinite(data.value)) {
        setHeight(Math.min(720, Math.max(120, Math.ceil(data.value))))
      }
    }
    window.addEventListener('message', receive)
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [srcDoc, revision, status === 'stopped', bootState === undefined, persistence])
  const restart = (state: GenuiHtmlState | null): void => {
    setBootState(state); setStatus('loading'); setRevision(value => value + 1)
  }
  const reset = async (): Promise<void> => {
    ignoreState.current = true; setResetting(true)
    try { await persistence?.clear(); latest.current = null; setSaveError(undefined); restart(null) }
    catch { setSaveError('reset') }
    finally { ignoreState.current = false; setResetting(false) }
  }
  const retrySave = async (): Promise<void> => {
    if (!persistence || !latest.current || retrying) return
    setRetrying(true)
    try { await persistence.save(latest.current); setSaveError(undefined) }
    catch { setSaveError('save') }
    finally { setRetrying(false) }
  }
  return <section className="clawGenuiHtml" aria-label={node.title}>
    <div className="clawGenuiHtmlToolbar"><h4>{node.title}</h4>
      <button type="button" disabled={resetting || bootState === undefined} onClick={() => status === 'stopped' ? restart(latest.current) : setStatus('stopped')}>
        {status === 'stopped' ? (zh ? '继续运行' : 'Resume') : (zh ? '暂停' : 'Pause')}
      </button>
    </div>
    {saveError && <p className="clawGenuiHtmlNotice" role="status">
      {saveError === 'unsupported'
        ? (zh ? '部分输入无法保存，可继续使用当前内容。' : 'Some inputs cannot be saved. You can keep using this view.')
        : saveError === 'reset' ? (zh ? '未能恢复初始值。' : 'Could not restore initial values.') : (zh ? '保存失败。' : 'Could not save inputs.')}
      {saveError !== 'unsupported' && <button type="button" disabled={retrying || resetting} onClick={() => { void (saveError === 'reset' ? reset() : retrySave()) }}>{zh ? '重试' : 'Retry'}</button>}
    </p>}
    <div className="clawGenuiHtmlViewport" style={{ height }} aria-busy={status === 'loading' && !loadError}>
      {(loadError || status === 'loading' || status === 'error' || status === 'stopped') && <div className="clawGenuiHtmlPlaceholder" role="status">
        {loadError ? <><p>{zh ? '无法读取已保存的输入。' : 'Saved inputs could not be loaded.'}</p><button type="button" onClick={() => setLoadAttempt(value => value + 1)}>{zh ? '重试加载' : 'Retry loading'}</button></>
          : status === 'error' ? <><p>{zh ? '交互内容暂时无法运行，可查看下方说明。' : 'Interactive content could not run. Read the description below.'}</p><button type="button" onClick={() => restart(latest.current)}>{zh ? '重新加载' : 'Reload'}</button></>
          : <p>{status === 'stopped' ? (zh ? '已暂停，点击“继续运行”即可恢复。' : 'Paused. Select Resume to continue.') : (zh ? '正在准备交互内容…' : 'Preparing interactive content…')}</p>}
      </div>}
      {status !== 'stopped' && bootState !== undefined && <iframe
        key={revision} ref={frame} title={node.title} srcDoc={srcDoc} sandbox="allow-scripts" referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'"
        style={{ height, width: '100%', border: 0, visibility: status === 'ready' ? 'visible' : 'hidden' }} />}
    </div>
    <details open={status === 'error' || loadError || fallbackOpen} onToggle={event => setFallbackOpen(event.currentTarget.open)}>
      <summary>{zh ? '说明' : 'Description'}</summary><p>{node.fallback}</p><p className="clawGenuiChartNote">{persistence
        ? (zh ? '普通表单输入可在重新打开时恢复；重置会清除保存值。自定义交互状态不一定恢复。' : 'Ordinary form inputs can be restored on reopen. Reset clears saved values. Custom interactions may start over.')
        : (zh ? '暂停后可继续使用当前输入。' : 'Resume retains inputs from this view.')}</p>
      <button type="button" className="clawGenuiHtmlReset" disabled={resetting || bootState === undefined}
        title={zh ? '清除保存的输入并恢复初始值' : 'Clear saved inputs and restore initial values'}
        onClick={() => { void reset() }}>{zh ? '恢复初始值' : 'Restore initial values'}</button>
    </details>
  </section>
}
