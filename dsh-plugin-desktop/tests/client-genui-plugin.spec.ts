// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import * as GenuiClient from '../src/client/genui-plugin.ts'

it('owns Client registration, scoped retry and cleanup as a disposable child plugin', async () => {
  const ctx = new Context()
  const listeners = new Set<() => void>()
  const remove = vi.fn()
  const registered: Array<{ name: string; inject?: (id: never) => { retry: (turn: number) => Promise<void> } }> = []
  const first = new Context(); const second = new Context()
  const sendFirst = vi.fn(async (_text: string) => {}); const sendSecond = vi.fn(async (_text: string) => {})
  first.provide('conversation', { send: sendFirst } as never)
  second.provide('conversation', { send: sendSecond } as never)
  class TestSlots extends Service {
    constructor(owner: Context) { super(owner, 'slots') }
    inject(_name: string, setup: () => () => void) { return this.ctx.effect(setup) }
    register(options: typeof registered[number]) { registered.push(options); return remove }
  }
  new TestSlots(ctx)
  ctx.provide('configForms', { get: () => ({ getSnapshot: () => ({ value: { enabled: true } }),
    subscribe: (fn: () => void) => { listeners.add(fn); return () => { listeners.delete(fn) } } }) } as never)
  const stopLocale = vi.fn()
  ctx.provide('locale', { register: () => stopLocale, getSnapshot: () => ({ active: 'zh-CN' }) } as never)
  ctx.provide('uiConversation', { binding: () => ({ target: () => ({}) }) } as never)
  ctx.provide('sessions', { scope: (id: string) => id === 'first' ? first : second } as never)
  ctx.provide('conversation', {} as never)
  const child = await ctx.plugin(GenuiClient)
  try {
    expect(registered.map(row => row.name)).toEqual(['tool.call.toolview', 'conversation.chat.turnTail', 'settings.general.item'])
    expect(document.head.querySelectorAll('style[data-claw-genui]')).toHaveLength(1)
    const tail = registered.find(row => row.name === 'conversation.chat.turnTail')!
    await tail.inject!('first' as never).retry(2)
    expect(sendFirst).toHaveBeenCalledOnce()
    expect(sendFirst.mock.calls[0]?.[0]).toContain('第 2 轮')
    expect(sendSecond).not.toHaveBeenCalled()
    await child.dispose()
    expect(remove).toHaveBeenCalledTimes(3)
    expect(stopLocale).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
    expect(document.head.querySelector('style[data-claw-genui]')).toBeNull()
  } finally { await ctx.fiber.dispose(); await first.fiber.dispose(); await second.fiber.dispose() }
})
