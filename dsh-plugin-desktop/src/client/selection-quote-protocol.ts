import type { SelectionQuoteSource } from './selection-quote-source.ts'

const QUOTE_OPEN = '<clawclaw-selection-quote>'
const QUOTE_CLOSE = '</clawclaw-selection-quote>'

export interface SelectionQuotePayload {
  readonly text: string
  readonly source?: SelectionQuoteSource
}

/** Keep the complete quote in the reference id so persisted drafts remain serializable. */
export function encodeSelectionQuote(value: string | SelectionQuotePayload): string {
  const payload = typeof value === 'string' ? { text: value } : value
  return encodeURIComponent(JSON.stringify(payload))
}

export function decodeSelectionQuote(ref: string): string {
  return decodeSelectionQuotePayload(ref).text
}

export function decodeSelectionQuotePayload(ref: string): SelectionQuotePayload {
  const decoded = decodeURIComponent(ref)
  if (!decoded.startsWith('{')) return { text: decoded }
  const parsed = JSON.parse(decoded) as { text?: unknown; source?: unknown }
  if (typeof parsed.text !== 'string') throw new Error('selection quote has no text')
  const source = parsed.source
  if (source === undefined) return { text: parsed.text }
  if (source === null || typeof source !== 'object') return { text: parsed.text }
  const candidate = source as Partial<SelectionQuoteSource>
  if (typeof candidate.messageKey !== 'string'
    || typeof candidate.startOffset !== 'number'
    || typeof candidate.endOffset !== 'number') return { text: parsed.text }
  return {
    text: parsed.text,
    source: {
      messageKey: candidate.messageKey,
      startOffset: candidate.startOffset,
      endOffset: candidate.endOffset,
    },
  }
}

/** Model-facing form. Escaping angle brackets prevents a selection from closing the envelope. */
export function serializeSelectionQuote(ref: string): string {
  const payload = JSON.stringify(decodeSelectionQuotePayload(ref)).replace(/</gu, '\\u003c')
  return `${QUOTE_OPEN}${payload}${QUOTE_CLOSE}`
}

export interface ScannedSelectionQuotes {
  readonly quotes: readonly SelectionQuotePayload[]
  readonly rest: string
}

/** Remove structured quote envelopes from a sent message and recover their display payloads. */
export function scanSelectionQuotes(value: string): ScannedSelectionQuotes {
  const quotes: SelectionQuotePayload[] = []
  const pattern = new RegExp(`${QUOTE_OPEN}([\\s\\S]*?)${QUOTE_CLOSE}`, 'gu')
  const rest = value.replace(pattern, (_whole, body: string) => {
    try {
      const parsed = JSON.parse(body) as { text?: unknown; source?: unknown }
      if (typeof parsed.text === 'string' && parsed.text.trim() !== '') {
        const source = parsed.source as Partial<SelectionQuoteSource> | undefined
        quotes.push({
          text: parsed.text,
          ...(source !== undefined
            && typeof source.messageKey === 'string'
            && typeof source.startOffset === 'number'
            && typeof source.endOffset === 'number'
            ? { source: { messageKey: source.messageKey, startOffset: source.startOffset, endOffset: source.endOffset } }
            : {}),
        })
      }
    } catch {
      return _whole
    }
    return ''
  }).replace(/[ \t]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim()
  return { quotes, rest }
}

