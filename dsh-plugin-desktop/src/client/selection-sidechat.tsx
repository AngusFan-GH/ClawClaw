import {
  useCallback, useLayoutEffect, useRef, useState,
  type FormEvent, type KeyboardEvent,
} from 'react'
// @ts-expect-error package subpath has no declaration file
import ArrowUp from 'lucide-react/dist/esm/icons/arrow-up.mjs'
// @ts-expect-error package subpath has no declaration file
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.mjs'
// @ts-expect-error package subpath has no declaration file
import Quote from 'lucide-react/dist/esm/icons/quote.mjs'
// @ts-expect-error package subpath has no declaration file
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.mjs'
import type { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ISidebarRight, SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  DESKTOP_SELECTION_SIDECHAT_START_PATH,
  MAX_SELECTION_SIDECHAT_QUESTION_LENGTH,
  parseSelectionSideChatStartResult,
  selectionSideChatLabel,
} from '../selection-sidechat-contract.ts'
import type { SelectionQuoteSource } from './selection-quote-source.ts'

export const SELECTION_SIDECHAT_KIND = 'desktop-selection-sidechat'
export const SELECTION_SIDECHAT_ADDRESS = 'dsh-resource://selection-sidechat/draft/'
const SUBAGENT_CHAT_KIND = 'subagentchat'
const SUBAGENT_CHAT_SLOT_KEY = '@deepseek-ai/dsh-client-ui-subagent'
const SUBAGENT_CHAT_ADDRESS = 'dsh-resource://subagentchat/session/'
const MAX_REMEMBERED_TITLES = 200

export interface SelectionSideChatContext {
  readonly context?: string
  readonly source?: SelectionQuoteSource
  readonly text: string
}

interface SelectionSideChatDraft {
  readonly context: SelectionSideChatContext
  readonly draftId: string
  readonly parentSessionId: SessionId
}

export interface SelectionSideChatResource {
  readonly draft?: SelectionSideChatDraft
  readonly draftId: string
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'selection-sidechat': SelectionSideChatResource
  }
}

const drafts = new Map<string, SelectionSideChatDraft>()
const childTitles = new Map<SessionId, string>()

export type SelectionSideChatStarter = (
  parentSessionId: SessionId,
  question: string,
  context: SelectionSideChatContext,
  signal?: AbortSignal,
) => Promise<{ childSessionId: SessionId; mode: 'continuable'; parentSessionId: SessionId }>

export async function startSelectionSideChatSession(
  parentSessionId: SessionId,
  question: string,
  context: SelectionSideChatContext,
  signal?: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): ReturnType<SelectionSideChatStarter> {
  const response = await fetcher(DESKTOP_SELECTION_SIDECHAT_START_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentSessionId, question, quote: context }),
    ...(signal === undefined ? {} : { signal }),
  })
  const value: unknown = await response.json()
  if (!response.ok) {
    const message = value !== null && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).error === 'string'
      ? (value as Record<string, unknown>).error as string
      : `Selection side-chat creation failed (HTTP ${String(response.status)})`
    throw new Error(message)
  }
  return parseSelectionSideChatStartResult(value)
}

export function selectionSideChatAddress(draftId: string): string {
  return `${SELECTION_SIDECHAT_ADDRESS}${encodeURIComponent(draftId)}`
}

export function parseSelectionSideChatAddress(value: string): string | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== 'selection-sidechat') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'draft' || url.search !== '' || url.hash !== '') return undefined
  try {
    const draftId = decodeURIComponent(parts[1] as string)
    return draftId === '' ? undefined : draftId
  } catch {
    return undefined
  }
}

export function subagentChatAddress(
  parentSessionId: SessionId,
  childSessionId: SessionId,
): string {
  const query = new URLSearchParams({ parent: parentSessionId, mode: 'continuable' })
  return `${SUBAGENT_CHAT_ADDRESS}${encodeURIComponent(childSessionId)}?${query}`
}

function parseSubagentChildId(value: string): SessionId | undefined {
  let url: URL
  try { url = new URL(value) } catch { return undefined }
  if (url.protocol !== 'dsh-resource:' || url.hostname !== 'subagentchat') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'session') return undefined
  try { return decodeURIComponent(parts[1] as string) as SessionId } catch { return undefined }
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => signal.addEventListener('abort', () => { resolve() }, { once: true }))
}

function resourceProvider(): ResourceProvider<'selection-sidechat'> {
  return {
    protocol: 'selection-sidechat',
    async *open(address, { signal }) {
      const draftId = parseSelectionSideChatAddress(address)
      if (draftId === undefined) throw new Error(`selection side chat: invalid resource address "${address}"`)
      if (signal.aborted) return
      const draft = drafts.get(draftId)
      yield { ok: true, value: { draftId, ...(draft === undefined ? {} : { draft }) } }
      await waitForAbort(signal)
      drafts.delete(draftId)
    },
  }
}

function labels() {
  const chinese = (document.documentElement.lang || navigator.language).toLocaleLowerCase().startsWith('zh')
  return chinese
    ? {
        ask: '发送', close: '关闭', error: '发送失败', expired: '该未发送的侧边提问已失效', placeholder: '针对引用内容提问',
        quote: '引用内容', retry: '重试', sending: '正在创建侧边对话', tab: '侧边聊天',
      }
    : {
        ask: 'Send', close: 'Close', error: 'Could not send', expired: 'This unsent side-chat draft has expired',
        placeholder: 'Ask about the quoted text', quote: 'Quoted context', retry: 'Retry',
        sending: 'Creating side chat', tab: 'Side chat',
      }
}

function rememberChildTitle(childSessionId: SessionId, title: string): void {
  childTitles.delete(childSessionId)
  childTitles.set(childSessionId, title)
  while (childTitles.size > MAX_REMEMBERED_TITLES) {
    const oldest = childTitles.keys().next().value as SessionId | undefined
    if (oldest === undefined) break
    childTitles.delete(oldest)
  }
}

export type SelectionSideChatTabProps = PropsRuntime<'sidebar.right.pane.tab'> & {
  readonly startChild?: SelectionSideChatStarter
}

function DraftComposer({ draft, signal, actions, startChild = startSelectionSideChatSession }: {
  readonly actions: { close(): void; openResource(address: string, options?: object): void }
  readonly draft: SelectionSideChatDraft
  readonly signal: AbortSignal
  readonly startChild?: SelectionSideChatStarter
}) {
  const copy = labels()
  const [question, setQuestion] = useState('')
  const [failure, setFailure] = useState<string>()
  const [submitting, setSubmitting] = useState(false)
  const [created, setCreated] = useState<Awaited<ReturnType<SelectionSideChatStarter>>>()
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const submittingRef = useRef(false)

  useLayoutEffect(() => { textareaRef.current?.focus() }, [])
  useLayoutEffect(() => {
    const textarea = textareaRef.current
    if (textarea === null) return
    textarea.style.height = '0px'
    textarea.style.height = `${Math.min(180, Math.max(44, textarea.scrollHeight))}px`
  }, [question])

  const openChild = useCallback((child: Awaited<ReturnType<SelectionSideChatStarter>>) => {
    rememberChildTitle(child.childSessionId, draft.context.text)
    actions.openResource(subagentChatAddress(child.parentSessionId, child.childSessionId), {
      kind: SUBAGENT_CHAT_KIND,
      replaceTab: true,
    })
  }, [actions, draft.context.text])

  const submit = useCallback(async () => {
    const prompt = question.trim()
    if (prompt === '' || submittingRef.current) return
    submittingRef.current = true
    setFailure(undefined)
    setSubmitting(true)
    try {
      if (created !== undefined) {
        openChild(created)
        return
      }
      const child = await startChild(draft.parentSessionId, prompt, draft.context, signal)
      if (signal.aborted) return
      setCreated(child)
      openChild(child)
    } catch (cause) {
      if (!signal.aborted) setFailure(cause instanceof Error ? cause.message : copy.error)
    } finally {
      submittingRef.current = false
      if (!signal.aborted) setSubmitting(false)
    }
  }, [copy.error, created, draft, openChild, question, signal, startChild])

  const onSubmit = (event: FormEvent) => { event.preventDefault(); void submit() }
  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key !== 'Enter' || event.shiftKey || event.nativeEvent.isComposing) return
    event.preventDefault()
    void submit()
  }

  return (
    <form className="clawSelectionSideChatDraft" onSubmit={onSubmit}>
      <div className="clawSelectionSideChatDraftSpace" />
      <div className="clawSelectionSideChatDraftComposer" data-composer-card="">
        <div className="clawSelectionSideChatDraftQuote">
          <Quote aria-hidden="true" />
          <div><span>{copy.quote}</span><p title={draft.context.text}>{draft.context.text}</p></div>
        </div>
        {failure !== undefined && (
          <div className="clawSelectionSideChatDraftError" role="alert">
            <span>{failure}</span>
            <button type="button" onClick={() => { created === undefined ? void submit() : openChild(created) }}>
              <RotateCcw aria-hidden="true" />{copy.retry}
            </button>
          </div>
        )}
        <textarea
          ref={textareaRef}
          value={question}
          maxLength={MAX_SELECTION_SIDECHAT_QUESTION_LENGTH}
          placeholder={copy.placeholder}
          aria-label={copy.placeholder}
          disabled={submitting}
          onChange={event => { setQuestion(event.target.value) }}
          onKeyDown={onKeyDown}
        />
        <div className="clawSelectionSideChatDraftActions">
          <button
            type="submit"
            className="clawSelectionSideChatDraftSend"
            title={submitting ? copy.sending : copy.ask}
            aria-label={submitting ? copy.sending : copy.ask}
            disabled={submitting || question.trim() === ''}
          >
            {submitting ? <LoaderCircle className="clawSelectionSideChatSpinner" aria-hidden="true" /> : <ArrowUp aria-hidden="true" />}
          </button>
        </div>
      </div>
    </form>
  )
}

export function SelectionSideChatTab({ useResource, useTabInfo, startChild }: SelectionSideChatTabProps) {
  const { tab } = useTabInfo()
  const resource = useResource<'selection-sidechat'>(tab.contentId)
  const copy = labels()
  if (resource.value === undefined) return null
  if (resource.value.draft === undefined) {
    return (
      <div className="clawSelectionSideChatExpired" data-selection-sidechat="">
        <p>{copy.expired}</p>
        <button type="button" onClick={tab.actions.close}>{copy.close}</button>
      </div>
    )
  }
  return (
    <div className="clawSelectionSideChat" data-selection-sidechat="">
      <DraftComposer
        draft={resource.value.draft}
        signal={tab.signal}
        actions={tab.actions}
        {...startChild === undefined ? {} : { startChild }}
      />
    </div>
  )
}

export function SelectionSideChatDraftTitle({ useResource, useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>) {
  const { tab } = useTabInfo()
  const resource = useResource<'selection-sidechat'>(tab.contentId)
  const title = resource.value?.draft?.context.text ?? tab.title
  return <span className="clawSelectionSideChatTabTitle" title={title}>{selectionSideChatLabel(title)}</span>
}

export function SubagentSideChatTitle({ useSessions, useTabInfo }: PropsRuntime<'sidebar.right.pane.tab.title'>) {
  const { tab } = useTabInfo()
  const childId = parseSubagentChildId(tab.contentId)
  const projected = useSessions(state => childId === undefined
    ? undefined
    : state.byId[childId]?.projectionValues?.subagent?.label)
  const title = childId === undefined ? tab.title : childTitles.get(childId) ?? projected ?? tab.title
  return <span className="clawSelectionSideChatTabTitle" title={title}>{title}</span>
}

/** Open a unique draft as another tab in the current pane; the user controls tab switching. */
export function startSelectionSideChat(
  sidebarRight: Pick<ISidebarRight, 'openResource'>,
  parentSessionId: SessionId,
  context: SelectionSideChatContext,
): string {
  const draftId = globalThis.crypto.randomUUID()
  drafts.set(draftId, { context, draftId, parentSessionId })
  try {
    sidebarRight.openResource(selectionSideChatAddress(draftId), {
      kind: SELECTION_SIDECHAT_KIND,
      revealIfOpened: false,
    })
  } catch (cause) {
    drafts.delete(draftId)
    throw cause
  }
  return draftId
}

export function applySelectionSideChat(ctx: Context): void {
  ctx.inject(['resources', 'sidebarRightTabs'], (scope: Context) => {
    scope.effect(() => scope.resources.register(resourceProvider()), 'desktop: selection side-chat drafts')
    scope.effect(() => scope.sidebarRightTabs.register({
      id: SELECTION_SIDECHAT_KIND,
      kind: SELECTION_SIDECHAT_KIND,
      patterns: [`${SELECTION_SIDECHAT_ADDRESS}**`],
      priority: 'builtin',
      canOpen: address => parseSelectionSideChatAddress(address) !== undefined,
      title: address => {
        const draftId = parseSelectionSideChatAddress(address)
        const text = draftId === undefined ? undefined : drafts.get(draftId)?.context.text
        return text === undefined ? labels().tab : selectionSideChatLabel(text)
      },
    } satisfies SidebarRightTabDefinition), 'desktop: selection side-chat type')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab', key: SELECTION_SIDECHAT_KIND,
    }, SelectionSideChatTab)), 'desktop: selection side-chat draft body')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
      name: 'sidebar.right.pane.tab.title', key: SELECTION_SIDECHAT_KIND,
    }, SelectionSideChatDraftTitle)), 'desktop: selection side-chat draft title')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab.title', () => scope.slots.register({
      name: 'sidebar.right.pane.tab.title', key: SUBAGENT_CHAT_SLOT_KEY,
    }, SubagentSideChatTitle)), 'desktop: subagent side-chat title')
  })
}
