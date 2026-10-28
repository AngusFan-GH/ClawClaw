import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { GenuiHtml } from '../genui-contract.ts'
import { createGenuiHtmlDocument, GENUI_HTML_CHANNEL } from './genui-html-document.ts'

function isDark(): boolean {
  return document.body.hasAttribute('data-ds-dark-theme') || document.documentElement.hasAttribute('data-ds-dark-theme')
}

export function GenuiHtmlView({ node, zh }: { node: GenuiHtml; zh: boolean }) {
  const frame = useRef<HTMLIFrameElement>(null)
  const [revision, setRevision] = useState(0)
  const [height, setHeight] = useState(240)
  const [status, setStatus] = useState<'loading' | 'ready' | 'error' | 'stopped'>('loading')
  const [fallbackOpen, setFallbackOpen] = useState(false)
  const srcDoc = useMemo(() => createGenuiHtmlDocument(node.html, { dark: isDark(), zh }), [node.html, zh])
  useEffect(() => {
    const observer = new MutationObserver(() => frame.current?.contentWindow?.postMessage({ channel: GENUI_HTML_CHANNEL, type: 'theme', value: isDark() }, '*'))
    for (const target of [document.body, document.documentElement]) observer.observe(target, {
      attributes: true, attributeFilter: ['data-ds-dark-theme'],
    })
    return () => observer.disconnect()
  }, [])
  useLayoutEffect(() => {
    if (status === 'stopped') return
    setStatus('loading')
    let ready = false
    const timeout = window.setTimeout(() => { if (!ready) setStatus('error') }, 8000)
    const receive = (event: MessageEvent<unknown>): void => {
      if (event.source !== frame.current?.contentWindow || event.origin !== 'null') return
      const data = event.data
      if (!data || typeof data !== 'object' || !('channel' in data) || data.channel !== GENUI_HTML_CHANNEL || !('type' in data)) return
      if (data.type === 'ready') { frame.current?.contentWindow?.postMessage({ channel: GENUI_HTML_CHANNEL, type: 'theme', value: isDark() }, '*'); ready = true; window.clearTimeout(timeout); setStatus(previous => previous === 'error' ? previous : 'ready') }
      if (data.type === 'error') { ready = true; window.clearTimeout(timeout); setStatus('error') }
      if (data.type === 'height' && 'value' in data && typeof data.value === 'number' && Number.isFinite(data.value)) {
        setHeight(Math.min(720, Math.max(120, Math.ceil(data.value))))
      }
    }
    window.addEventListener('message', receive)
    return () => { window.clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [srcDoc, revision, status === 'stopped'])
  const reset = (): void => { setHeight(240); setStatus('loading'); setRevision(value => value + 1) }
  return <section className="clawGenuiHtml" aria-label={node.title}>
    <div className="clawGenuiHtmlToolbar"><h4>{node.title}</h4><span className="clawGenuiChartNote">{zh ? '本地交互' : 'Local interaction'}</span>
      <button type="button" onClick={reset}>{zh ? '重置' : 'Reset'}</button>
      {status !== 'stopped' && <button type="button" onClick={() => setStatus('stopped')}>{zh ? '停止' : 'Stop'}</button>}
    </div>
    <p className="clawGenuiChartNote">{zh ? '仅在此片段内交互；重置或重新打开后恢复初始状态。' : 'Interactions stay in this snippet. Resetting or reopening restores its initial state.'}</p>
    {status === 'loading' && <p role="status">{zh ? '正在准备交互内容…' : 'Preparing interactive content…'}</p>}
    {status === 'error' && <p role="status">{zh ? '交互内容未能正常运行，可查看文字说明或重置。' : 'Interactive content could not run correctly. Read the description or reset.'}</p>}
    {status === 'stopped' ? <p role="status">{zh ? '已停止交互内容。' : 'Interactive content stopped.'}</p> : <iframe
      key={revision} ref={frame} title={node.title} srcDoc={srcDoc} sandbox="allow-scripts" referrerPolicy="no-referrer"
      allow="camera 'none'; microphone 'none'; geolocation 'none'; clipboard-read 'none'; clipboard-write 'none'; payment 'none'; usb 'none'"
      style={{ height, width: '100%', border: 0 }} />}
    <details open={status === 'error' || status === 'stopped' || fallbackOpen} onToggle={event => setFallbackOpen(event.currentTarget.open)}>
      <summary>{zh ? '文字说明' : 'Text description'}</summary><p>{node.fallback}</p>
    </details>
  </section>
}
