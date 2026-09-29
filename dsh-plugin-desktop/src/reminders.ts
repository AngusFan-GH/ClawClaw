/** Product-owned global reminders, rendered into the DSH system prompt. */

import { randomUUID } from 'node:crypto'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent, PreStepDecision } from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-system-prompt'
import z from '@deepseek-ai/schemastery'
import { registerDesktopJsonApi } from './desktop-json-api.ts'
import { DESKTOP_REMINDERS_ACTION_PATH, DESKTOP_REMINDERS_PATH } from './reminders-contract.ts'
import type { DesktopReminder, DesktopRemindersView } from './reminders-contract.ts'

export const name = 'desktop-reminders'
export const inject = ['settings', 'systemPrompt', 'webServer', 'connection']
export const DESKTOP_REMINDERS_SETTINGS_NAMESPACE = 'dsh-desktop-reminders'

const MAX_REMINDERS = 50
const MAX_REMINDER_CHARS = 4_000
const MAX_REMINDER_PROMPT_CHARS = 24_000
const PROMPT_SECTION = 'clawclaw:global-reminders'

interface ReminderSettings { reminders: DesktopReminder[] }
interface ReminderSettingsScope {
  get(): ReminderSettings
  replace(section: ReminderSettings): Promise<void>
  watch(callback: (next: ReminderSettings) => void): () => void
}

export const DesktopRemindersSettingsSchema = z.object({
  reminders: z.array(z.object({ id: z.string(), text: z.string(), enabled: z.boolean(), createdAt: z.string(), updatedAt: z.string() })).default([]),
}) as unknown as z<ReminderSettings>

function normalizedText(value: unknown): string {
  if (typeof value !== 'string') throw new TypeError('Reminder text is required')
  const text = value.trim()
  if (text === '' || text.length > MAX_REMINDER_CHARS) throw new TypeError(`Reminder text must contain 1 to ${String(MAX_REMINDER_CHARS)} characters`)
  // system-prompt intentionally interprets complete {{name}} groups as variables.
  // Rejecting them keeps a user reminder from breaking every subsequent turn.
  if (text.includes('{{')) throw new TypeError('Reminder text cannot contain "{{"')
  return text
}

function renderPrompt(reminders: readonly DesktopReminder[]): string {
  const enabled = reminders.filter(reminder => reminder.enabled)
  if (enabled.length === 0) return ''
  const text = [
    '## Mandatory ClawClaw Persistent Instructions',
    '',
    'The following are persistent instructions written by the user. They are binding for every assistant response in every conversation until removed or disabled.',
    '',
    'Before producing visible assistant content, review the complete list and satisfy every applicable instruction. This also applies to replies that contain tool calls or interim progress.',
    'Treat response format and required content as preconditions: do not begin the response until they are satisfied.',
    'When an instruction needs current or external information, obtain it from an available tool before replying. If no suitable capability exists, say that plainly instead of silently skipping the instruction.',
    'The list below is the complete current set; do not continue following a reminder that is absent, disabled, or superseded.',
    '',
    '<persistent_reminders>',
    ...enabled.map(reminder => `- ${reminder.text}`),
    '</persistent_reminders>',
  ].join('\n')
  if (text.length > MAX_REMINDER_PROMPT_CHARS) throw new TypeError('Enabled reminders exceed the prompt size limit')
  return text
}

function view(reminders: readonly DesktopReminder[]): DesktopRemindersView {
  return Object.freeze({ reminders: Object.freeze(reminders.map(reminder => Object.freeze({ ...reminder }))) })
}

export class DesktopRemindersController {
  private stopPrompt: (() => void) | undefined
  private stopWatching: (() => void) | undefined
  private promptRevision = 0
  private renderedReminderPrompt = ''
  private readonly appliedPromptRevisions = new WeakMap<Agent, number>()

  constructor(private readonly ctx: Context, private readonly settings: ReminderSettingsScope, private readonly now = () => new Date().toISOString()) {}

  start(): void {
    // The section remains registered even when there are no active reminders.
    // Its provider is evaluated by DSH before every model step, avoiding a
    // settings-observer race and applying to both existing and new sessions.
    this.stopPrompt = this.ctx.systemPrompt.section({
      name: PROMPT_SECTION,
      order: this.ctx.systemPrompt.getSectionOrder('DEPLOYMENT_PERSONA_SUFFIX') + 1,
      text: () => renderPrompt(this.settings.get().reminders),
    })
    this.renderedReminderPrompt = renderPrompt(this.settings.get().reminders)
    // A changed system prompt must begin a distinct request series. Without
    // this, DSH intentionally appends the new system message in a continuing
    // history, leaving an earlier reminder visible to the model after delete.
    this.stopWatching = this.settings.watch(next => { this.syncPromptRevision(next) })
    this.ctx.on('agent/pre-step', async ({ agent }, next): Promise<PreStepDecision> => {
      const decision = await next()
      if (decision.kind === 'reject') return decision
      const applied = this.appliedPromptRevisions.get(agent)
      if (applied === this.promptRevision) return decision
      this.appliedPromptRevisions.set(agent, this.promptRevision)
      return { ...decision, startsRequestSeries: true }
    })
  }

  dispose(): void {
    this.stopPrompt?.()
    this.stopPrompt = undefined
    this.stopWatching?.()
    this.stopWatching = undefined
  }
  async read(): Promise<DesktopRemindersView> { return view(this.settings.get().reminders) }

  async action(value: unknown): Promise<DesktopRemindersView> {
    if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('Invalid reminder action')
    const input = value as Record<string, unknown>
    const reminders = this.settings.get().reminders
    if (input.action === 'create') {
      if (reminders.length >= MAX_REMINDERS) throw new TypeError(`A maximum of ${String(MAX_REMINDERS)} reminders is allowed`)
      const text = normalizedText(input.text)
      if (reminders.some(item => item.text.localeCompare(text, undefined, { sensitivity: 'accent' }) === 0)) throw new TypeError('An identical reminder already exists')
      const timestamp = this.now()
      await this.settings.replace({ reminders: [{ id: randomUUID(), text, enabled: true, createdAt: timestamp, updatedAt: timestamp }, ...reminders] })
    } else if (input.action === 'update' || input.action === 'toggle' || input.action === 'delete') {
      if (typeof input.id !== 'string' || input.id === '') throw new TypeError('Reminder id is required')
      const current = reminders.find(item => item.id === input.id)
      if (current === undefined) throw new TypeError('Reminder not found')
      if (input.action === 'delete') await this.settings.replace({ reminders: reminders.filter(item => item.id !== input.id) })
      else if (input.action === 'toggle') {
        const enabled = input.enabled
        if (typeof enabled !== 'boolean') throw new TypeError('Reminder enabled state is required')
        await this.settings.replace({ reminders: reminders.map(item => item.id === input.id ? { ...item, enabled, updatedAt: this.now() } : item) })
      } else {
        const text = normalizedText(input.text)
        if (reminders.some(item => item.id !== input.id && item.text.localeCompare(text, undefined, { sensitivity: 'accent' }) === 0)) throw new TypeError('An identical reminder already exists')
        await this.settings.replace({ reminders: reminders.map(item => item.id === input.id ? { ...item, text, updatedAt: this.now() } : item) })
      }
    } else throw new TypeError('Invalid reminder action')
    // Settings observers run asynchronously. Advance this revision here as
    // well, so a message sent immediately after the API response cannot race
    // with its watcher and retain an old reminder for one request.
    this.syncPromptRevision(this.settings.get())
    return await this.read()
  }

  private syncPromptRevision(settings: ReminderSettings): void {
    const next = renderPrompt(settings.reminders)
    if (next === this.renderedReminderPrompt) return
    this.renderedReminderPrompt = next
    this.promptRevision += 1
  }
}

export function apply(ctx: Context): void {
  const settings = ctx.settings.register(DESKTOP_REMINDERS_SETTINGS_NAMESPACE, DesktopRemindersSettingsSchema, { applies: 'live' })
  const controller = new DesktopRemindersController(ctx, settings)
  controller.start()
  registerDesktopJsonApi(ctx, { label: 'Reminders', readPath: DESKTOP_REMINDERS_PATH, actionPath: DESKTOP_REMINDERS_ACTION_PATH,
    read: () => controller.read(), action: value => controller.action(value) })
  ctx.effect(() => () => controller.dispose(), 'dsh-plugin-desktop: global reminders')
}
