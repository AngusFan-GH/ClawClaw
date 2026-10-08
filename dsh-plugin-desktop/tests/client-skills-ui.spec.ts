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
async function mount(overrides: Partial<typeof skill> = {}, options: { initialSessionId?: string; embedded?: boolean; configure?: (api: DesktopSkillsApi) => void } = {}) {
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
    addScanPath: vi.fn(async () => view), removeScanPath: vi.fn(async () => view),
  }
  options.configure?.(api)
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root!.render(createElement(SkillsSettingsSection, { api, embedded: options.embedded, ...(options.initialSessionId === undefined ? {} : { initialSessionId: options.initialSessionId }), t: (key: keyof typeof zh) => zh[key] } as SkillsSettingsSectionProps)) })
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
  it('moves catalog actions into the toolbar when embedded in the expert library', async () => {
    await mount({}, { embedded: true })
    expect(document.querySelector('.dshSkillsPage>header')).toBeNull()
    const toolbar = document.querySelector('.dshSkillsToolbar')
    expect(toolbar?.querySelector('.dshSkillsCatalogActions')).not.toBeNull()
    expect(toolbar?.textContent).toContain(zh.newSkill)
    expect(toolbar?.textContent).toContain(zh.importRaw)
  })

  it('adds and removes explicit read-only scan directories', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ path: '/opt/team-skills' }))))
    let scanPaths: readonly string[] = []
    const api = await mount({}, { configure: api => {
      vi.mocked(api.readView).mockImplementation(async () => ({ ...view, scanPaths }))
      vi.mocked(api.addScanPath).mockImplementation(async () => { scanPaths = ['/opt/team-skills']; return { ...view, skills: [], scanPaths } })
      vi.mocked(api.removeScanPath).mockImplementation(async () => { scanPaths = []; return { ...view, skills: [], scanPaths } })
    } })
    expect(button(zh.skillLocations).getAttribute('aria-expanded')).toBe('false')
    await click(zh.skillLocations)
    expect(document.body.textContent).toContain(zh.noScanPaths)
    await click(zh.addScanPath)
    expect(api.addScanPath).toHaveBeenCalledWith('/opt/team-skills')
    expect(document.querySelector('.dshSkillsDirectories code')?.textContent).toBe('/opt/team-skills')
    expect(document.querySelectorAll('.dshSkillsCard')).toHaveLength(1)
    await click(`${zh.removeScanPath}: /opt/team-skills`)
    expect(api.removeScanPath).toHaveBeenCalledWith('/opt/team-skills')
    expect(document.body.textContent).toContain(zh.noScanPaths)
  })
  it('groups name-sorted Skills by source and narrows groups when filtered', async () => {
    await mount({}, { configure: api => { vi.mocked(api.readView).mockResolvedValue({ ...view, skills: [
      { ...skill, name: 'z-local' }, { ...skill, name: 'a-shared', source: 'user-agents' },
    ] }) } })
    expect(document.querySelectorAll('.dshSkillsGrid')).toHaveLength(2)
    expect([...document.querySelectorAll('.dshSkillsCardHeading strong')].map(item => item.textContent)).toEqual(['z-local', 'a-shared'])
    expect([...document.querySelectorAll('.dshSkillsGroup h3')].map(item => item.textContent)).toEqual([`${zh.sourceUserDsh}1`, `${zh.sourceUserAgents}1`])
    expect(document.querySelectorAll('.dshSkillsCardDelete')).toHaveLength(1)
    await click(zh.filterSource); await click(`${zh.sourceUserAgents} · 1`)
    expect(document.querySelectorAll('.dshSkillsCard')).toHaveLength(1)
    expect(document.querySelectorAll('.dshSkillsGroup')).toHaveLength(1)
  })
  it('requires confirmation for permanent deletion and supports cancellation', async () => {
    const purge = vi.fn(async (ids: readonly string[]) => ({ deleted: ids, failed: [] }))
    await mount({}, { configure: api => { api.purge = purge } })
    await act(async () => { (document.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click() })
    await click(`${zh.permanentlyDelete}: removed`)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.purgeWarning)
    expect(purge).not.toHaveBeenCalled()
    await click(zh.cancel)
    expect(purge).not.toHaveBeenCalled()
    await click(`${zh.permanentlyDelete}: removed`); await click(zh.permanentlyDelete)
    expect(purge).toHaveBeenCalledWith(['deleted-id'])
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.body.textContent).toContain(zh.recycleEmpty)
  })
  it('keeps only failed items in the clear confirmation and retries those IDs', async () => {
    const purge = vi.fn().mockResolvedValueOnce({ deleted: ['deleted-id'], failed: ['second-id'] }).mockResolvedValueOnce({ deleted: ['second-id'], failed: [] })
    await mount({}, { configure: api => {
      api.purge = purge
      vi.mocked(api.readView).mockResolvedValue({ ...view, recycled: [...view.recycled, { id: 'second-id', name: 'second', deletedAt: '2026-09-21T00:00:00Z' }] })
    } })
    await act(async () => { (document.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click() })
    await click(zh.emptyRecycleBin)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`${zh.purgeCount}: 2`)
    await click(zh.permanentlyDelete)
    expect(purge).toHaveBeenCalledWith(['deleted-id', 'second-id'])
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(zh.purgeFailed)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(`${zh.purgeCount}: 1`)
    await click(zh.permanentlyDelete)
    expect(purge).toHaveBeenLastCalledWith(['second-id'])
    expect(button(zh.emptyRecycleBin).disabled).toBe(true)
  })
  it('previews a selected folder and imports all files only after confirmation', async () => {
    const importBundle = vi.fn(async () => view)
    const api = await mount({}, { configure: api => { api.importBundle = importBundle } })
    await click(zh.importRaw)
    const file = new File(['Instructions'], 'SKILL.md')
    Object.defineProperty(file, 'webkitRelativePath', { value: 'review/SKILL.md' })
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('Instructions').buffer })
    const input = document.querySelector<HTMLInputElement>('input[webkitdirectory]')!
    Object.defineProperty(input, 'files', { configurable: true, value: [file] })
    await act(async () => { input.dispatchEvent(new Event('change', { bubbles: true })) })
    expect(document.querySelector('.dshSkillBundleList')?.textContent).toContain('SKILL.md')
    expect(importBundle).not.toHaveBeenCalled()
    await click(zh.import)
    expect(importBundle).toHaveBeenCalledWith([{ path: 'SKILL.md', base64: btoa('Instructions') }])
    expect(api.importDocument).not.toHaveBeenCalled()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it('browses resource files without executing or rendering their contents as HTML', async () => {
    const api = await mount({}, { configure: api => {
      vi.mocked(api.detail).mockResolvedValue({ ...skill, content: 'Instructions', path: '/data/skills/review/SKILL.md' })
      api.files = vi.fn(async () => [{ path: 'scripts/check.py', size: 12, blocked: false }, { path: 'linked', size: 0, blocked: true }])
      api.file = vi.fn(async (_name, path) => ({ path, content: '<script>not executed</script>', unavailable: false }))
    } })
    await click('查看详情: review')
    expect(document.querySelector('.dshSkillFiles')).toBeNull()
    await click(zh.skillFiles)
    const files = document.querySelector('.dshSkillFiles')!
    expect(files.textContent).toContain('check.py')
    expect(button('linked').disabled).toBe(true)
    await act(async () => { files.querySelector('summary')!.click() })
    await click('scripts/check.py')
    expect(api.file).toHaveBeenCalledWith('review', 'scripts/check.py')
    expect(files.querySelector('pre')?.textContent).toBe('<script>not executed</script>')
    expect(files.querySelector('script')).toBeNull()
    await click(zh.backToFiles)
    expect(files.querySelector('pre')).toBeNull()
    expect(files.querySelector('.dshSkillFileBrowser')?.getAttribute('data-preview')).toBe('false')
  })
  it('filters Skills by source without changing their scope or calling configuration', async () => {
    const api = await mount({}, { configure: api => { vi.mocked(api.readView).mockResolvedValue({ ...view, skills: [skill, { ...skill, name: 'project-review', source: 'project-agents', editable: false }] }) } })
    await click(zh.filterSource)
    await click(`${zh.sourceProjectAgents} · 1`)
    expect(document.querySelectorAll('.dshSkillsCard')).toHaveLength(1)
    expect(button('查看详情: project-review')).toBeDefined()
    expect(api.setModelInvocable).not.toHaveBeenCalled()
    await click(zh.filterSource)
    await click(`${zh.allSources} · 2`)
    expect(document.querySelectorAll('.dshSkillsCard')).toHaveLength(2)
  })
  it('ignores stale file previews after switching files', async () => {
    let finish!: (value: { path: string; content: string; unavailable: boolean }) => void
    await mount({}, { configure: api => {
      vi.mocked(api.detail).mockResolvedValue({ ...skill, content: 'Instructions', path: '/data/skills/review/SKILL.md' })
      api.files = async () => [{ path: 'a.md', size: 1, blocked: false }, { path: 'b.md', size: 1, blocked: false }]
      api.file = async (_name, path) => path === 'a.md' ? new Promise(done => { finish = done }) : { path, content: 'New content', unavailable: false }
    } })
    await click('查看详情: review'); await click(zh.skillFiles)
    await click('a.md'); await click('b.md')
    await act(async () => { finish({ path: 'a.md', content: 'Old content', unavailable: false }) })
    expect(document.querySelector('.dshSkillFilePreview pre')?.textContent).toBe('New content')
  })
  it('combines managed, project, and additional Skill directories while keeping the effective preset visible', async () => {
    await mount({}, { configure: api => { vi.mocked(api.readView).mockResolvedValue({ ...view, locations: {
      userLibrary: '/data/skills', recycleBin: '/data/skills/.recycle', cwd: '/workspaces/default', projectLibrary: '/workspaces/default/.clawclaw/skills', preset: 'standard',
    }, scanPaths: ['/opt/team-skills'] }) } })
    const directories = document.querySelector('.dshSkillsDirectories')!
    expect(directories.textContent).not.toContain('/data/skills')
    await click(zh.skillLocations)
    expect(directories.textContent).toContain('/data/skills')
    expect(directories.textContent).toContain('/workspaces/default/.clawclaw/skills')
    expect(directories.textContent).toContain('/opt/team-skills')
    expect(button(zh.agentPreset).textContent).toContain('standard')
    await act(async () => { (document.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click() })
    expect(document.querySelector('.dshSkillsDirectories')?.textContent).toContain('/data/skills/.recycle')
    expect(document.querySelector('.dshSkillsDirectories')?.textContent).not.toContain('/opt/team-skills')
  })
  it('keeps installation diagnostics separate from callable catalog cards', async () => {
    const api = await mount({}, { configure: api => { vi.mocked(api.readView).mockResolvedValue({ ...view, installed: [
      { name: 'review', path: '/data/skills/review/SKILL.md', status: 'overridden', effectivePath: '/project/.agents/skills/review/SKILL.md', effectiveSource: 'project-agents' },
      { name: 'broken', path: '/data/skills/broken/SKILL.md', status: 'invalid', reason: 'missing-file' },
    ] }) } })
    expect(document.querySelector('details')?.textContent).toContain(zh.installationOverridden)
    expect(document.querySelector('details')?.textContent).toContain('/data/skills/broken/SKILL.md')
    expect(document.querySelectorAll('.dshSkillsCard')).toHaveLength(1)
    expect(document.querySelector('details')?.textContent).toContain(zh.diagnosticMissingFile)
    expect(document.querySelector('details')?.textContent).toContain('/project/.agents/skills/review/SKILL.md')
    await act(async () => { document.querySelector<HTMLButtonElement>('details button')!.click() })
    expect(api.detail).toHaveBeenCalledWith('review')
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
  })
  it('preserves the catalog and reports a warning after a completed operation with pending refresh', async () => {
    const api = await mount()
    vi.mocked(api.recycle).mockResolvedValue({ skills: [], recycled: [], refreshPending: true })
    await click('移至回收站: review'); await click(zh.recycle)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="alert"]')).toBeNull()
    expect(document.body.textContent).toContain(zh.skillSavedRefreshPending)
    expect(button('查看详情: review')).toBeDefined()
    await click(zh.refresh)
    expect(document.body.textContent).not.toContain(zh.skillSavedRefreshPending)
  })
  it('keeps a conflicted draft and requires review before adopting a new revision', async () => {
    const api = await mount()
    vi.mocked(api.detail).mockResolvedValue({ ...skill, content: 'My draft', revision: 'a'.repeat(64) })
    await click('查看详情: review'); await click(zh.edit)
    vi.mocked(api.update).mockRejectedValueOnce(new Error('skillEditConflict'))
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(api.update).toHaveBeenLastCalledWith('review', expect.objectContaining({ instructions: 'My draft' }), 'a'.repeat(64))
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(zh.skillEditConflict)
    vi.mocked(api.detail).mockResolvedValue({ ...skill, content: 'External changes', revision: 'b'.repeat(64) })
    await click(zh.reviewLatest)
    expect(document.querySelector('pre')?.textContent).toBe('External changes')
    expect(document.querySelector<HTMLTextAreaElement>('.dshSkillsCode')?.value).toBe('My draft')
    await click(zh.confirmDraftVersion)
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(api.update).toHaveBeenLastCalledWith('review', expect.objectContaining({ instructions: 'My draft' }), 'b'.repeat(64))
  })
  it('shows resolved data and working directories and the user-library install destination', async () => {
    const locations = { userLibrary: '/custom/data/skills', recycleBin: '/custom/data/skills/.recycle', cwd: '/projects/current', projectLibrary: '/projects/current/.clawclaw/skills' }
    await mount({}, { configure: api => { vi.mocked(api.readView).mockResolvedValue({ ...view, locations }) } })
    await click(zh.skillLocations)
    expect(document.querySelector('[aria-label="技能目录"]')?.textContent).toContain(locations.cwd)
    await click(zh.newSkill)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.installDestination)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(locations.userLibrary)
    await click(zh.cancel)
    await click(zh.importRaw)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(locations.userLibrary)
    await click(zh.cancel)
    await act(async () => { (document.querySelectorAll('[role="tab"]')[1] as HTMLButtonElement).click() })
    expect(document.querySelector('[aria-label="技能目录"]')?.textContent).toContain(locations.recycleBin)
    expect(document.querySelector('[aria-label="技能目录"]')?.textContent).not.toContain(locations.projectLibrary)
  })
  it('starts in the current Session scope and uses its preset', async () => {
    const api = await mount({}, { initialSessionId: 'current-session', configure: api => {
      vi.mocked(api.readView).mockResolvedValue({ ...view, locations: { userLibrary: '/data/skills', recycleBin: '/data/skills/.recycle', preset: 'standard' } })
    } })
    expect(api.forScope).toHaveBeenCalledWith({ sessionId: 'current-session' })
    expect(api.forPreset).toHaveBeenCalledWith()
    expect(button(zh.skillScope).textContent).toContain(zh.scopeSession)
    expect(button(zh.skillScope).textContent).toContain('standard')
    expect(document.querySelector('.dshSkillsToolbar')?.textContent).not.toContain(zh.sessionPreset)
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
    expect(button(zh.skillScope).textContent).toContain('Project A')
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
  it('explains shared origins and edit impact without offering unsupported deletion', async () => {
    await mount({ source: 'user-agents' })
    expect(document.querySelector('.dshSkillsGroup h3')?.textContent).toContain(zh.sourceUserAgents)
    expect(document.querySelector('.dshSkillsCardDelete')).toBeNull()
    await click('查看详情: review')
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.recycleSharedRestricted)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.sharedSkillOrigin)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.sharedSkillEditImpact)
    await click(zh.edit)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain(zh.sharedSkillEditImpact)
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
  it.each(['user-agents', 'bundled', 'plugin:demo'])('hides unsupported deletion and explains the %s source', async source => {
    const api = await mount({ source, editable: source === 'user-agents' })
    expect(document.querySelector('.dshSkillsCardDelete')).toBeNull()
    await click('查看详情: review')
    expect([...document.querySelectorAll('button')].some(item => item.textContent === zh.recycle)).toBe(false)
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
