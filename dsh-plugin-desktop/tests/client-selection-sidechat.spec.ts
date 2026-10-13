// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot } from 'react-dom/client'
import type { Context } from '@deepseek-ai/cordis'
import type { ResourceProvider } from '@deepseek-ai/dsh-client-resources/client'
import type { SidebarRightTabDefinition } from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  applySelectionSideChat,
  parseSelectionSideChatAddress,
  selectionSideChatAddress,
  SelectionSideChatTab,
  SELECTION_SIDECHAT_KIND,
  startSelectionSideChat,
  startSelectionSideChatSession,
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

describe('selection side-chat first question', () => {
  it('posts the quote and question to the host start endpoint', async () => {
    const fetcher = vi.fn(async () => new Response(JSON.stringify({
      childSessionId: CHILD,
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }))

    await expect(startSelectionSideChatSession(PARENT, 'What is this?', CONTEXT, undefined, fetcher as typeof fetch))
      .resolves.toEqual({ childSessionId: CHILD })
    expect(fetcher).toHaveBeenCalledWith('/api/desktop/selection-sidechat/start', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ parentSessionId: PARENT, question: 'What is this?', quote: CONTEXT }),
    }))
  })

  it('replaces the draft tab with the standard addressed subagent chat after submit', async () => {
    const host = document.createElement('div')
    document.body.append(host)
    const root = createRoot(host)
    const actions = { close: vi.fn(), openResource: vi.fn() }
    const abort = new AbortController()
    const startChild = vi.fn(async () => ({ childSessionId: CHILD }))
    const draftId = 'draft-1'
    const resource: SelectionSideChatResource = {
      draft: { context: CONTEXT, parentSessionId: PARENT },
    }
    const props = {
      startChild,
      useTabInfo: () => ({ tab: { actions, contentId: selectionSideChatAddress(draftId), signal: abort.signal } }),
      useResource: () => ({ status: 'live', value: resource, failure: undefined }),
    } as unknown as SelectionSideChatTabProps

    await act(async () => { root.render(createElement(SelectionSideChatTab, props)) })
    const textarea = host.querySelector('textarea')!
    expect(textarea.style.height).toBe('36px')
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value')?.set
      setter?.call(textarea, 'Explain this quote')
      textarea.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await act(async () => { host.querySelector('form')?.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })

    expect(startChild).toHaveBeenCalledWith(PARENT, 'Explain this quote', CONTEXT, abort.signal)
    expect(actions.openResource).toHaveBeenCalledWith(subagentChatAddress(PARENT, CHILD), {
      kind: 'subagentchat', replaceTab: true,
    })
    await act(async () => { root.unmount() })
    host.remove()
  })
})
