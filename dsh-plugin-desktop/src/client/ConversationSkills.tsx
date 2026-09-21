import { type KeyboardEvent as ReactKeyboardEvent, useEffect, useRef, useState } from 'react'
import { IconSkillOutline16, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
import { SettingsIconButton } from './settings-controls.tsx'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type { DesktopSkillsLocaleKey } from './skills-locales.ts'
import { rankConversationSkills, SkillPickError, type ConversationSkillCatalog, type ConversationSkillsApi } from './conversation-skills.ts'

export type ConversationSkillsProps = PropsRuntime<'conversation.input.left'> & PropsLocale<'desktop.skills'> & { api: ConversationSkillsApi }

export function ConversationSkills({ api, t, useInput, useSession, useProjection }: ConversationSkillsProps) {
  const phase = useInput(state => state.phase)
  const subagent = useSession(state => state.subagent)
  const sessionId = useSession(state => state.sessionId)
  const removed = useSession(state => state.removed)
  const preset = useProjection('agentPreset')
  return <SkillPicker key={`${sessionId}:${preset}`} api={api} t={t} disabled={phase !== 'plain' || subagent !== null || removed} />
}

export function SkillPicker({ api, t, disabled }: { api: ConversationSkillsApi; t: (key: DesktopSkillsLocaleKey) => string; disabled: boolean }) {
  const apiRef = useRef(api)
  apiRef.current = api
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<ConversationSkillCatalog>()
  const [query, setQuery] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [reload, setReload] = useState(0)
  const request = useRef<AbortController>()
  const selecting = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const results = useRef<HTMLDivElement>(null)
  const close = () => { request.current?.abort(); setOpen(false) }
  const message = (cause: unknown) => cause instanceof SkillPickError ? t(cause.code) : t('unavailable')

  useEffect(() => { if (disabled) close() }, [disabled])
  useEffect(() => {
    if (!open) return
    setCatalog(undefined); setError(''); setBusy(false)
    let pending = false
    const load = () => {
      if (pending || selecting.current || document.visibilityState === 'hidden') return
      pending = true
      request.current?.abort()
      const abort = new AbortController(); request.current = abort
      void apiRef.current.list(abort.signal).then(value => {
        if (!abort.signal.aborted) { setCatalog(value); setError('') }
      }, cause => { if (!abort.signal.aborted) setError(message(cause)) }).finally(() => { pending = false })
    }
    load()
    const timer = window.setInterval(load, 5000)
    window.addEventListener('focus', load)
    document.addEventListener('visibilitychange', load)
    return () => {
      request.current?.abort(); window.clearInterval(timer)
      window.removeEventListener('focus', load); document.removeEventListener('visibilitychange', load)
    }
  // Session/preset changes remount the picker. An ordinary parent render
  // after inserting text must not cancel the selection before it closes.
  }, [open, reload])
  useEffect(() => {
    if (!open) return
    const dialog = search.current?.closest<HTMLElement>('[role="dialog"]')
    const overflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    search.current?.focus()
    const keydown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); close() }
      if (event.key !== 'Tab' || !dialog) return
      const items = [...dialog.querySelectorAll<HTMLElement>('button:not(:disabled),input:not(:disabled)')]
      const index = items.indexOf(document.activeElement as HTMLElement)
      if (index === -1 || (event.shiftKey ? index === 0 : index === items.length - 1)) {
        event.preventDefault(); items[event.shiftKey ? items.length - 1 : 0]?.focus()
      }
    }
    document.addEventListener('keydown', keydown, true)
    return () => {
      document.removeEventListener('keydown', keydown, true)
      document.body.style.overflow = overflow
      trigger.current?.focus()
    }
  }, [open])

  const select = async (name: string) => {
    if (busy || request.current?.signal.aborted) return
    const abort = request.current
    if (!abort) return
    selecting.current = true
    setBusy(true); setError('')
    try { await apiRef.current.select(name, abort.signal); if (!abort.signal.aborted) close() }
    catch (cause) { if (!abort.signal.aborted) setError(message(cause)) }
    finally { selecting.current = false; if (!abort.signal.aborted) setBusy(false) }
  }
  const skills = rankConversationSkills(catalog?.skills ?? [], query)
  const navigate = (event: ReactKeyboardEvent<HTMLElement>) => {
    if (event.nativeEvent.isComposing || busy) return
    const buttons = [...(results.current?.querySelectorAll<HTMLButtonElement>('button:not(:disabled)') ?? [])]
    if (buttons.length === 0) return
    const index = buttons.indexOf(document.activeElement as HTMLButtonElement)
    if (event.key === 'Enter' && event.target === search.current) {
      event.preventDefault(); event.stopPropagation(); buttons[0]?.click(); return
    }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault(); event.stopPropagation()
    const next = index < 0 ? (event.key === 'ArrowDown' ? 0 : buttons.length - 1) : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length
    buttons[next]?.focus(); buttons[next]?.scrollIntoView?.({ block: 'nearest' })
  }
  return <>
    <Tooltip label={t('chooseSkill')}><button ref={trigger} type="button" className="dshSkillPickerTrigger" aria-label={t('chooseSkill')} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setQuery(''); setOpen(true) }}><IconSkillOutline16 /></button></Tooltip>
    <Modal open={open} onClose={close} title={t('chooseSkill')} closeLabel={t('close')} className="dshSkillsDialog dshSkillPicker" contentClassName="dshSkillsDialogContent">
      <div className="dshSkillPickerToolbar"><input ref={search} type="search" aria-label={t('searchSkills')} placeholder={t('searchSkills')} value={query} onKeyDown={navigate} onChange={event => { setQuery(event.target.value) }} />
        <SettingsIconButton label={t('refresh')} disabled={busy} onClick={() => { setReload(value => value + 1) }}><RefreshCw /></SettingsIconButton>
      </div>
      {error && <div className="dshSkillPickerError" role="alert">{error}</div>}
      <div ref={results} className="dshSkillPickerResults" onKeyDown={navigate} aria-busy={busy || (!catalog && !error)}>
        {!catalog && !error && <p role="status">{t('loading')}</p>}
        {catalog && skills.length === 0 && <p role="status">{t(catalog.skills.length === 0 ? 'noSessionSkills' : 'noMatches')}</p>}
        {skills.map(skill => {
          const conflict = catalog!.commands.includes(skill.name)
          return <button type="button" key={skill.name} className="dshSkillPickerItem" disabled={busy || conflict} onClick={() => { void select(skill.name) }}>
            <IconSkillOutline16 /><span><strong>{skill.name}</strong><span>{conflict ? t('skillCommandConflict') : skill.description}</span></span>
          </button>
        })}
      </div>
    </Modal>
  </>
}
