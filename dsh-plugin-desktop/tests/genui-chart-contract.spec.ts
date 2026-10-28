import { describe, expect, it } from 'vitest'
import { GENUI_FORMAT, GENUI_LIMITS, type GenuiChart } from '../src/genui-contract.ts'
import { genuiText, validateGenuiDocument } from '../src/genui-core.ts'

const chart: GenuiChart = { type: 'chart', kind: 'bar', title: '服务请求', categories: ['API', 'Worker', 'Cache'],
  series: [{ name: '请求', values: [20, null, 0] }], unit: '次' }
const doc = (node: unknown = chart) => ({ format: GENUI_FORMAT, title: '报告', items: [node] })

describe('GenUI chart protocol', () => {
  it.each(['bar', 'line', 'pie'] as const)('preserves %s data in metadata and text without mutation', kind => {
    const input = doc({ ...chart, kind, series: [{ name: '请求', values: [20, 4, 0] }] })
    const before = structuredClone(input)
    const parsed = validateGenuiDocument(input)
    expect(parsed.ok).toBe(true)
    expect(input).toEqual(before)
    if (!parsed.ok) throw new Error('Invalid fixture')
    expect(parsed.document.items).toEqual(input.items)
    expect(genuiText(parsed.document)).toContain('服务请求 (次)\n请求\nAPI: 20\nWorker: 4\nCache: 0')
  })

  it('distinguishes negative, zero and missing data, including multiple series', () => {
    const parsed = validateGenuiDocument(doc({ ...chart, kind: 'line', series: [
      { name: '实际', values: [-2.5, null, 0] }, { name: '目标', values: [10, 10, 10] },
    ] }))
    expect(parsed.ok).toBe(true)
    if (parsed.ok) expect(genuiText(parsed.document)).toContain('API: -2.5 | 10\nWorker: — | 10\nCache: 0 | 10')
  })

  it.each([
    [{ ...chart, kind: 'scatter' }, '$.items[0].kind'],
    [{ ...chart, title: ' ' }, '$.items[0].title'],
    [{ ...chart, option: { tooltip: { formatter: '<script>' } } }, '$.items[0].option'],
    [{ ...chart, categories: ['API', 'API', 'Cache'] }, '$.items[0].categories'],
    [{ ...chart, categories: ['API', '', 'Cache'] }, '$.items[0].categories[1]'],
    [{ ...chart, categories: Array(61).fill('A') }, '$.items[0].categories'],
    [{ ...chart, series: [] }, '$.items[0].series'],
    [{ ...chart, series: Array(5).fill(chart.series[0]) }, '$.items[0].series'],
    [{ ...chart, series: [{ name: '请求', values: [1, 2] }] }, '$.items[0].series[0].values'],
    [{ ...chart, series: [{ name: '请求', values: [1, '2', 3] }] }, '$.items[0].series[0].values[1]'],
    [{ ...chart, series: [{ name: '请求', values: [1e16, 2, 3] }] }, '$.items[0].series[0].values[0]'],
    [{ ...chart, series: [{ name: '', values: [1, 2, 3] }] }, '$.items[0].series[0].name'],
    [{ ...chart, series: [{ ...chart.series[0], action: 'run' }] }, '$.items[0].series[0].action'],
    [{ ...chart, series: [chart.series[0], chart.series[0]] }, '$.items[0].series'],
    [{ ...chart, kind: 'pie' }, '$.items[0].series[0].values[1]'],
    [{ ...chart, kind: 'pie', series: [{ name: '请求', values: [-1, 2, 3] }] }, '$.items[0].series[0].values[0]'],
    [{ ...chart, kind: 'pie', series: [chart.series[0], chart.series[0]] }, '$.items[0].series'],
    [{ ...chart, kind: 'pie', categories: Array.from({ length: 13 }, (_, i) => String(i)) }, '$.items[0].categories'],
  ])('rejects unsupported, ambiguous or oversized chart inputs with field diagnostics', (node, path) => {
    expect(validateGenuiDocument(doc(node))).toMatchObject({ ok: false,
      diagnostics: expect.arrayContaining([expect.objectContaining({ path })]) })
  })

  it('keeps empty and zero-sum datasets honest, and caps chart instances', () => {
    expect(validateGenuiDocument(doc({ ...chart, categories: [], series: [{ name: '请求', values: [] }] })).ok).toBe(true)
    expect(validateGenuiDocument(doc({ ...chart, kind: 'pie', series: [{ name: '请求', values: [0, 0, 0] }] })).ok).toBe(true)
    expect(validateGenuiDocument({ ...doc(), items: Array(GENUI_LIMITS.charts).fill(chart) }).ok).toBe(true)
    expect(validateGenuiDocument({ ...doc(), items: Array(GENUI_LIMITS.charts + 1).fill(chart) })).toMatchObject({ ok: false })
  })
})
