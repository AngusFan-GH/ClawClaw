/** Expert Center page: browse local experts, filter, inspect, and summon. */

import { useEffect, useMemo, useRef, useState } from 'react'
// @ts-expect-error package subpath has no declaration file
import RefreshCw from 'lucide-react/dist/esm/icons/refresh-cw.mjs'
// @ts-expect-error package subpath has no declaration file
import Search from 'lucide-react/dist/esm/icons/search.mjs'
// @ts-expect-error package subpath has no declaration file
import ArrowLeft from 'lucide-react/dist/esm/icons/arrow-left.mjs'
// @ts-expect-error package subpath has no declaration file
import Play from 'lucide-react/dist/esm/icons/play.mjs'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { DesktopExpertEntry, DesktopExpertsView } from '../experts-contract.ts'
import type { DesktopExpertsApi } from './experts-api.ts'
import { zh } from './experts-locales.ts'

export interface ExpertsPanelInjected {
  readonly api: DesktopExpertsApi
  /** Summon an expert with an optional prompt; resolves when the Session opens. */
  readonly summon: (expertId: string, prompt: string) => Promise<void>
}

export type ExpertsPanelProps = PropsRuntime<'main'>
  & PropsLocale<'desktop.experts'> & InjectFace<ExpertsPanelInjected>

type LocaleKey = keyof typeof zh

export function ExpertsPanel({ t, api, summon }: ExpertsPanelProps): JSX.Element {
  const [view, setView] = useState<DesktopExpertsView>()
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('')
  const [selected, setSelected] = useState<DesktopExpertEntry>()
  const [summoning, setSummoning] = useState<string>()
  const [summonError, setSummonError] = useState<string>()
  const readEpoch = useRef(0)
  const inFlight = useRef(false)

  const load = async (background = false): Promise<void> => {
    if (inFlight.current) return
    readEpoch.current++
    const epoch = readEpoch.current
    inFlight.current = true
    if (!background) { setLoading(true); setError(undefined) }
    try {
      const next = await api.read()
      if (epoch !== readEpoch.current) return
      setView(next)
      setError(undefined)
    } catch (cause) {
      if (epoch !== readEpoch.current) return
      setError(cause instanceof Error ? cause.message : t('unavailable'))
    } finally {
      inFlight.current = false
      if (!background) setLoading(false)
    }
  }

  useEffect(() => {
    void load()
    return () => { readEpoch.current++ }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (selected !== undefined) return
    const refresh = (): void => { if (document.visibilityState !== 'hidden') void load(true) }
    const timer = window.setInterval(refresh, 5000)
    window.addEventListener('focus', refresh)
    document.addEventListener('visibilitychange', refresh)
    return () => {
      window.clearInterval(timer)
      window.removeEventListener('focus', refresh)
      document.removeEventListener('visibilitychange', refresh)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selected])

  const query = search.trim().toLocaleLowerCase()
  const experts = useMemo(() => {
    if (view === undefined) return []
    let rows = view.experts
    if (category !== '') rows = rows.filter(expert => expert.category === category)
    if (query !== '') {
      rows = rows.filter(expert => [
        expert.id, expert.display.name, expert.display.title, expert.display.description,
        ...expert.display.tags, ...expert.entry.quickPrompts,
      ].join('\n').toLocaleLowerCase().includes(query))
    }
    return [...rows].sort((a, b) => a.display.name.localeCompare(b.display.name))
  }, [view, category, query])

  const startSummon = async (expert: DesktopExpertEntry, prompt: string): Promise<void> => {
    if (summoning !== undefined || !expert.available) return
    setSummoning(expert.id)
    setSummonError(undefined)
    try {
      await summon(expert.id, prompt)
    } catch (cause) {
      setSummonError(cause instanceof Error ? cause.message : t('operationFailed'))
    } finally {
      setSummoning(undefined)
    }
  }

  if (selected !== undefined) {
    return <ExpertDetail
      expert={selected} t={t} summoning={summoning === selected.id} summonError={summonError}
      onBack={() => { setSelected(undefined); setSummonError(undefined) }}
      onSummon={prompt => { void startSummon(selected, prompt) }}
    />
  }

  return <main className="dshExpertsPage">
    <section className="dshIntegrations dshExperts" aria-label={t('title')}>
      <header className="dshIntegrationsHeader">
        <div>
          <h2>{t('title')}</h2>
          <p>{t('intro')}</p>
        </div>
        <div className="dshIntegrationsRowActions">
          <button type="button" className="dshIntegrationsCommand" disabled={loading}
            onClick={() => { void load() }}><RefreshCw />{t('refresh')}</button>
        </div>
      </header>

      {loading && <div className="dshExpertsNotice">{t('loading')}</div>}
      {error !== undefined && <div className="dshIntegrationsError" role="alert">{error}</div>}

      {!loading && view !== undefined && <>
        <div className="dshExpertsToolbar">
          <div className="dshIntegrationsSearch">
            <Search aria-hidden="true" />
            <input type="search" value={search} aria-label={t('searchPlaceholder')}
              placeholder={t('searchPlaceholder')}
              onChange={event => { setSearch(event.target.value) }} />
          </div>
          <select aria-label={t('category')} value={category} onChange={event => { setCategory(event.target.value) }}>
            <option value="">{t('allCategories')}</option>
            {view.categories.map(item => <option key={item} value={item}>{item}</option>)}
          </select>
        </div>

        {summonError !== undefined && <div className="dshIntegrationsError" role="alert">{summonError}</div>}

        {experts.length === 0 && (
          <div className="dshExpertsNotice">{view.experts.length === 0 ? t('empty') : t('noMatches')}</div>
        )}

        <div className="dshExpertsGrid">
          {experts.map(expert => <ExpertCard key={expert.id} expert={expert} t={t}
            summoning={summoning === expert.id}
            onOpen={() => { setSelected(expert); setSummonError(undefined) }}
            onSummon={() => { void startSummon(expert, expert.entry.defaultPrompt) }} />)}
        </div>

        {view.invalid.length > 0 && <details className="dshExpertsInvalid">
          <summary>{t('invalidTitle')} · {String(view.invalid.length)}</summary>
          <p>{t('invalidHint')}</p>
          <ul>
            {view.invalid.map(item => <li key={item.id}>
              <strong>{item.id}</strong> — {item.reason}
            </li>)}
          </ul>
        </details>}
      </>}
    </section>
  </main>
}

function ExpertCard({ expert, t, summoning, onOpen, onSummon }: {
  expert: DesktopExpertEntry
  t: (key: LocaleKey) => string
  summoning: boolean
  onOpen: () => void
  onSummon: () => void
}): JSX.Element {
  return <article className="dshExpertsCard" data-available={expert.available || undefined}>
    <div className="dshExpertsCardHead">
      <h3>{expert.display.name}</h3>
      <span className="dshExpertsStatus" data-available={expert.available || undefined}>
        {expert.available ? t('available') : t('notAvailable')}
      </span>
    </div>
    <p className="dshExpertsTitle">{expert.display.title}</p>
    <p className="dshExpertsDescription">{expert.display.description}</p>
    <div className="dshExpertsTags">
      {expert.display.tags.map(tag => <span key={tag} className="dshExpertsTag">{tag}</span>)}
    </div>
    <div className="dshExpertsMeta">
      <span>{t('version')}: {expert.version}</span>
      <span>{t('category')}: {expert.category}</span>
      <span>{t('preset')}: {expert.presetId}</span>
    </div>
    <div className="dshIntegrationsRowActions">
      <button type="button" className="dshIntegrationsCommand" onClick={onOpen}>{t('viewDetails')}</button>
      <button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={!expert.available || summoning}
        onClick={onSummon}>
        <Play aria-hidden="true" />{summoning ? t('summonInProgress') : t('startConversation')}
      </button>
    </div>
    {!expert.available && expert.unavailableReason !== undefined && (
      <p className="dshExpertsUnavailableReason">{expert.unavailableReason}</p>
    )}
  </article>
}

function ExpertDetail({ expert, t, summoning, summonError, onBack, onSummon }: {
  expert: DesktopExpertEntry
  t: (key: LocaleKey) => string
  summoning: boolean
  summonError?: string | undefined
  onBack: () => void
  onSummon: (prompt: string) => void
}): JSX.Element {
  return <main className="dshExpertsPage">
    <section className="dshIntegrations dshExperts" aria-label={expert.display.name}>
      <header className="dshCronSubHeader">
        <button className="dshCronBack" type="button" onClick={onBack}><ArrowLeft />{t('back')}</button>
        <h2>{expert.display.name}</h2>
      </header>

      {summonError !== undefined && <div className="dshIntegrationsError" role="alert">{summonError}</div>}

      <div className="dshExpertsDetail">
        <p className="dshExpertsTitle">{expert.display.title}</p>
        <p className="dshExpertsDescription">{expert.display.description}</p>
        <div className="dshExpertsTags">
          {expert.display.tags.map(tag => <span key={tag} className="dshExpertsTag">{tag}</span>)}
        </div>
        <dl className="dshExpertsMetaGrid">
          <dt>{t('version')}</dt><dd>{expert.version}</dd>
          <dt>{t('category')}</dt><dd>{expert.category}</dd>
          <dt>{t('preset')}</dt><dd>{expert.presetId}</dd>
          <dt>{t('available')}</dt><dd>{expert.available ? t('available') : t('notAvailable')}</dd>
        </dl>
        {!expert.available && expert.unavailableReason !== undefined && (
          <p className="dshExpertsUnavailableReason">{expert.unavailableReason}</p>
        )}

        <h3>{t('defaultTask')}</h3>
        <p className="dshExpertsPrompt">{expert.entry.defaultPrompt}</p>

        <h3>{t('quickTasks')}</h3>
        <div className="dshExpertsQuickTasks">
          {expert.entry.quickPrompts.map(prompt => <button key={prompt} type="button"
            className="dshExpertsQuickTask" disabled={!expert.available || summoning}
            onClick={() => { onSummon(prompt) }}>
            {prompt}
          </button>)}
        </div>

        <div className="dshIntegrationsRowActions">
          <button type="button" className="dshIntegrationsCommand dshCronPrimary" disabled={!expert.available || summoning}
            onClick={() => { onSummon(expert.entry.defaultPrompt) }}>
            <Play aria-hidden="true" />{summoning ? t('summonInProgress') : t('startConversation')}
          </button>
        </div>
      </div>
    </section>
  </main>
}
