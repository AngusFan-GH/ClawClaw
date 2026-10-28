import { init, use } from 'echarts/core'
import { BarChart, LineChart, PieChart } from 'echarts/charts'
import { AriaComponent, GridComponent, TooltipComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'

use([BarChart, LineChart, PieChart, AriaComponent, GridComponent, TooltipComponent, SVGRenderer])

/** SVG needs no GPU, remote asset or Electron privilege; the same engine supports headless QA. */
export function createGenuiChart(container: HTMLElement | null, options: { width: number; height: number; ssr?: boolean }) {
  return init(container, undefined, { ...options, renderer: 'svg' })
}
