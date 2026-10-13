import type { Context } from '@deepseek-ai/cordis'
import type {
  ISessions, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { ConversationViewsProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISidebarRight, SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type {
  PropsRenderFactories, PropsRenderSlots, PropsRuntime,
} from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import {
  DESKTOP_SELECTION_SIDECHAT_CREATE_PATH,
  parseSelectionSideChatCreateResult,
} from '../selection-sidechat-contract.ts'
import type { SelectionQuoteSource } from './selection-quote-source.ts'

export const SELECTION_SIDECHAT_KIND = 'desktop-selection-sidechat'
export const SELECTION_SIDECHAT_ADDRESS = 'dsh-resource://selection-sidechat/session/'

export interface SelectionSideChatContext {
  readonly context?: string
  readonly source?: SelectionQuoteSource
  readonly text: string
}

export interface SelectionSideChatResource {
  readonly reference: SessionReference
  readonly sessionId: SessionId
}

declare module '@deepseek-ai/dsh-api-session-controller/client' {
  interface SessionReferenceSourceMap {
    selectionSideChat: unknown
  }
}

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface ResourceProtocolMap {
    'selection-sidechat': SelectionSideChatResource
  }

  interface SlotMap {
    'desktop.selection-sidechat.conversation': { kind: 'single'; scope: 'session' }
  }
}

const pendingContexts = new Map<SessionId, SelectionSideChatContext>()
const creatingByParent = new Map<SessionId, Promise<SessionId>>()

export type SelectionSideChatCreator = (parentSessionId: SessionId) => Promise<SessionId>

/** Ask the Desktop Host to create an empty ordinary Session linked to the parent. */
export async function createSelectionSideChatSession(
  parentSessionId: SessionId,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<SessionId> {
  const response = await fetcher(DESKTOP_SELECTION_SIDECHAT_CREATE_PATH, {
    method: 'POST',
    credentials: 'same-origin',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
    body: JSON.stringify({ parentSessionId }),
  })
  const value: unknown = await response.json()
  if (!response.ok) {
    const message = value !== null && typeof value === 'object' && !Array.isArray(value)
      && typeof (value as Record<string, unknown>).error === 'string'
      ? (value as Record<string, unknown>).error as string
      : `Selection side-chat creation failed (HTTP ${String(response.status)})`
    throw new Error(message)
  }
  return parseSelectionSideChatCreateResult(value).sessionId
}

export function selectionSideChatAddress(sessionId: SessionId): string {
  return `${SELECTION_SIDECHAT_ADDRESS}${encodeURIComponent(sessionId)}`
}

export function parseSelectionSideChatAddress(value: string): SessionId | undefined {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'dsh-resource:' || url.hostname.toLowerCase() !== 'selection-sidechat') return undefined
  const parts = url.pathname.split('/').filter(Boolean)
  if (parts.length !== 2 || parts[0] !== 'session' || url.search !== '' || url.hash !== '') return undefined
  try {
    const sessionId = decodeURIComponent(parts[1] as string)
    return sessionId === '' ? undefined : sessionId as SessionId
  } catch {
    return undefined
  }
}

/** Read the selected context waiting for this Session's standard composer. */
export function pendingSelectionSideChatContext(sessionId: SessionId): SelectionSideChatContext | undefined {
  return pendingContexts.get(sessionId)
}

/** Clear selected context only after the standard composer accepted it. */
export function consumeSelectionSideChatContext(sessionId: SessionId): void {
  pendingContexts.delete(sessionId)
}

function waitForAbort(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve()
  return new Promise(resolve => signal.addEventListener('abort', () => { resolve() }, { once: true }))
}

function resourceProvider(sessions: ISessions): ResourceProvider<'selection-sidechat'> {
  return {
    protocol: 'selection-sidechat',
    async *open(address, { signal }) {
      const sessionId = parseSelectionSideChatAddress(address)
      if (sessionId === undefined) throw new Error(`selection side chat: invalid resource address "${address}"`)
      if (signal.aborted) return
      const reference = sessions.retain(sessionId, { source: 'selectionSideChat', signal })
      try {
        yield { ok: true, value: { reference, sessionId } }
        await waitForAbort(signal)
      } finally {
        reference.release()
      }
    },
  }
}

export type SelectionSideChatTabProps =
  PropsRuntime<'sidebar.right.pane.tab'> & PropsRenderSlots<'desktop.selection-sidechat.conversation'>

export function SelectionSideChatView(props: ConversationViewsProps) {
  return <>{props.renderSlot('conversation.session', { view: 'chat' })}</>
}

export type SelectionSideChatConversationProps =
  PropsRuntime<'desktop.selection-sidechat.conversation'> & PropsRenderFactories

/** Adapt the standard Conversation shell to a compact, explicitly bound child Session. */
export function SelectionSideChatConversation({
  useSession, renderFactorySlot,
}: SelectionSideChatConversationProps) {
  const session = useSession(value => value)
  const phase = session.openState === 'loading' ? 'settling' : 'active'
  return renderFactorySlot('conversation.content', { variant: 'embedded', phase, hero: false }, {
    slots: { views: SelectionSideChatView },
  })
}

/** Bind a Desktop-created Session to the upstream embedded Conversation slot. */
export function SelectionSideChatTab({
  useResource, useTabInfo, SessionProvider, renderSlot,
}: SelectionSideChatTabProps) {
  const { tab } = useTabInfo()
  const resource = useResource<'selection-sidechat'>(tab.contentId)
  if (resource.value === undefined) return null
  return (
    <div className="clawSelectionSideChat" data-selection-sidechat="">
      <SessionProvider session={resource.value.reference}>
        {renderSlot('desktop.selection-sidechat.conversation', {})}
      </SessionProvider>
    </div>
  )
}

function labels(): { tab: string } {
  const chinese = (document.documentElement.lang || navigator.language).toLocaleLowerCase().startsWith('zh')
  return { tab: chinese ? '侧边聊天' : 'Side chat' }
}

/** Create a child conversation, attach the selected quote to its composer, and open it aside. */
export function startSelectionSideChat(
  sidebarRight: Pick<ISidebarRight, 'openResource'>,
  parentSessionId: SessionId,
  context: SelectionSideChatContext,
  createChild: SelectionSideChatCreator = createSelectionSideChatSession,
): Promise<SessionId> {
  const existing = creatingByParent.get(parentSessionId)
  if (existing !== undefined) return existing
  const creation = (async () => {
    const sessionId = await createChild(parentSessionId)
    pendingContexts.set(sessionId, context)
    try {
      sidebarRight.openResource(selectionSideChatAddress(sessionId), {
        kind: SELECTION_SIDECHAT_KIND,
        preferNewPane: true,
      })
      return sessionId
    } catch (cause) {
      pendingContexts.delete(sessionId)
      throw cause
    }
  })()
  creatingByParent.set(parentSessionId, creation)
  void creation.finally(() => {
    if (creatingByParent.get(parentSessionId) === creation) creatingByParent.delete(parentSessionId)
  }).catch(() => undefined)
  return creation
}

export function applySelectionSideChat(ctx: Context): void {
  ctx.inject(['resources', 'sidebarRightTabs'], (scope: Context) => {
    scope.effect(
      () => scope.resources.register(resourceProvider(scope.get('sessions') as unknown as ISessions)),
      'desktop: selection side-chat resources',
    )
    scope.effect(() => scope.sidebarRightTabs.register({
      id: SELECTION_SIDECHAT_KIND,
      kind: SELECTION_SIDECHAT_KIND,
      patterns: [`${SELECTION_SIDECHAT_ADDRESS}**`],
      priority: 'builtin',
      canOpen: address => parseSelectionSideChatAddress(address) !== undefined,
      title: () => labels().tab,
    } satisfies SidebarRightTabDefinition), 'desktop: selection side-chat type')
    scope.effect(() => scope.slots.inject('sidebar.right.pane.tab', () => scope.slots.register({
      name: 'sidebar.right.pane.tab',
      key: SELECTION_SIDECHAT_KIND,
      children: { 'desktop.selection-sidechat.conversation': { kind: 'single', scope: 'session' } },
    }, SelectionSideChatTab)), 'desktop: selection side-chat body')
    scope.effect(() => scope.slots.inject('desktop.selection-sidechat.conversation', () => scope.slots.register({
      name: 'desktop.selection-sidechat.conversation',
    }, SelectionSideChatConversation)), 'desktop: selection side-chat Conversation')
  })
}
