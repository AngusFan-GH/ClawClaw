// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { RemindersSettingsSection, type RemindersSettingsSectionProps } from '../src/client/RemindersSettingsSection.tsx'
import { zh } from '../src/client/reminders-locales.ts'
import type { DesktopRemindersApi } from '../src/client/reminders-api.ts'
import type { DesktopReminder } from '../src/reminders-contract.ts'

let host: HTMLDivElement
let root: Root
let reminders: DesktopReminder[]
let api: DesktopRemindersApi

beforeEach(() => {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  reminders = []
  api = {
    read: vi.fn(async () => ({ reminders })),
    create: vi.fn(async (text: string) => {
      reminders = [{ id: 'new', text, enabled: true, createdAt: '2026-10-25', updatedAt: '2026-10-25' }, ...reminders]
      return { reminders }
    }),
    update: vi.fn(async () => ({ reminders })),
    toggle: vi.fn(async () => ({ reminders })),
    remove: vi.fn(async () => ({ reminders })),
  }
  host = document.createElement('div'); document.body.append(host); root = createRoot(host)
})
afterEach(async () => { await act(async () => { root.unmount() }); host.remove(); vi.unstubAllGlobals() })

async function mount() {
  await act(async () => {
    root.render(createElement(RemindersSettingsSection, {
      api,
      t: (key: keyof typeof zh, values?: Record<string, unknown>) => Object.entries(values ?? {}).reduce((text, [name, value]) => text.replace(`{${name}}`, String(value)), zh[key] as string),
    } as RemindersSettingsSectionProps))
  })
}
async function click(selector: string) { await act(async () => { host.querySelector<HTMLButtonElement>(selector)!.click() }) }

it('reviews presets in a draft before saving, then shows the collection before the composer', async () => {
  await mount()
  expect(host.querySelector('.dshRemindersCollection')).toBeNull()
  await click('.dshRemindersPresets button')
  expect(api.create).not.toHaveBeenCalled()
  expect(host.querySelector('textarea')!.value).toBe(zh.privacy)
  expect(document.activeElement).toBe(host.querySelector('textarea'))
  await click('.dshRemindersComposerActions .dshCronPrimary')
  expect(api.create).toHaveBeenCalledExactlyOnceWith(zh.privacy)
  expect(host.querySelector('.dshRemindersCollection')!.compareDocumentPosition(host.querySelector('.dshRemindersPanel')!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  expect(host.querySelector('.dshRemindersPanelHeader')!.textContent).toContain('已启用 1 / 共 1 条')
  expect(host.querySelector<HTMLButtonElement>('.dshRemindersPresets button')!.disabled).toBe(true)
  expect(host.querySelector<HTMLTextAreaElement>('.dshRemindersPanel textarea')!.value).toBe('')
})

it('adds presets without discarding the existing draft and clears it explicitly', async () => {
  await mount()
  await click('.dshRemindersPresets button:nth-child(1)')
  await click('.dshRemindersPresets button:nth-child(2)')
  expect(host.querySelector('textarea')!.value).toBe(`${zh.privacy}\n${zh.files}`)
  expect(api.create).not.toHaveBeenCalled()
  await click('.dshRemindersTextButton')
  expect(host.querySelector('textarea')!.value).toBe('')
  expect(host.querySelector('.dshRemindersTextButton')).toBeNull()
})

it('keeps the draft available after a failed save and puts capability guidance in disclosure', async () => {
  vi.mocked(api.create).mockRejectedValueOnce(new Error('Offline'))
  await mount(); await click('.dshRemindersPresets button'); await click('.dshRemindersComposerActions .dshCronPrimary')
  expect(host.querySelector('[role="alert"]')!.textContent).toBe(zh.operationFailed)
  expect(host.querySelector('textarea')!.value).toBe(zh.privacy)
  expect(host.querySelector('details')!.open).toBe(false)
  expect(host.querySelector('details p')!.textContent).toBe(zh.notice)
  expect(host.textContent).not.toContain('下一次模型请求')
})
