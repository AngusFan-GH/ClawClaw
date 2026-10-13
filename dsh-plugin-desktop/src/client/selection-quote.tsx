import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
// @ts-expect-error package subpath has no declaration file
import Copy from 'lucide-react/dist/esm/icons/copy.mjs'
// @ts-expect-error package subpath has no declaration file
import LocateFixed from 'lucide-react/dist/esm/icons/locate-fixed.mjs'
// @ts-expect-error package subpath has no declaration file
import Quote from 'lucide-react/dist/esm/icons/quote.mjs'
// @ts-expect-error package subpath has no declaration file
import X from 'lucide-react/dist/esm/icons/x.mjs'
import type { Context } from '@deepseek-ai/cordis'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ChatNodeViewProps } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { InputState, ReferenceInsert } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { InputTriggerSource } from '@deepseek-ai/dsh-client-ui-input-trigger/client'
import {
  FileTypeIcon, IconCheckOutlineRegular, IconCopyOutlineRegular, JsonBlock, Tooltip,
  fileSizeText, projectUserText, writeClipboard,
} from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import {
  decodeSelectionQuote,
  decodeSelectionQuotePayload,
  encodeSelectionQuote,
  scanSelectionQuotes,
  serializeSelectionQuote,
} from './selection-quote-protocol.ts'
import {
  applySelectionQuoteMark,
  quoteSourceFromRange,
  removeSelectionQuoteMarks,
  revealSelectionQuoteSource,
  type SelectionQuoteMark,
  type SelectionQuoteSource,
} from './selection-quote-source.ts'
import { installSelectionQuoteStyles } from './selection-quote-styles.ts'

const MAX_SELECTION_LENGTH = 4_000
const VIEWPORT_GAP = 8
export const SELECTION_QUOTE_SOURCE = 'desktop-selection-quote'
type Occurrence = InputState['occurrences'][number]

export interface SelectionSnapshot {
  readonly text: string
  readonly left: number
  readonly top: number
  readonly bottom: number
  readonly source?: SelectionQuoteSource
}

export function normalizeSelectedText(value: string): string {
  return value.replace(/\u00a0/gu, ' ').replace(/[\t ]+\n/gu, '\n').replace(/\n{3,}/gu, '\n\n').trim().slice(0, MAX_SELECTION_LENGTH)
}

export async function copySelectionText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText !== undefined) {
    await navigator.clipboard.writeText(text)
    return
  }
  const fallback = document.createElement('textarea')
  fallback.value = text
  fallback.style.position = 'fixed'
  fallback.style.opacity = '0'
  document.body.append(fallback)
  fallback.select()
  document.execCommand('copy')
  fallback.remove()
}

export function placeSelectionPopover(anchor: Pick<SelectionSnapshot, 'left' | 'top' | 'bottom'>, width: number, height: number, viewportWidth: number, viewportHeight: number): { left: number; top: number } {
  const left = Math.min(Math.max(anchor.left - width / 2, VIEWPORT_GAP), Math.max(VIEWPORT_GAP, viewportWidth - width - VIEWPORT_GAP))
  const above = anchor.top - height - VIEWPORT_GAP
  const below = anchor.bottom + VIEWPORT_GAP
  return { left, top: above >= VIEWPORT_GAP ? above : Math.min(below, Math.max(VIEWPORT_GAP, viewportHeight - height - VIEWPORT_GAP)) }
}

function nodeElement(node: Node | null): Element | null {
  return node instanceof Element ? node : node?.parentElement ?? null
}

export function readConversationSelection(selection: Selection | null = window.getSelection()): SelectionSnapshot | null {
  if (selection === null || selection.isCollapsed || selection.rangeCount === 0) return null
  const text = normalizeSelectedText(selection.toString())
  if (text === '') return null
  const range = selection.getRangeAt(0)
  const start = nodeElement(range.startContainer)
  const end = nodeElement(range.endContainer)
  const conversation = start?.closest('[data-chat-flow]')
  if (conversation === null || conversation === undefined || !conversation.contains(end)) return null
  if (start?.closest('[contenteditable="true"], input, textarea, [data-claw-selection-quote]') !== null) return null
  const rects = [...range.getClientRects()].filter(rect => rect.width > 0 && rect.height > 0)
  const rect = rects.at(-1) ?? range.getBoundingClientRect()
  if (rect.width <= 0 && rect.height <= 0) return null
  const source = quoteSourceFromRange(range)
  return { text, left: rect.left + rect.width / 2, top: rect.top, bottom: rect.bottom, ...(source === undefined ? {} : { source }) }
}

function labels(): { add: string; copied: string; copy: string; locate: string; quote: string; remove: string; toolbar: string } {
  const chinese = (document.documentElement.lang || navigator.language).toLocaleLowerCase().startsWith('zh')
  return chinese
    ? { add: '添加引用', copied: '已复制', copy: '复制', locate: '定位原文', quote: '引用内容', remove: '移除引用', toolbar: '划词操作' }
    : { add: 'Add quote', copied: 'Copied', copy: 'Copy', locate: 'Show source', quote: 'Quoted context', remove: 'Remove quote', toolbar: 'Selection actions' }
}

function quoteReference(snapshot: Pick<SelectionSnapshot, 'text' | 'source'>): ReferenceInsert {
  const ref = encodeSelectionQuote({ text: snapshot.text, ...(snapshot.source === undefined ? {} : { source: snapshot.source }) })
  return { source: SELECTION_QUOTE_SOURCE, ref, label: snapshot.text, clipboardText: ' ' }
}

export function selectionQuoteOccurrences(occurrences: readonly Occurrence[]): readonly Occurrence[] {
  return occurrences.filter(item => item.source === SELECTION_QUOTE_SOURCE)
}

/** Translate a clipboard-projection occurrence into the editor's one-codepoint chip coordinates. */
export function occurrenceDetectSpan(target: Occurrence, occurrences: readonly Occurrence[], draftRev: number) {
  let collapsed = 0
  for (const item of occurrences) {
    if (item.offset >= target.offset) break
    collapsed += Math.max(0, item.length - 1)
  }
  const start = target.offset - collapsed
  return { start, end: start + 1, draftRev }
}

interface SelectionQuoteInjected {
  readonly actx: Context
}

export type SelectionQuoteOverlayProps = PropsRuntime<'conversation.input.overlay'> & SelectionQuoteInjected

function PendingQuoteCards({ actx, draftRev, occurrences }: {
  readonly actx: Context
  readonly draftRev: number
  readonly occurrences: readonly Occurrence[]
}) {
  const rootRef = useRef<HTMLDivElement>(null)
  const copy = labels()
  const quotes = useMemo(() => selectionQuoteOccurrences(occurrences), [occurrences])
  const marks = useMemo(() => quotes.flatMap((item): SelectionQuoteMark[] => {
    try {
      const payload = decodeSelectionQuotePayload(item.ref)
      return payload.source === undefined ? [] : [{
        id: `pending:${String(item.occurrenceId)}`,
        text: payload.text,
        source: payload.source,
      }]
    } catch { return [] }
  }), [quotes])
  useSelectionQuoteMarks('pending', marks)

  useLayoutEffect(() => {
    const card = rootRef.current?.closest<HTMLElement>('[data-composer-card]')
    if (card === null || card === undefined) return
    const apply = () => card.style.setProperty('--claw-selection-quote-height', `${rootRef.current?.offsetHeight ?? 0}px`)
    card.classList.add('clawSelectionQuoteComposer')
    apply()
    const observer = new ResizeObserver(apply)
    if (rootRef.current !== null) observer.observe(rootRef.current)
    return () => {
      observer.disconnect()
      card.classList.remove('clawSelectionQuoteComposer')
      card.style.removeProperty('--claw-selection-quote-height')
    }
  }, [quotes.length])

  if (quotes.length === 0) return null
  return <div ref={rootRef} className="clawSelectionQuoteCards" data-claw-selection-quote>
    {quotes.map((item, index) => {
      let payload = { text: item.label } as ReturnType<typeof decodeSelectionQuotePayload>
      try { payload = decodeSelectionQuotePayload(item.ref) } catch { /* retain the cached label */ }
      const mark = marks.find(candidate => candidate.id === `pending:${String(item.occurrenceId)}`)
      return <div className="clawSelectionQuoteCard" key={item.occurrenceId}>
        <Quote aria-hidden="true" />
        <div><span>{copy.quote}{quotes.length > 1 ? ` ${index + 1}` : ''}</span><p title={payload.text}>{payload.text}</p></div>
        {mark !== undefined && <button type="button" title={copy.locate} aria-label={copy.locate} onClick={() => { revealSelectionQuoteSource(mark) }}><LocateFixed aria-hidden="true" /></button>}
        <button type="button" title={copy.remove} aria-label={copy.remove} onClick={() => {
          actx.bail(actx, 'slash/input-consume-token', { guard: { kind: 'span', span: occurrenceDetectSpan(item, occurrences, draftRev) } })
        }}><X aria-hidden="true" /></button>
      </div>
    })}
  </div>
}

export function SelectionQuoteOverlay({ actx, useInput }: SelectionQuoteOverlayProps) {
  const state = useInput(value => value)
  const quotes = selectionQuoteOccurrences(state.occurrences)
  const [snapshot, setSnapshot] = useState<SelectionSnapshot | null>(null)
  const toolbarRef = useRef<HTMLDivElement>(null)
  const copy = labels()

  const close = useCallback(() => { setSnapshot(null) }, [])
  const refresh = useCallback(() => {
    const next = readConversationSelection()
    if (next !== null) setSnapshot(next)
  }, [])

  useEffect(() => { installSelectionQuoteStyles() }, [])
  useEffect(() => {
    let selecting = false
    let timer = 0
    const schedule = () => { window.clearTimeout(timer); timer = window.setTimeout(refresh, 0) }
    const pointerDown = (event: PointerEvent) => {
      const target = event.target
      if (target instanceof Node && toolbarRef.current?.contains(target) === true) return
      selecting = true
      close()
    }
    const pointerUp = () => { selecting = false; schedule() }
    const selectionChange = () => { if (!selecting) schedule() }
    document.addEventListener('pointerdown', pointerDown, true)
    document.addEventListener('pointerup', pointerUp, true)
    document.addEventListener('selectionchange', selectionChange)
    document.addEventListener('keyup', schedule, true)
    const keyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || toolbarRef.current === null) return
      window.getSelection()?.removeAllRanges()
      close()
    }
    document.addEventListener('keydown', keyDown, true)
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      window.clearTimeout(timer)
      document.removeEventListener('pointerdown', pointerDown, true)
      document.removeEventListener('pointerup', pointerUp, true)
      document.removeEventListener('selectionchange', selectionChange)
      document.removeEventListener('keyup', schedule, true)
      document.removeEventListener('keydown', keyDown, true)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [close, refresh])

  const addQuote = () => {
    if (snapshot === null) return
    const ref = encodeSelectionQuote({ text: snapshot.text, ...(snapshot.source === undefined ? {} : { source: snapshot.source }) })
    if (quotes.some(item => {
      try { return decodeSelectionQuote(item.ref) === snapshot.text } catch { return item.ref === ref }
    })) {
      window.getSelection()?.removeAllRanges()
      close()
      return
    }
    const inserted = actx.bail(actx, 'slash/input-insert-reference', {
      reference: quoteReference(snapshot),
      span: { start: 0, end: 0, draftRev: state.draftRev },
    }) === true
    window.getSelection()?.removeAllRanges()
    close()
    if (inserted) window.requestAnimationFrame(() => document.querySelector<HTMLElement>('[data-composer-card] [contenteditable="true"]')?.focus())
  }

  const preventSelectionLoss = (event: ReactPointerEvent) => { event.preventDefault(); event.stopPropagation() }
  let toolbar: ReactNode = null
  if (snapshot !== null && state.phase === 'plain') {
    const position = placeSelectionPopover(snapshot, 164, 40, window.innerWidth, window.innerHeight)
    const style: CSSProperties = { left: position.left, top: position.top }
    toolbar = createPortal(<div ref={toolbarRef} className="clawSelectionQuoteToolbar" data-claw-selection-quote role="toolbar" aria-label={copy.toolbar} style={style} onPointerDown={preventSelectionLoss}>
      <button type="button" title={copy.copy} onClick={() => { void copySelectionText(snapshot.text).then(close, close) }}><Copy aria-hidden="true" />{copy.copy}</button>
      <span className="clawSelectionQuoteDivider" aria-hidden="true" />
      <button type="button" className="clawSelectionQuotePrimary" title={copy.add} onClick={addQuote}><Quote aria-hidden="true" />{copy.add}</button>
    </div>, document.body)
  }

  return <Fragment>
    <PendingQuoteCards actx={actx} draftRev={state.draftRev} occurrences={state.occurrences} />
    {toolbar}
  </Fragment>
}

function messageParts(content: readonly unknown[]) {
  const texts: string[] = []
  const images: Array<{ attachment: never }> = []
  const files: Array<{ name: string; bytes?: number }> = []
  const rest: unknown[] = []
  for (const block of content) {
    if (block === null || typeof block !== 'object') { rest.push(block); continue }
    const item = block as { type?: unknown; text?: unknown; attachment?: { name?: unknown; bytes?: unknown } }
    if (item.type === 'text' && typeof item.text === 'string') texts.push(item.text)
    else if (item.type === 'image' && item.attachment !== undefined) images.push({ attachment: item.attachment as never })
    else if (item.type === 'file' && typeof item.attachment?.name === 'string') files.push({ name: item.attachment.name, ...(typeof item.attachment.bytes === 'number' ? { bytes: item.attachment.bytes } : {}) })
    else rest.push(block)
  }
  return { text: texts.join(''), images, files, rest }
}

/** User-message projection that keeps the transport protocol out of the transcript. */
type UserQuoteMessageProps = ChatNodeViewProps<'user'>
type SteeringQuoteMessageProps = ChatNodeViewProps<'steering'>

function messageClock(time: number): string {
  const then = new Date(time)
  const now = new Date()
  const clock = `${String(then.getHours()).padStart(2, '0')}:${String(then.getMinutes()).padStart(2, '0')}`
  if (then.toDateString() === now.toDateString()) return clock
  const date = then.getFullYear() === now.getFullYear()
    ? `${then.getMonth() + 1}/${then.getDate()}`
    : `${then.getFullYear()}/${then.getMonth() + 1}/${then.getDate()}`
  return `${date} ${clock}`
}

function MessageActions({ text, time }: { readonly text: string; readonly time: number }) {
  const [copied, setCopied] = useState(false)
  const timer = useRef<number | undefined>(undefined)
  const copy = labels()
  useEffect(() => () => { window.clearTimeout(timer.current) }, [])
  const onCopy = () => {
    if (copied) return
    void writeClipboard(text).then(ok => {
      if (!ok) return
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => { setCopied(false) }, 1_000)
    })
  }
  const actionLabel = copied ? copy.copied : copy.copy
  return <div className="clawSelectionQuoteHistoryActions">
    <time dateTime={new Date(time).toISOString()}>{messageClock(time)}</time>
    <Tooltip label={actionLabel} side="bottom">
      <button type="button" aria-label={actionLabel} onClick={onCopy}>
        {copied ? <IconCheckOutlineRegular /> : <IconCopyOutlineRegular />}
      </button>
    </Tooltip>
  </div>
}

function useSelectionQuoteMarks(ownerKey: string, marks: readonly SelectionQuoteMark[]): void {
  useEffect(() => {
    if (marks.length === 0) return
    let frame = 0
    const apply = () => { for (const mark of marks) applySelectionQuoteMark(mark) }
    const schedule = () => {
      if (frame !== 0) return
      frame = window.requestAnimationFrame(() => { frame = 0; apply() })
    }
    apply()
    const observer = new MutationObserver(schedule)
    observer.observe(document.body, { childList: true, subtree: true })
    return () => {
      observer.disconnect()
      if (frame !== 0) window.cancelAnimationFrame(frame)
      removeSelectionQuoteMarks(marks.map(mark => mark.id))
    }
  }, [marks, ownerKey])
}

function HistoryQuoteCard({ count, index, mark, text }: {
  readonly count: number
  readonly index: number
  readonly mark?: SelectionQuoteMark
  readonly text: string
}) {
  const copy = labels()
  const content = <Fragment>
    <Quote aria-hidden="true" />
    <div><span>{copy.quote}{count > 1 ? ` ${index + 1}` : ''}</span><p>{text}</p></div>
    {mark !== undefined && <LocateFixed aria-hidden="true" className="clawSelectionQuoteLocateIcon" />}
  </Fragment>
  return mark === undefined
    ? <div className="clawSelectionQuoteHistoryCard">{content}</div>
    : <button type="button" className="clawSelectionQuoteHistoryCard clawSelectionQuoteHistoryLink" title={copy.locate} onClick={() => { revealSelectionQuoteSource(mark) }}>{content}</button>
}

function SelectionQuoteMessage({ node, renderMessageImages, openFile, openSkill, t }: UserQuoteMessageProps | SteeringQuoteMessageProps) {
  const { text, images, files, rest } = messageParts(node.data.content)
  const scanned = useMemo(() => scanSelectionQuotes(text), [text])
  const marks = useMemo(() => scanned.quotes.flatMap((quote, index): SelectionQuoteMark[] => quote.source === undefined ? [] : [{
    id: `history:${node.key}:${String(index)}`,
    text: quote.text,
    source: quote.source,
  }]), [node.key, scanned.quotes])
  useSelectionQuoteMarks(node.key, marks)
  const referenceLabels = node.data.referenceLabels ?? []
  const skillNames = node.data.skillNames ?? []
  return <div className="clawSelectionQuoteHistoryRow">
    <div className="clawSelectionQuoteHistoryStack">
      {scanned.quotes.length > 0 && <div className="clawSelectionQuoteHistoryCards">
        {scanned.quotes.map((quote, index) => {
          const mark = marks.find(item => item.id === `history:${node.key}:${String(index)}`)
          return <HistoryQuoteCard
            count={scanned.quotes.length}
            index={index}
            key={`${index}:${quote.text}`}
            {...mark === undefined ? {} : { mark }}
            text={quote.text}
          />
        })}
      </div>}
      {images.length > 0 && <div className="clawSelectionQuoteHistoryAttachments">{renderMessageImages({ images, align: 'end', compact: images.length > 1 })}</div>}
      {files.length > 0 && <div className="clawSelectionQuoteHistoryAttachments">{files.map((file, index) => <div className="clawSelectionQuoteFile" key={`${index}:${file.name}`}>
        <FileTypeIcon path={file.name} /><span>{file.name}{file.bytes === undefined ? '' : ` · ${fileSizeText(file.bytes)}`}</span>
      </div>)}</div>}
      {(scanned.rest !== '' || rest.length > 0) && <div className="clawSelectionQuoteHistoryBubble">
        {projectUserText(scanned.rest, referenceLabels, skillNames, 'skill', { openFile, openSkill })}
        {rest.map((block, index) => <JsonBlock key={index} label={t('message.extraBlock')} payload={block} truncatedLabel={total => t('json.truncated', { total })} />)}
      </div>}
      {referenceLabels.length > 0 && <div className="clawSelectionQuoteReferenceSummary">
        {t('message.referenceSummary', { labels: referenceLabels.join(t('message.referenceSeparator')) })}
      </div>}
    </div>
    <MessageActions text={scanned.rest} time={node.data.time} />
  </div>
}

export function SelectionQuoteUserMessage(props: UserQuoteMessageProps) {
  return <SelectionQuoteMessage {...props} />
}

export function SelectionQuoteSteeringMessage(props: SteeringQuoteMessageProps) {
  return <SelectionQuoteMessage {...props} />
}

export function createSelectionQuoteSource(): InputTriggerSource {
  return {
    trigger: '@',
    name: SELECTION_QUOTE_SOURCE,
    showGroupTitle: false,
    candidates: async () => [],
    onPick: () => undefined,
    codec: {
      clipboardText: () => ' ',
      serialize: async ref => serializeSelectionQuote(ref),
    },
  }
}

export function applySelectionQuote(ctx: Context): void {
  installSelectionQuoteStyles()
  ctx.effect(() => ctx.inputTriggers.registerSource(createSelectionQuoteSource()), 'desktop: selection quote reference codec')
  ctx.slots.inject('conversation.input.overlay', () => ctx.slots.register({
    name: 'conversation.input.overlay', id: 'desktop-selection-quote', order: 40,
    inject: (sessionId) => {
      const actx = (ctx.get('sessions') as unknown as ISessions).scope(sessionId)
      if (actx === undefined) throw new Error(`selection quote resolved no scope for session "${sessionId}"`)
      return { actx }
    },
  }, SelectionQuoteOverlay))
  ctx.slots.inject('conversation.chat.node', () => {
    const user = ctx.slots.register({ name: 'conversation.chat.node', key: 'user', priority: -10, locale: 'chat' }, SelectionQuoteUserMessage)
    const steering = ctx.slots.register({ name: 'conversation.chat.node', key: 'steering', priority: -10, locale: 'chat' }, SelectionQuoteSteeringMessage)
    return () => { user(); steering() }
  })
}

