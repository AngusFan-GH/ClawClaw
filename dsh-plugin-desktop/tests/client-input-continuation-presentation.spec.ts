// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest'
import { continuationCssText, continuationSurface } from '../src/client/input-continuation-presentation.ts'

afterEach(() => { document.body.replaceChildren(); vi.restoreAllMocks() })
describe('inline continuation presentation boundary', () => {
  function fixture() {
    const root = document.createElement('div'), editor = document.createElement('div'), paragraph = document.createElement('p')
    editor.contentEditable = 'true'; editor.setAttribute('contenteditable', 'true'); editor.tabIndex = 0
    paragraph.textContent = '请帮我继续'; editor.append(paragraph); root.append(editor); document.body.append(root)
    const bounds = vi.spyOn(editor, 'getBoundingClientRect').mockReturnValue(new DOMRect(0, 0, 300, 24))
    editor.focus()
    return { root, editor, bounds }
  }
  it('uses only the focused, mounted paragraph-backed input surface', () => {
    const f = fixture(); expect(continuationSurface(f.root)).toBe(f.editor)
    expect(continuationSurface(document.createElement('div'))).toBeUndefined()
    f.editor.blur(); expect(continuationSurface(f.root)).toBeUndefined()
  })
  it('refuses an unrendered or unsupported surface instead of adopting invisible text', () => {
    const f = fixture(); f.bounds.mockReturnValue(new DOMRect())
    expect(continuationSurface(f.root)).toBeUndefined()
    f.bounds.mockReturnValue(new DOMRect(0, 0, 300, 24)); f.editor.replaceChildren(document.createTextNode('different renderer'))
    expect(continuationSurface(f.root)).toBeUndefined()
  })
  it('serializes model text as one CSS string, retaining quotes, slashes and newlines as text', () => {
    const f = fixture(); const draft = f.editor.textContent
    const token = continuationCssText('包含 "引号"、C:\\temp\n下一行')
    f.root.style.setProperty('--dsh-ai-continuation-text', token)
    expect(token).toBe('"包含 \\"引号\\"、C:\\\\temp\\a 下一行"')
    expect(f.editor.textContent).toBe(draft)
    expect(f.root.style.color).toBe('')
  })
})
