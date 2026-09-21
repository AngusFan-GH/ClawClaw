// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { SkillsSettingsSection, type SkillsSettingsSectionProps } from '../src/client/SkillsSettingsSection.tsx'
import type { DesktopSkillsApi } from '../src/client/skills-api.ts'
import { zh } from '../src/client/skills-locales.ts'

let root: Root | undefined
const skill = { name: 'review', description: 'Review code', source: 'user-dsh', provider: 'filesystem', editable: true, modelInvocable: true, userInvocable: true }
const view = { skills: [skill], recycled: [{ id: 'deleted-id', name: 'removed', deletedAt: '2026-09-21T00:00:00Z' }] }
async function mount(overrides: Partial<typeof skill> = {}, options: { initialSessionId?: string; configure?: (api: DesktopSkillsApi) => void } = {}) {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const current = { ...skill, ...overrides }
  const api: DesktopSkillsApi = {
    forScope: vi.fn(() => api), workspaces: vi.fn(async () => []),
    forPreset: vi.fn(() => api), presets: async () => [], read: async () => [current], readView: vi.fn(async () => ({ ...view, skills: [current] })),
    detail: vi.fn(async () => ({ ...current, content: 'Review carefully.' })),
    setModelInvocable: vi.fn(async (_name, enabled) => [{ ...skill, modelInvocable: enabled }]),
    setUserInvocable: vi.fn(async (_name, enabled) => [{ ...skill, userInvocable: enabled }]),
    create: vi.fn(async () => view), update: vi.fn(async () => view), importDocument: vi.fn(async () => view),
    recycle: vi.fn(async () => ({ ...view, skills: [] })), restore: vi.fn(async () => ({ ...view, recycled: [] })),
  }
  options.configure?.(api)
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root!.render(createElement(SkillsSettingsSection, { api, ...(options.initialSessionId === undefined ? {} : { initialSessionId: options.initialSessionId }), t: (key: keyof typeof zh) => zh[key] } as SkillsSettingsSectionProps)) })
  return api
}
function button(text: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent === text || item.getAttribute('aria-label') === text)
  if (found === undefined) throw new Error(`Missing button: ${text}`)
  return found
}
async function click(text: string) { await act(async () => { button(text).click() }) }
afterEach(async () => { await act(async () => { root?.unmount() }); root = undefined; document.body.replaceChildren(); vi.unstubAllGlobals() })

describe('Skills catalog UI', () => {
  it('starts in the current Session scope and uses its preset', async () => {
    const api = await mount({}, { initialSessionId: 'current-session' })
    expect(api.forScope).toHaveBeenCalledWith({ sessionId: 'current-session' })
    expect(api.forPreset).toHaveBeenCalledWith()
    expect(button(zh.skillScope).textContent).toBe(zh.scopeSession)
    expect(document.body.textContent).toContain(zh.sessionPreset)
  })
  it('switches Workspace scope and groups project Skills separately', async () => {
    const api = await mount({}, { configure: api => {
      vi.mocked(api.workspaces).mockResolvedValue([{ id: 'a', title: 'Project A', path: '/project/a' }])
      vi.mocked(api.forScope).mockImplementation(scope => scope.workspaceId === 'a'
        ? { ...api, forPreset: () => ({ ...api, readView: async () => ({ ...view, skills: [{ ...skill, source: 'project-agents', editable: false }] }) }) }
        : api)
    } })
    await click(zh.skillScope); await click('Project A · /project/a')
    expect(api.forScope).toHaveBeenCalledWith({ workspaceId: 'a' })
    expect(document.querySelector('.dshSkillsGroup h3')?.textContent).toContain(zh.sourceProjectAgents)
    expect(button(zh.skillScope).textContent).toBe('Project A')
  })
  it('refreshes in the background without interrupting an open Skill', async () => {
    vi.useFakeTimers()
    try {
      const api = await mount()
      vi.mocked(api.readView).mockResolvedValue({ ...view, skills: [skill, { ...skill, name: 'installed-by-agent' }] })
      await act(async () => { vi.advanceTimersByTime(5000) })
      expect(button('查看详情: installed-by-agent')).toBeDefined()
      await click('查看详情: review')
      const count = vi.mocked(api.readView).mock.calls.length
      await act(async () => { vi.advanceTimersByTime(10000) })
      expect(api.readView).toHaveBeenCalledTimes(count)
      expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    } finally { vi.useRealTimers() }
  })
  it('ignores a late background response after the user opens details', async () => {
    vi.useFakeTimers()
    try {
      const api = await mount()
      let resolve!: (value: typeof view) => void
      vi.mocked(api.readView).mockImplementationOnce(() => new Promise(done => { resolve = done }))
      await act(async () => { vi.advanceTimersByTime(5000) })
      await click('查看详情: review')
      await act(async () => { resolve({ ...view, skills: [] }) })
      await click('关闭')
      expect(button('查看详情: review')).toBeDefined()
    } finally { vi.useRealTimers() }
  })
  it('delays the compact deletion tooltip and keeps the full reason in details', async () => {
    await mount({ source: 'user-agents' })
    vi.useFakeTimers()
    try {
      const anchor = button('移至回收站: review').parentElement!
      vi.spyOn(anchor, 'getBoundingClientRect').mockReturnValue(new DOMRect(200, 120, 30, 30))
      await act(async () => { anchor.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })) })
      expect(document.querySelector('[role="tooltip"]')).toBeNull()
      await act(async () => { vi.advanceTimersByTime(350) })
      const tooltip = document.querySelector<HTMLElement>('[role="tooltip"]')!
      expect(tooltip.textContent).toBe(zh.recycleSharedHint)
      expect(tooltip.style.maxWidth).toBe('240px')
      expect(tooltip.dataset.side).toBe('top')
      await act(async () => { anchor.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })) })
      expect(document.querySelector('[role="tooltip"]')).toBeNull()
    } finally { vi.useRealTimers() }
    await click('查看详情: review')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.recycleSharedRestricted)
  })
  it('offers card deletion without nested buttons and requires confirmation before recycling', async () => {
    const api = await mount()
    expect(button('移至回收站: review').disabled).toBe(false)
    expect(document.querySelector('button button')).toBeNull()
    await click('移至回收站: review')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(zh.confirmRecycle)
    expect(api.recycle).not.toHaveBeenCalled()
    await click('移至回收站')
    expect(api.recycle).toHaveBeenCalledExactlyOnceWith('review')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('.dshSkillsCard')).toBeNull()
    expect(document.activeElement).toBe(document.querySelector('[role="tab"]'))
  })
  it.each(['user-agents', 'bundled', 'plugin:demo'])('keeps restricted deletion visible and explains the %s source', async source => {
    const api = await mount({ source, editable: source === 'user-agents' })
    expect(button('移至回收站: review').disabled).toBe(true)
    await click('查看详情: review')
    expect(button('移至回收站').disabled).toBe(true)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(source === 'user-agents' ? zh.recycleSharedRestricted : zh.recycleManagedRestricted)
    expect(api.recycle).not.toHaveBeenCalled()
  })
  it('cancels card deletion without mutating the catalog', async () => {
    const api = await mount()
    await click('移至回收站: review'); await click('取消')
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(button('移至回收站').disabled).toBe(false)
    await click('关闭')
    expect(document.activeElement).toBe(button('移至回收站: review'))
    expect(api.recycle).not.toHaveBeenCalled()
  })
  it('keeps details and invocation controls out of the catalog, and restores focus', async () => {
    const api = await mount()
    const trigger = button('查看详情: review')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="switch"]')).toBeNull()
    await click('查看详情: review')
    expect(document.body.style.overflow).toBe('hidden')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain('Review carefully.')
    await click('允许模型调用')
    expect(api.setModelInvocable).toHaveBeenCalledWith('review', false)
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.style.overflow).toBe('')
    expect(document.activeElement).toBe(trigger)
    expect(trigger.textContent).toContain('模型不可用')
  })
  it('does not let Escape reach the underlying settings dialog', async () => {
    await mount()
    await click('查看详情: review')
    const parentEscape = vi.fn()
    document.addEventListener('keydown', parentEscape)
    try {
      await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
      expect(parentEscape).not.toHaveBeenCalled()
    } finally { document.removeEventListener('keydown', parentEscape) }
  })
  it('separates the recycle view and keeps it keyboard accessible', async () => {
    const api = await mount()
    const first = document.querySelector('[role="tab"]')!
    await act(async () => { first.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(document.querySelector('.dshSkillsCard')).toBeNull()
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain('removed')
    await click('恢复')
    expect(api.restore).toHaveBeenCalledWith('deleted-id')
    expect(document.querySelector('[role="tabpanel"]')?.textContent).toContain('回收站为空')
  })
  it('requires explicit discard for an imported document and does not import on selection', async () => {
    const api = await mount()
    await click('导入技能')
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [{ name: 'SKILL.md', size: 30, text: async () => '---\nname: test\ndescription: Test\n---\nDo it.' }] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(api.importDocument).not.toHaveBeenCalled()
    expect(document.querySelector('textarea')?.value).toContain('name: test')
    await click('取消')
    expect(document.querySelector('[role="alert"]')?.textContent).toContain('有未保存的内容')
    await click('继续编辑')
    expect(document.querySelector('textarea')?.value).toContain('name: test')
    await click('取消'); await click('放弃更改')
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('keeps import failures inside the dialog with the document intact', async () => {
    const api = await mount()
    vi.mocked(api.importDocument).mockRejectedValueOnce(new Error('Already exists'))
    await click('导入技能')
    const input = document.querySelector<HTMLInputElement>('input[type="file"]')!
    Object.defineProperty(input, 'files', { value: [{ name: 'SKILL.md', size: 4, text: async () => 'test' }] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    await click('导入')
    expect(document.querySelector('[role="dialog"] [role="alert"]')?.textContent).toBe('Already exists')
    expect(document.querySelector('textarea')?.value).toBe('test')
  })
})
