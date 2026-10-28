import { useEffect, useId, useRef, useState } from 'react'
import type { GenuiChart } from '../genui-contract.ts'
import { createGenuiChart } from './genui-chart-engine.ts'
import { chartEmptyReason, chartKeys, chartLayout, genuiChartOption, GENUI_CHART_DARK, GENUI_CHART_LIGHT, type GenuiChartPalette } from './genui-chart-options.ts'

function paletteOf(element: HTMLElement): GenuiChartPalette {
  const dark = document.body.hasAttribute('data-ds-dark-theme') || document.documentElement.hasAttribute('data-ds-dark-theme')
  const base = dark ? GENUI_CHART_DARK : GENUI_CHART_LIGHT
  const style = getComputedStyle(element)
  return { text: style.color || base.text, border: style.getPropertyValue('--dsw-alias-border-l2').trim() || base.border,
    colors: base.colors.map((fallback, i) => style.getPropertyValue(`--claw-chart-color-${i + 1}`).trim() || fallback) }
}

export function GenuiChartView({ node, zh }: { node: GenuiChart; zh: boolean }) {
  const dataId = useId()
  const [dataOpen, setDataOpen] = useState(false)
  const canvas = useRef<HTMLDivElement>(null)
  const [hidden, setHidden] = useState<ReadonlySet<string>>(new Set())
  const [failed, setFailed] = useState(false)
  const emptyReason = chartEmptyReason(node, hidden)
  const hasData = emptyReason === undefined
  const { height, minWidth } = chartLayout(node)
  const keys = chartKeys(node)
  const showLegend = node.kind === 'pie' || keys.length > 1
  const total = node.series[0]!.values.reduce<number>((sum, value) => sum + (value ?? 0), 0)
  const visibleTotal = node.kind === 'pie' ? node.series[0]!.values.reduce<number>((sum, value, i) =>
    sum + (hidden.has(node.categories[i]!) ? 0 : value ?? 0), 0) : total
  const percent = (value: number | null, sum: number) => sum > 0 && value !== null ? `${Number((value / sum * 100).toFixed(1))}%` : '—'
  const emptyText = zh ? {
    empty: '暂无数据。数据表中没有类别记录。', hidden: '已隐藏全部数据。恢复全部后可继续查看图表。',
    missing: '当前数据均为缺失值，无法绘制图表；缺失不代表零。', zero: '当前显示数据的总和为零，无法计算占比。',
  } : { empty: 'No data. There are no category records.', hidden: 'All data is hidden. Restore all to show the chart.',
    missing: 'All visible values are missing. Missing does not mean zero.', zero: 'Visible values sum to zero; proportions cannot be calculated.' }
  useEffect(() => {
    const element = canvas.current
    if (element === null) return
    setFailed(false)
    if (!hasData) return
    let chart: ReturnType<typeof createGenuiChart> | undefined
    let broken = false
    const paint = (): void => {
      if (broken) return
      const width = element.getBoundingClientRect().width
      if (width <= 0) return // Collapsed work details initialise when revealed.
      try {
        chart ??= createGenuiChart(element, { width, height })
        chart.setOption(genuiChartOption(node, paletteOf(element), hidden), { notMerge: true })
        chart.resize({ width, height })
      } catch {
        broken = true
        chart?.dispose(); chart = undefined
        setFailed(true)
      }
    }
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(paint)
    resize?.observe(element)
    const theme = new MutationObserver(paint)
    for (const target of [document.documentElement, document.body]) theme.observe(target, { attributes: true,
      attributeFilter: ['data-ds-dark-theme', 'style', 'class'] })
    window.addEventListener('resize', paint)
    paint()
    return () => { resize?.disconnect(); theme.disconnect(); window.removeEventListener('resize', paint); chart?.dispose() }
  }, [node, hidden, hasData, height])

  return <figure className="clawGenuiChart">
    <figcaption>{node.title}</figcaption>
    {showLegend && <div role="group" aria-label={zh ? '图例，点击显示或隐藏' : 'Legend, toggle visibility'}
      className="clawGenuiChartLegendGroup">
      {chartKeys(node).map((name, i) => <button key={name} type="button" className="clawGenuiChartLegend"
        aria-pressed={!hidden.has(name)} onClick={() => setHidden(previous => {
          const next = new Set(previous); if (next.has(name)) next.delete(name); else next.add(name); return next
        })}>
        <span aria-hidden="true" style={{ color: `var(--claw-chart-color-${i % 4 + 1}, ${GENUI_CHART_LIGHT.colors[i % 4]})` }}>●</span> {name}
        {node.kind === 'pie' && <span className="clawGenuiChartLegendValue">{node.series[0]!.values[i]}{node.unit ? ` ${node.unit}` : ''} · {hidden.has(name) ? (zh ? '已隐藏' : 'hidden') : percent(node.series[0]!.values[i]!, visibleTotal)}</span>}
      </button>)}
    </div>}
    {!showLegend && <p className="clawGenuiChartNote">{node.series[0]!.name}{node.unit ? ` (${node.unit})` : ''}</p>}
    {node.kind === 'pie' && <p className="clawGenuiChartNote">{zh
      ? (hidden.size ? '图形占比按当前显示类别重新计算；数据表保留全部类别及原始占比。' : '占比基于全部类别的总和；点击图例可隐藏类别。')
      : (hidden.size ? 'Chart shares use visible categories. The table retains all categories and original shares.' : 'Shares use the total of all categories. Toggle legends to hide categories.')}</p>}
    {hidden.size > 0 && <button className="clawGenuiChartRestore" type="button" onClick={() => setHidden(new Set())}>{zh ? '恢复全部' : 'Restore all'}</button>}
    <div className="clawGenuiChartScroll" tabIndex={hasData ? 0 : undefined} role="region" aria-label={zh ? `${node.title}，可滚动查看，精确数值见数据表` : `${node.title}, scroll to explore; exact values in the data table`}>
    <div ref={canvas} style={{ height, minWidth, width: '100%', display: hasData && !failed ? 'block' : 'none' }}
      role="img" aria-label={node.title} aria-describedby={dataId} />
    </div>
    {emptyReason && <p role="status">{emptyText[emptyReason]}</p>}
    {failed && <p role="status">{zh ? '图表暂时无法显示，请查看数据表。' : 'Chart unavailable. View the data table below.'}</p>}
    <details id={dataId} className="clawGenuiChartData" open={failed || dataOpen} onToggle={event => setDataOpen(event.currentTarget.open)}><summary>{zh ? '查看数据' : 'View data'}</summary>
      <div className="clawGenuiTable" tabIndex={0} role="region" aria-label={node.title}>
        <table aria-label={node.title}><thead><tr><th scope="col">{zh ? '类别' : 'Category'}</th>
          {node.series.map(series => <th scope="col" key={series.name}>{series.name}{node.unit ? ` (${node.unit})` : ''}</th>)}
          {node.kind === 'pie' && <th scope="col">{zh ? '占全部数据' : 'Share of all data'}</th>}
        </tr></thead><tbody>{node.categories.map((category, i) => <tr key={category}><th scope="row">{category}</th>
          {node.series.map(series => <td key={series.name} data-numeric={series.values[i] !== null || undefined}>{series.values[i] === null ? '—' : String(series.values[i])}</td>)}
          {node.kind === 'pie' && <td data-numeric="true">{percent(node.series[0]!.values[i]!, total)}</td>}
        </tr>)}</tbody></table>
      </div>
    </details>
  </figure>
}
