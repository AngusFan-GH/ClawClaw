// @vitest-environment jsdom
import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    IconChevronDownOutlineMedium: (props: object) => React.createElement('svg', props),
    Menu: ({ open, anchor, items, onSelect }: { open: boolean; anchor: ReactNode; items: readonly { id: string; label: ReactNode; disabled?: boolean }[]; onSelect(id: string): void }) => React.createElement('span', null, anchor, open && React.createElement('div', { role: 'menu' }, items.map(item => React.createElement('button', { key: item.id, disabled: item.disabled, role: 'menuitem', onClick: () => { onSelect(item.id) } }, item.label)))),
  }
})
import { CronTasksSettingsSection, type CronTasksSettingsProps } from '../src/client/CronTasksSettingsSection.tsx'
import type { CronTasksView, CronTaskView } from '../src/client/cron-tasks-api.ts'
const task: CronTaskView = { id: 'task-1', name: 'Existing task', prompt: 'Keep this instruction', expression: '0 9 * * *', timeZone: 'UTC', enabled: true, nextRunAt: '2027-01-11T09:00:00Z', workspaceId: 'w1', activeSessionId: 'cron-1', history: [
  { startedAt: '2027-01-09T09:00:00Z', finishedAt: '2027-01-09T09:01:00Z', status: 'completed', sessionId: 'cron-old' },
] }
let root: Root
let host: HTMLDivElement
let view: CronTasksView
let action: ReturnType<typeof vi.fn>
let read: ReturnType<typeof vi.fn>
let openSession: ReturnType<typeof vi.fn>
let close: ReturnType<typeof vi.fn>
beforeEach(() => {
  vi.useFakeTimers(); vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  view = { jobs: [structuredClone(task)], running: [], archivedSessionIds: [], workspaces: [{ id: 'w1', title: 'Project', path: '/project' }], defaultWorkspaceId: 'w1', policy: { requiresHost: true, missedRuns: 'skip', interruptedRuns: 'do-not-retry', timeoutMinutes: 60 } }
  action = vi.fn(async (value: { action: string }) => value.action === 'preview' ? { occurrences: ['2027-01-11T09:00:00Z'] } : {})
  read = vi.fn(async () => structuredClone(view)); openSession = vi.fn(async () => {}); close = vi.fn()
  vi.spyOn(window, 'confirm').mockReturnValue(true)
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.useRealTimers(); vi.restoreAllMocks(); vi.unstubAllGlobals() })
async function mount() {
  await act(async () => { root.render(createElement(CronTasksSettingsSection, { api: { read, action }, localeId: () => 'en', t: (key: string) => key, openSession, close } as CronTasksSettingsProps)) })
}
function button(text: string): HTMLButtonElement {
  const found = [...host.querySelectorAll<HTMLButtonElement>('button')].find(item => item.textContent === text)
  if (!found) throw new Error(`Missing button: ${text}`)
  return found
}
async function click(text: string) { await act(async () => { button(text).click() }) }
async function edit() { await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMain')!.click() }); await click('edit') }
async function preview() { await act(async () => { await vi.advanceTimersByTimeAsync(260) }) }
async function set(element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(element, value)
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? 'change' : 'input', { bubbles: true }))
  })
}
function field(label: string): HTMLInputElement { return [...host.querySelectorAll('label')].find(item => item.textContent === label)!.querySelector('input')! }
async function menu(id: string) { await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!.click() }); await click(id) }
const mutations = () => action.mock.calls.filter(([value]) => value.action !== 'preview')

describe('automation list and navigation controls', () => {
  it('searches names and instructions and refreshes without mutating tasks', async () => {
    await mount()
    await set(host.querySelector<HTMLInputElement>('[aria-label="search"]')!, 'no match')
    expect(host.textContent).toContain('noSearchResults')
    await set(host.querySelector<HTMLInputElement>('[aria-label="search"]')!, 'INSTRUCTION')
    expect(host.querySelector('.dshCronMain')).not.toBeNull()
    await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="refresh"]')!.click() })
    expect(read).toHaveBeenCalledTimes(2); expect(mutations()).toEqual([])
  })
  it('shows a load error and recovers with an empty-list creation entry', async () => {
    read.mockRejectedValueOnce(new Error('Offline'))
    await mount(); expect(host.querySelector('[role="alert"]')!.textContent).toContain('Offline')
    view = { ...view, jobs: [] }; await click('refresh'); await click('addFirst'); expect(host.querySelector('form')).not.toBeNull()
    await click('cancel'); expect(host.textContent).toContain('emptyHint')
  })
  it.each(['openTaskSession', 'openSession'])('opens the original or historical Session via %s', async (entry) => {
    await mount(); await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMain')!.click() })
    await click(entry)
    expect(openSession).toHaveBeenCalledWith(task.id, entry === 'openTaskSession' ? 'cron-1' : 'cron-old')
    expect(close).toHaveBeenCalledOnce(); expect(mutations()).toEqual([])
  })
  it('keeps the detail visible and exposes navigation errors', async () => {
    openSession.mockRejectedValue(new Error('Attachment refused'))
    await mount(); await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMain')!.click() }); await click('openTaskSession')
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Attachment refused'); expect(close).not.toHaveBeenCalled()
    await click('backToList'); expect(host.querySelector('.dshCronList')).not.toBeNull()
  })
  it('disables archived Session links without changing stored history', async () => {
    view = { ...view, archivedSessionIds: ['cron-1', 'cron-old'] }; await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMain')!.click() })
    expect(host.textContent).toContain('archivedSession'); expect(host.querySelector('.dshCronOpenSession')).toBeNull()
    expect([...host.querySelectorAll('button')].some(item => item.textContent === 'openTaskSession')).toBe(false)
  })
  it.each([true, false])('requires deletion confirmation (confirmed=%s)', async (confirmed) => {
    vi.mocked(window.confirm).mockReturnValue(confirmed); await mount(); await menu('delete')
    expect(mutations()).toEqual(confirmed ? [[{ action: 'delete', id: task.id }]] : [])
  })
  it.each([true, false])('toggles an enabled=%s task through the same registry', async (enabled) => {
    view = { ...view, jobs: [{ ...task, enabled }] }; await mount(); await menu(enabled ? 'disable' : 'enable')
    expect(mutations()).toEqual([[{ action: 'toggle', id: task.id, enabled: !enabled }]])
    if (!enabled) expect(button('run').disabled).toBe(true)
  })
  it('closes the menu with Escape and prevents editing while any task is running', async () => {
    view = { ...view, running: ['other-task'] }; await mount()
    await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!.click() })
    expect(button('edit').disabled).toBe(true); expect(button('disable').disabled).toBe(true); expect(button('delete').disabled).toBe(true)
    expect(button('add').disabled).toBe(true); expect(button('run').disabled).toBe(true)
    await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' })) })
    expect(host.querySelector('[role="menu"]')).toBeNull()
  })
})

describe('automation editing and schedule validation', () => {
  it('creates a task once, with its name, prompt and current schedule', async () => {
    await mount(); await click('add')
    await set(field('name'), 'New task'); await set(host.querySelector('textarea')!, 'New instruction')
    expect(button('save').disabled).toBe(true); await preview(); expect(button('save').disabled).toBe(false)
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })); host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(mutations()).toHaveLength(1)
    expect(mutations()[0]![0]).toMatchObject({ action: 'create', input: { name: 'New task', prompt: 'New instruction', expression: '0 9 * * 1-5', enabled: true } })
    expect(host.querySelector('form')).toBeNull()
  })
  it('preserves identity, instructions, workspace and enabled state while editing', async () => {
    await mount(); await edit(); await preview(); await click('save')
    expect(mutations()[0]![0]).toMatchObject({ action: 'update', id: task.id, input: { name: task.name, prompt: task.prompt, expression: task.expression, workspaceId: 'w1', enabled: true } })
  })
  it.each(['daily', 'weekdays', 'weekends', 'weekly', 'interval', 'custom', 'once'])('previews the %s frequency and cancels without saving', async (mode) => {
    await mount(); await click('add'); await click(mode); await preview()
    expect(action).toHaveBeenCalledWith(expect.objectContaining({ action: 'preview' })); await click('cancel')
    expect(mutations()).toEqual([])
  })
  it('refuses an empty weekly selection instead of reusing the previous expression', async () => {
    await mount(); await edit(); await click('weekly'); await preview(); await click('weekdayShort1'); await preview()
    expect(button('save').disabled).toBe(true); expect(host.textContent).toContain('Select at least one weekday')
    await act(async () => { host.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(mutations()).toEqual([])
  })
  it('refuses an invalid interval and recovers once corrected', async () => {
    await mount(); await edit(); await click('interval'); await preview()
    const input = host.querySelector<HTMLInputElement>('input[type="number"]')!
    await set(input, '0'); await preview(); expect(button('save').disabled).toBe(true)
    await set(input, '15'); await preview(); await click('save')
    expect(mutations()[0]![0]).toMatchObject({ input: { expression: '*/15 * * * *' } })
  })
  it('does not save a new rule until its own preview succeeds; ignores a stale preview', async () => {
    const old = Promise.withResolvers<unknown>(); action.mockImplementationOnce(() => old.promise)
    await mount(); await edit(); await preview()
    await click('weekdays'); expect(button('save').disabled).toBe(true); await preview()
    expect(button('save').disabled).toBe(false)
    await act(async () => { old.reject(new Error('Stale error')) })
    expect(button('save').disabled).toBe(false); expect(host.textContent).not.toContain('Stale error')
  })
  it('shows server preview failures and malformed previews without permitting a save', async () => {
    await mount(); await edit(); action.mockRejectedValueOnce(new Error('Unsupported rule')); await preview()
    expect(button('save').disabled).toBe(true); expect(host.textContent).toContain('Unsupported rule')
    action.mockResolvedValueOnce({}); await click('weekdays'); await preview()
    expect(button('save').disabled).toBe(true)
  })
  it('keeps the draft on save failure and allows retry', async () => {
    await mount(); await edit(); await preview(); action.mockRejectedValueOnce(new Error('Storage failed')); await click('save')
    expect(host.querySelector('form')).not.toBeNull(); expect(field('name').value).toBe(task.name)
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Storage failed')
    await click('save'); expect(host.querySelector('form')).toBeNull()
  })
  it('saves one-time input in the selected zone and preserves exact seconds when unchanged', async () => {
    view = { ...view, jobs: [{ ...task, oneTimeAt: '2027-01-10T01:30:45.000Z', timeZone: 'Asia/Shanghai' }] }
    await mount(); await edit(); await preview(); await click('save')
    expect(mutations()[0]![0]).toMatchObject({ input: { oneTimeAt: '2027-01-10T01:30:45.000Z' } })
    await edit(); await set(host.querySelector<HTMLInputElement>('input[type="date"]')!, '2027-01-12'); await preview(); await click('save')
    expect(mutations()[1]![0]).toMatchObject({ input: { oneTimeAt: '2027-01-12T01:30:00.000Z', timeZone: 'Asia/Shanghai' } })
  })
  it('clears recurring one-time overrides and permits choosing the default workspace', async () => {
    view = { ...view, jobs: [{ ...task, oneTimeAt: '2027-01-10T09:00:00Z' }] }; await mount(); await edit()
    await click('daily'); await set(host.querySelector<HTMLSelectElement>('.dshCronAdvanced select')!, ''); await preview(); await click('save')
    const input = mutations()[0]![0].input
    expect(input.oneTimeAt).toBeUndefined(); expect(input.workspaceId).toBeUndefined()
  })
})

describe('manual run, stop and asynchronous state', () => {
  it('sends a single manual run even on rapid duplicate clicks', async () => {
    const pending = Promise.withResolvers<unknown>(); await mount(); action.mockReturnValueOnce(pending.promise)
    const run = button('run'); await act(async () => { run.click(); run.click() })
    expect(mutations()).toEqual([[{ action: 'run', id: task.id }]])
    await act(async () => { pending.resolve({}) })
  })
  it('allows stopping a manual run before its long request returns', async () => {
    const pending = Promise.withResolvers<unknown>(); await mount(); action.mockReturnValueOnce(pending.promise)
    await click('run'); view = { ...view, running: [task.id] }
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(button('cancelRun').disabled).toBe(false); await click('cancelRun')
    expect(action).toHaveBeenCalledWith({ action: 'cancel', id: task.id })
    await act(async () => { pending.resolve({}) })
  })
  it.each([true, false])('confirms stopping a background run (confirmed=%s)', async (confirmed) => {
    vi.mocked(window.confirm).mockReturnValue(confirmed); view = { ...view, running: [task.id] }; await mount(); await click('cancelRun')
    expect(mutations()).toEqual(confirmed ? [[{ action: 'cancel', id: task.id }]] : [])
  })
  it('stops from the detail page and exposes a failed cancellation', async () => {
    view = { ...view, running: [task.id] }; await mount(); await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMain')!.click() })
    action.mockRejectedValueOnce(new Error('Stop failed')); await click('cancelRun')
    expect(host.querySelector('[role="alert"]')!.textContent).toBe('Stop failed'); expect(button('cancelRun').disabled).toBe(false)
  })
  it('ignores an older read after a successful mutation refresh', async () => {
    await mount(); const old = Promise.withResolvers<CronTasksView>(); read.mockReturnValueOnce(old.promise)
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    view = { ...view, jobs: [{ ...task, enabled: false }] }; await menu('disable')
    await act(async () => { old.resolve({ ...view, jobs: [task] }) })
    expect(button('run').disabled).toBe(true)
  })
})


it('edits weekdays, hour, minute, interval unit, workspace and enabled checkbox', async () => {
  await mount(); await edit(); await click('weekly'); await click('weekdayShort3')
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="hour"]')!.click() }); await click('13')
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="minute"]')!.click() }); await click('45')
  await preview(); await click('save')
  expect(mutations()[0]![0]).toMatchObject({ input: { expression: '45 13 * * 1,3' } })
  await edit(); await click('interval'); await set(host.querySelector<HTMLSelectElement>('.dshCronInterval select')!, 'hours')
  await set(host.querySelector<HTMLInputElement>('input[type="number"]')!, '2')
  await set(host.querySelector<HTMLSelectElement>('.dshCronAdvanced select')!, '')
  await act(async () => { host.querySelector<HTMLInputElement>('input[type="checkbox"]')!.click() })
  await preview(); await click('save')
  expect(mutations()[1]![0]).toMatchObject({ input: { expression: '0 */2 * * *', enabled: false } })
})

it('disables form fields while saving and retains them when the write fails', async () => {
  await mount(); await edit(); await preview()
  const pending = Promise.withResolvers<unknown>(); action.mockReturnValueOnce(pending.promise)
  await click('save'); expect(host.querySelector<HTMLFieldSetElement>('.dshCronEditorBody')!.disabled).toBe(true)
  await act(async () => { pending.reject(new Error('Write refused')) })
  expect(host.querySelector<HTMLFieldSetElement>('.dshCronEditorBody')!.disabled).toBe(false)
  expect(field('name').value).toBe(task.name)
})

it('displays one-time schedule and next run in the configured zone', async () => {
  view = { ...view, jobs: [{ ...task, oneTimeAt: '2027-01-10T01:30:00Z', nextRunAt: '2027-01-10T01:30:00Z', timeZone: 'Asia/Shanghai' }] }
  await mount()
  expect(host.querySelector('.dshCronSchedule')!.textContent).toContain('9:30')
  expect(host.querySelector('.dshCronNext')!.textContent).toContain('9:30')
})


it('explains why an archived Session task cannot be enabled', async () => {
  view = { ...view, jobs: [{ ...task, enabled: false }], archivedSessionIds: ['cron-1'] }
  await mount(); await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!.click() })
  expect(button('sessionArchivedNextRun').disabled).toBe(true); expect(mutations()).toEqual([])
})


it('uses actual completion time for old runs and distinguishes manual from scheduled execution', async () => {
  view = { ...view, jobs: [{ ...task, history: [
    { scheduledFor: '2027-01-11T09:00:00Z', startedAt: '2027-01-10T09:00:00Z', finishedAt: '2027-01-10T09:01:00Z', status: 'completed', trigger: 'manual' },
    { scheduledFor: '2027-01-09T09:00:00Z', startedAt: '2027-01-09T09:00:00Z', finishedAt: '2027-01-10T09:01:00Z', status: 'skipped', trigger: 'schedule' },
  ] }] }
  await mount(); await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMain')!.click() })
  const times = host.querySelectorAll('time')
  expect(times[0]!.dateTime).toBe('2027-01-10T09:01:00Z')
  expect(times[1]!.dateTime).toBe('2027-01-09T09:00:00Z')
  expect(host.textContent).toContain('manualTrigger'); expect(host.textContent).toContain('scheduledTrigger')
})
