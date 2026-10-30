import { useMemo, useState, type ReactNode } from 'react'
import type { GenuiCell, GenuiNode } from '../genui-contract.ts'
import { validateGenuiDocument } from '../genui-core.ts'
import { GenuiHtmlView } from './genui-html.tsx'
import { GenuiChartView } from './genui-chart.tsx'
import { genuiLayout, genuiSurfaces, type GenuiLayoutNode } from './genui-layout.ts'

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

function renderNode(entry: GenuiLayoutNode, label: string, zh: boolean, identity: { sessionId: string; callId: string; path: string }, repair?: () => Promise<void>, nestedCard = false, prose = false): ReactNode {
  const { node, key } = entry
  const title = node.type === 'card' && entry.continuation ? `${node.title}${zh ? '（续）' : ' (continued)'}` : node.type === 'card' ? node.title : ''
  switch (node.type) {
    case 'html': return <GenuiHtmlView key={key} node={node} zh={zh} identity={{ ...identity, path: entry.path }} {...(repair === undefined ? {} : { repair })} />
    case 'chart': return <GenuiChartView key={key} node={node} zh={zh} />
    case 'text': return <p key={key}>{node.content}</p>
    case 'card': return <section key={key} className={prose ? 'clawGenuiProse' : 'clawGenuiCard'} aria-label={node.title}>{nestedCard ? <h4>{title}</h4> : <h3>{title}</h3>}{entry.children?.map(child => renderNode(child, node.title, zh, identity, repair, true, prose))}</section>
    case 'row': return <div key={key} className={prose ? 'clawGenuiProse' : 'clawGenuiRow'}>{entry.children?.map(child => renderNode(child, label, zh, identity, repair, nestedCard, prose))}</div>
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
  repair?: () => Promise<void>
}

/** Only durable result metadata is eligible; never render incomplete tool args. */
export function GenuiResultView({ sessionId, callId, meta, text, isError, zh = false, repair }: GenuiResultViewProps) {
  const parsed = useMemo(() => isError ? undefined : validateGenuiDocument(meta), [isError, meta])
  if (!parsed?.ok) return <div className="clawGenuiFallback">
    {!isError && <p className="clawGenuiDiagnostic">{zh ? '此卡片无法显示，以下为保存的文本结果。' : 'This card is unavailable. The saved text result follows.'}</p>}
    <pre className="clawGenuiFallback">{text}</pre>
  </div>
  const surfaces = genuiSurfaces(genuiLayout(parsed.document.items))
  let titled = false
  return <section className={`clawGenui clawGenuiResult${surfaces.every(group => group.nodes.length === 1 && group.nodes[0]!.node.type === 'html') ? ' clawGenuiInline' : ''}`} data-genui-session={sessionId} data-genui-call={callId} aria-label={parsed.document.title}>
    {surfaces.map(({ kind, nodes }) => {
      const first = nodes[0]!
      const content = nodes.map(entry => renderNode(entry, parsed.document.title, zh, { sessionId, callId, path: entry.path }, repair, false, kind === 'prose'))
      if (kind === 'independent') return content
      if (kind === 'prose') return <section key={`prose:${first.key}`} className="clawGenuiProse" aria-label={first.node.type === 'card' ? first.node.title : parsed.document.title}>{content}</section>
      const showTitle = !titled
      titled = true
      return <section key={`surface:${first.key}`} className="clawGenuiSurface" aria-label={parsed.document.title}>
        {showTitle && <h3>{parsed.document.title}</h3>}{content}
      </section>
    })}
  </section>
}
