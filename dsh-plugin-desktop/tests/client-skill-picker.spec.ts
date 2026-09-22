// @vitest-environment jsdom
import { act, createElement, useState } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillPicker } from '../src/client/ConversationSkills.tsx'
import { SkillPickError, type ConversationSkillsApi } from '../src/client/conversation-skills.ts'
import { zh } from '../src/client/skills-locales.ts'

let root: Root | undefined
const catalog = { skills: [{ name: 'review', description: 'Review code', modelInvocable: false }], commands: [] }
async function mount(api: ConversationSkillsApi, disabled = false) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root!.render(createElement(SkillPicker, { api, disabled, t: key => zh[key] })) })
}
function button(name: string) {
  const result = [...document.querySelectorAll('button')].find(button => button.getAttribute('aria-label') === name || button.textContent?.includes(name))
  if (!result) throw new Error(`Missing button: ${name}`)
  return result
}
async function click(name: string) { await act(async () => { button(name).click() }) }
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('conversation Skill picker', () => {
  it('navigates with arrow keys, skips conflicts and supports Enter from search', async () => {
    const api = { list: vi.fn(async () => ({ skills: [
      { name: 'blocked', description: 'Blocked', modelInvocable: true },
      { name: 'review', description: 'Review', modelInvocable: true },
    ], commands: ['blocked'] })), select: vi.fn(async () => {}) }
    await mount(api); await click('选择技能')
    const search = document.querySelector<HTMLInputElement>('input[type="search"]')!
    await act(async () => { search.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true })) })
    expect(document.activeElement).toBe(button('review'))
    await act(async () => { search.focus(); search.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })) })
    expect(api.select).toHaveBeenCalledWith('review', expect.any(AbortSignal))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('refreshes an open picker without closing it and stops polling after close', async () => {
    vi.useFakeTimers()
    try {
      const api = { list: vi.fn(async () => catalog), select: vi.fn(async () => {}) }
      await mount(api); await click('选择技能')
      api.list.mockResolvedValue({ skills: [{ name: 'new-skill', description: 'New skill', modelInvocable: true }], commands: [] })
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(button('new-skill')).toBeDefined()
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
      await click('刷新')
      expect(api.list).toHaveBeenCalledTimes(3)
      await click('关闭')
      await act(async () => { await vi.advanceTimersByTimeAsync(5000) })
      expect(api.list).toHaveBeenCalledTimes(3)
    } finally { vi.useRealTimers() }
  })
  it('loads on each open, focuses search, inserts only the chosen Skill and closes', async () => {
    const api = { list: vi.fn(async () => catalog), select: vi.fn(async () => {}) }
    await mount(api)
    await act(async () => { button('选择技能').focus() })
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe('选择技能')
    await click('选择技能')
    expect(document.activeElement?.getAttribute('type')).toBe('search')
    expect(document.body.style.overflow).toBe('hidden')
    await click('review')
    expect(api.select).toHaveBeenCalledWith('review', expect.any(AbortSignal))
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.activeElement).toBe(button('选择技能'))
    expect(document.querySelector('[role="tooltip"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    await click('选择技能')
    expect(api.list).toHaveBeenCalledTimes(2)
  })
  it('aborts outstanding work on Escape and does not reopen from a late response', async () => {
    let signal: AbortSignal | undefined
    const api = { list: vi.fn(async (value: AbortSignal) => { signal = value; return catalog }), select: vi.fn(async () => {}) }
    await mount(api); await click('选择技能')
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(signal?.aborted).toBe(true)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('shows recoverable errors and empty catalogs, and disables command-name collisions', async () => {
    const api = { list: vi.fn<ConversationSkillsApi['list']>().mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce({ skills: [], commands: [] }).mockResolvedValueOnce({ ...catalog, commands: ['review'] }), select: vi.fn(async () => {}) }
    await mount(api); await click('选择技能')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(zh.unavailable)
    await click('刷新')
    expect(document.querySelector('[role="status"]')?.textContent).toBe(zh.noSessionSkills)
    await click('关闭'); await click('选择技能')
    expect(button('review').disabled).toBe(true)
    expect(api.select).not.toHaveBeenCalled()
  })
  it('keeps selection failure in the dialog without losing the draft', async () => {
    const api = { list: async () => catalog, select: vi.fn(async () => { throw new SkillPickError('skillUnavailable') }) }
    await mount(api); await click('选择技能'); await click('review')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(zh.skillUnavailable)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
  it('does not open while input is disabled', async () => {
    const api = { list: vi.fn(async () => catalog), select: vi.fn(async () => {}) }
    await mount(api, true); await click('选择技能')
    expect(api.list).not.toHaveBeenCalled()
  })
  it('closes after insertion even when the parent recreates the API on draft changes', async () => {
    await mount({ list: async () => catalog, select: async () => {} })
    function Parent() {
      const [draft, setDraft] = useState('Keep this draft')
      return createElement('div', {}, draft, createElement(SkillPicker, {
        disabled: false, t: key => zh[key],
        api: { list: async () => catalog, select: async () => { setDraft('/review Keep this draft'); await Promise.resolve() } },
      }))
    }
    await act(async () => { root!.render(createElement(Parent)) })
    await click('选择技能'); await click('review')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).toContain('/review Keep this draft')
  })
})
