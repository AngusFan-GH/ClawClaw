/** Independent Desktop frame portalled above the upstream content viewport. */

import { Download, LoaderCircle, RefreshCw, RotateCcw } from 'lucide-react'
import { useEffect, useState } from 'react'
import type { DesktopUpdatePresentation } from '../runtime.ts'
import type { DesktopSettingsApi } from './desktop-settings-api.ts'
import type { DesktopClientEnvironment } from './environment.ts'
import { DesktopNativeActions } from './DesktopNativeActions.tsx'
import { Button } from '../native-ui/components/ui/button.tsx'
import type { DesktopSettingsLocaleKey } from './desktop-settings-locales.ts'
import {
  HoverCard,
  HoverCardContent,
  HoverCardTrigger,
} from '../native-ui/components/ui/hover-card.tsx'

export interface DesktopFrameTitlebarInjected {
  readonly environment: DesktopClientEnvironment
  readonly update?: DesktopUpdatePresentation | undefined
  readonly api: Pick<
    DesktopSettingsApi,
    'openTerminal' | 'restart' | 'restartToRecovery' | 'reloadRenderer' | 'toggleDeveloperTools' | 'checkForUpdates'
  >
}

export function DesktopVersionControl({
  version,
  update = { phase: 'idle' },
  checkForUpdates,
  t,
}: {
  readonly version: string
  readonly update?: DesktopUpdatePresentation | undefined
  readonly checkForUpdates: () => Promise<void>
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  const [requesting, setRequesting] = useState(false)
  const [failed, setFailed] = useState(false)
  const busy = requesting || ['checking', 'downloading', 'verifying', 'installing'].includes(update.phase)
  useEffect(() => {
    if (update.phase !== 'idle') setRequesting(false)
    if (update.phase !== 'error') setFailed(false)
  }, [update.phase])
  const runCheck = (): void => {
    if (busy) return
    setRequesting(true)
    setFailed(false)
    void checkForUpdates()
      .catch(() => { setFailed(true) })
      .finally(() => { setRequesting(false) })
  }
  const visibleVersion = `v${version}`
  const format = (key: DesktopSettingsLocaleKey, values: Record<string, string | number>): string => {
    return Object.entries(values).reduce(
      (copy, [name, value]) => copy.replaceAll(`{${name}}`, String(value)),
      t(key),
    )
  }
  const percent = update.percent ?? 0
  const status = requesting || update.phase === 'checking' ? t('checkingForUpdates')
    : update.phase === 'available' ? t('updateAvailable')
      : update.phase === 'downloading' ? format('updateDownloading', { percent })
        : update.phase === 'verifying' ? t('updateVerifying')
          : update.phase === 'ready' ? t('updateReady')
            : update.phase === 'installing' ? t('updateInstalling')
              : update.phase === 'error' ? t('retryUpdate') : visibleVersion
  const action = update.phase === 'available' ? t('downloadUpdate')
    : update.phase === 'ready' ? t('updateReady')
      : update.phase === 'error' ? t('retryUpdate')
        : update.phase === 'downloading' ? format('updateDownloading', { percent })
          : update.phase === 'verifying' ? t('updateVerifying')
            : update.phase === 'installing' ? t('updateInstalling')
              : requesting || update.phase === 'checking' ? t('checkingForUpdates') : t('checkForUpdates')
  const ActionIcon = update.phase === 'available' || update.phase === 'ready' ? Download
    : update.phase === 'error' ? RotateCcw
      : busy ? LoaderCircle : RefreshCw
  return (
    <HoverCard>
      <HoverCardTrigger
        closeDelay={200}
        delay={150}
        render={<button type="button" className="dshDesktopFrameVersion" data-update-phase={update.phase} />}
        aria-label={update.phase === 'idle'
          ? `${t('currentVersion')} ${visibleVersion}`
          : `${t('currentVersion')} ${visibleVersion}; ${status}`}
      >
        {busy && <LoaderCircle className="dshDesktopUpdateSpinner" aria-hidden="true" />}
        {!busy && update.phase !== 'idle' && <ActionIcon aria-hidden="true" />}
        <span>{status}</span>
      </HoverCardTrigger>
      <HoverCardContent className="dshDesktopVersionPopover">
        <div className="dshDesktopVersionPopoverHeader">
          <span>{t('currentVersion')}</span>
          <strong>{visibleVersion}</strong>
        </div>
        {update.version !== undefined && update.phase !== 'idle' && (
          <div className="dshDesktopVersionUpdateDetail">
            <span>{format('updateTargetVersion', { version: update.version })}</span>
            {update.phase === 'downloading' && (
              <progress aria-label={status} max={100} value={percent}>{percent}%</progress>
            )}
          </div>
        )}
        <Button
          className="dshDesktopVersionCheckButton"
          disabled={busy}
          size="sm"
          variant="outline"
          onClick={runCheck}
        >
          <ActionIcon className={busy ? 'dshDesktopUpdateSpinner' : undefined} aria-hidden="true" />
          <span>{action}</span>
        </Button>
        {(failed || update.phase === 'error') && <span className="dshDesktopVersionCheckError" role="alert">
          {update.failedOperation === 'download' ? t('updateDownloadFailed') : t('checkForUpdatesError')}
        </span>}
      </HoverCardContent>
    </HoverCard>
  )
}

/** Horizontal frame surface; the unrelated upstream content starts below it. */
export function DesktopFrameTitlebarView({ api, environment, update, t }: DesktopFrameTitlebarInjected & {
  readonly t: (key: DesktopSettingsLocaleKey) => string
}) {
  return (
    <header
      className="dshDesktopFrameTitlebar"
      data-dsh-desktop-frame="titlebar"
      data-mode={environment.mode}
      data-platform={environment.platform}
      data-material={environment.material}
    >
      <div className="dshDesktopFrameIdentity">
        <span className="dshDesktopFrameProduct">ClawClaw</span>
        <DesktopVersionControl version={environment.version} update={update} checkForUpdates={api.checkForUpdates} t={t} />
      </div>
      <div className="dshDesktopFrameActions">
        <DesktopNativeActions api={api} t={t} placement="titlebar" />
      </div>
    </header>
  )
}
