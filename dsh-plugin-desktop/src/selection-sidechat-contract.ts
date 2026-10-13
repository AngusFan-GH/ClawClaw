import type { SessionId } from '@deepseek-ai/dsh-session/types'

export const DESKTOP_SELECTION_SIDECHAT_PATH = '/api/desktop/selection-sidechat'
export const DESKTOP_SELECTION_SIDECHAT_START_PATH = `${DESKTOP_SELECTION_SIDECHAT_PATH}/start`
export const SELECTION_SIDECHAT_SESSION_PREFIX = 'selection-sidechat-'

export const MAX_SELECTION_SIDECHAT_QUESTION_LENGTH = 16_000
export const MAX_SELECTION_SIDECHAT_TEXT_LENGTH = 4_000
export const MAX_SELECTION_SIDECHAT_CONTEXT_LENGTH = 12_000
export const MAX_SELECTION_SIDECHAT_LABEL_LENGTH = 120

export interface SelectionSideChatSource {
  readonly messageKey: string
  readonly startOffset: number
  readonly endOffset: number
}

export interface SelectionSideChatQuote {
  readonly context?: string
  readonly source?: SelectionSideChatSource
  readonly text: string
}

export interface SelectionSideChatStartRequest {
  readonly parentSessionId: SessionId
  readonly question: string
  readonly quote: SelectionSideChatQuote
}

export interface SelectionSideChatStartResult {
  readonly childSessionId: SessionId
  readonly mode: 'continuable'
  readonly parentSessionId: SessionId
}

function record(value: unknown, label: string): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object`)
  }
  return value as Record<string, unknown>
}

function boundedText(value: unknown, label: string, maximum: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new TypeError(`${label} must be a non-empty string`)
  }
  if (value.length > maximum) throw new TypeError(`${label} is too long`)
  return value
}

function parseSource(value: unknown): SelectionSideChatSource | undefined {
  if (value === undefined) return undefined
  const source = record(value, 'Selection side-chat quote source')
  if (typeof source.messageKey !== 'string' || source.messageKey === ''
    || !Number.isSafeInteger(source.startOffset) || (source.startOffset as number) < 0
    || !Number.isSafeInteger(source.endOffset) || (source.endOffset as number) < (source.startOffset as number)) {
    throw new TypeError('Selection side-chat quote source is invalid')
  }
  return {
    messageKey: source.messageKey,
    startOffset: source.startOffset as number,
    endOffset: source.endOffset as number,
  }
}

export function parseSelectionSideChatStartRequest(value: unknown): SelectionSideChatStartRequest {
  const input = record(value, 'Selection side-chat payload')
  const quote = record(input.quote, 'Selection side-chat quote')
  const context = quote.context === undefined
    ? undefined
    : boundedText(quote.context, 'Selection side-chat quote context', MAX_SELECTION_SIDECHAT_CONTEXT_LENGTH)
  const source = parseSource(quote.source)
  return {
    parentSessionId: boundedText(input.parentSessionId, 'Selection side-chat parentSessionId', 512) as SessionId,
    question: boundedText(input.question, 'Selection side-chat question', MAX_SELECTION_SIDECHAT_QUESTION_LENGTH),
    quote: {
      text: boundedText(quote.text, 'Selection side-chat quote text', MAX_SELECTION_SIDECHAT_TEXT_LENGTH),
      ...(context === undefined ? {} : { context }),
      ...(source === undefined ? {} : { source }),
    },
  }
}

export function parseSelectionSideChatStartResult(value: unknown): SelectionSideChatStartResult {
  const output = record(value, 'Selection side-chat response')
  if (typeof output.childSessionId !== 'string' || output.childSessionId === ''
    || typeof output.parentSessionId !== 'string' || output.parentSessionId === ''
    || output.mode !== 'continuable') {
    throw new TypeError('Selection side-chat response is invalid')
  }
  return {
    childSessionId: output.childSessionId as SessionId,
    parentSessionId: output.parentSessionId as SessionId,
    mode: 'continuable',
  }
}

export function selectionSideChatLabel(text: string): string {
  const normalized = text.replace(/\s+/gu, ' ').trim()
  const points = Array.from(normalized)
  if (points.length <= MAX_SELECTION_SIDECHAT_LABEL_LENGTH) return normalized
  return `${points.slice(0, MAX_SELECTION_SIDECHAT_LABEL_LENGTH - 3).join('')}...`
}

export function isSelectionSideChatSessionId(value: string): boolean {
  return value.startsWith(SELECTION_SIDECHAT_SESSION_PREFIX)
}
