// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type {
  ISessions, SessionReference,
} from '@deepseek-ai/dsh-api-session-controller/client'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applySelectionSideChat,
  consumeSelectionSideChatContext,
  createSelectionSideChatSession,
  parseSelectionSideChatAddress,
  pendingSelectionSideChatContext,
  selectionSideChatAddress,
  SelectionSideChatConversation,
  SelectionSideChatTab,
  SELECTION_SIDECHAT_KIND,
  startSelectionSideChat,
  type SelectionSideChatTabProps,
} from '../src/client/selection-sidechat.tsx'

const PARENT = 'parent/a' as SessionId
const CHILD = 'child#1' as SessionId

afterEach(() => { vi.restoreAllMocks() })

describe('selection side chat resource', () => {
  it('round-trips only canonical Session addresses', () => {
    expect(selectionSideChatAddress(CHILD)).toBe('dsh-resource://selection-sidechat/session/child%231')
    expect(parseSelectionSideChatAddress(selectionSideChatAddress(CHILD))).toBe(CHILD)
    expect(parseSelectionSideChatAddress('https://selection-sidechat/session/child')).toBeUndefined()
    expect(parseSelectionSideChatAddress('dsh-resource://selection-sidechat/other/child')).toBeUndefined()
    expect(parseSelectionSideChatAddress('dsh-resource://selection-sidechat/session/child?extra=true')).toBeUndefined()
  })

  it('registers a resource tab that retains the Session for its lifetime', async () => {
    const release = vi.fn()
    const reference = { sessionId: CHILD, release, ready: Promise.resolve() } as unknown as SessionReference
    const retain = vi.fn(() => reference)
    let provider: ResourceProvider<'selection-sidechat'> | undefined
    let definition: SidebarRightTabDefinition | undefined
    const registrations: Array<{ options: Record<string, unknown>; component: unknown }> = []
    const ctx = {
      sessions: { retain } as unknown as ISessions,
      resources: { register: (value: ResourceProvider<'selection-sidechat'>) => { provider = value; return () => undefined } },
      sidebarRightTabs: { register: (value: SidebarRightTabDefinition) => { definition = value; return () => undefined } },
      slots: {
        inject: (_name: string, install: () => unknown) => install(),
        register: (options: Record<string, unknown>, component: unknown) => {
          registrations.push({ options, component })
          return () => undefined
        },
      },
      effect: (install: () => unknown) => { install(); return () => undefined },
      get: (name: string) => name === 'sessions' ? { retain } : undefined,
      inject: (_names: readonly string[], install: (scope: Context) => unknown) => install(ctx as unknown as Context),
    } as unknown as Context

    applySelectionSideChat(ctx)

    expect(definition).toEqual(expect.objectContaining({ id: SELECTION_SIDECHAT_KIND, kind: SELECTION_SIDECHAT_KIND }))
    expect(definition?.canOpen?.(selectionSideChatAddress(CHILD))).toBe(true)
    expect(registrations[0]?.options).toEqual(expect.objectContaining({
      name: 'sidebar.right.pane.tab',
      key: SELECTION_SIDECHAT_KIND,
      children: { 'desktop.selection-sidechat.conversation': { kind: 'single', scope: 'session' } },
    }))
    expect(registrations[1]).toEqual(expect.objectContaining({
      options: { name: 'desktop.selection-sidechat.conversation' },
      component: SelectionSideChatConversation,
    }))

    const controller = new AbortController()
    const stream = provider!.open(selectionSideChatAddress(CHILD), { signal: controller.signal })[Symbol.asyncIterator]()
    expect(await stream.next()).toEqual({ done: false, value: { ok: true, value: { reference, sessionId: CHILD } } })
    expect(retain).toHaveBeenCalledWith(CHILD, { source: 'selectionSideChat', signal: controller.signal })
    const completion = stream.next()
    controller.abort()
    expect(await completion).toEqual({ done: true, value: undefined })
    expect(release).toHaveBeenCalledOnce()
  })

  it('creates a linked child conversation and opens it with selected context pending', async () => {
    const createChild = vi.fn(async () => CHILD)
    const openResource = vi.fn()
    const context = { text: 'selected', source: { messageKey: 'assistant:1', startOffset: 0, endOffset: 8 } }

    await expect(startSelectionSideChat({ openResource }, PARENT, context, createChild)).resolves.toBe(CHILD)

    expect(createChild).toHaveBeenCalledWith(PARENT)
    expect(openResource).toHaveBeenCalledWith(selectionSideChatAddress(CHILD), {
      kind: SELECTION_SIDECHAT_KIND,
      preferNewPane: true,
    })
    expect(pendingSelectionSideChatContext(CHILD)).toEqual(context)
    consumeSelectionSideChatContext(CHILD)
    expect(pendingSelectionSideChatContext(CHILD)).toBeUndefined()
  })

  it('requests an empty child Session from the Desktop Host', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({ sessionId: CHILD }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    await expect(createSelectionSideChatSession(PARENT, fetcher as typeof fetch)).resolves.toBe(CHILD)
    expect(fetcher).toHaveBeenCalledWith('/api/desktop/selection-sidechat/create', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ parentSessionId: PARENT }),
    }))
  })

  it('binds the resource Session around the shared embedded conversation slot', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const reference = { sessionId: CHILD } as SessionReference
    const SessionProvider = vi.fn(({ children }: { children: ReactNode }) => children)
    const renderSlot = vi.fn(() => createElement('span', null, 'shared conversation'))
    const props = {
      useTabInfo: () => ({ tab: { contentId: selectionSideChatAddress(CHILD) } }),
      useResource: () => ({ status: 'live', value: { reference, sessionId: CHILD }, failure: undefined }),
      SessionProvider,
      renderSlot,
    } as unknown as SelectionSideChatTabProps

    await act(async () => { root.render(createElement(SelectionSideChatTab, props)) })

    expect(host.textContent).toBe('shared conversation')
    expect(SessionProvider).toHaveBeenCalledWith(expect.objectContaining({ session: reference }), {})
    expect(renderSlot).toHaveBeenCalledWith('desktop.selection-sidechat.conversation', {})
    await act(async () => { root.unmount() })
    host.remove()
  })
})
