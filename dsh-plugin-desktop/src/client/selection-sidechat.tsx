import { useEffect, useMemo, useRef, useState, useSyncExternalStore, type FormEvent, type KeyboardEvent } from 'react'
// @ts-expect-error package subpath has no declaration file
import Copy from 'lucide-react/dist/esm/icons/copy.mjs'
// @ts-expect-error package subpath has no declaration file
import CornerDownLeft from 'lucide-react/dist/esm/icons/corner-down-left.mjs'
// @ts-expect-error package subpath has no declaration file
import MessageSquareText from 'lucide-react/dist/esm/icons/message-square-text.mjs'
// @ts-expect-error package subpath has no declaration file
import Quote from 'lucide-react/dist/esm/icons/quote.mjs'
// @ts-expect-error package subpath has no declaration file
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.mjs'
import type { Context } from '@deepseek-ai/cordis'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import { MarkdownText, writeClipboard, type MarkdownLabels } from '@deepseek-ai/dsh-client-ui-primitives'
import { DESKTOP_SELECTION_SIDECHAT_PATH } from '../selection-sidechat.ts'
import type { SelectionSnapshot } from './selection-quote.tsx'

const TAB_KIND = 'desktop-selection-sidechat'
interface SideChatTurn { readonly answer: string; readonly question: string }
interface SideChatState {
  readonly error?: string
  readonly pending: boolean
  readonly revision: number
  readonly retryQuestion?: string
  readonly selection: string
  readonly turns: readonly SideChatTurn[]
}
const states = new Map<string, SideChatState>()
const listeners = new Set<() => void>()
const publish = () => { for (const listener of listeners) listener() }
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const stateOf = (sessionId: string): SideChatState => states.get(sessionId) ?? { pending: false, revision: 0, selection: '', turns: [] }
const update = (sessionId: string, state: SideChatState) => { states.set(sessionId, state); publish() }

export function startSelectionSideChat(ctx: Context, sessionId: string, snapshot: SelectionSnapshot): void {
  update(sessionId, { pending: false, revision: stateOf(sessionId).revision + 1, selection: snapshot.text, turns: [] })
  ctx.sidebarRight.openTab(TAB_KIND)
}

async function ask(sessionId: string, question: string): Promise<void> {
  const current = stateOf(sessionId)
  if (current.pending || current.selection === '') return
  const { error: _error, ...ready } = current
  update(sessionId, { ...ready, pending: true, retryQuestion: question })
  try {
    const response = await fetch(DESKTOP_SELECTION_SIDECHAT_PATH, {
      method: 'POST', credentials: 'same-origin', redirect: 'error',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ sessionId, selection: current.selection, question, history: current.turns }),
    })
    const value = await response.json() as { answer?: unknown; error?: unknown }
    if (!response.ok || typeof value.answer !== 'string') throw new Error(typeof value.error === 'string' ? value.error : `HTTP ${response.status}`)
    if (stateOf(sessionId).revision !== current.revision) return
    update(sessionId, { revision: current.revision, selection: current.selection, pending: false, turns: [...current.turns, { question, answer: value.answer }] })
  } catch (cause) {
    if (stateOf(sessionId).revision !== current.revision) return
    update(sessionId, { ...current, pending: false, retryQuestion: question, error: cause instanceof Error ? cause.message : String(cause) })
  }
}

function markdownLabels(): MarkdownLabels {
  const chinese = (document.documentElement.lang || navigator.language).toLocaleLowerCase().startsWith('zh')
  return {
    code: {
      copyLabel: chinese ? '复制代码' : 'Copy code',
      copiedLabel: chinese ? '已复制' : 'Copied',
      toolbarLabels: { codeLabel: chinese ? '代码' : 'Code', wrapLabel: chinese ? '自动换行' : 'Wrap', unwrapLabel: chinese ? '取消换行' : 'Unwrap' },
    },
    footnotes: chinese ? '脚注' : 'Footnotes',
  }
}

function sideChatLabels() {
  const chinese = (document.documentElement.lang || navigator.language).toLocaleLowerCase().startsWith('zh')
  return chinese ? {
    answer: '回答', copyAnswer: '复制回答', empty: '在对话中选择文本，然后点击“侧边提问”。',
    firstPlaceholder: '针对引用内容提问', followPlaceholder: '继续追问', quote: '引用内容', retry: '重试', send: '发送',
    suggestions: ['解释一下', '总结要点', '有什么风险？'], tab: '侧边对话', thinking: '正在思考',
  } : {
    answer: 'Answer', copyAnswer: 'Copy answer', empty: 'Select text in the conversation, then choose “Ask in side chat”.',
    firstPlaceholder: 'Ask about the selected text', followPlaceholder: 'Ask a follow-up', quote: 'Quoted context', retry: 'Retry', send: 'Send',
    suggestions: ['Explain this', 'Summarize', 'What are the risks?'], tab: 'Side chat', thinking: 'Thinking',
  }
}

type SideChatProps = PropsRuntime<'sidebar.right.pane.tab'> & { readonly sessionId: string }
export function SelectionSideChatPanel({ sessionId }: SideChatProps) {
  const state = useSyncExternalStore(subscribe, () => stateOf(sessionId), () => stateOf(sessionId))
  const [draft, setDraft] = useState('')
  const copy = useMemo(sideChatLabels, [])
  const answerLabels = useMemo(markdownLabels, [])
  const scrollRef = useRef<HTMLDivElement>(null)
  const composerRef = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    setDraft('')
    scrollRef.current?.scrollTo({ top: 0 })
    const frame = window.requestAnimationFrame(() => { composerRef.current?.focus() })
    return () => { window.cancelAnimationFrame(frame) }
  }, [state.revision])
  useEffect(() => {
    if (state.turns.length === 0 && !state.pending && state.error === undefined) return
    const frame = window.requestAnimationFrame(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' }) })
    return () => { window.cancelAnimationFrame(frame) }
  }, [state.error, state.pending, state.turns.length])
  const submit = (question: string) => {
    const value = question.trim()
    if (value === '' || state.pending) return
    setDraft('')
    void ask(sessionId, value)
  }
  const onSubmit = (event: FormEvent) => { event.preventDefault(); submit(draft) }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey && !event.nativeEvent.isComposing) { event.preventDefault(); submit(draft) }
  }
  if (state.selection === '') return <div className="clawSideChatEmpty"><MessageSquareText aria-hidden="true" /><p>{copy.empty}</p></div>
  return <div className="clawSideChat">
    <div ref={scrollRef} className="clawSideChatScroll">
      <section className="clawSideChatQuote"><Quote aria-hidden="true" /><div><span>{copy.quote}</span><p>{state.selection}</p></div></section>
      {state.turns.length === 0 && !state.pending && <div className="clawSideChatSuggestions">{copy.suggestions.map(item => <button type="button" key={item} onClick={() => { submit(item) }}>{item}</button>)}</div>}
      {state.turns.map((turn, index) => <div className="clawSideChatTurn" key={`${index}:${turn.question}`}>
        <p className="clawSideChatQuestion">{turn.question}</p>
        <div className="clawSideChatAnswer"><div className="clawSideChatAnswerLabel"><MessageSquareText aria-hidden="true" /><span>{copy.answer}</span><button type="button" title={copy.copyAnswer} aria-label={copy.copyAnswer} onClick={() => { void writeClipboard(turn.answer) }}><Copy aria-hidden="true" /></button></div><div className="clawSideChatAnswerBody"><MarkdownText text={turn.answer} labels={answerLabels} variant="compact" /></div></div>
      </div>)}
      {state.pending && <div className="clawSideChatThinking" role="status"><span /><span /><span />{copy.thinking}</div>}
      {state.error !== undefined && <div className="clawSideChatError" role="alert"><p>{state.error}</p><button type="button" onClick={() => { submit(state.retryQuestion ?? '') }}><RotateCcw aria-hidden="true" />{copy.retry}</button></div>}
    </div>
    <form onSubmit={onSubmit}><textarea ref={composerRef} value={draft} disabled={state.pending} rows={3} placeholder={state.turns.length === 0 ? copy.firstPlaceholder : copy.followPlaceholder} onChange={event => { setDraft(event.target.value) }} onKeyDown={onKeyDown} /><div><button type="submit" title={copy.send} aria-label={copy.send} disabled={state.pending || draft.trim() === ''}><CornerDownLeft aria-hidden="true" /></button></div></form>
  </div>
}

export function applySelectionSideChat(ctx: Context): void {
  ctx.inject(['sidebarRightTabs', 'sidebarRight'], (scope: Context) => {
    scope.effect(() => scope.sidebarRightTabs.register({ id: TAB_KIND, kind: TAB_KIND, keepMounted: true, title: () => sideChatLabels().tab }), 'desktop: selection side-chat tab type')
    scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab', key: TAB_KIND, inject: sessionId => ({ sessionId: String(sessionId) }),
    }, SelectionSideChatPanel))
    scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({ name: 'sidebar.right.pane.tab.title', key: TAB_KIND }, () => <span>{sideChatLabels().tab}</span>))
  })
}
