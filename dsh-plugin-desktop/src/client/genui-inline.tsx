import { createElement, useMemo, useSyncExternalStore, type ComponentType, type ReactNode } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { AssistantBlock, ChatNodeViewProps, ChatSnapshot, ToolChatData, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import { createSnapshotStore } from '@deepseek-ai/dsh-client-store'
import type { StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import { registerEntryProjection } from './shortcut-presentation.tsx'
import { GenuiResultView } from './genui-result.tsx'
import { genuiResultId, genuiResults } from './genui-results.ts'
import { canPlaceGenuiText, splitGenuiText } from './genui-placement.ts'

const EMPTY: readonly ToolChatData[] = []
const EMPTY_SOURCE = { getSnapshot: () => EMPTY, subscribe: () => () => {} }
interface InlineContext {
  chat: ObservableSnapshot<ChatSnapshot | undefined>
  zh: boolean
  visuals?: boolean
  retry: (turn: number) => Promise<void>
}
function useResults(chat: InlineContext['chat'], turn: number) {
  const snapshot = useSyncExternalStore(listener => chat.subscribe(listener), () => chat.getSnapshot())
  const source = snapshot?.nodes.turnDataSource(turn, 'tool-call') ?? EMPTY_SOURCE
  const tools = useSyncExternalStore(listener => source.subscribe(listener), () => source.getSnapshot())
  return useMemo(() => new Map(genuiResults(tools).flatMap(result => {
    const id = genuiResultId(result)
    return id === undefined ? [] : [[id, result] as const]
  })), [tools])
}
const withoutMarkers = (text: string) => splitGenuiText(text).flatMap(part => part.kind === 'text' ? [part.text] : []).join('')

/** A native Markdown pass remains readable when visual presentation is disabled. */
function readableBlocks(blocks: readonly AssistantBlock[], results: ReadonlyMap<string, ToolResultNode>, zh: boolean) {
  const used = new Set<string>()
  return blocks.map(block => block.kind !== 'text' ? block : { ...block,
    text: splitGenuiText(block.text).map(part => {
      if (part.kind === 'text') return part.text
      if (part.kind !== 'result' || used.has(part.id)) return ''
      used.add(part.id)
      const result = results.get(part.id)
      return result ? result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n') + '\n'
        : (zh ? '交互内容暂不可用。\n' : 'Interactive content unavailable.\n')
    }).join(''),
  })
}

/** Keep native Markdown, reasoning, images and file actions; split only explicit block boundaries. */
export function GenuiAssistantView(props: Parameters<typeof AnchoredAssistantView>[0]) {
  const { Native, genui: _genui, ...native } = props
  if (!props.node.data.blocks.some(block => block.kind === 'text' && block.text.includes('[[clawclaw-ui:'))) return createElement(Native, native)
  return <AnchoredAssistantView {...props} />
}

function AnchoredAssistantView({ Native, genui, ...props }: ChatNodeViewProps<'assistant-step'> & {
  Native: ComponentType<ChatNodeViewProps<'assistant-step'>>; genui: InlineContext
}) {
  const results = useResults(genui.chat, props.node.data.turn)
  const process = props.useTurnData('turn-process')
  const blocks = props.node.data.blocks
  if (!blocks.some(block => block.kind === 'text' && splitGenuiText(block.text).some(part => part.kind !== 'text'))) {
    return createElement(Native, props)
  }
  const nodeWith = (subset: readonly AssistantBlock[]) => ({ ...props.node, data: { ...props.node.data, blocks: subset } })
  if (genui.visuals === false) return createElement(Native, { ...props, node: nodeWith(readableBlocks(blocks, results, genui.zh)) })
  const eligible = props.node.data.status === 'settled' && process?.answerStep === props.node.data.step && props.groupPart !== 'reasoning'
  if (!eligible) return createElement(Native, { ...props, node: nodeWith(blocks.map(block =>
    block.kind === 'text' ? { ...block, text: withoutMarkers(block.text) } : block)) })
  const output: ReactNode[] = []
  const used = new Set<string>()
  let pending: AssistantBlock[] = []
  let index = 0
  const flush = () => {
    if (pending.length) output.push(createElement(Native, { ...props, key: `text-${index++}`, node: nodeWith(pending) }))
    pending = []
  }
  for (const block of blocks) {
    if (block.kind !== 'text') { pending.push(block); continue }
    if (!canPlaceGenuiText(block.text)) { pending.push({ ...block, text: withoutMarkers(block.text) }); continue }
    for (const part of splitGenuiText(block.text)) {
      if (part.kind === 'text') { pending.push({ kind: 'text', text: part.text }); continue }
      if (part.kind !== 'result' || used.has(part.id)) continue
      used.add(part.id); flush()
      const result = results.get(part.id)
      output.push(result ? <GenuiResultView key={JSON.stringify([part.id, result.callId])} sessionId={String(props.sessionId)} callId={result.callId}
        meta={result.meta} text={result.content.flatMap(block => block.type === 'text' ? [block.text] : []).join('\n')}
        isError={false} zh={genui.zh} repair={() => genui.retry(props.node.data.turn)} />
        : <p key={`missing-${part.id}`} className="clawGenuiDiagnostic" role="status">{genui.zh ? '此处的交互内容暂不可用。' : 'This interactive result is currently unavailable.'}</p>)
    }
  }
  flush()
  return <div className="clawGenuiInlineAnswer">{output}</div>
}

/** Clipboard text receives the readable tool fallback, never internal placement markers. */
export function GenuiFooterView(props: Parameters<typeof AnchoredFooterView>[0]) {
  const { Native, genui: _genui, ...native } = props
  if (!props.node.data.closing?.blocks.some(block => block.kind === 'text' && block.text.includes('[[clawclaw-ui:'))) return createElement(Native, native)
  return <AnchoredFooterView {...props} />
}

function AnchoredFooterView({ Native, genui, ...props }: ChatNodeViewProps<'turn-tail'> & {
  Native: ComponentType<ChatNodeViewProps<'turn-tail'>>; genui: InlineContext
}) {
  const results = useResults(genui.chat, props.node.data.turn)
  const closing = props.node.data.closing
  if (!closing) return createElement(Native, props)
  if (!closing.blocks.some(block => block.kind === 'text' && splitGenuiText(block.text).some(part => part.kind !== 'text'))) return createElement(Native, props)
  const blocks = readableBlocks(closing.blocks, results, genui.zh)
  return createElement(Native, { ...props, node: { ...props.node, data: { ...props.node.data, closing: { ...closing, blocks } } } })
}

const VISUALS_ON = { getSnapshot: () => true, subscribe: () => () => {} }

/** Reuse the desktop projection adapter; the original entries keep child-slot ownership. */
export function installGenuiInline(ctx: Context, retry: (sessionId: string, turn: number) => Promise<void>,
  enabled: ObservableSnapshot<boolean> = VISUALS_ON) {
  const available = createSnapshotStore(false)
  const records = new Map<string, { source: StoredEntry; component: unknown; dispose: () => void }>()
  let installing = false
  let disposed = false
  const install = () => {
    if (installing || disposed) return
    installing = true
    try {
      const entries = ctx.slots.entries('conversation.chat.node')
      for (const [key, record] of records) if (!entries.includes(record.source)) {
        record.dispose(); records.delete(key)
        if (key === 'assistant-step') available.set(false)
      }
      for (const key of ['assistant-step', 'turn-tail'] as const) {
        const source = ctx.slots.entries('conversation.chat.node').find(entry => entry.options.key === key && ![...records.values()].some(record => record.component === entry.component))
        if (!source || records.get(key)?.source === source) continue
        records.get(key)?.dispose(); records.delete(key)
        const View = key === 'assistant-step' ? GenuiAssistantView : GenuiFooterView
        function InlineNode({ sectionComponent: Native, ...props }: Record<string, unknown>) {
          const locale = useSyncExternalStore(listener => ctx.locale.subscribe(listener), () => ctx.locale.getSnapshot())
          const visuals = useSyncExternalStore(listener => enabled.subscribe(listener), () => enabled.getSnapshot())
          const id = String(props.sessionId)
          return createElement(View as ComponentType<never>, { ...props, Native, genui: {
            chat: ctx.uiConversation.binding(id as never).target('chat'), visuals,
            zh: locale.active.startsWith('zh'), retry: (turn: number) => retry(id, turn),
          } } as never)
        }
        const dispose = registerEntryProjection(ctx, source, { name: 'conversation.chat.node', key,
          priority: (source.options.priority ?? 0) - 1 }, InlineNode)
        records.set(key, { source, component: InlineNode, dispose })
        if (key === 'assistant-step') available.set(true)
      }
    } finally { installing = false }
  }
  const stop = ctx.on('slots/changed', name => { if (name === 'conversation.chat.node') install() })
  const dispose = () => {
    if (disposed) return
    disposed = true; stop(); available.set(false)
    for (const record of records.values()) record.dispose()
    records.clear()
  }
  try { install() } catch (cause) { dispose(); throw cause }
  return { available, dispose }
}
