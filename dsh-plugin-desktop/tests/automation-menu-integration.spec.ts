// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { CronTasksSettingsSection, CronTimePicker, type CronTasksSettingsProps } from '../src/client/CronTasksSettingsSection.tsx'
import type { CronTasksView } from '../src/client/cron-tasks-api.ts'
let root: Root
let host: HTMLDivElement
beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true); host = document.createElement('div'); document.body.append(host); root = createRoot(host) })
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.unstubAllGlobals() })
async function mount(running: readonly string[] = []) {
  const view: CronTasksView = { jobs: [{ id: 'task', name: 'Task', prompt: 'Instruction', expression: '0 9 * * *', timeZone: 'UTC', enabled: true, nextRunAt: null, history: [] }], running, archivedSessionIds: [], workspaces: [], defaultWorkspaceId: null, policy: { requiresHost: true, missedRuns: 'skip', interruptedRuns: 'do-not-retry', timeoutMinutes: 60 } }
  const action = vi.fn(async () => ({}))
  await act(async () => { root.render(createElement(CronTasksSettingsSection, { t: (key: string) => key, api: { read: async () => view, action }, localeId: () => 'en', openSession: vi.fn(), close: vi.fn() } as CronTasksSettingsProps)) })
  return action
}
it('selects an action through the actual portalled DSH menu', async () => {
  const action = await mount()
  await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!.click() })
  const menu = document.querySelector('[role="menu"]')!
  expect(menu).not.toBeNull()
  expect(host.contains(menu)).toBe(false)
  const toggle = [...menu.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'disable')!
  await act(async () => { toggle.click() })
  expect(action).toHaveBeenCalledWith({ action: 'toggle', id: 'task', enabled: false })
  expect(host.querySelector('.dshCronMoreTrigger')!.getAttribute('aria-expanded')).toBe('false')
})
it('keeps disabled actions inert in the actual DSH menu', async () => {
  const action = await mount(['other-task'])
  await act(async () => { host.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!.click() })
  const toggle = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === 'disable')!
  expect((toggle as HTMLButtonElement).disabled).toBe(true)
  await act(async () => { toggle.click() })
  expect(action).not.toHaveBeenCalled()
})


it('closes the actual DSH menu with Escape and outside clicks', async () => {
  await mount(); const trigger = host.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!
  await act(async () => { trigger.click() })
  await act(async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })) })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
  await act(async () => { trigger.click() })
  await act(async () => { document.body.click() })
  expect(trigger.getAttribute('aria-expanded')).toBe('false')
})
it('selects minutes through the actual time-picker menu', async () => {
  const onChange = vi.fn()
  await act(async () => { root.render(createElement(CronTimePicker, { value: '09:30', label: 'Time', hourLabel: 'Hour', minuteLabel: 'Minute', onChange })) })
  await act(async () => { host.querySelector<HTMLButtonElement>('[aria-label="Minute"]')!.click() })
  const minute = [...document.querySelectorAll<HTMLElement>('[role="menuitem"]')].find(item => item.textContent === '45')!
  await act(async () => { minute.click() })
  expect(onChange).toHaveBeenCalledWith('09:45')
})
