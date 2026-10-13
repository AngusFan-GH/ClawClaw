// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import type { InputState } from '@deepseek-ai/dsh-client-ui-conversation/client'
import {
  applySelectionQuote,
  createSelectionQuoteSource,
  insertSelectionQuote,
  normalizeSelectedText,
  occurrenceDetectSpan,
  placeSelectionPopover,
  readConversationSelection,
  SELECTION_QUOTE_SOURCE,
  selectionQuoteOccurrences,
} from '../src/client/selection-quote.tsx'
import {
  decodeSelectionQuote,
  decodeSelectionQuotePayload,
  encodeSelectionQuote,
  scanSelectionQuotes,
  serializeSelectionQuote,
} from '../src/client/selection-quote-protocol.ts'
import {
  applySelectionQuoteMark,
  collectQuoteSourceText,
  quoteSourceFromRange,
  removeSelectionQuoteMarks,
} from '../src/client/selection-quote-source.ts'

type Occurrence = InputState['occurrences'][number]

function occurrence(overrides: Partial<Occurrence> = {}): Occurrence {
  return {
    occurrenceId: 1,
    source: SELECTION_QUOTE_SOURCE,
    ref: encodeSelectionQuote('selected text'),
    offset: 0,
    length: 1,
    label: 'selected text',
    clipboardText: ' ',
    ...overrides,
  }
}

describe('selection quote', () => {
  it('normalizes and bounds selected content', () => {
    expect(normalizeSelectedText('  one\u00a0 two  \n\n\n three  ')).toBe('one  two\n\n three')
    expect(normalizeSelectedText('x'.repeat(5_000))).toHaveLength(4_000)
  })

  it('round-trips unicode quote references and strips their transport envelope', async () => {
    const selected = '项目已初始化为 <unsafe>\nsecond line'
    const ref = encodeSelectionQuote(selected)
    expect(decodeSelectionQuote(ref)).toBe(selected)

    const source = createSelectionQuoteSource()
    const wire = await source.codec?.serialize(ref, new AbortController().signal)
    expect(wire).toBe(serializeSelectionQuote(ref))
    expect(wire).not.toContain('<unsafe>')
    expect(scanSelectionQuotes(`${wire}\n\n请解释原因`)).toEqual({
      quotes: [{ text: selected }],
      rest: '请解释原因',
    })
  })

  it('keeps source coordinates in new references and reads legacy references', () => {
    const source = { messageKey: 'assistant:7', startOffset: 4, endOffset: 8 }
    const context = '这是引用内容所在的完整消息。'
    const ref = encodeSelectionQuote({ text: '引用内容', context, source })
    expect(decodeSelectionQuotePayload(ref)).toEqual({ text: '引用内容', context, source })
    expect(decodeSelectionQuotePayload(encodeURIComponent('旧引用'))).toEqual({ text: '旧引用' })
    expect(serializeSelectionQuote(ref)).toContain('完整消息')
    expect(scanSelectionQuotes(serializeSelectionQuote(ref))).toEqual({ quotes: [{ text: '引用内容', context, source }], rest: '' })
  })

  it('captures a same-message range and marks and restores its source text', () => {
    document.body.innerHTML = '<div data-chat-flow-key="assistant:7"><p>Hello <strong>quoted value</strong> world</p><button>Copy</button></div>'
    const strongText = document.querySelector('strong')?.firstChild
    if (!(strongText instanceof Text)) throw new Error('missing fixture text')
    const range = document.createRange()
    range.setStart(strongText, 0)
    range.setEnd(strongText, 6)
    const source = quoteSourceFromRange(range)
    expect(source).toEqual({ messageKey: 'assistant:7', startOffset: 6, endOffset: 12 })
    expect(collectQuoteSourceText(document.querySelector<HTMLElement>('[data-chat-flow-key]')!).map(item => item.node.nodeValue).join('')).toBe('Hello quoted value world')

    const mark = applySelectionQuoteMark({ id: 'quote:1', text: 'quoted', source: source! })
    expect(mark?.textContent).toBe('quoted')
    expect(document.querySelector('p')?.textContent).toBe('Hello quoted value world')
    expect(document.querySelector('mark')?.getAttribute('data-claw-selection-quote-mark')).toBe('quote:1')
    removeSelectionQuoteMarks(['quote:1'])
    expect(document.querySelector('mark')).toBeNull()
    expect(document.querySelector('[data-chat-flow-key]')?.textContent).toBe('Hello quoted value worldCopy')
  })

  it('captures surrounding message context without including action controls', () => {
    document.body.innerHTML = '<div data-chat-flow data-chat-flow-key="assistant:8"><p>Desktop folders: <strong>金秒充</strong></p><button>Copy</button></div>'
    const selected = document.querySelector('strong')?.firstChild
    if (!(selected instanceof Text)) throw new Error('missing fixture text')
    const range = document.createRange()
    range.setStart(selected, 0)
    range.setEnd(selected, selected.length)
    Object.defineProperty(range, 'getClientRects', {
      value: () => [{ width: 20, height: 10, left: 10, top: 10, bottom: 20 } as DOMRect],
    })
    const selection = { isCollapsed: false, rangeCount: 1, toString: () => '金秒充', getRangeAt: () => range } as unknown as Selection

    expect(readConversationSelection(selection)).toEqual(expect.objectContaining({
      text: '金秒充',
      context: 'Desktop folders: 金秒充',
    }))
  })

  it('does not attach a misleading source to cross-message selections', () => {
    document.body.innerHTML = '<div data-chat-flow-key="a">first</div><div data-chat-flow-key="b">second</div>'
    const first = document.querySelector<HTMLElement>('[data-chat-flow-key="a"]')?.firstChild
    const second = document.querySelector<HTMLElement>('[data-chat-flow-key="b"]')?.firstChild
    if (!(first instanceof Text) || !(second instanceof Text)) throw new Error('missing fixture text')
    const range = document.createRange()
    range.setStart(first, 0)
    range.setEnd(second, 3)
    expect(quoteSourceFromRange(range)).toBeUndefined()
  })

  it('leaves malformed envelopes visible instead of silently deleting content', () => {
    const malformed = '<clawclaw-selection-quote>{bad}</clawclaw-selection-quote>'
    expect(scanSelectionQuotes(malformed)).toEqual({ quotes: [], rest: malformed })
  })

  it('filters owned occurrences and maps clipboard offsets to chip coordinates', () => {
    const first = occurrence({ occurrenceId: 1, offset: 0, length: 3 })
    const foreign = occurrence({ occurrenceId: 2, source: 'file', offset: 5, length: 5 })
    const second = occurrence({ occurrenceId: 3, offset: 12, length: 4 })
    const all = [first, foreign, second]
    expect(selectionQuoteOccurrences(all)).toEqual([first, second])
    expect(occurrenceDetectSpan(second, all, 9)).toEqual({ start: 6, end: 7, draftRev: 9 })
  })

  it('keeps the popover in the viewport and flips below a top-edge selection', () => {
    expect(placeSelectionPopover({ left: 10, top: 4, bottom: 24 }, 200, 40, 320, 200)).toEqual({ left: 8, top: 32 })
    expect(placeSelectionPopover({ left: 310, top: 180, bottom: 196 }, 200, 40, 320, 200)).toEqual({ left: 112, top: 132 })
  })

  it('ignores selections owned by another conversation occurrence', () => {
    document.body.innerHTML = [
      '<section data-conversation-content="first"><div data-chat-flow><p>first conversation</p></div></section>',
      '<section data-conversation-content="second"><div data-chat-flow><p>second conversation</p></div></section>',
    ].join('')
    const first = document.querySelector<HTMLElement>('[data-conversation-content="first"]')!
    const second = document.querySelector<HTMLElement>('[data-conversation-content="second"]')!
    const text = first.querySelector('p')!.firstChild!
    const range = document.createRange()
    range.setStart(text, 0)
    range.setEnd(text, 5)
    Object.defineProperty(range, 'getClientRects', {
      value: () => [{ width: 20, height: 10, left: 10, top: 10, bottom: 20 } as DOMRect],
    })
    const selection = { isCollapsed: false, rangeCount: 1, toString: () => 'first', getRangeAt: () => range } as unknown as Selection

    expect(readConversationSelection(selection, second)).toBeNull()
    expect(readConversationSelection(selection, first)?.text).toBe('first')
  })

  it('inserts the existing structured quote into a standard composer', () => {
    const bail = vi.fn(() => true)
    const actx = { bail } as unknown as Context
    expect(insertSelectionQuote(actx, {
      context: 'source message containing selected text',
      text: 'selected text',
      source: { messageKey: 'assistant:7', startOffset: 2, endOffset: 15 },
    }, 4)).toBe(true)
    expect(bail).toHaveBeenCalledWith(actx, 'slash/input-insert-reference', {
      reference: expect.objectContaining({
        source: SELECTION_QUOTE_SOURCE,
        label: 'selected text',
        ref: expect.stringContaining('source%20message'),
      }),
      span: { start: 0, end: 0, draftRev: 4 },
    })
  })

  it('registers the reference codec, composer overlay, and protocol-cleaning history views', () => {
    const registerSource = vi.fn(() => () => undefined)
    let overlayRegistration: { inject: (sessionId: string) => unknown } | undefined
    const register = vi.fn((definition: { inject?: (sessionId: string) => unknown; name: string }) => {
      if (definition.name === 'conversation.input.overlay' && definition.inject !== undefined) overlayRegistration = { inject: definition.inject }
      return () => undefined
    })
    const inject = vi.fn((_name: string, install: () => unknown) => { install(); return () => undefined })
    const effect = vi.fn((install: () => unknown) => install())
    const sessions = { scope: vi.fn(() => ({ bail: vi.fn() })), retain: vi.fn() }
    const sidebarRight = { openResource: vi.fn() }
    const scope = {
      effect,
      get: vi.fn((name: string) => name === 'sessions' ? sessions : undefined),
      resources: { register: vi.fn(() => () => undefined) },
      sessions,
      sidebarRight,
      sidebarRightTabs: { register: vi.fn(() => () => undefined) },
      slots: { inject, register },
    } as unknown as Context
    const clientCtx = {
      effect,
      get: vi.fn((name: string) => name === 'sessions' ? sessions : undefined),
      inject: vi.fn((_faces: readonly string[], install: (injected: Context) => unknown) => install(scope)),
      inputTriggers: { registerSource },
      sessions,
      slots: { inject, register },
    } as unknown as Context
    applySelectionQuote(clientCtx)

    expect(registerSource).toHaveBeenCalledWith(expect.objectContaining({ name: SELECTION_QUOTE_SOURCE }))
    expect(inject).toHaveBeenCalledWith('conversation.input.overlay', expect.any(Function))
    expect(inject).toHaveBeenCalledWith('conversation.chat.node', expect.any(Function))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'conversation.input.overlay', id: 'desktop-selection-quote' }), expect.any(Function))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'conversation.chat.node', key: 'user', priority: -10 }), expect.any(Function))
    expect(register).toHaveBeenCalledWith(expect.objectContaining({ name: 'conversation.chat.node', key: 'steering', priority: -10 }), expect.any(Function))

    if (overlayRegistration === undefined) throw new Error('missing overlay registration')
    expect(overlayRegistration.inject('session-1')).toEqual(expect.objectContaining({ sidebarRight, sessionId: 'session-1' }))
  })
})
