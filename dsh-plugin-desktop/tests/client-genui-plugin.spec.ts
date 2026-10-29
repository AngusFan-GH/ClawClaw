// @vitest-environment jsdom
import { Context, Service } from '@deepseek-ai/cordis'
import { expect, it, vi } from 'vitest'
import * as GenuiClient from '../src/client/genui-plugin.ts'

it('owns Client registration, scoped retry and cleanup as a disposable child plugin', async () => {
  const ctx = new Context()
  const listeners = new Set<() => void>()
  const remove = vi.fn()
  const registered: Array<{ name: string; inject?: (id: never) => { retry: (turn: number) => Promise<void> } }> = []
  const promptFirst = vi.fn(async (_content: unknown, _mode: string) => ({ ok: true }))
    .mockResolvedValueOnce({ ok: false, error: { message: 'connection unavailable' } } as never)
  const promptSecond = vi.fn(async (_content: unknown, _mode: string) => ({ ok: true }))
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
  ctx.provide('sessions', { binding: (id: string) => id === 'missing' ? undefined : { session: {
    prompt: id === 'first' ? promptFirst : promptSecond,
  } } } as never)
  const child = await ctx.plugin(GenuiClient)
  try {
    expect(registered.map(row => row.name)).toEqual(['tool.call.toolview', 'conversation.chat.turnTail', 'settings.general.item'])
    expect(document.head.querySelectorAll('style[data-claw-genui]')).toHaveLength(1)
    const tail = registered.find(row => row.name === 'conversation.chat.turnTail')!
    await expect(tail.inject!('first' as never).retry(2)).rejects.toThrow('connection unavailable')
    await tail.inject!('first' as never).retry(2)
    expect(promptFirst).toHaveBeenCalledTimes(2)
    expect(promptFirst.mock.calls[0]?.[0]).toEqual([{ type: 'text', text: expect.stringContaining('第 2 轮') }])
    expect(promptFirst.mock.calls[0]?.[1]).toBe('queue')
    expect(promptSecond).not.toHaveBeenCalled()
    await expect(tail.inject!('missing' as never).retry(2)).rejects.toThrow('Conversation unavailable')
    await child.dispose()
    expect(remove).toHaveBeenCalledTimes(3)
    expect(stopLocale).toHaveBeenCalledOnce()
    expect(listeners.size).toBe(0)
    expect(document.head.querySelector('style[data-claw-genui]')).toBeNull()
  } finally { await ctx.fiber.dispose() }
})
