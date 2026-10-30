import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { validHtmlState, type GenuiHtmlState, type GenuiStateIdentity } from '../genui-state-contract.ts'
import { htmlStateStorage, type HtmlStateStorage } from './genui-html-state.ts'
import type { GenuiHtml } from '../genui-contract.ts'
import { createGenuiHtmlDocument, genuiHtmlDownloadName, GENUI_HTML_CHANNEL } from './genui-html-document.ts'

function isDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme') || document.documentElement.hasAttribute('data-ds-dark-theme')
}

export function GenuiHtmlView({ node, zh, identity, storage, repair }: { node: GenuiHtml; zh: boolean;
  identity?: Omit<GenuiStateIdentity, 'sourceHash'>; storage?: HtmlStateStorage; repair?: () => Promise<void> }) {
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
  const container = useRef<HTMLElement>(null)
  const [fullscreen, setFullscreen] = useState(false)
  const [actionError, setActionError] = useState<'fullscreen' | 'download'>()
  const [revision, setRevision] = useState(0)
  const [height, setHeight] = useState(240)
  const [width, setWidth] = useState<number | undefined>(640)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error'>('loading')
  const [interactionError, setInteractionError] = useState(false)
  const [repairAttempt, setRepairAttempt] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const srcDoc = useMemo(() => createGenuiHtmlDocument(node.html, { dark: isDark(), zh, state: bootState ?? null }), [node.html, zh, bootState])
  useEffect(() => {
    const update = () => setFullscreen(document.fullscreenElement === container.current)
    document.addEventListener('fullscreenchange', update)
    return () => document.removeEventListener('fullscreenchange', update)
  }, [])
  useEffect(() => {
    const observer = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ channel: GENUI_HTML_CHANNEL, type: 'theme', value: isDark() }, '*'))
    for (const target of [document.body, document.documentElement]) observer.observe(target, {
      attributes: true, attributeFilter: ['data-ds-dark-theme'],
    })
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (bootState === undefined) return
    setStatus('loading'); setInteractionError(false)
    let ready = false
    let startupFailed = false
    const timeout = window.setTimeout(() => { if (!ready) { startupFailed = true; setStatus('error') } }, 8000)
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return
      const data = event.data
      if (!data || typeof data !== 'object' || !('channel' in data) || data.channel !== GENUI_HTML_CHANNEL || !('type' in data)) return
      if (data.type === 'ready') { frame.current?.contentWindow?.postMessage({ channel: GENUI_HTML_CHANNEL, type: 'theme', value: isDark() }, '*'); ready = true; window.clearTimeout(timeout); setStatus(previous => previous === 'error' ? previous : 'ready') }
      if (data.type === 'error') {
        window.clearTimeout(timeout)
        if (ready && !startupFailed) { setInteractionError(true); setFallbackOpen(true) }
        else { startupFailed = true; setStatus('error') }
      }
      if (data.type === 'state-error') setSaveError('unsupported')
      if (data.type === 'state' && 'value' in data && !ignoreState.current) {
        if (!validHtmlState(data.value)) { setSaveError('unsupported'); return }
        latest.current = data.value
        if (persistence) void persistence.save(data.value).then(() => setSaveError(undefined)).catch(() => setSaveError('save'))
      }
      if (data.type === 'width' && 'value' in data && document.fullscreenElement !== container.current) {
        if (data.value === null) setWidth(undefined)
        else if (typeof data.value === 'number' && Number.isFinite(data.value)) setWidth(Math.min(960, Math.max(320, Math.ceil(data.value))))
      }
      if (data.type === 'height' && 'value' in data && typeof data.value === 'number' && Number.isFinite(data.value)) {
        if (document.fullscreenElement !== container.current) setHeight(Math.min(720, Math.max(120, Math.ceil(data.value))))
      }
    }
    window.addEventListener('message', receive)
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [srcDoc, revision, bootState === undefined, persistence])
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
  const requestRepair = (): void => {
    if (!repair || repairAttempt === 'sending' || repairAttempt === 'sent') return
    setRepairAttempt('sending')
    void repair().then(() => setRepairAttempt('sent')).catch(() => setRepairAttempt('error'))
  }
  const toggleFullscreen = async (): Promise<void> => {
    setActionError(undefined)
    try {
      if (document.fullscreenElement === container.current) await document.exitFullscreen()
      else await container.current?.requestFullscreen()
    } catch { setActionError('fullscreen') }
  }
  const download = (): void => {
    setActionError(undefined)
    try {
      const html = createGenuiHtmlDocument(node.html, { dark: isDark(), zh, state: latest.current, standalone: true, title: node.title })
      const url = URL.createObjectURL(new Blob([html], { type: 'text/html;charset=utf-8' }))
      window.setTimeout(() => URL.revokeObjectURL(url), 1000)
      const link = document.createElement('a')
      link.href = url; link.download = genuiHtmlDownloadName(node.title)
      document.body.append(link)
      try { link.click() } finally { link.remove() }
    } catch { setActionError('download') }
  }
  const repairButton = repair && <button type="button" title={zh ? '请求助手在后续回答中重新生成内容' : 'Ask the assistant to regenerate this content in a follow-up answer'} disabled={repairAttempt === 'sending' || repairAttempt === 'sent'} onClick={requestRepair}>
    {repairAttempt === 'sending' ? (zh ? '正在发送…' : 'Sending…') : repairAttempt === 'sent' ? (zh ? '已发送请求' : 'Request sent') : (zh ? '请求重新生成' : 'Request regeneration')}
  </button>
  return <section ref={container} className="clawGenuiHtml" aria-label={node.title} style={{ maxWidth: fullscreen ? undefined : width }}>
    <div className="clawGenuiHtmlToolbar"><h3>{node.title}</h3>
      <button type="button" aria-label={fullscreen ? (zh ? '退出全屏' : 'Exit fullscreen') : (zh ? '全屏' : 'Fullscreen')}
        title={fullscreen ? (zh ? '退出全屏' : 'Exit fullscreen') : (zh ? '全屏' : 'Fullscreen')} onClick={() => { void toggleFullscreen() }}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d={fullscreen ? 'M6 1v5H1m14 4h-5v5M6 6 1 1m9 9 5 5' : 'M1 6V1h5m4 14h5v-5M1 1l5 5m9 9-5-5'} />
        </svg>
      </button>
      <button type="button" aria-label={zh ? '下载 HTML' : 'Download HTML'} title={zh ? '下载 HTML' : 'Download HTML'}
        disabled={bootState === undefined} onClick={download}>
        <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="M8 1v9m-3-3 3 3 3-3M2 10v4h12v-4" />
        </svg>
      </button>
    </div>
    {actionError && <p className="clawGenuiHtmlNotice" role="status">{actionError === 'fullscreen'
      ? (zh ? '无法进入或退出全屏，请重试。' : 'Could not change fullscreen mode. Try again.')
      : (zh ? '下载未能开始，请重试。' : 'The download could not start. Try again.')}</p>}
    {interactionError && <p className="clawGenuiHtmlNotice" role="status">
      <span>{zh ? '部分操作执行出错，其余内容仍可使用。' : 'An interaction failed. The remaining content is still available.'}</span>{repairButton}
    </p>}
    {repairAttempt === 'sent' && <p className="clawGenuiChartNote" role="status">{zh ? '请在后续回答中查看重新生成的内容。' : 'Look for the regenerated content in a follow-up answer.'}</p>}
    {repairAttempt === 'error' && <p className="clawGenuiHtmlNotice" role="status">{zh ? '重新生成请求发送失败，请再试一次。' : 'The regeneration request could not be sent. Try again.'}</p>}
    {saveError && <p className="clawGenuiHtmlNotice" role="status">
      {saveError === 'unsupported'
        ? (zh ? '部分输入无法保存，可继续使用当前内容。' : 'Some inputs cannot be saved. You can keep using this view.')
        : saveError === 'reset' ? (zh ? '未能恢复初始值。' : 'Could not restore initial values.') : (zh ? '保存失败。' : 'Could not save inputs.')}
      {saveError !== 'unsupported' && <button type="button" disabled={retrying || resetting} onClick={() => { void (saveError === 'reset' ? reset() : retrySave()) }}>{saveError === 'reset' ? (resetting ? (zh ? '正在恢复…' : 'Restoring…') : (zh ? '重试恢复' : 'Retry reset')) : (retrying ? (zh ? '正在保存…' : 'Saving…') : (zh ? '重试保存' : 'Retry save'))}</button>}
    </p>}
    <div className="clawGenuiHtmlViewport" style={{ height: fullscreen ? undefined : height }} aria-busy={status === 'loading' && !loadError}>
      {(loadError || status === 'loading' || status === 'error') && <div className="clawGenuiHtmlPlaceholder" role="status">
        {loadError ? <><p>{zh ? '无法读取已保存的输入。' : 'Saved inputs could not be loaded.'}</p><button type="button" onClick={() => setLoadAttempt(value => value + 1)}>{zh ? '重新读取输入' : 'Reload saved inputs'}</button></>
          : status === 'error' ? <><p>{zh ? '交互内容暂时无法运行，可查看下方说明。' : 'Interactive content could not run. Read the description below.'}</p>{repairButton || <button type="button" title={zh ? '重新运行当前内容，保留已保存的输入' : 'Run the current content again with saved inputs'} onClick={() => restart(latest.current)}>{zh ? '重新加载内容' : 'Reload content'}</button>}</>
          : <p>{zh ? '正在准备交互内容…' : 'Preparing interactive content…'}</p>}
      </div>}
      {bootState !== undefined && <iframe
        key={revision} ref={frame} title={node.title} srcDoc={srcDoc} sandbox="allow-scripts" referrerPolicy="no-referrer"
        allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'"
        style={{ height: fullscreen ? '100%' : height, width: '100%', border: 0, visibility: status === 'ready' ? 'visible' : 'hidden' }} />}
    </div>
    <details open={status === 'error' || loadError || fallbackOpen} onToggle={event => setFallbackOpen(event.currentTarget.open)}>
      <summary>{zh ? '说明' : 'Description'}</summary><p>{node.fallback}</p><p className="clawGenuiChartNote">{persistence
        ? (zh ? '普通表单输入可在重新打开时恢复；重置会清除保存值。自定义交互状态不一定恢复。' : 'Ordinary form inputs can be restored on reopen. Reset clears saved values. Custom interactions may start over.')
        : (zh ? '恢复初始值会清除当前输入。' : 'Restoring initial values clears the current inputs.')}</p>
      <button type="button" className="clawGenuiHtmlReset" disabled={resetting || bootState === undefined}
        title={zh ? '清除保存的输入并恢复初始值' : 'Clear saved inputs and restore initial values'}
        onClick={() => { void reset() }}>{zh ? '恢复初始值' : 'Restore initial values'}</button>
    </details>
  </section>
}
