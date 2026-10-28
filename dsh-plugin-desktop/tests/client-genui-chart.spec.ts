// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { GenuiChart } from '../src/genui-contract.ts'
import { GenuiChartView } from '../src/client/genui-chart.tsx'

const engine = vi.hoisted(() => ({ create: vi.fn() }))
vi.mock('../src/client/genui-chart-engine.ts', () => ({ createGenuiChart: engine.create }))
const roots: Root[] = []
const observers: Array<{ resize: () => void; disconnect: ReturnType<typeof vi.fn<() => void>> }> = []
const instances: Array<{ setOption: ReturnType<typeof vi.fn>; resize: ReturnType<typeof vi.fn>; dispose: ReturnType<typeof vi.fn> }> = []
let width = 640
const chart: GenuiChart = { type: 'chart', kind: 'bar', title: '服务请求', categories: ['API', 'Worker'],
  series: [{ name: '实际', values: [20, null] }, { name: '目标', values: [30, 0] }] }

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  width = 640
  engine.create.mockReset().mockImplementation(() => {
    const instance = { setOption: vi.fn(), resize: vi.fn(), dispose: vi.fn() }
    instances.push(instance); return instance
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => new DOMRect(0, 0, width, 300))
  vi.stubGlobal('ResizeObserver', class {
    entry: { resize: () => void; disconnect: ReturnType<typeof vi.fn<() => void>> }
    constructor(callback: () => void) { this.entry = { resize: callback, disconnect: vi.fn() }; observers.push(this.entry) }
    observe() {}
    disconnect() { this.entry.disconnect() }
  })
})
afterEach(async () => {
  for (const root of roots.splice(0)) await act(async () => root.unmount())
  document.body.replaceChildren()
  document.body.removeAttribute('data-ds-dark-theme')
  observers.splice(0); instances.splice(0)
  vi.restoreAllMocks(); vi.unstubAllGlobals()
})

async function mount(node = chart) {
  const element = document.createElement('div'); document.body.append(element)
  const root = createRoot(element); roots.push(root)
  await act(async () => root.render(createElement(GenuiChartView, { node, zh: true })))
  return { element, root }
}

describe('GenUI interactive chart', () => {
  it('toggles series locally while keeping the source data and readable table intact', async () => {
    const { element } = await mount()
    expect(element.querySelector('[role="img"]')?.getAttribute('aria-label')).toBe(chart.title)
    const buttons = element.querySelectorAll<HTMLButtonElement>('button')
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('true')
    await act(async () => buttons[0]!.click())
    expect(buttons[0]?.getAttribute('aria-pressed')).toBe('false')
    expect(instances[0]?.dispose).toHaveBeenCalledOnce()
    expect(instances[1]?.setOption.mock.calls[0]?.[0].series).toHaveLength(1)
    expect(instances[1]?.setOption.mock.calls[0]?.[0].series[0].name).toBe('目标')
    expect(chart.series).toHaveLength(2)
    const rows = Array.from(element.querySelectorAll('tbody tr')).map(row => row.textContent)
    expect(rows).toEqual(['API2030', 'Worker—0'])
    await act(async () => element.querySelector('summary')!.click())
    expect(element.querySelector('details')?.open).toBe(true)
    await act(async () => buttons[1]!.click())
    expect(element.querySelector('[role="status"]')?.textContent).toContain('已隐藏全部数据')
    await act(async () => buttons[0]!.click())
    expect(element.querySelector('[role="status"]')).toBeNull()
  })

  it('explains filtered pie shares, preserves original shares and restores all categories', async () => {
    const { element } = await mount({ ...chart, kind: 'pie', series: [{ name: '请求数', values: [20, 80] }] })
    const legend = element.querySelectorAll<HTMLButtonElement>('.clawGenuiChartLegend')
    expect(legend[0]!.textContent).toContain('20%')
    const before = element.querySelector('tbody')!.textContent
    await act(async () => legend[1]!.click())
    expect(legend[0]!.textContent).toContain('100%')
    expect(element.querySelector('.clawGenuiChartNote')!.textContent).toContain('当前显示类别重新计算')
    expect(element.querySelector('tbody')!.textContent).toBe(before)
    expect(element.querySelector('thead')!.textContent).toContain('占全部数据')
    await act(async () => element.querySelector<HTMLButtonElement>('.clawGenuiChartRestore')!.click())
    expect(legend[0]!.textContent).toContain('20%')
    expect(element.querySelector('.clawGenuiChartRestore')).toBeNull()
  })

  it('keeps single-series charts concise and distinguishes missing values from zero', async () => {
    const { element } = await mount({ ...chart, series: [{ name: '请求数', values: [null, null] }] })
    expect(element.querySelector('.clawGenuiChartLegendGroup')).toBeNull()
    expect(element.querySelector('[role="status"]')!.textContent).toContain('缺失不代表零')
    expect(element.querySelector('summary')!.textContent).toBe('查看数据')
  })

  it('waits for a visible container, resizes, follows theme changes and disposes on unmount', async () => {
    width = 0
    const { root } = await mount()
    expect(engine.create).not.toHaveBeenCalled()
    width = 420
    await act(async () => observers[0]!.resize())
    expect(engine.create).toHaveBeenCalledOnce()
    expect(instances[0]?.resize).toHaveBeenLastCalledWith({ width: 420, height: 240 })
    await act(async () => document.body.setAttribute('data-ds-dark-theme', ''))
    expect(instances[0]?.setOption.mock.calls.at(-1)?.[0].color).toContain('#69b1ff')
    await act(async () => root.unmount()); roots.splice(roots.indexOf(root), 1)
    expect(instances[0]?.dispose).toHaveBeenCalledOnce()
    expect(observers[0]?.disconnect).toHaveBeenCalledOnce()
  })

  it('shows a data fallback after an engine failure rather than losing the result', async () => {
    engine.create.mockImplementationOnce(() => {
      const instance = { setOption: vi.fn(() => { throw new Error('renderer failed') }), resize: vi.fn(), dispose: vi.fn() }
      instances.push(instance); return instance
    })
    const { element } = await mount()
    expect(element.querySelector('[role="status"]')?.textContent).toContain('图表暂时无法显示')
    expect(element.querySelector('tbody')?.textContent).toContain('API2030')
    expect(element.querySelector('details')?.open).toBe(true)
    expect(instances[0]?.dispose).toHaveBeenCalledOnce()
  })

  it.each([
    { ...chart, categories: [], series: [{ name: '实际', values: [] }] },
    { ...chart, kind: 'pie' as const, series: [{ name: '实际', values: [0, 0] }] },
  ])('renders empty and zero-sum charts without inventing a visual', async node => {
    const { element } = await mount(node)
    expect(engine.create).not.toHaveBeenCalled()
    expect(element.querySelector('[role="status"]')?.textContent).toMatch(/暂无数据|总和为零/)
  })
})
