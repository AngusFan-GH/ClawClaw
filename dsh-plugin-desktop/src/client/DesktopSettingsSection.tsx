/** Desktop-owned settings section registered into the official Settings shell. */

import {
  useCallback, useEffect, useId, useState, type ReactNode,
} from 'react'
import type { InjectFace, PropsLocale, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {
  DesktopMarketProvider, DesktopSettingsApi, DesktopSettingsView,
} from './desktop-settings-api.ts'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import type { DesktopClientPlatform } from './environment.ts'

/** Browser view of the Host `dsh-desktop` settings namespace. */
export interface DesktopShellSettings {
  readonly mode: 'compatibility'
  readonly macosMaterial: 'off' | 'transparent'
  readonly windowsMaterial: 'off' | 'acrylic' | 'mica'
  readonly port: number
  readonly logLevel: 'debug' | 'info' | 'warn' | 'error'
  readonly updateQualificationJournal: boolean
}

/** Browser view of the Host `dsh-desktop-notifications` settings namespace. */
export interface DesktopNotificationSettings {
  readonly enabled: boolean
  readonly notifyOnTurnCompletion: boolean
  readonly notifyOnTurnFailure: boolean
  readonly notifyOnJobCompletion: boolean
  readonly notifyOnJobFailure: boolean
}

/** Registration-side business face for the Desktop settings section. */
export interface DesktopSettingsSectionInjected {
  readonly api: DesktopSettingsApi
  readonly platform: DesktopClientPlatform
  readonly micaSupported: boolean
}

/** Renderer-composed props for the official settings section entry. */
export type DesktopSettingsSectionProps =
  PropsRuntime<'settings.section'>
  & PropsLocale<'desktop.settings'>
  & InjectFace<DesktopSettingsSectionInjected>

type Translate = DesktopSettingsSectionProps['t']
type BusyOperation = 'load' | 'select-aa' | 'select-market' | 'material' | 'notification'
type RestartState = 'none' | 'restarting' | 'required'

function Choice({
  title,
  body,
  aside,
  selected,
  reselectable,
  disabled,
  action,
  status,
  badge,
}: {
  title: ReactNode
  body: ReactNode
  aside?: ReactNode
  selected: boolean
  reselectable?: boolean
  disabled?: boolean
  action: () => void
  status?: ReactNode
  badge?: ReactNode
}) {
  const actionable = disabled !== true && (!selected || reselectable === true)
  const choose = (): void => {
    if (actionable) action()
  }
  return (
    <div
      role="radio"
      className="dshDesktopSettingsChoice"
      data-selected={selected ? 'true' : undefined}
      data-actionable={actionable ? 'true' : undefined}
      aria-checked={selected}
      aria-disabled={disabled === true ? 'true' : undefined}
      tabIndex={disabled === true ? -1 : 0}
      onClick={choose}
      onKeyDown={(event) => {
        if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
        event.preventDefault()
        choose()
      }}
    >
      <span className="dshDesktopSettingsChoiceCopy">
        <span className="dshDesktopSettingsChoiceTitle">
          {title}
          {badge !== undefined && <span className="dshDesktopSettingsBadge">{badge}</span>}
          {status !== undefined && <span className="dshDesktopSettingsBadge">{status}</span>}
        </span>
        <span className="dshDesktopSettingsChoiceBody">{body}</span>
      </span>
      {aside}
    </div>
  )
}

function RepositoryLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a
      className="dshDesktopSettingsChoiceLink"
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={event => { event.stopPropagation() }}
    >
      {children}
    </a>
  )
}

function ToggleRow({
  label,
  badge,
  checked,
  disabled,
  onChange,
}: {
  label: ReactNode
  badge?: ReactNode
  checked: boolean
  disabled: boolean
  onChange: (checked: boolean) => void
}) {
  const labelId = useId()
  return (
    <div className="dshDesktopSettingsToggleRow">
      <span className="dshDesktopSettingsToggleLabel" id={labelId}>
        {label}
        {badge !== undefined && <span className="dshDesktopSettingsBadge">{badge}</span>}
      </span>
      <button
        type="button"
        role="switch"
        className="dshDesktopSettingsToggle"
        aria-checked={checked}
        aria-labelledby={labelId}
        disabled={disabled}
        onClick={() => { onChange(!checked) }}
      >
        <span className="dshDesktopSettingsToggleKnob" aria-hidden="true" />
      </button>
    </div>
  )
}

const MARKET_OPTIONS: readonly {
  id: DesktopMarketProvider
  title: DesktopSettingsLocaleKey
  body: DesktopSettingsLocaleKey
}[] = [
  { id: 'disabled', title: 'marketDisabled', body: 'marketDisabledBody' },
  { id: 'dsh-market', title: 'dshMarket', body: 'dshMarketBody' },
]

const DSH_MARKET_URL = 'https://github.com/dsh-market/dsh-market'
const AWESOME_DSH_PLUGIN_URL = 'https://github.com/awesome-dsh-plugin/awesome-dsh-plugin'

function marketTitle(option: (typeof MARKET_OPTIONS)[number], t: Translate): ReactNode {
  if (option.id === 'dsh-market') {
    return <RepositoryLink href={DSH_MARKET_URL}>{t(option.title)}</RepositoryLink>
  }
  return t(option.title)
}

function marketBody(option: (typeof MARKET_OPTIONS)[number], t: Translate): ReactNode {
  if (option.id !== 'dsh-market') return t(option.body)
  return (
    <>
      {t(option.body)}{' '}
      <RepositoryLink href={AWESOME_DSH_PLUGIN_URL}>awesome-dsh-plugin</RepositoryLink>
    </>
  )
}

/** Render the Desktop settings page. */
export function DesktopSettingsSection({
  t,
  api,
  platform,
  micaSupported,
}: DesktopSettingsSectionProps) {
  const [view, setView] = useState<DesktopSettingsView>()
  const [busy, setBusy] = useState<BusyOperation | undefined>('load')
  const [loadFailed, setLoadFailed] = useState(false)
  const [operationFailed, setOperationFailed] = useState(false)
  const [restart, setRestart] = useState<RestartState>('none')

  const refreshView = useCallback(async () => {
    const next = await api.read()
    setView(next)
    return next
  }, [api])

  const load = useCallback(async () => {
    setBusy('load')
    setLoadFailed(false)
    setOperationFailed(false)
    try {
      await refreshView()
    } catch {
      setLoadFailed(true)
    } finally {
      setBusy(current => current === 'load' ? undefined : current)
    }
  }, [refreshView])

  useEffect(() => { void load() }, [load])
  useEffect(() => {
    if (restart !== 'restarting') return
    const timer = setTimeout(() => { setRestart('required') }, 8_000)
    return () => { clearTimeout(timer) }
  }, [restart])

  const run = useCallback(async (operation: BusyOperation, invoke: () => Promise<void>) => {
    setBusy(operation)
    setOperationFailed(false)
    try {
      await invoke()
    } catch {
      setOperationFailed(true)
    } finally {
      setBusy(current => current === operation ? undefined : current)
    }
  }, [])

  const requestRestart = (): void => { setRestart('restarting') }
  const settingsWritable = view !== undefined
  const preferences = view?.preferences
  const notificationValue = preferences?.notifications ?? {
    enabled: true,
    notifyOnTurnCompletion: true,
    notifyOnTurnFailure: true,
    notifyOnJobCompletion: true,
    notifyOnJobFailure: true,
  }

  const selectMarket = (provider: DesktopMarketProvider): void => {
    void run('select-market', async () => {
      const response = await api.selectMarket(provider)
      setView(current => current === undefined ? current : {
        ...current,
        market: { requested: provider, effective: current.market.effective, legacyDefaulted: false },
      })
      if (response.restartRequired) requestRestart()
    })
  }

  const setMaterial = (next: string): void => {
    void run('material', async () => {
      if (platform === 'darwin') {
        if (next !== 'off' && next !== 'transparent') {
          throw new Error(`dsh-plugin-desktop: invalid macOS material ${JSON.stringify(next)}`)
        }
        setView(await api.updatePreference({ field: 'macosMaterial', value: next }))
      } else if (platform === 'win32') {
        if (next !== 'off' && (next !== 'mica' || !micaSupported)) {
          throw new Error(`dsh-plugin-desktop: unavailable Windows material ${JSON.stringify(next)}`)
        }
        setView(await api.updatePreference({ field: 'windowsMaterial', value: next }))
      }
      await api.restart()
    })
  }

  const setNotification = (field: keyof DesktopNotificationSettings, checked: boolean): void => {
    void run('notification', async () => {
      setView(await api.updatePreference({
        field: 'notifications',
        value: { ...notificationValue, [field]: checked },
      }))
    })
  }

  return (
    <div className="dshDesktopSettings">
      <header className="dshDesktopSettingsHeader">
        <h2>{t('title')}</h2>
        <p>{t('intro')}</p>
      </header>

      {operationFailed && <p className="dshDesktopSettingsError" role="alert">{t('operationFailed')}</p>}
      {restart !== 'none' && (
        <p className="dshDesktopSettingsSuccess" role="status">
          {t(restart === 'restarting' ? 'restarting' : 'restartRequired')}
        </p>
      )}
      {busy === 'load' && view === undefined && <p className="dshDesktopSettingsHint">{t('loading')}</p>}
      {loadFailed && view === undefined && (
        <div>
          <p className="dshDesktopSettingsError" role="alert">{t('unavailable')}</p>
          <button type="button" className="dshDesktopSettingsButton" onClick={() => { void load() }}>{t('retry')}</button>
        </div>
      )}

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-market-title">
        <div>
          <h3 id="dsh-desktop-market-title">{t('marketTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('marketIntro')}</p>
        </div>
        {view?.market.legacyDefaulted === true && <p className="dshDesktopSettingsNotice">{t('legacyMarketNotice')}</p>}
        {view !== undefined && view.market.requested !== view.market.effective && restart === 'none' && (
          <p className="dshDesktopSettingsNotice" role="status">{t('marketLoadFailed')}</p>
        )}
        {view !== undefined && (
          <div className="dshDesktopSettingsList" role="radiogroup" aria-labelledby="dsh-desktop-market-title">
            {MARKET_OPTIONS.map(option => (
              <Choice
                key={option.id}
                title={marketTitle(option, t)}
                                body={marketBody(option, t)}
                selected={view.market.requested === option.id}
                reselectable={view.market.requested === option.id && view.market.requested !== view.market.effective}
                disabled={busy !== undefined || restart !== 'none'}
                action={() => { selectMarket(option.id) }}
                status={view.market.requested === option.id && view.market.requested !== view.market.effective
                    ? t('retryMarket')
                    : view.market.requested === option.id ? t('selected') : undefined}
              />
            ))}
          </div>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-appearance-title">
        <div>
          <h3 id="dsh-desktop-appearance-title">{t('appearanceTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('appearanceIntro')}</p>
        </div>
        {platform !== 'linux' && (
          <label className="dshDesktopSettingsMaterialField">
            <span className="dshDesktopSettingsMaterialCopy">
              <span className="dshDesktopSettingsChoiceTitle">{t('windowMaterial')}</span>
              <span className="dshDesktopSettingsChoiceBody">{t('windowMaterialBody')}</span>
            </span>
            <select
              className="dshDesktopSettingsSelect"
              value={platform === 'darwin'
                ? preferences?.macosMaterial ?? 'transparent'
                : preferences?.windowsMaterial === 'acrylic'
                  || (!micaSupported && preferences?.windowsMaterial === 'mica')
                  ? 'off'
                  : preferences?.windowsMaterial ?? 'off'}
              disabled={!settingsWritable || busy !== undefined || restart !== 'none'}
              onChange={event => { setMaterial(event.currentTarget.value) }}
            >
              <option value="off">{t('windowMaterialOff')}</option>
              {platform === 'darwin'
                ? <option value="transparent">{t('windowMaterialTransparent')}</option>
                : (
                    <>
                      {micaSupported && <option value="mica">{t('windowMaterialMica')}</option>}
                    </>
                  )}
            </select>
          </label>
        )}
      </section>

      <section className="dshDesktopSettingsGroup" aria-labelledby="dsh-desktop-notifications-title">
        <div>
          <h3 id="dsh-desktop-notifications-title">{t('notificationsTitle')}</h3>
          <p className="dshDesktopSettingsGroupIntro">{t('notificationsIntro')}</p>
        </div>
        <ToggleRow
          label={t('notificationsEnabled')}
          checked={notificationValue.enabled}
          disabled={!settingsWritable || busy !== undefined}
          onChange={checked => { setNotification('enabled', checked) }}
        />
        <div className="dshDesktopSettingsDetails">
          <ToggleRow
            label={t('turnCompletion')}
            checked={notificationValue.notifyOnTurnCompletion}
            disabled={!notificationValue.enabled || !settingsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnTurnCompletion', checked) }}
          />
          <ToggleRow
            label={t('turnFailure')}
            checked={notificationValue.notifyOnTurnFailure}
            disabled={!notificationValue.enabled || !settingsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnTurnFailure', checked) }}
          />
          <ToggleRow
            label={t('jobCompletion')}
            checked={notificationValue.notifyOnJobCompletion}
            disabled={!notificationValue.enabled || !settingsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnJobCompletion', checked) }}
          />
          <ToggleRow
            label={t('jobFailure')}
            checked={notificationValue.notifyOnJobFailure}
            disabled={!notificationValue.enabled || !settingsWritable || busy !== undefined}
            onChange={checked => { setNotification('notifyOnJobFailure', checked) }}
          />
        </div>
      </section>
    </div>
  )
}
