import type { ComposeOption } from 'echarts/core'
import type { BarSeriesOption, LineSeriesOption, PieSeriesOption } from 'echarts/charts'
import type { AriaComponentOption, GridComponentOption, TooltipComponentOption } from 'echarts/components'
import type { GenuiChart } from '../genui-contract.ts'

export type GenuiChartOption = ComposeOption<BarSeriesOption | LineSeriesOption | PieSeriesOption
  | AriaComponentOption | GridComponentOption | TooltipComponentOption>

export interface GenuiChartPalette { text: string; border: string; colors: string[] }
export const GENUI_CHART_LIGHT: GenuiChartPalette = { text: '#262626', border: '#d9d9d9', colors: ['#1668dc', '#08979c', '#ad6800', '#722ed1'] }
export const GENUI_CHART_DARK: GenuiChartPalette = { text: '#f0f0f0', border: '#434343', colors: ['#69b1ff', '#5cdbd3', '#ffc53d', '#b37feb'] }

export function chartKeys(chart: GenuiChart): string[] {
  return chart.kind === 'pie' ? chart.categories : chart.series.map(series => series.name)
}

export type ChartEmptyReason = 'empty' | 'hidden' | 'missing' | 'zero'
export function chartEmptyReason(chart: GenuiChart, hidden: ReadonlySet<string>): ChartEmptyReason | undefined {
  if (!chart.categories.length) return 'empty'
  if (chartKeys(chart).every(key => hidden.has(key))) return 'hidden'
  const values = chart.kind === 'pie' ? chart.series[0]!.values.filter((_, i) => !hidden.has(chart.categories[i]!))
    : chart.series.filter(series => !hidden.has(series.name)).flatMap(series => series.values)
  if (values.every(value => value === null)) return 'missing'
  if (chart.kind === 'pie' && !values.some(value => value !== null && value > 0)) return 'zero'
  return undefined
}

export function chartHasData(chart: GenuiChart, hidden: ReadonlySet<string>): boolean {
  return chartEmptyReason(chart, hidden) === undefined
}

/** Keep category order and all source values; long comparisons scroll vertically. */
export function chartLayout(chart: GenuiChart) {
  const horizontal = chart.kind === 'bar' && (chart.categories.length > 8 || chart.categories.some(label => label.length > 12))
  return { horizontal, height: horizontal ? Math.max(240, chart.categories.length * 28 + 56) : 240,
    minWidth: chart.kind === 'line' && chart.categories.length > 12 ? chart.categories.length * 56 : 0 }
}

/** Build only trusted engine options. Model data never becomes an ECharts option or formatter. */
export function genuiChartOption(chart: GenuiChart, palette: GenuiChartPalette, hidden: ReadonlySet<string> = new Set()): GenuiChartOption {
  const base: GenuiChartOption = {
    animation: false, backgroundColor: 'transparent', color: palette.colors,
    textStyle: { color: palette.text, fontFamily: 'sans-serif' },
    aria: { enabled: true, label: { description: chart.title }, decal: { show: true } },
    tooltip: { trigger: chart.kind === 'pie' ? 'item' : 'axis', renderMode: 'richText', confine: true,
      valueFormatter: value => value === null ? '—' : `${String(value)}${chart.unit ? ` ${chart.unit}` : ''}` },
  }
  const layout = chartLayout(chart)
  if (chart.kind === 'pie') return {
    ...base,
    series: [{ type: 'pie', name: chart.series[0]!.name, radius: ['0%', '68%'], center: ['50%', '50%'],
      stillShowZeroSum: false, label: { show: false },
      data: chart.categories.flatMap((name, i) => hidden.has(name) ? [] : [{ name, value: chart.series[0]!.values[i]!, itemStyle: { color: palette.colors[i % palette.colors.length]! } }]),
    }],
  }
  const categoryAxis = { type: 'category' as const, data: chart.categories,
    axisLabel: { color: palette.text, interval: 0, width: layout.horizontal ? 140 : 90, overflow: 'truncate' as const,
      ...(layout.horizontal ? { lineHeight: 14, formatter: (label: string) => label.length > 12 ? `${label.slice(0, 8)}\n…${label.slice(-7)}` : label } : {}) },
    axisLine: { lineStyle: { color: palette.border } }, ...(layout.horizontal ? { inverse: true } : {}) }
  const valueAxis = { type: 'value' as const, ...(chart.unit ? { name: chart.unit, nameTextStyle: { color: palette.text } } : {}),
    axisLabel: { color: palette.text }, splitLine: { lineStyle: { color: palette.border } } }
  return {
    ...base,
    grid: { left: 12, right: 20, top: 28, bottom: 16, containLabel: true },
    xAxis: layout.horizontal ? valueAxis : categoryAxis,
    yAxis: layout.horizontal ? categoryAxis : valueAxis,
    series: chart.series.flatMap((series, i): Array<BarSeriesOption | LineSeriesOption> => {
      if (hidden.has(series.name)) return []
      const common = { name: series.name, data: series.values,
        itemStyle: { color: palette.colors[i % palette.colors.length]! } }
      return chart.kind === 'bar' ? [{ ...common, type: 'bar', barMaxWidth: 48 }]
        : [{ ...common, type: 'line', connectNulls: false, showSymbol: true, symbolSize: 6,
          lineStyle: { type: (['solid', 'dashed', 'dotted', 'solid'] as const)[i % 4]! } }]
    }),
  }
}
