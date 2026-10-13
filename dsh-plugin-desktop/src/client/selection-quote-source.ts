export const QUOTE_MARK_ATTRIBUTE = 'data-claw-selection-quote-mark'
const FLOW_SELECTOR = '[data-chat-flow-key]'
const SKIP_SELECTOR = '[data-claw-selection-quote], button, [role="button"], input, textarea, [contenteditable="true"], [data-message-attachments]'

export interface SelectionQuoteSource {
  readonly messageKey: string
  readonly startOffset: number
  readonly endOffset: number
}

interface TextEntry {
  readonly node: Text
  readonly start: number
  readonly end: number
}

function elementOf(node: Node): Element | null {
  return node instanceof Element ? node : node.parentElement
}

function flowOf(node: Node): HTMLElement | null {
  const flow = elementOf(node)?.closest(FLOW_SELECTOR)
  return flow instanceof HTMLElement ? flow : null
}

function isSkipped(node: Text): boolean {
  return node.parentElement?.closest(SKIP_SELECTOR) !== null
}

export function collectQuoteSourceText(root: HTMLElement): readonly TextEntry[] {
  const entries: TextEntry[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT)
  let offset = 0
  while (walker.nextNode()) {
    const node = walker.currentNode
    if (!(node instanceof Text) || isSkipped(node)) continue
    const value = node.nodeValue ?? ''
    if (value === '') continue
    entries.push({ node, start: offset, end: offset + value.length })
    offset += value.length
  }
  return entries
}

function pointOffset(entries: readonly TextEntry[], container: Node, offset: number): number | null {
  const direct = entries.find(entry => entry.node === container)
  if (direct !== undefined) return direct.start + Math.min(Math.max(offset, 0), direct.end - direct.start)
  if (!(container instanceof Element)) return null
  const inside = entries.filter(entry => container.contains(entry.node))
  if (inside.length === 0) return null
  if (offset <= 0) return inside[0]?.start ?? null
  if (offset >= container.childNodes.length) return inside.at(-1)?.end ?? null
  const before = container.childNodes[offset - 1]
  const after = container.childNodes[offset]
  const beforeEntries = entries.filter(entry => before?.contains(entry.node) === true)
  if (beforeEntries.length > 0) return beforeEntries.at(-1)?.end ?? null
  const afterEntries = entries.filter(entry => after?.contains(entry.node) === true)
  return afterEntries[0]?.start ?? null
}

export function quoteSourceFromRange(range: Range): SelectionQuoteSource | undefined {
  const startFlow = flowOf(range.startContainer)
  const endFlow = flowOf(range.endContainer)
  if (startFlow === null || startFlow !== endFlow) return undefined
  const messageKey = startFlow.dataset.chatFlowKey
  if (messageKey === undefined || messageKey === '') return undefined
  const entries = collectQuoteSourceText(startFlow)
  const startOffset = pointOffset(entries, range.startContainer, range.startOffset)
  const endOffset = pointOffset(entries, range.endContainer, range.endOffset)
  if (startOffset === null || endOffset === null || endOffset <= startOffset) return undefined
  return { messageKey, startOffset, endOffset }
}

function flowByKey(messageKey: string): HTMLElement | null {
  for (const node of document.querySelectorAll<HTMLElement>(FLOW_SELECTOR)) {
    if (node.dataset.chatFlowKey === messageKey) return node
  }
  return null
}

function normalized(value: string): string {
  return value.replace(/\s+/gu, '')
}

function overlapping(entries: readonly TextEntry[], start: number, end: number) {
  return entries.filter(entry => entry.end > start && entry.start < end)
}

function marksById(id: string): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>(`[${QUOTE_MARK_ATTRIBUTE}]`)]
    .filter(mark => mark.getAttribute(QUOTE_MARK_ATTRIBUTE) === id)
}

export interface SelectionQuoteMark {
  readonly id: string
  readonly text: string
  readonly source: SelectionQuoteSource
}

export function applySelectionQuoteMark(mark: SelectionQuoteMark): HTMLElement | null {
  const existing = marksById(mark.id)[0] ?? null
  if (existing !== null) return existing
  const flow = flowByKey(mark.source.messageKey)
  if (flow === null) return null
  const entries = collectQuoteSourceText(flow)
  const total = entries.at(-1)?.end ?? 0
  const start = Math.min(Math.max(mark.source.startOffset, 0), total)
  const end = Math.min(Math.max(mark.source.endOffset, start), total)
  const pieces = overlapping(entries, start, end)
  if (pieces.length === 0) return null
  const sourceText = pieces.map(entry => {
    const from = Math.max(start, entry.start) - entry.start
    const to = Math.min(end, entry.end) - entry.start
    return (entry.node.nodeValue ?? '').slice(from, to)
  }).join('')
  if (normalized(sourceText) !== normalized(mark.text)) return null

  let first: HTMLElement | null = null
  for (const entry of pieces) {
    const from = Math.max(start, entry.start) - entry.start
    const to = Math.min(end, entry.end) - entry.start
    entry.node.splitText(to)
    const selected = entry.node.splitText(from)
    const element = document.createElement('mark')
    element.className = 'clawSelectionQuoteSourceMark'
    element.setAttribute(QUOTE_MARK_ATTRIBUTE, mark.id)
    selected.replaceWith(element)
    element.append(selected)
    if (entry.node.nodeValue === '') entry.node.remove()
    first ??= element
  }
  return first
}

export function removeSelectionQuoteMarks(ids: readonly string[]): void {
  for (const id of ids) {
    for (const mark of marksById(id)) {
      const parent = mark.parentNode
      if (parent === null) continue
      while (mark.firstChild !== null) parent.insertBefore(mark.firstChild, mark)
      mark.remove()
      parent.normalize()
    }
  }
}

export function revealSelectionQuoteSource(mark: SelectionQuoteMark): boolean {
  const target = applySelectionQuoteMark(mark)
  if (target === null) return false
  target.scrollIntoView({ behavior: 'smooth', block: 'center', inline: 'nearest' })
  for (const node of marksById(mark.id)) {
    node.classList.remove('clawSelectionQuoteSourceFlash')
    window.requestAnimationFrame(() => { node.classList.add('clawSelectionQuoteSourceFlash') })
  }
  return true
}
