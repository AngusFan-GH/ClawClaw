import { describe, expect, it } from 'vitest'
import type { GenuiChart } from '../src/genui-contract.ts'
import { createGenuiChart } from '../src/client/genui-chart-engine.ts'
import { chartHasData, chartLayout, genuiChartOption, GENUI_CHART_DARK, GENUI_CHART_LIGHT } from '../src/client/genui-chart-options.ts'

const chart: GenuiChart = { type: 'chart', kind: 'bar', title: 'Service requests', categories: ['API', 'Worker', 'Cache'],
  series: [{ name: 'Requests', values: [20, 4, 100] }] }

describe('real ECharts SVG renderer', () => {
  it.each(['bar', 'line', 'pie'] as const)('renders %s without a browser, GPU or external resources', kind => {
    const instance = createGenuiChart(null, { ssr: true, width: 640, height: 300 })
    try {
      instance.setOption(genuiChartOption({ ...chart, kind }, GENUI_CHART_LIGHT))
      const svg = instance.renderToSVGString()
      expect(svg).toContain('<svg')
      expect(svg).toContain('<path')
      expect(svg).not.toMatch(/<(?:script|image|foreignObject)\b/i)
      expect(svg).not.toContain('NaN')
      expect(svg).not.toContain('Infinity')
    } finally { instance.dispose() }
    expect(instance.isDisposed()).toBe(true)
  })

  it('keeps model text literal and handles negative and missing points in the dark palette', () => {
    const instance = createGenuiChart(null, { ssr: true, width: 400, height: 300 })
    try {
      instance.setOption(genuiChartOption({ ...chart, kind: 'line', categories: ['<script>alert(1)</script>', 'Missing', 'Zero'],
        series: [{ name: '<img src=x>', values: [-20, null, 0] }] }, GENUI_CHART_DARK))
      const svg = instance.renderToSVGString()
      expect(svg).not.toMatch(/<(?:script|img|foreignObject)\b/i)
      expect(svg).not.toContain('NaN')
      expect(svg).toContain('#69b1ff')
    } finally { instance.dispose() }
  })

  it('uses only rich-text tooltips and preserves gaps and original palette identities when filtering', () => {
    const node: GenuiChart = { ...chart, kind: 'line', series: [chart.series[0]!, { name: 'Target', values: [0, null, -2] }] }
    const option = genuiChartOption(node, GENUI_CHART_LIGHT, new Set(['Requests']))
    expect(option.tooltip).toMatchObject({ renderMode: 'richText', confine: true })
    expect(option.series).toEqual([expect.objectContaining({ name: 'Target', data: [0, null, -2], connectNulls: false,
      itemStyle: { color: GENUI_CHART_LIGHT.colors[1] } })])
    expect(node.series).toHaveLength(2)
  })

  it('renders dense comparisons horizontally and keeps every category and long trend point', () => {
    const categories = Array.from({ length: 60 }, (_, i) => `Service ${i}`)
    const dense = { ...chart, categories, series: [{ name: 'Requests', values: categories.map((_, i) => i) }] }
    const option = genuiChartOption(dense, GENUI_CHART_LIGHT)
    expect(option.yAxis).toMatchObject({ type: 'category', data: categories, inverse: true })
    expect(option.xAxis).toMatchObject({ type: 'value' })
    expect(chartLayout(dense).height).toBeGreaterThan(440)
    expect(chartLayout({ ...dense, kind: 'line' }).minWidth).toBe(60 * 56)
    const instance = createGenuiChart(null, { ssr: true, width: 640, height: chartLayout(dense).height })
    try {
      instance.setOption(option)
      expect(instance.renderToSVGString()).toContain('Service 59')
    } finally { instance.dispose() }
    const long = genuiChartOption({ ...chart, categories: ['a very long category name', 'B', 'C'] }, GENUI_CHART_LIGHT)
    expect(long.yAxis).toMatchObject({ type: 'category', axisLabel: { formatter: expect.any(Function) } })
    const axis = long.yAxis as { axisLabel: { formatter: (label: string) => string } }
    expect(axis.axisLabel.formatter('background-task-processing-node-18')).toBe('backgrou\n…node-18')
  })

  it('never invents proportions for zero-sum pies or zeroes for missing data', () => {
    expect(chartHasData({ ...chart, kind: 'pie', series: [{ name: 'Requests', values: [0, 0, 0] }] }, new Set())).toBe(false)
    expect(chartHasData({ ...chart, series: [{ name: 'Requests', values: [null, null, null] }] }, new Set())).toBe(false)
    expect(chartHasData({ ...chart, series: [{ name: 'Requests', values: [0, 0, 0] }] }, new Set())).toBe(true)
    expect(chartHasData(chart, new Set(['Requests']))).toBe(false)
    const option = genuiChartOption({ ...chart, kind: 'pie' }, GENUI_CHART_LIGHT, new Set(['API']))
    expect(option.series).toEqual([expect.objectContaining({ stillShowZeroSum: false, data: [
      expect.objectContaining({ name: 'Worker', value: 4 }), expect.objectContaining({ name: 'Cache', value: 100 }),
    ] })])
  })
})
