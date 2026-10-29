import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { genuiActivity, type GenuiActivity } from './genui-status.ts'
import { useMemo, useState, useSyncExternalStore, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { ChatSnapshot, ToolChatData, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { GENUI_ENTRY, GENUI_RENDER_TOOL, type GenuiCell, type GenuiNode, type GenuiSettings } from '../genui-contract.ts'
import { validateGenuiDocument } from '../genui-core.ts'
import { GenuiHtmlView } from './genui-html.tsx'
import { GenuiChartView } from './genui-chart.tsx'
import { GENUI_STYLES } from './genui-styles.ts'



type TableNode = Extract<GenuiNode, { type: 'table' }>
function cellText(cell: GenuiCell): string { return cell === null ? '' : String(cell) }
function compareCells(a: GenuiCell, b: GenuiCell): number {
  if (a === null) return b === null ? 0 : 1
  if (b === null) return -1
  return typeof a === 'number' && typeof b === 'number'
    ? a - b : cellText(a).localeCompare(cellText(b), undefined, { numeric: true })
}

function GenuiTable({ node, label }: { node: TableNode; label: string }) {
  const [sort, setSort] = useState<{ column: number; descending: boolean }>()
  const rows = node.rows.map((cells, index) => ({ cells, index }))
  const numeric = node.columns.map((_, column) => node.rows.some(row => typeof row[column] === 'number')
    && node.rows.every(row => row[column] === null || typeof row[column] === 'number'))
  if (sort !== undefined) rows.sort((a, b) => {
    const order = compareCells(a.cells[sort.column] ?? null, b.cells[sort.column] ?? null)
    return (sort.descending ? -order : order) || a.index - b.index
  })
  return <div className="clawGenuiTable" tabIndex={0} role="region" aria-label={label}>
    <table aria-label={label}>
      <thead><tr>{node.columns.map((column, index) => <th key={index} scope="col"
        data-numeric={numeric[index] || undefined} aria-sort={sort?.column === index ? sort.descending ? 'descending' : 'ascending' : 'none'}>
        <button type="button" onClick={() => setSort({ column: index, descending: sort?.column === index && !sort.descending })}>
          {column}<span className="clawGenuiSort" aria-hidden="true"><svg width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
            {sort?.column !== index ? <path d="m5 6 3-3 3 3M5 10l3 3 3-3" />
              : <path d={sort.descending ? 'm4 6 4 4 4-4' : 'm4 10 4-4 4 4'} />}
          </svg></span>
        </button>
      </th>)}</tr></thead>
      <tbody>{rows.map(({ cells, index }) => <tr key={index}>{cells.map((cell, c) => <td key={c} data-numeric={typeof cell === 'number' || undefined}>{cellText(cell)}</td>)}</tr>)}</tbody>
    </table>
  </div>
}

function renderNode(node: GenuiNode, key: number, label: string, zh: boolean, identity: { sessionId: string; callId: string; path: string }): ReactNode {
  switch (node.type) {
    case 'html': return <GenuiHtmlView key={key} node={node} zh={zh} identity={identity} />
    case 'chart': return <GenuiChartView key={key} node={node} zh={zh} />
    case 'text': return <p key={key}>{node.content}</p>
    case 'card': return <section key={key} className="clawGenuiCard"><h4>{node.title}</h4>{node.items.map((child, i) => renderNode(child, i, node.title, zh, { ...identity, path: `${identity.path}.${i}` }))}</section>
    case 'row': return <div key={key} className="clawGenuiRow">{node.items.map((child, i) => renderNode(child, i, label, zh, { ...identity, path: `${identity.path}.${i}` }))}</div>
    case 'stat': return <div key={key} className="clawGenuiStat"><span>{node.label}</span><strong>{node.value}</strong></div>
    case 'table': return <GenuiTable key={key} node={node} label={label} />
    case 'progress': return <div key={key} className="clawGenuiProgress"><div className="clawGenuiProgressLabel"><span>{node.label}</span><span className="clawGenuiProgressValue">{node.value}%</span></div><progress aria-label={node.label} value={node.value} max={100} /></div>
    case 'callout': {
      const tones = zh ? { info: '提示', success: '成功', warning: '注意', error: '错误' } : { info: 'Info', success: 'Success', warning: 'Warning', error: 'Error' }
      return <aside key={key} className="clawGenuiCallout" data-tone={node.tone}><div className="clawGenuiTone"><span aria-hidden="true"><svg width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round"><circle cx="8" cy="8" r="6" /><path d={{ info: 'M8 7v4M8 4.5v.1', success: 'm5 8 2 2 4-4', warning: 'M8 4v5M8 11.5v.1', error: 'm6 6 4 4M10 6l-4 4' }[node.tone]} /></svg></span> {tones[node.tone]}</div>{node.content}</aside>
    }
    case 'steps': return <ol key={key}>{node.steps.map((step, i) => <li key={i}>{step}</li>)}</ol>
  }
}

export interface GenuiResultViewProps {
  sessionId: string
  callId: string
  meta: unknown
  text: string
  isError: boolean
  zh?: boolean
}

/** Only durable result metadata is eligible; never render incomplete tool args. */
export function GenuiResultView({ sessionId, callId, meta, text, isError, zh = false }: GenuiResultViewProps) {
  const parsed = useMemo(() => isError ? undefined : validateGenuiDocument(meta), [isError, meta])
  if (!parsed?.ok) return <div className="clawGenuiFallback">
    {!isError && <p className="clawGenuiDiagnostic">{zh ? '此卡片无法显示，以下为保存的文本结果。' : 'This card is unavailable. The saved text result follows.'}</p>}
    <pre className="clawGenuiFallback">{text}</pre>
  </div>
  const inline = parsed.document.items.every(node => node.type === 'html')
  return <section className={inline ? 'clawGenui clawGenuiInline' : 'clawGenui'} data-genui-session={sessionId} data-genui-call={callId} aria-label={parsed.document.title}>
    {!inline && <h3>{parsed.document.title}</h3>}
    {parsed.document.items.map((node, i) => renderNode(node, i, parsed.document.title, zh, { sessionId, callId, path: String(i) }))}
  </section>
}

export function GenuiToolView(props: ToolCallViewProps & { zh?: boolean }) {
  if (props.phase !== 'result') return <p role="status">{props.zh ? '正在生成交互内容…' : 'Generating interactive content…'}</p>
  return <GenuiResultView key={JSON.stringify([props.sessionId, props.callId])}
    sessionId={String(props.sessionId)} callId={props.callId} meta={props.block.meta} isError={props.block.isError}
    text={props.block.content.filter(block => block.type === 'text').map(block => block.text).join('\n')} zh={props.zh ?? false} />
}

/** Preserve independent results, replace only explicit IDs, and retain original display order. */
export function genuiResults(tools: readonly ToolChatData[]): ToolResultNode[] {
  const calls = new Map<string, ToolResultNode>()
  const visit = (block: ToolChatData['root']): void => {
    if ('kind' in block && block.name === GENUI_RENDER_TOOL && !block.isError) {
      const previous = calls.get(block.callId)
      if (!previous || block.seq > previous.seq) calls.set(block.callId, block)
    }
    for (const child of block.subCalls) visit(child)
  }
  for (const tool of tools) visit(tool.root)
  const results = new Map<string, ToolResultNode>()
  for (const result of [...calls.values()].sort((a, b) => a.seq - b.seq)) {
    const parsed = validateGenuiDocument(result.meta)
    // Invalid updates must not replace a working result; their saved text stays visible separately.
    const id = parsed.ok ? parsed.document.resultId : undefined
    results.set(id === undefined ? `call:${result.callId}` : `result:${id}`, result)
  }
  return [...results.values()]
}

/** Retained for callers that need the last successful tool event. */
export function latestGenuiResult(tools: readonly ToolChatData[]): ToolResultNode | undefined {
  return genuiResults(tools).reduce<ToolResultNode | undefined>((latest, result) =>
    latest === undefined || result.seq > latest.seq ? result : latest, undefined)
}

export type GenuiTurnTailProps = PropsRuntime<'conversation.chat.turnTail'> & {
  chat: ObservableSnapshot<ChatSnapshot | undefined>
  zh: boolean
  retry?: (turn: number) => Promise<void>
}

const EMPTY_TOOL_DATA: readonly ToolChatData[] = []
const EMPTY_TOOL_SOURCE: ObservableSnapshot<readonly ToolChatData[]> = {
  getSnapshot: () => EMPTY_TOOL_DATA, subscribe: () => () => {},
}

function GenuiStatus({ activity, zh, retry, hasResults }: { activity: GenuiActivity; zh: boolean; retry: (() => Promise<void>) | undefined; hasResults: boolean }) {
  const [attempt, setAttempt] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const message = activity === 'redirecting' ? (zh ? '正在改为对话内展示…' : 'Preparing an inline result…')
    : activity === 'generating' ? (zh ? '正在生成交互内容…' : 'Generating interactive content…')
    : hasResults ? (zh ? '部分交互内容未能显示，已保留可用结果。' : 'Some interactive content could not be displayed. Available results are kept.')
    : (zh ? '交互内容未能显示，可重试展示。' : 'Interactive content could not be displayed. You can retry.')
  return <div className="clawGenuiStatus" role="status"><span>{message}</span>
    {activity === 'failed' && retry && <button type="button" disabled={attempt === 'sending' || attempt === 'sent'} onClick={() => {
      setAttempt('sending')
      void retry().then(() => setAttempt('sent')).catch(() => setAttempt('error'))
    }}>{attempt === 'sending' ? (zh ? '正在提交…' : 'Submitting…') : attempt === 'sent' ? (zh ? '已提交重试' : 'Retry submitted') : (zh ? '重试展示' : 'Retry display')}</button>}
    {attempt === 'error' && <span>{zh ? '重试未能提交，请再试一次。' : 'Retry could not be submitted. Please try again.'}</span>}
  </div>
}

/** The completed answer's public tail stays visible when its process is collapsed. */
export function GenuiTurnTail({ chat, sessionId, turn, zh, retry }: GenuiTurnTailProps) {
  const snapshot = useSyncExternalStore(listener => chat.subscribe(listener), () => chat.getSnapshot())
  const tools = snapshot?.nodes.turnDataSource(turn.turn, 'tool-call') ?? EMPTY_TOOL_SOURCE
  const data = useSyncExternalStore(listener => tools.subscribe(listener), () => tools.getSnapshot())
  const results = genuiResults(data)
  const activity = turn.status === 'unknown' ? undefined : genuiActivity(data, turn.status === 'closed' || (snapshot?.legacy?.turnEnds.has(turn.turn) ?? false))
  if (results.length === 0 && activity === undefined) return null
  return <div className="clawGenuiResults">
    {activity && <GenuiStatus activity={activity} zh={zh} retry={retry ? () => retry(turn.turn) : undefined} hasResults={results.length > 0} />}
    {results.map(result => <GenuiResultView key={JSON.stringify([sessionId, result.callId])}
    sessionId={String(sessionId)} callId={result.callId} meta={result.meta} isError={false}
    text={result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')} zh={zh} />)}</div>
}

/** Follow the confirmed Host setting; disabled mode registers no presentation. */
export function applyDesktopGenui(ctx: Context): void {
  ctx.inject(['slots', 'configForms', 'locale', 'uiConversation', 'sessions', 'conversation'], scope => {
    const settings = scope.configForms.get<GenuiSettings>(GENUI_ENTRY)
    scope.effect(() => {
      let dispose: (() => void) | undefined
      const reconcile = (): void => {
        if (settings.getSnapshot().value?.enabled !== true) { dispose?.(); dispose = undefined; return }
        if (dispose !== undefined) return
        const style = document.createElement('style')
        style.dataset.clawGenui = ''
        style.textContent = GENUI_STYLES
        document.head.appendChild(style)
        try {
          const stopTool = scope.slots.inject('tool.call.toolview', () => scope.slots.register({
            name: 'tool.call.toolview', key: GENUI_RENDER_TOOL,
          }, function LocalizedGenuiToolView(props) {
            const locale = useSyncExternalStore(listener => scope.locale.subscribe(listener), () => scope.locale.getSnapshot())
            return <GenuiToolView {...props} zh={locale.active.startsWith('zh')} />
          }))
          let stopTail: () => void
          try {
            stopTail = scope.slots.inject('conversation.chat.turnTail', () => scope.slots.register({
              name: 'conversation.chat.turnTail', id: GENUI_ENTRY, order: 0,
              inject: sessionId => ({ chat: scope.uiConversation.binding(sessionId).target('chat'),
                retry: async (failedTurn: number) => {
                  const sessions = scope.get('sessions') as unknown as ISessions
                  const sessionScope = sessions.scope(sessionId)
                  if (!sessionScope) throw new Error('Conversation unavailable')
                  const conversation = (sessionScope as unknown as Context).conversation
                  const zh = scope.locale.getSnapshot().active.startsWith('zh')
                  await conversation.send(zh
                    ? `请在当前对话中重新展示第 ${failedTurn} 轮未能显示的交互内容。沿用原对话语言，直接使用内联渲染，保留已有说明，不要用浏览器页面代替。`
                    : `Retry the interactive content that failed to display in turn ${failedTurn} of this conversation. Keep the original conversation language and explanation. Render inline instead of opening a browser.`)
                },
              }),
            }, function LocalizedGenuiTurnTail(props) {
              const locale = useSyncExternalStore(listener => scope.locale.subscribe(listener), () => scope.locale.getSnapshot())
              return <GenuiTurnTail {...props} zh={locale.active.startsWith('zh')} />
            }))
          } catch (cause) { stopTool(); throw cause }
          dispose = () => { stopTail(); stopTool(); style.remove() }
        } catch (cause) { style.remove(); throw cause }
      }
      const stop = settings.subscribe(reconcile)
      try { reconcile() } catch (cause) { stop(); throw cause }
      return () => { stop(); dispose?.() }
    }, 'desktop: optional GenUI result cards')
  })
}
