import { useEffect, useRef, useState } from 'react'
import { IconSkillOutline16, Modal, Tooltip } from '@deepseek-ai/dsh-client-ui-primitives'
import type { PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-agent-presets/types'
import type { DesktopSkillsLocaleKey } from './skills-locales.ts'
import { SkillPickError, type ConversationSkillCatalog, type ConversationSkillsApi } from './conversation-skills.ts'

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
  const trigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const close = () => { request.current?.abort(); setOpen(false) }
  const message = (cause: unknown) => cause instanceof SkillPickError ? t(cause.code) : t('unavailable')

  useEffect(() => { if (disabled) close() }, [disabled])
  useEffect(() => {
    if (!open) return
    const abort = new AbortController(); request.current = abort
    setCatalog(undefined); setError(''); setBusy(false)
    void apiRef.current.list(abort.signal).then(value => {
      if (!abort.signal.aborted) setCatalog(value)
    }, cause => { if (!abort.signal.aborted) setError(message(cause)) })
    return () => { abort.abort() }
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
    setBusy(true); setError('')
    try { await apiRef.current.select(name, abort.signal); if (!abort.signal.aborted) close() }
    catch (cause) { if (!abort.signal.aborted) setError(message(cause)) }
    finally { if (!abort.signal.aborted) setBusy(false) }
  }
  const needle = query.trim().toLocaleLowerCase()
  const skills = catalog?.skills.filter(skill => `${skill.name} ${skill.description}`.toLocaleLowerCase().includes(needle)) ?? []
  return <>
    <Tooltip label={t('chooseSkill')}><button ref={trigger} type="button" className="dshSkillPickerTrigger" aria-label={t('chooseSkill')} aria-haspopup="dialog" aria-expanded={open} disabled={disabled} onClick={() => { setQuery(''); setOpen(true) }}><IconSkillOutline16 /></button></Tooltip>
    <Modal open={open} onClose={close} title={t('chooseSkill')} closeLabel={t('close')} className="dshSkillsDialog dshSkillPicker" contentClassName="dshSkillsDialogContent">
      <div className="dshSkillsForm"><input ref={search} type="search" aria-label={t('searchSkills')} placeholder={t('searchSkills')} value={query} onChange={event => { setQuery(event.target.value) }} /></div>
      {error && <div className="dshSkillPickerError" role="alert">{error}<button type="button" className="dshIntegrationsCommand" disabled={busy} onClick={() => { setReload(value => value + 1) }}>{t('refresh')}</button></div>}
      <div className="dshSkillPickerResults" aria-busy={busy || (!catalog && !error)}>
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
