import { useRef, useState } from 'react'
import { ArrowRight, AlertTriangle, LoaderCircle, SlidersHorizontal, KeyRound } from 'lucide-react'
import { isDesktopSetupWizardInput, type DesktopSetupWizardInput, type DesktopSetupWizardSelection } from '../../setup-wizard-contract.ts'
import { desktopSetupWizardCopy, type DesktopSetupWizardCopy } from '../../setup-wizard-copy.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent } from '../components/ui/card.tsx'
import { DesktopFrame } from '../shared/DesktopFrame.tsx'

const SCHEME = 'dsh-setup-wizard:'
const MAX_STATE_CHARACTERS = 32 * 1024
type Locale = 'en' | 'zh'

function localLocale(search: string): Locale {
  return new URLSearchParams(search).get('locale') === 'zh' ? 'zh' : 'en'
}

function decodeBase64Url(value: string): string | undefined {
  if (value.length === 0 || value.length > MAX_STATE_CHARACTERS || !/^[A-Za-z0-9_-]+$/u.test(value)) {
    return undefined
  }
  const standard = value.replaceAll('-', '+').replaceAll('_', '/')
  const padded = standard.padEnd(standard.length + (4 - standard.length % 4) % 4, '=')
  try {
    const binary = window.atob(padded)
    const bytes = Uint8Array.from(binary, character => character.charCodeAt(0))
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    return undefined
  }
}

/** Decode only the exact state/query tuple emitted by DesktopSetupWizardWindow. */
export function decodeDesktopSetupWizardInput(search: string): DesktopSetupWizardInput | undefined {
  const query = new URLSearchParams(search)
  const expected = ['locale', 'state', 'platform', 'frame']
  const keys = [...query.keys()]
  if (keys.length !== expected.length
    || keys.some(key => !expected.includes(key))
    || expected.some(key => query.getAll(key).length !== 1)) return undefined
  const locale = query.get('locale')
  const frame = query.get('frame')
  if ((locale !== 'en' && locale !== 'zh') || (frame !== 'true' && frame !== 'false')) return undefined
  const state = query.get('state')
  if (state === null) return undefined
  const decoded = decodeBase64Url(state)
  if (decoded === undefined) return undefined
  let value: unknown
  try { value = JSON.parse(decoded) as unknown } catch { return undefined }
  if (!isDesktopSetupWizardInput(value) || query.get('platform') !== value.platform) return undefined
  return value
}

function finish(selection: DesktopSetupWizardSelection, navigate: (url: string) => void): void {
  const url = new URL(`${SCHEME}//complete`)
  url.searchParams.set('mode', selection.mode)
  url.searchParams.set('macosMaterial', selection.macosMaterial)
  url.searchParams.set('windowsMaterial', selection.windowsMaterial)
  url.searchParams.set('openBrowser', 'false')
  url.searchParams.set('networkExposure', 'loopback')
  url.searchParams.set('market', selection.market)
  url.searchParams.set('notificationsEnabled', String(selection.notifications.enabled))
  url.searchParams.set('notifyOnTurnCompletion', String(selection.notifications.notifyOnTurnCompletion))
  url.searchParams.set('notifyOnTurnFailure', String(selection.notifications.notifyOnTurnFailure))
  url.searchParams.set('notifyOnJobCompletion', String(selection.notifications.notifyOnJobCompletion))
  url.searchParams.set('notifyOnJobFailure', String(selection.notifications.notifyOnJobFailure))
  navigate(url.href)
}

/** A single welcome screen; model setup runs once the Host is available. */
export function SetupWizardWelcome({ appVersion, copy, onStart, busy = false }: {
  readonly appVersion: string
  readonly copy: DesktopSetupWizardCopy
  readonly onStart: () => void
  readonly busy?: boolean
}): JSX.Element {
  return <div className="mx-auto flex w-full max-w-xl flex-col py-6" data-setup-step="welcome">
    <div className="flex flex-wrap items-center gap-3">
      <h1 className="text-2xl font-semibold tracking-tight">{copy.welcomeTitle}</h1>
      <Badge variant="secondary">v{appVersion}</Badge>
    </div>
    <p className="mt-3 text-sm leading-relaxed text-muted-foreground">{copy.welcomeBody}</p>
    <Card className="mt-7">
      <CardContent className="space-y-6 p-5 sm:p-6">
        <div className="flex gap-4">
          <KeyRound aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div><h2 className="text-sm font-medium">{copy.modelTitle}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.modelBody}</p></div>
        </div>
        <div className="flex gap-4">
          <SlidersHorizontal aria-hidden="true" className="mt-0.5 size-5 shrink-0 text-muted-foreground" />
          <div><h2 className="text-sm font-medium">{copy.defaultsTitle}</h2><p className="mt-1 text-sm leading-relaxed text-muted-foreground">{copy.defaultsBody}</p></div>
        </div>
      </CardContent>
    </Card>
    <div className="mt-8 flex justify-end">
      <Button disabled={busy} onClick={onStart} size="lg" type="button">
        {busy ? <LoaderCircle aria-hidden="true" className="animate-spin" /> : null}
        {busy ? copy.starting : copy.continue}
        {busy ? null : <ArrowRight aria-hidden="true" />}
      </Button>
    </div>
    {busy ? <p className="mt-3 text-right text-sm text-muted-foreground" role="status">{copy.startingBody}</p> : null}
  </div>
}

export function SetupWizardApp({ navigate = url => { window.location.assign(url) } }: {
  readonly navigate?: (url: string) => void
}): JSX.Element {
  const copy = desktopSetupWizardCopy(localLocale(window.location.search))
  const input = decodeDesktopSetupWizardInput(window.location.search)
  const submitted = useRef(false)
  const [busy, setBusy] = useState(false)
  const start = (): void => {
    if (input === undefined || submitted.current) return
    submitted.current = true
    setBusy(true)
    // Keep the existing preferences, including imported settings. Normalize only
    // the desktop carrier and unsupported Windows material before submission.
    finish({
      mode: 'compatibility',
      macosMaterial: input.macosMaterial,
      windowsMaterial: input.platform === 'win32' && !input.micaSupported ? 'off' : input.windowsMaterial,
      openBrowser: false,
      networkExposure: 'loopback',
      market: input.market,
      notifications: { ...input.notifications },
    }, navigate)
  }
  return <><DesktopFrame /><main className="dshNativeContent flex h-screen items-center overflow-y-auto p-5 sm:p-8">
    {input === undefined
      ? <div className="mx-auto w-full max-w-xl"><Alert variant="destructive"><AlertTriangle /><AlertTitle>{copy.title}</AlertTitle><AlertDescription>{copy.invalidState}</AlertDescription></Alert></div>
      : <SetupWizardWelcome appVersion={input.appVersion} busy={busy} copy={copy} onStart={start} />}
  </main></>
}
