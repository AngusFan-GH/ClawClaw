import {
  useCallback, useEffect, useRef, useState,
  type CSSProperties,
} from 'react'
// @ts-expect-error package subpath has no declaration file
import LoaderCircle from 'lucide-react/dist/esm/icons/loader-circle.mjs'
// @ts-expect-error package subpath has no declaration file
import Quote from 'lucide-react/dist/esm/icons/quote.mjs'
// @ts-expect-error package subpath has no declaration file
import RotateCcw from 'lucide-react/dist/esm/icons/rotate-ccw.mjs'
import type { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISidebarRight, SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { PropsRenderFactories, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  DESKTOP_SELECTION_SIDECHAT_PREPARE_PATH,
  isSelectionSideChatSessionId,
  parseSelectionSideChatPrepareResult,
  selectionSideChatLabel,
  type SelectionSideChatQuote,
  type SelectionSideChatPrepareResult,
} from '../selection-sidechat-contract.ts'

export const SELECTION_SIDECHAT_KIND = 'desktop-selection-sidechat'
export const SELECTION_SIDECHAT_ADDRESS = 'dsh-resource://selection-sidechat/draft/'
const SUBAGENT_CHAT_KIND = 'subagentchat'
const SUBAGENT_CHAT_SLOT_KEY = '@deepseek-ai/dsh-client-ui-subagent'
const SUBAGENT_CHAT_ADDRESS = 'dsh-resource://subagentchat/session/'
const MAX_REMEMBERED_TITLES = 200
const SIDE_CHAT_CONVERSATION_STYLE = {
  position: 'absolute',
  inset: 0,
  display: 'flex',
  flexDirection: 'column',
  width: '100%',
  height: '100%',
  minWidth: 0,
  minHeight: 0,
  overflow: 'hidden',
} satisfies CSSProperties

interface SelectionSideChatDraft {
  readonly context: SelectionSideChatQuote
  readonly parentSessionId: SessionId
}

export interface SelectionSideChatResource {
  readonly draft?: SelectionSideChatDraft
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'selection-sidechat': SelectionSideChatResource
  }

  interface SlotMap {
    'sidebar.chat.conversation': { kind: 'single'; scope: 'session' }
  }
}

const drafts = new Map<string, SelectionSideChatDraft>()
const childTitles = new Map<SessionId, string>()
const pendingContexts = new Map<SessionId, SelectionSideChatQuote>()

export type SelectionSideChatPreparer = (
  parentSessionId: SessionId,
  context: SelectionSideChatQuote,
  signal?: AbortSignal,
) => Promise<SelectionSideChatPrepareResult>

export async function prepareSelectionSideChatSession(
  parentSessionId: SessionId,
  context: SelectionSideChatQuote,
  signal?: AbortSignal,
  fetcher: typeof fetch = globalThis.fetch,
): ReturnType<SelectionSideChatPreparer> {
  const response = await fetcher(DESKTOP_SELECTION_SIDECHAT_PREPARE_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentSessionId, quote: context }),
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
  return parseSelectionSideChatPrepareResult(value)
}

export function pendingSelectionSideChatContext(sessionId: SessionId): SelectionSideChatQuote | undefined {
  return pendingContexts.get(sessionId)
}

export function consumeSelectionSideChatContext(sessionId: SessionId): void {
  pendingContexts.delete(sessionId)
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
      yield { ok: true, value: draft === undefined ? {} : { draft } }
      await waitForAbort(signal)
      drafts.delete(draftId)
    },
  }
}

function labels() {
  const chinese = (document.documentElement.lang || navigator.language).toLocaleLowerCase().startsWith('zh')
  return chinese
    ? {
        close: '关闭', error: '无法创建侧边对话', expired: '该侧边提问已失效',
        quote: '引用内容', retry: '重试', sending: '正在准备侧边对话', tab: '侧边聊天',
      }
    : {
        close: 'Close', error: 'Could not create side chat', expired: 'This side-chat request has expired',
        quote: 'Quoted context', retry: 'Retry', sending: 'Preparing side chat', tab: 'Side chat',
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
  readonly prepareChild?: SelectionSideChatPreparer
}

function PreparingSideChat({ draft, signal, actions, prepareChild = prepareSelectionSideChatSession }: {
  readonly actions: { openResource(address: string, options?: object): void }
  readonly draft: SelectionSideChatDraft
  readonly signal: AbortSignal
  readonly prepareChild?: SelectionSideChatPreparer
}) {
  const copy = labels()
  const [failure, setFailure] = useState<string>()
  const createdRef = useRef<SelectionSideChatPrepareResult>()
  const preparingRef = useRef(false)
  const startedRef = useRef(false)

  const openChild = useCallback((child: SelectionSideChatPrepareResult) => {
    rememberChildTitle(child.childSessionId, draft.context.text)
    pendingContexts.set(child.childSessionId, draft.context)
    try {
      actions.openResource(subagentChatAddress(draft.parentSessionId, child.childSessionId), {
        kind: SUBAGENT_CHAT_KIND,
        replaceTab: true,
      })
    } catch (cause) {
      pendingContexts.delete(child.childSessionId)
      throw cause
    }
  }, [actions, draft.context, draft.parentSessionId])

  const prepare = useCallback(async () => {
    if (preparingRef.current) return
    preparingRef.current = true
    setFailure(undefined)
    try {
      if (createdRef.current !== undefined) {
        openChild(createdRef.current)
        return
      }
      const child = await prepareChild(draft.parentSessionId, draft.context, signal)
      if (signal.aborted) return
      createdRef.current = child
      openChild(child)
    } catch (cause) {
      if (!signal.aborted) setFailure(cause instanceof Error ? cause.message : copy.error)
    } finally {
      preparingRef.current = false
    }
  }, [copy.error, draft, openChild, prepareChild, signal])

  useEffect(() => {
    if (startedRef.current) return
    startedRef.current = true
    void prepare()
  }, [prepare])

  return (
    <div className="clawSelectionSideChatPreparing">
      <div className="clawSelectionSideChatPreparingQuote">
        <Quote aria-hidden="true" />
        <div><span>{copy.quote}</span><p title={draft.context.text}>{draft.context.text}</p></div>
      </div>
      {failure === undefined
        ? <div className="clawSelectionSideChatPreparingStatus" role="status">
          <LoaderCircle className="clawSelectionSideChatSpinner" aria-hidden="true" />
          <span>{copy.sending}</span>
        </div>
        : <div className="clawSelectionSideChatPreparingError" role="alert">
          <span>{failure}</span>
          <button type="button" onClick={() => { void prepare() }}>
            <RotateCcw aria-hidden="true" />{copy.retry}
          </button>
        </div>}
    </div>
  )
}

export function SelectionSideChatTab({ useResource, useTabInfo, prepareChild }: SelectionSideChatTabProps) {
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
      <PreparingSideChat
        draft={resource.value.draft}
        signal={tab.signal}
        actions={tab.actions}
        {...prepareChild === undefined ? {} : { prepareChild }}
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
  return <span className="clawSelectionSideChatTabTitle" title={title}>{selectionSideChatLabel(title)}</span>
}

function SideChatConversationView({ renderSlot }: ConversationViewsProps) {
  return <>{renderSlot('conversation.session', { view: 'chat' })}</>
}

export type SelectionSideChatConversationProps =
  PropsRuntime<'sidebar.chat.conversation'> & PropsRenderFactories

/** Keep a new selection child in the docked embedded layout before its first prompt. */
export function SelectionSideChatConversation({
  sessionId, useSession, useConversation, useSessions, renderFactorySlot,
}: SelectionSideChatConversationProps) {
  const session = useSession(value => value)
  const conversation = useConversation(value => value)
  const selectionSideChat = isSelectionSideChatSessionId(sessionId)
  const active = selectionSideChat
    || conversation.activeTargets.size > 0
    || (!session.blank && !session.awaitingFirstTurn)
    || session.running
  const shellPhase = active ? 'active' : session.promptAttempted ? 'engaging' : 'blank'
  const summaryBlank = useSessions(state => state.byId[sessionId]?.blank)
  const parentAvailabilityPending = session.subagent?.address.mode === 'continuable'
    && session.subagent.parentAvailable === undefined
  const settling = !selectionSideChat && (
    (shellPhase === 'blank' && session.openState === 'loading' && summaryBlank !== true)
    || parentAvailabilityPending
  )
  const hero = !selectionSideChat
    && shellPhase === 'blank'
    && (session.openState === 'open' || summaryBlank === true)
  const phase = settling ? 'settling' : hero ? 'hero' : 'active'
  const content = renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero }, {
    slots: { views: SideChatConversationView },
  })
  return selectionSideChat
    ? (
      <div className="clawSelectionSideChatConversation" style={SIDE_CHAT_CONVERSATION_STYLE}>
        {content}
      </div>
    )
    : content
}

/** Open a unique draft as another tab in the current pane; the user controls tab switching. */
export function startSelectionSideChat(
  sidebarRight: Pick<ISidebarRight, 'openResource'>,
  parentSessionId: SessionId,
  context: SelectionSideChatQuote,
): string {
  const draftId = globalThis.crypto.randomUUID()
  drafts.set(draftId, { context, parentSessionId })
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
    scope.effect(() => scope.slots.inject('sidebar.chat.conversation', () => scope.slots.register({
      name: 'sidebar.chat.conversation', priority: -10,
    }, SelectionSideChatConversation)), 'desktop: selection side-chat conversation layout')
  })
}
