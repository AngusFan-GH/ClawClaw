// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SelectionQuoteOverlay, type SelectionQuoteOverlayProps } from '../src/client/selection-quote.tsx'
import { installSelectionQuoteStyles } from '../src/client/selection-quote-styles.ts'
import {
  applySelectionSideChat,
  consumeSelectionSideChatContext,
  parseSelectionSideChatAddress,
  pendingSelectionSideChatContext,
  prepareSelectionSideChatSession,
  selectionSideChatAddress,
  SelectionSideChatConversation,
  SelectionSideChatTab,
  SELECTION_SIDECHAT_KIND,
  startSelectionSideChat,
  subagentChatAddress,
  type SelectionSideChatResource,
  type SelectionSideChatTabProps,
} from '../src/client/selection-sidechat.tsx'

const PARENT = 'parent/a' as SessionId
const CHILD = 'child#1' as SessionId
const CONTEXT = {
  text: 'selected text that identifies this tab',
  context: 'the whole source message',
  source: { messageKey: 'assistant:1', startOffset: 0, endOffset: 8 },
}

afterEach(() => { vi.restoreAllMocks() })

describe('selection side-chat draft resource', () => {
  it('round-trips only canonical draft addresses', () => {
    expect(selectionSideChatAddress('draft#1')).toBe('dsh-resource://selection-sidechat/draft/draft%231')
    expect(parseSelectionSideChatAddress(selectionSideChatAddress('draft#1'))).toBe('draft#1')
    expect(parseSelectionSideChatAddress('https://selection-sidechat/draft/child')).toBeUndefined()
    expect(parseSelectionSideChatAddress('dsh-resource://selection-sidechat/session/child')).toBeUndefined()
    expect(parseSelectionSideChatAddress('dsh-resource://selection-sidechat/draft/child?extra=true')).toBeUndefined()
  })

  it('opens every selection as a distinct tab in the current pane', async () => {
    vi.spyOn(globalThis.crypto, 'randomUUID')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000001')
      .mockReturnValueOnce('00000000-0000-4000-8000-000000000002')
    const openResource = vi.fn()

    const first = startSelectionSideChat({ openResource }, PARENT, CONTEXT)
    const second = startSelectionSideChat({ openResource }, PARENT, CONTEXT)

    expect(first).not.toBe(second)
    expect(openResource).toHaveBeenNthCalledWith(1, selectionSideChatAddress(first), {
      kind: SELECTION_SIDECHAT_KIND,
      revealIfOpened: false,
    })
    expect(openResource).toHaveBeenNthCalledWith(2, selectionSideChatAddress(second), {
      kind: SELECTION_SIDECHAT_KIND,
      revealIfOpened: false,
    })
  })

  it('registers the draft body and live titles, and releases draft data on close', async () => {
    let provider: ResourceProvider<'selection-sidechat'> | undefined
    let definition: SidebarRightTabDefinition | undefined
    const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const ctx = {
      resources: { register: (value: ResourceProvider<'selection-sidechat'>) => { provider = value; return () => undefined } },
      sidebarRightTabs: { register: (value: SidebarRightTabDefinition) => { definition = value; return () => undefined } },
      slots: {
        inject: (_name: string, install: () => unknown) => install(),
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component }); return () => undefined
        },
      },
      effect: (install: () => unknown) => { install(); return () => undefined },
      inject: (_names: readonly string[], install: (scope: Context) => unknown) => install(ctx as unknown as Context),
    } as unknown as Context
    applySelectionSideChat(ctx)

    const openResource = vi.fn()
    const draftId = startSelectionSideChat({ openResource }, PARENT, CONTEXT)
    const address = selectionSideChatAddress(draftId)
    expect(definition?.title(address)).toBe(CONTEXT.text)
    expect(registrations.map(item => item.options)).toEqual([
      { name: 'sidebar.right.pane.tab', key: SELECTION_SIDECHAT_KIND },
      { name: 'sidebar.right.pane.tab.title', key: SELECTION_SIDECHAT_KIND },
      { name: 'sidebar.right.pane.tab.title', key: '@deepseek-ai/dsh-client-ui-subagent' },
      { name: 'sidebar.chat.conversation', priority: -10 },
    ])

    const controller = new AbortController()
    const stream = provider!.open(address, { signal: controller.signal })[Symbol.asyncIterator]()
    expect(await stream.next()).toEqual({
      done: false,
      value: { ok: true, value: { draft: { context: CONTEXT, parentSessionId: PARENT } } },
    })
    const completion = stream.next()
    controller.abort()
    expect(await completion).toEqual({ done: true, value: undefined })
  })
})

describe('selection side-chat conversation layout', () => {
  function renderPhase(sessionId: SessionId) {
    const renderFactorySlot = vi.fn(() => null)
    const content = SelectionSideChatConversation({
      sessionId,
      useSession: (select: (state: unknown) => unknown) => select({
        blank: true,
        awaitingFirstTurn: true,
        running: false,
        openState: 'open',
        subagent: { address: { mode: 'continuable' }, parentAvailable: true },
      }),
      useConversation: (select: (state: unknown) => unknown) => select({ activeTargets: new Set() }),
      useSessions: (select: (state: unknown) => unknown) => select({
        byId: { [sessionId]: { blank: true } },
      }),
      renderFactorySlot,
    } as never)
    return { content, renderFactorySlot }
  }

  it('docks the shared composer for a blank selection child', () => {
    const { content, renderFactorySlot } = renderPhase('selection-sidechat-child' as SessionId)
    expect(renderFactorySlot).toHaveBeenCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'active', hero: false },
      expect.objectContaining({ slots: expect.any(Object) }),
    )
    expect(content).toMatchObject({
      type: 'div',
      props: {
        className: 'clawSelectionSideChatConversation',
        style: expect.objectContaining({
          position: 'absolute',
          inset: 0,
          display: 'flex',
          flexDirection: 'column',
          height: '100%',
          minHeight: 0,
        }),
      },
    })
  })

  it('pushes the shared composer to the bottom when the blank child has no message view', () => {
    const stale = document.createElement('style')
    stale.id = 'clawclaw-selection-quote-styles'
    stale.textContent = 'stale'
    document.head.append(stale)

    installSelectionQuoteStyles()

    expect(stale.textContent).toContain(
      '.clawSelectionSideChatConversation [data-composer-seat] { margin-top: auto; }',
    )
    stale.remove()
  })

  it('preserves the upstream hero phase for other blank subagents', () => {
    const { content, renderFactorySlot } = renderPhase('ordinary-child' as SessionId)
    expect(renderFactorySlot).toHaveBeenCalledWith(
      'conversation.content',
      { variant: 'embedded', phase: 'hero', hero: true },
      expect.objectContaining({ slots: expect.any(Object) }),
    )
    expect(content).toBeNull()
  })
})

describe('selection side-chat preparation', () => {
  it('posts the quote to the host preparation endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      childSessionId: CHILD,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(prepareSelectionSideChatSession(PARENT, CONTEXT, undefined, fetcher as typeof fetch))
      .resolves.toEqual({ childSessionId: CHILD })
    expect(fetcher).toHaveBeenCalledWith('/api/desktop/selection-sidechat/prepare', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ parentSessionId: PARENT, quote: CONTEXT }),
    }))
  })

  it('prepares automatically and replaces the draft with the standard subagent composer', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const actions = { close: vi.fn(), openResource: vi.fn() }
    const abort = new AbortController()
    const prepareChild = vi.fn(async () => ({ childSessionId: CHILD }))
    const draftId = 'draft-1'
    const resource: SelectionSideChatResource = {
      draft: { context: CONTEXT, parentSessionId: PARENT },
    }
    const props = {
      prepareChild,
      useTabInfo: () => ({ tab: { actions, contentId: selectionSideChatAddress(draftId), signal: abort.signal } }),
      useResource: () => ({ status: 'live', value: resource, failure: undefined }),
    } as unknown as SelectionSideChatTabProps

    await act(async () => { root.render(createElement(SelectionSideChatTab, props)) })

    expect(host.querySelector('textarea, [contenteditable="true"]')).toBeNull()
    expect(prepareChild).toHaveBeenCalledWith(PARENT, CONTEXT, abort.signal)
    expect(actions.openResource).toHaveBeenCalledWith(subagentChatAddress(PARENT, CHILD), {
      kind: 'subagentchat', replaceTab: true,
    })
    expect(pendingSelectionSideChatContext(CHILD)).toEqual(CONTEXT)

    const quoteHost = document.createElement('div')
    document.body.append(quoteHost)
    const quoteRoot = createRoot(quoteHost)
    const bail = vi.fn(() => true)
    const quoteProps = {
      actx: { bail },
      sessionId: CHILD,
      sidebarRight: { openResource: vi.fn() },
      useInput: (select: (state: unknown) => unknown) => select({ draftRev: 3, occurrences: [] }),
      useSession: (select: (state: unknown) => unknown) => select({ subagent: { mode: 'continuable' } }),
    } as unknown as SelectionQuoteOverlayProps
    await act(async () => { quoteRoot.render(createElement(SelectionQuoteOverlay, quoteProps)) })
    expect(bail).toHaveBeenCalledWith(expect.anything(), 'slash/input-insert-reference', expect.objectContaining({
      reference: expect.objectContaining({ label: CONTEXT.text }),
      span: { start: 0, end: 0, draftRev: 3 },
    }))
    expect(pendingSelectionSideChatContext(CHILD)).toBeUndefined()
    await act(async () => { quoteRoot.render(createElement(SelectionQuoteOverlay, {
      ...quoteProps,
      useInput: (select: (state: unknown) => unknown) => select({ draftRev: 4, occurrences: [] }),
    } as unknown as SelectionQuoteOverlayProps)) })
    expect(bail).toHaveBeenCalledOnce()
    await act(async () => { quoteRoot.unmount() })
    quoteHost.remove()
    await act(async () => { root.unmount() })
    host.remove()
  })

  it('shows a retry state without provisioning a second child after navigation fails', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const actions = {
      close: vi.fn(),
      openResource: vi.fn()
        .mockImplementationOnce(() => { throw new Error('navigation failed') })
        .mockImplementationOnce(() => undefined),
    }
    const abort = new AbortController()
    const prepareChild = vi.fn(async () => ({ childSessionId: CHILD }))
    const props = {
      prepareChild,
      useTabInfo: () => ({ tab: { actions, contentId: selectionSideChatAddress('draft-retry'), signal: abort.signal } }),
      useResource: () => ({
        status: 'live', failure: undefined,
        value: { draft: { context: CONTEXT, parentSessionId: PARENT } },
      }),
    } as unknown as SelectionSideChatTabProps

    await act(async () => { root.render(createElement(SelectionSideChatTab, props)) })
    expect(host.querySelector('[role="alert"]')?.textContent).toContain('navigation failed')
    await act(async () => { (host.querySelector('[role="alert"] button') as HTMLButtonElement).click() })

    expect(prepareChild).toHaveBeenCalledOnce()
    expect(actions.openResource).toHaveBeenCalledTimes(2)
    consumeSelectionSideChatContext(CHILD)
    await act(async () => { root.unmount() })
    host.remove()
  })
})
