import { describe, expect, it } from 'vitest'
import { GENUI_FORMAT, GENUI_LIMITS } from '../src/genui-contract.ts'
import { genuiText, validateGenuiDocument } from '../src/genui-core.ts'
import { blockIsolatedPreviewNavigation } from '../src/genui-navigation-policy.ts'
const fragment = { type: 'html', title: 'Counter', html: '<button onclick="this.textContent++">0</button>', fallback: 'Initial count: 0. Press the button to increment locally.' }
const doc = (items: unknown[]) => ({ format: GENUI_FORMAT, title: 'Demo', items })

describe('isolated HTML protocol', () => {
  it('preserves executable source only in metadata and provides readable ordinary text', () => {
    const source = doc([fragment])
    const parsed = validateGenuiDocument(source)
    expect(parsed).toMatchObject({ ok: true, document: source })
    if (!parsed.ok) throw new Error('invalid fixture')
    expect(genuiText(parsed.document)).toBe(`Demo\nCounter\n${fragment.fallback}`)
    expect(genuiText(parsed.document)).not.toContain('onclick')
    expect(validateGenuiDocument(JSON.parse(JSON.stringify(parsed.document)))).toEqual(parsed)
  })
  it('requires meaningful titles, source and fallback and caps UTF-8 source bytes and fragment count', () => {
    for (const patch of [{ html: '' }, { fallback: ' ' }, { title: '' }, { html: 4 },
      { html: '中'.repeat(Math.floor(GENUI_LIMITS.htmlBytes / 3) + 1) }, { action: 'execute' }]) {
      expect(validateGenuiDocument(doc([{ ...fragment, ...patch }])).ok).toBe(false)
    }
    expect(validateGenuiDocument(doc([fragment, fragment])).ok).toBe(true)
    expect(validateGenuiDocument(doc([fragment, fragment, fragment])).ok).toBe(false)
  })
})

describe('desktop srcdoc navigation boundary', () => {
  it.each(['https://example.com/secret', 'http://localhost:3000', 'file:///etc/passwd', 'data:text/html,hello', 'about:blank'])('blocks %s from a preview, even after its name changes', url => {
    expect(blockIsolatedPreviewNavigation({ url, frame: { url: 'about:srcdoc' } })).toBe(true)
    expect(blockIsolatedPreviewNavigation({ url, initiator: { url: 'about:srcdoc' } })).toBe(true)
  })
  it('preserves host-driven srcdoc updates and existing non-preview navigation rules', () => {
    expect(blockIsolatedPreviewNavigation({ url: 'about:srcdoc', frame: { url: 'about:srcdoc' } })).toBe(false)
    expect(blockIsolatedPreviewNavigation({ url: 'https://example.com', frame: { url: 'https://app.test' } })).toBe(false)
    expect(blockIsolatedPreviewNavigation({ url: 'https://example.com', frame: null })).toBe(false)
  })
})
