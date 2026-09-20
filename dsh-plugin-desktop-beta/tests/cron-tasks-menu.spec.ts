// @vitest-environment jsdom

import { act, createElement, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@deepseek-ai/dsh-client-ui-primitives', async () => {
  const React = await import('react')
  return {
    IconChevronDownOutline14: (props: object) => React.createElement('svg', props),
    Menu: ({ open, anchor, items, onSelect }: {
      open: boolean
      anchor: ReactNode
      items: readonly { id: string; label: ReactNode }[]
      onSelect: (id: string) => void
    }) => React.createElement('span', null, anchor, open && React.createElement('div', { role: 'menu' },
      items.map(item => React.createElement('button', { key: item.id, role: 'menuitem', onClick: () => { onSelect(item.id) } }, item.label)))),
  }
})

import { CronTasksSettingsSection, CronTimePicker, type CronTasksSettingsProps } from '../src/client/CronTasksSettingsSection.tsx'
import type { CronTasksApi, CronTasksView } from '../src/client/cron-tasks-api.ts'

const view: CronTasksView = {
  jobs: [{ id: 'task-1', name: 'Daily report', prompt: 'Summarize', expression: '0 9 * * *', timeZone: 'UTC',
    enabled: true, nextRunAt: '2026-09-21T09:00:00.000Z', history: [] }],
  running: [], archivedSessionIds: [], workspaces: [], defaultWorkspaceId: null,
  policy: { requiresHost: true, missedRuns: 'skip', interruptedRuns: 'do-not-retry', timeoutMinutes: 30 },
}

let root: Root | undefined
let host: HTMLDivElement | undefined

beforeEach(() => { vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true) })
afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  host?.remove()
  host = undefined
  vi.unstubAllGlobals()
})

async function mount(): Promise<{ api: CronTasksApi; action: ReturnType<typeof vi.fn> }> {
  const action = vi.fn(async () => ({}))
  const api: CronTasksApi = { read: vi.fn(async () => view), action }
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  const props = { api, localeId: () => 'en', openSession: vi.fn(), close: vi.fn(), t: (key: string) => key }
  await act(async () => { root!.render(createElement(CronTasksSettingsSection, props as CronTasksSettingsProps)) })
  return { api, action }
}

describe('scheduled task action menu', () => {
  it('closes when the user clicks outside', async () => {
    await mount()
    const trigger = host!.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!
    await act(async () => { trigger.click() })
    expect(host!.querySelector('[role="menu"]')).not.toBeNull()

    await act(async () => { document.body.click() })
    expect(host!.querySelector('[role="menu"]')).toBeNull()
    expect(trigger.getAttribute('aria-expanded')).toBe('false')
  })

  it('closes before running the selected action', async () => {
    const { action } = await mount()
    await act(async () => { host!.querySelector<HTMLButtonElement>('.dshCronMoreTrigger')!.click() })
    const disable = [...host!.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
      .find(button => button.textContent === 'disable')!

    await act(async () => { disable.click() })
    expect(host!.querySelector('[role="menu"]')).toBeNull()
    expect(action).toHaveBeenCalledWith({ action: 'toggle', id: 'task-1', enabled: false })
  })
})

it('selects hour and minute through the shared menu control', async () => {
  const onChange = vi.fn()
  host = document.createElement('div')
  document.body.append(host)
  root = createRoot(host)
  await act(async () => { root!.render(createElement(CronTimePicker, {
    value: '09:30', label: 'Run at', hourLabel: 'Hour', minuteLabel: 'Minute', onChange,
  })) })

  await act(async () => { host!.querySelector<HTMLButtonElement>('[aria-label="Hour"]')!.click() })
  const hour = [...document.querySelectorAll<HTMLButtonElement>('[role="menuitem"]')]
    .find(button => button.textContent === '13')!
  await act(async () => { hour.click() })
  expect(onChange).toHaveBeenCalledWith('13:30')
  expect(document.querySelector('[role="menu"]')).toBeNull()
})
