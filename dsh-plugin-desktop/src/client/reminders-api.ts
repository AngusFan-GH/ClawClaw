import { DESKTOP_REMINDERS_ACTION_PATH, DESKTOP_REMINDERS_PATH } from '../reminders-contract.ts'
import type { DesktopReminder, DesktopRemindersView } from '../reminders-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
function isRecord(value: unknown): value is Record<string, unknown> { return value !== null && typeof value === 'object' && !Array.isArray(value) }
function text(value: unknown, max = 4_000): value is string { return typeof value === 'string' && value.length <= max }
function parseReminder(value: unknown): DesktopReminder {
  if (!isRecord(value) || !text(value.id, 128) || value.id === '' || !text(value.text) || value.text === '' || typeof value.enabled !== 'boolean'
    || !text(value.createdAt, 64) || !text(value.updatedAt, 64)) throw new Error('Invalid reminder response')
  return Object.freeze({ id: value.id, text: value.text, enabled: value.enabled, createdAt: value.createdAt, updatedAt: value.updatedAt })
}
export function parseDesktopRemindersView(value: unknown): DesktopRemindersView {
  if (!isRecord(value) || !Array.isArray(value.reminders) || value.reminders.length > 50) throw new Error('Invalid reminders response')
  const reminders = value.reminders.map(parseReminder)
  if (new Set(reminders.map(reminder => reminder.id)).size !== reminders.length) throw new Error('Duplicate reminder response')
  return Object.freeze({ reminders: Object.freeze(reminders) })
}
async function responseValue(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('Reminders response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}
export interface DesktopRemindersApi {
  read(): Promise<DesktopRemindersView>
  create(text: string): Promise<DesktopRemindersView>
  update(id: string, text: string): Promise<DesktopRemindersView>
  toggle(id: string, enabled: boolean): Promise<DesktopRemindersView>
  remove(id: string): Promise<DesktopRemindersView>
}
export function createDesktopRemindersApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopRemindersApi {
  const post = async (body: object): Promise<DesktopRemindersView> => parseDesktopRemindersView(await responseValue(await fetcher(DESKTOP_REMINDERS_ACTION_PATH, {
    method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  })))
  return Object.freeze({
    async read() { return parseDesktopRemindersView(await responseValue(await fetcher(DESKTOP_REMINDERS_PATH, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }))) },
    create: (text: string) => post({ action: 'create', text }), update: (id: string, text: string) => post({ action: 'update', id, text }),
    toggle: (id: string, enabled: boolean) => post({ action: 'toggle', id, enabled }), remove: (id: string) => post({ action: 'delete', id }),
  })
}
