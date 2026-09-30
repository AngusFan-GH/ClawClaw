/** Expert center: browse local experts, read one expert, and start its conversation. */

import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import { ArrowLeft, RefreshCw, Search, Sparkles } from 'lucide-react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type { ExpertProblem, ExpertView } from '../experts-contract.ts'
import { DesktopFeatureIcon } from './desktop-feature-icon.tsx'
import type { ExpertCenter, ExpertCenterState } from './experts-center.ts'
import type { DesktopExpertsLocaleKey } from './experts-locales.ts'

export interface ExpertCenterInjected {
  readonly center: ExpertCenter
}

export type ExpertsPanelProps = PropsRuntime<'main'>
  & PropsLocale<'desktop.experts'>
  & InjectFace<ExpertCenterInjected>

const PROBLEM_KEY: Record<ExpertProblem, DesktopExpertsLocaleKey> = {
  'missing-files': 'problemMissingFiles',
  'unreadable': 'problemUnreadable',
  'unsafe-path': 'problemUnsafePath',
  'invalid-yaml': 'problemInvalidYaml',
  'invalid-manifest': 'problemInvalidManifest',
  'id-mismatch': 'problemIdMismatch',
  'duplicate-id': 'problemDuplicateId',
  'too-large': 'problemTooLarge',
  'preset-missing': 'problemPresetMissing',
  'preset-broken': 'problemPresetBroken',
  'preset-invalid': 'problemPresetInvalid',
  'preset-registry-unavailable': 'problemPresetRegistryUnavailable',
}

/** Localized status sentence for one expert row, plus the Host's own reason. */
export function statusLabel(expert: ExpertView, t: (key: DesktopExpertsLocaleKey) => string): string {
  if (expert.status === 'available') return t('statusAvailable')
  const problem = expert.problem === undefined ? undefined : t(PROBLEM_KEY[expert.problem])
  const base = expert.status === 'invalid' ? t('statusInvalid') : t('statusUnavailable')
  return problem === undefined ? base : `${base} · ${problem}`
}

/** The panel body; the sidebar entry selects it. */
export function ExpertsPanel({ center, t }: ExpertsPanelProps): ReactNode {
  const state = useSyncExternalStore(center.subscribe, center.getSnapshot)
  useEffect(() => { void center.start() }, [center])
  if (state.selectedId !== undefined) return <ExpertDetailView state={state} center={center} t={t} />
  return <ExpertListView state={state} center={center} t={t} />
}

function ExpertListView({ state, center, t }: {
  state: ExpertCenterState
  center: ExpertCenter
  t: ExpertsPanelProps['t']
}): ReactNode {
  return (
    <main className="dshAutomationPage dshExpertsPage">
      <div className="dshIntegrations dshExperts">
        <header className="dshIntegrationsHeader">
          <div>
            <h2>{t('title')}</h2>
            <p>{t('intro')}</p>
          </div>
          <div className="dshIntegrationsRowActions">
            <button type="button" className="dshIntegrationsCommand" onClick={() => { void center.refresh() }}>
              <RefreshCw aria-hidden="true" />{t('refresh')}
            </button>
          </div>
        </header>
        <div className="dshExpertsToolbar">
          <label className="dshIntegrationsSearch">
            <Search aria-hidden="true" />
            <input
              type="search" aria-label={t('searchExperts')} placeholder={t('searchExperts')}
              value={state.query}
              onChange={event => { void center.setQuery(event.target.value) }}
            />
          </label>
          <div className="dshExpertsCategories" role="group" aria-label={t('filterCategory')}>
            <button
              type="button" aria-pressed={state.category === ''} data-active={state.category === ''}
              onClick={() => { void center.setCategory('') }}
            >{t('allCategories')} · {state.roster.length}</button>
            {state.categories.map(category => <button
              key={category.id} type="button" data-active={state.category === category.id}
              aria-pressed={state.category === category.id}
              onClick={() => { void center.setCategory(category.id) }}
            >{category.id} · {category.count}</button>)}
          </div>
        </div>
        <ExpertNotice state={state} t={t} center={center} />
        {state.truncated && <p className="dshExpertsHint">{t('truncated')}</p>}
        {state.phase === 'loading' && state.roster.length === 0
          ? <p className="dshIntegrationsEmpty">{t('loading')}</p>
          : state.phase === 'error'
            ? <div className="dshExpertsEmpty" role="alert">
                <p>{t('loadFailed')}</p>
                {state.error !== undefined && <p className="dshExpertsReason">{state.error}</p>}
                <button type="button" className="dshIntegrationsCommand" onClick={() => { void center.refresh() }}>{t('retry')}</button>
              </div>
            : state.roster.length === 0
              ? <div className="dshExpertsEmpty">
                  <p>{t('empty')}</p>
                  <p className="dshExpertsHint">{t('emptyHint', { root: state.root })}</p>
                </div>
              : state.experts.length === 0
                ? <div className="dshExpertsEmpty">
                    <p>{t('noMatches')}</p>
                    <button type="button" className="dshIntegrationsCommand" onClick={() => {
                      void center.setQuery('')
                      void center.setCategory('')
                    }}>{t('clearFilters')}</button>
                  </div>
                : <ul className="dshExpertsGrid" aria-label={t('title')}>
                    {state.experts.map(expert => <ExpertCard key={expert.id} expert={expert} center={center} t={t}
                      summoning={state.summoningId === expert.id} />)}
                  </ul>}
      </div>
    </main>
  )
}

function ExpertNotice({ state, center, t }: {
  state: ExpertCenterState
  center: ExpertCenter
  t: ExpertsPanelProps['t']
}): ReactNode {
  const notice = state.notice
  if (notice === undefined) return null
  const key: DesktopExpertsLocaleKey = notice.code === 'summonFailed'
    ? 'summonFailed'
    : notice.code === 'sessionPending' ? 'sessionPending' : notice.code === 'detailFailed' ? 'detailLoadFailed' : 'loadFailed'
  return (
    <p className="dshExpertsNotice" data-kind={notice.kind} role="status">
      {t(key)}{notice.detail === undefined ? '' : ` ${notice.detail}`}
      <button type="button" className="dshIntegrationsIconButton" aria-label={t('close')}
        onClick={() => { center.clearNotice() }}>×</button>
    </p>
  )
}

function ExpertCard({ expert, center, t, summoning }: {
  expert: ExpertView
  center: ExpertCenter
  t: ExpertsPanelProps['t']
  summoning: boolean
}): ReactNode {
  const available = expert.status === 'available'
  return (
    <li className="dshExpertsCard" data-status={expert.status}>
      <div className="dshExpertsCardHead">
        <span className="dshExpertsStatus" data-status={expert.status}>{statusLabel(expert, t)}</span>
        {expert.version !== undefined && <span className="dshExpertsVersion">{t('version')} {expert.version}</span>}
      </div>
      <button type="button" className="dshExpertsCardTitle" onClick={() => { void center.openDetail(expert.id) }}>
        <strong>{expert.display?.name ?? expert.id}</strong>
        {expert.display?.title !== undefined && <span>{expert.display.title}</span>}
      </button>
      {expert.display?.description !== undefined && <p className="dshExpertsDescription">{expert.display.description}</p>}
      {expert.display !== undefined && expert.display.tags.length > 0 && <ul className="dshExpertsTags" aria-label={t('tags')}>
        {expert.display.tags.map(tag => <li key={tag}>{tag}</li>)}
      </ul>}
      {!available && <p className="dshExpertsReason">{expert.message ?? t('unavailableHint')}</p>}
      <div className="dshExpertsCardActions">
        <button type="button" className="dshIntegrationsCommand dshExpertsStart" disabled={!available || summoning}
          onClick={() => { void center.summon(expert.id) }}>
          <Sparkles aria-hidden="true" />{summoning ? t('starting') : t('start')}
        </button>
        <button type="button" className="dshIntegrationsCommand" onClick={() => { void center.openDetail(expert.id) }}>
          {t('details')}
        </button>
      </div>
    </li>
  )
}

function ExpertDetailView({ state, center, t }: {
  state: ExpertCenterState
  center: ExpertCenter
  t: ExpertsPanelProps['t']
}): ReactNode {
  const expert = state.detail
  const selectedId = state.selectedId
  return (
    <main className="dshAutomationPage dshExpertsPage">
      <div className="dshIntegrations dshExperts">
        <header className="dshIntegrationsHeader">
          <button type="button" className="dshIntegrationsCommand" onClick={() => { center.closeDetail() }}>
            <ArrowLeft aria-hidden="true" />{t('back')}
          </button>
        </header>
        <ExpertNotice state={state} center={center} t={t} />
        {state.detailPhase === 'loading' && <p className="dshIntegrationsEmpty">{t('loading')}</p>}
        {state.detailPhase === 'error' && <div className="dshExpertsEmpty" role="alert">
          <p>{t('detailLoadFailed')}</p>
          {state.detailError !== undefined && <p className="dshExpertsReason">{state.detailError}</p>}
          {selectedId !== undefined && <button type="button" className="dshIntegrationsCommand"
            onClick={() => { void center.openDetail(selectedId) }}>{t('retry')}</button>}
        </div>}
        {expert !== undefined && <>
          <div className="dshExpertsDetailHead">
            <div>
              <h2>{expert.display?.name ?? expert.id}</h2>
              {expert.display?.title !== undefined && <p className="dshExpertsDetailTitle">{expert.display.title}</p>}
            </div>
            <span className="dshExpertsStatus" data-status={expert.status}>{statusLabel(expert, t)}</span>
          </div>
          {expert.display?.description !== undefined && <p className="dshIntegrationsRowDescription">{expert.display.description}</p>}
          {expert.display !== undefined && expert.display.tags.length > 0 && <ul className="dshExpertsTags" aria-label={t('tags')}>
            {expert.display.tags.map(tag => <li key={tag}>{tag}</li>)}
          </ul>}
          <dl className="dshExpertsFacts">
            <div><dt>{t('version')}</dt><dd>{expert.version ?? '—'}</dd></div>
            <div><dt>{t('category')}</dt><dd>{expert.category ?? '—'}</dd></div>
            <div><dt>{t('preset')}</dt><dd>{expert.presetName ?? expert.presetId}</dd></div>
            <div><dt>{t('packageDirectory')}</dt><dd>{expert.directory}</dd></div>
          </dl>
          {expert.status !== 'available' && <p className="dshExpertsReason" role="status">
            {t('unavailableHint')}{expert.message === undefined ? '' : ` ${expert.message}`}
          </p>}
          <div className="dshExpertsEntry">
            {expert.entry?.defaultPrompt !== undefined && <>
              <h3>{t('defaultTask')}</h3>
              <p className="dshExpertsPrompt">{expert.entry.defaultPrompt}</p>
            </>}
            <button type="button" className="dshIntegrationsCommand dshExpertsStart"
              disabled={expert.status !== 'available' || state.summoningId !== undefined}
              onClick={() => { void center.summon(expert.id) }}>
              <Sparkles aria-hidden="true" />{state.summoningId === expert.id ? t('starting') : t('start')}
            </button>
          </div>
          {expert.entry !== undefined && expert.entry.quickPrompts.length > 0 && <section className="dshExpertsQuick">
            <h3>{t('quickTasks')}</h3>
            <p className="dshExpertsHint">{t('quickTaskHint')}</p>
            <ul>
              {expert.entry.quickPrompts.map(prompt => <li key={prompt}>
                <button type="button" className="dshExpertsQuickTask"
                  disabled={expert.status !== 'available' || state.summoningId !== undefined}
                  onClick={() => { void center.summon(expert.id, prompt) }}>{prompt}</button>
              </li>)}
            </ul>
          </section>}
        </>}
      </div>
    </main>
  )
}

/** The sidebar entry's icon; the sidebar owns the button, label, and selected state. */
export function ExpertsPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): ReactNode {
  return <DesktopFeatureIcon featureId="desktop-experts" kind="panel" size={size} />
}
