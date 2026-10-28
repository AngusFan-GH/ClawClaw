import { describe, expect, it } from 'vitest'
import { GENUI_FORMAT, GENUI_LIMITS } from '../src/genui-contract.ts'
import { genuiText, validateGenuiDocument } from '../src/genui-core.ts'

const doc = (items: unknown[] = [{ type: 'text', content: 'Hello' }]) => ({ format: GENUI_FORMAT, title: 'Report', items })

describe('GenUI read-only protocol', () => {
  it('preserves optional revision identity while rejecting blank, oversized and non-string IDs', () => {
    expect(validateGenuiDocument({ ...doc(), resultId: 'service-status' })).toMatchObject({ ok: true, document: { resultId: 'service-status' } })
    for (const resultId of ['', '  ', 12, 'x'.repeat(161)]) {
      expect(validateGenuiDocument({ ...doc(), resultId })).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ path: '$.resultId' })]) })
    }
  })

  it('validates without mutating input and preserves every scalar in text fallback', () => {
    const input = doc([
      { type: 'row', items: [{ type: 'stat', label: 'Count', value: 0 }, { type: 'progress', label: 'Ready', value: 12.5 }] },
      { type: 'card', title: 'Details', items: [{ type: 'table', columns: ['A', 'B'], rows: [[false, null], [1, 'line\nbreak']] }] },
      { type: 'steps', steps: ['Check', 'Review'] }, { type: 'callout', content: '<script>literal</script>' },
    ])
    const before = structuredClone(input)
    const parsed = validateGenuiDocument(input)
    expect(input).toEqual(before)
    expect(parsed.ok).toBe(true)
    if (!parsed.ok) throw new Error('Expected valid document')
    const fallback = genuiText(parsed.document)
    expect(fallback).toContain('Count: 0')
    expect(fallback).toContain('Ready: 12.5%')
    expect(fallback).toContain('false | ')
    expect(fallback).toContain('1 | line\nbreak')
    expect(fallback).toContain('2. Review')
    expect(fallback).toContain('<script>literal</script>')
  })

  it.each([
    [{ ...doc(), format: 'clawclaw.genui/v2' }, '$.format'],
    [doc([{ type: 'text', content: 'ok', action: 'run' }]), '$.items[0].action'],
    [doc([{ type: 'input', value: 'secret' }]), '$.items[0].type'],
    [doc([{ type: 'text', content: 4 }]), '$.items[0].content'],
    [doc([{ type: 'progress', label: 'Wrong', value: 101 }]), '$.items[0].value'],
    [doc([{ type: 'table', columns: ['A'], rows: [[1, 2]] }]), '$.items[0].rows[0]'],
    [doc([{ type: 'table', columns: ['A'], rows: [[{ html: 'x' }]] }]), '$.items[0].rows[0][0]'],
    [doc([{ type: 'callout', content: 'x', tone: 'danger' }]), '$.items[0].tone'],
  ])('rejects malformed documents with field paths', (input, path) => {
    expect(validateGenuiDocument(input)).toMatchObject({ ok: false, diagnostics: expect.arrayContaining([expect.objectContaining({ path })]) })
  })

  it('rejects over-budget tails instead of silently truncating', () => {
    expect(validateGenuiDocument(doc(Array.from({ length: GENUI_LIMITS.nodes }, () => ({ type: 'text', content: '' })))).ok).toBe(true)
    expect(validateGenuiDocument(doc(Array.from({ length: GENUI_LIMITS.nodes + 1 }, () => ({ type: 'text', content: '' })))).ok).toBe(false)
    expect(validateGenuiDocument(doc([{ type: 'table', columns: ['A'], rows: Array.from({ length: 51 }, () => [1]) }])).ok).toBe(false)
    expect(validateGenuiDocument(doc([{ type: 'text', content: 'a'.repeat(2001) }])).ok).toBe(false)
    let nested: unknown = { type: 'text', content: 'leaf' }
    for (let i = 0; i < 8; i++) nested = { type: 'row', items: [nested] }
    expect(validateGenuiDocument(doc([nested])).ok).toBe(false)
  })

  it('bounds cyclic, deeply nested, non-JSON and escaped-byte inputs', () => {
    const cycle: unknown[] = []; cycle.push(cycle)
    for (const input of [cycle, undefined, NaN, { value: Infinity }, { value: () => 1 }, new Date(), doc([{ type: 'table', columns: ['A'], rows: [new Array(1)] }])]) {
      expect(validateGenuiDocument(input).ok).toBe(false)
    }
    const huge = doc(Array.from({ length: 20 }, () => ({ type: 'text', content: '\u0000'.repeat(2000) })))
    expect(validateGenuiDocument(huge)).toMatchObject({ ok: false })
    expect(validateGenuiDocument(doc(Array.from({ length: 50 }, () => ({ type: 'unknown' }))))).toMatchObject({ ok: false, diagnostics: expect.any(Array) })
    const failure = validateGenuiDocument(doc(Array.from({ length: 50 }, () => ({ type: 'unknown' }))))
    expect(failure.diagnostics.length).toBeLessThanOrEqual(GENUI_LIMITS.diagnostics)
  })

  it('accepts compact numeric tables within the actual serialized byte budget', () => {
    const input = doc(Array.from({ length: 5 }, () => ({ type: 'table',
      columns: Array.from({ length: 12 }, (_, i) => String(i)),
      rows: Array.from({ length: 50 }, () => Array.from({ length: 12 }, () => 0)),
    })))
    expect(new TextEncoder().encode(JSON.stringify(input)).byteLength).toBeLessThan(GENUI_LIMITS.bytes)
    expect(validateGenuiDocument(input).ok).toBe(true)
  })
})
