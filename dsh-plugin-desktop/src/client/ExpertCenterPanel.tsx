/** Expert Center main panel: browse local experts, filter, and summon. */

import { useCallback, useEffect, useMemo, useState } from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { RefreshCw, Search, ArrowLeft } from 'lucide-react'
import { filterExperts, type ExpertsApi } from './experts-api.ts'
import type { ExpertView } from '../expert-center-contract.ts'
import { DesktopFeatureIcon } from './desktop-feature-icon.tsx'

export const DESKTOP_EXPERTS_PANEL_ID = 'desktop-experts' as const
export const DESKTOP_EXPERTS_LOCALE_NAMESPACE = 'desktop.experts'

interface ExpertCenterServices {
  readonly api: ExpertsApi
  readonly summon: (expertId: string, prompt: string) => Promise<void>
}

export type ExpertCenterPanelProps = PropsRuntime<'main'>
  & PropsLocale<typeof DESKTOP_EXPERTS_LOCALE_NAMESPACE>
  & InjectFace<ExpertCenterServices>

type ViewState =
  | readonly [{ kind: 'list' }]
  | readonly [{ kind: 'detail'; expert: ExpertView }]

export function ExpertCenterPanel({ api, summon, t }: ExpertCenterPanelProps): JSX.Element {
  const [view, setView] = useState<ViewState>([{ kind: 'list' }])
  const [experts, setExperts] = useState<readonly ExpertView[]>([])
  const [invalid, setInvalid] = useState<readonly { id: string; reason: string }[]>([])
  const [categories, setCategories] = useState<readonly string[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [query, setQuery] = useState('')
  const [category, setCategory] = useState<string>('')
  const [summoning, setSummoning] = useState<string | null>(null)
  const [summonError, setSummonError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const view = await api.read()
      setExperts(view.experts)
      setInvalid(view.invalid)
      setCategories(view.categories)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }, [api])

  useEffect(() => { void load() }, [load])

  const filtered = useMemo(
    () => filterExperts(experts, query, category),
    [experts, query, category],
  )

  const startSummon = useCallback(async (expert: ExpertView, prompt: string) => {
    setSummoning(expert.id)
    setSummonError(null)
    try {
      await summon(expert.id, prompt)
    } catch (cause) {
      setSummonError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSummoning(null)
    }
  }, [summon])

  if (view[0].kind === 'detail') {
    const expert = view[0].expert
    return (
      <main className="dshExpertsPage">
        <div className="dshExpertsContainer">
          <button type="button" className="dshExpertsBack" onClick={() => setView([{ kind: 'list' }])}>
            <ArrowLeft size={16} />{t('backToList')}
          </button>
          <header className="dshExpertsDetailHeader">
            <div className="dshExpertsDetailIcon"><DesktopFeatureIcon featureId="desktop-experts" kind="panel" size={28} /></div>
            <div>
              <h2>{expert.display.name}</h2>
              <p className="dshExpertsTitle">{expert.display.title}</p>
              <p className="dshExpertsDescription">{expert.display.description}</p>
            </div>
          </header>
          <div className="dshExpertsMeta">
            <span>{t('version')}: {expert.version}</span>
            <span>{t('category')}: {expert.category}</span>
            <span>{t('preset')}: {expert.presetId}</span>
          </div>
          {expert.display.tags.length > 0 && (
            <div className="dshExpertsTags">
              {expert.display.tags.map(tag => <span key={tag} className="dshExpertsTag">{tag}</span>)}
            </div>
          )}
          <section className="dshExpertsTask">
            <h3>{t('defaultTask')}</h3>
            <p className="dshExpertsPrompt">{expert.entry.defaultPrompt}</p>
            <button
              type="button"
              className="dshExpertsPrimary"
              disabled={!expert.available || summoning !== null}
              onClick={() => { void startSummon(expert, expert.entry.defaultPrompt) }}
            >
              {summoning === expert.id ? t('loading') : t('startConversation')}
            </button>
            {!expert.available && <p className="dshExpertsUnavailable">{expert.unavailableReason ?? t('unavailable')}</p>}
          </section>
          {expert.entry.quickPrompts.length > 0 && (
            <section className="dshExpertsTask">
              <h3>{t('quickTask')}</h3>
              <div className="dshExpertsQuickList">
                {expert.entry.quickPrompts.map(prompt => (
                  <button
                    key={prompt}
                    type="button"
                    className="dshExpertsQuick"
                    disabled={!expert.available || summoning !== null}
                    onClick={() => { void startSummon(expert, prompt) }}
                  >
                    {prompt}
                  </button>
                ))}
              </div>
            </section>
          )}
        </div>
      </main>
    )
  }

  return (
    <main className="dshExpertsPage">
      <div className="dshExpertsContainer">
        <header className="dshExpertsHeader">
          <h2>{t('title')}</h2>
          <p>{t('intro')}</p>
        </header>
        <div className="dshExpertsToolbar">
          <div className="dshExpertsSearch">
            <Search size={15} />
            <input
              type="search"
              placeholder={t('searchPlaceholder')}
              value={query}
              onChange={event => setQuery(event.target.value)}
            />
          </div>
          <select value={category} onChange={event => setCategory(event.target.value)}>
            <option value="">{t('allCategories')}</option>
            {categories.map(cat => <option key={cat} value={cat}>{cat}</option>)}
          </select>
          <button type="button" className="dshExpertsRefresh" onClick={() => { void load() }}>
            <RefreshCw size={14} />{t('refresh')}
          </button>
        </div>
        {loading && <p className="dshExpertsNotice">{t('loading')}</p>}
        {error !== null && (
          <div className="dshExpertsError">
            <p>{t('error')}: {error}</p>
            <button type="button" onClick={() => { void load() }}>{t('refresh')}</button>
          </div>
        )}
        {summonError !== null && (
          <div className="dshExpertsError">
            <p>{t('summonFailed')}: {summonError}</p>
            <button type="button" onClick={() => setSummonError(null)}>{t('refresh')}</button>
          </div>
        )}
        {!loading && error === null && filtered.length === 0 && (
          <p className="dshExpertsNotice">{experts.length === 0 ? t('empty') : t('noSearchResults')}</p>
        )}
        <div className="dshExpertsList">
          {filtered.map(expert => (
            <div key={expert.id} className="dshExpertsRow" onClick={() => setView([{ kind: 'detail', expert }])}>
              <div className="dshExpertsRowMain">
                <div className="dshExpertsRowTitle">{expert.display.name}</div>
                <div className="dshExpertsRowDescription">{expert.display.title}</div>
                <div className="dshExpertsMeta">
                  <span>{expert.category}</span>
                  <span>v{expert.version}</span>
                  {!expert.available && <span className="dshExpertsUnavailable">{t('unavailable')}</span>}
                </div>
              </div>
              <button
                type="button"
                className="dshExpertsPrimary"
                disabled={!expert.available || summoning !== null}
                onClick={event => {
                  event.stopPropagation()
                  void startSummon(expert, expert.entry.defaultPrompt)
                }}
              >
                {summoning === expert.id ? t('loading') : t('startConversation')}
              </button>
            </div>
          ))}
        </div>
        {invalid.length > 0 && (
          <section className="dshExpertsInvalid">
            <h3>{t('invalidPackages')}</h3>
            <p>{t('invalidHint')}</p>
            <ul>
              {invalid.map(item => <li key={item.id}><code>{item.id}</code>: {item.reason}</li>)}
            </ul>
          </section>
        )}
      </div>
    </main>
  )
}

export function ExpertCenterPanelIcon({ size }: PropsRuntime<'sidebar.panellist'>): JSX.Element {
  return <DesktopFeatureIcon featureId="desktop-experts" kind="panel" size={size} />
}
