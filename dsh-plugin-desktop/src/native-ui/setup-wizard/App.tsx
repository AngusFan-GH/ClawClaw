import { useState, type ReactNode } from 'react'
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  CheckCircle2,
  SkipForward,
} from 'lucide-react'
import {
  isDesktopSetupWizardInput,
  type DesktopSetupWizardInput,
  type DesktopSetupWizardMacosMaterial,
  type DesktopSetupWizardMarket,
  type DesktopSetupWizardNotifications,
  type DesktopSetupWizardSelection,
  type DesktopSetupWizardWindowsMaterial,
} from '../../setup-wizard-contract.ts'
import { desktopSetupWizardCopy, type DesktopSetupWizardCopy } from '../../setup-wizard-copy.ts'
import { Alert, AlertDescription, AlertTitle } from '../components/ui/alert.tsx'
import { Badge } from '../components/ui/badge.tsx'
import { Button } from '../components/ui/button.tsx'
import { Card, CardContent } from '../components/ui/card.tsx'
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '../components/ui/dialog.tsx'
import { Label } from '../components/ui/label.tsx'
import { RadioGroup, RadioGroupItem } from '../components/ui/radio-group.tsx'
import { Switch } from '../components/ui/switch.tsx'
import { DesktopFrame } from '../shared/DesktopFrame.tsx'

const SCHEME = 'dsh-setup-wizard:'
const MAX_STATE_CHARACTERS = 32 * 1024

type Locale = 'en' | 'zh'

export type DesktopSetupWizardStep =
  | 'welcome'
  | 'material'
  | 'market'
  | 'notifications'
  | 'success'

export const DESKTOP_SETUP_WIZARD_STEPS = Object.freeze([
  'welcome',
  'material',
  'market',
  'notifications',
  'success',
] as const satisfies readonly DesktopSetupWizardStep[])

export function previousDesktopSetupWizardStep(
  step: DesktopSetupWizardStep,
): DesktopSetupWizardStep | undefined {
  const index = DESKTOP_SETUP_WIZARD_STEPS.indexOf(step)
  return index > 0 ? DESKTOP_SETUP_WIZARD_STEPS[index - 1] : undefined
}

export function nextDesktopSetupWizardStep(
  step: DesktopSetupWizardStep,
): DesktopSetupWizardStep | undefined {
  const index = DESKTOP_SETUP_WIZARD_STEPS.indexOf(step)
  return index >= 0 && index < DESKTOP_SETUP_WIZARD_STEPS.length - 1
    ? DESKTOP_SETUP_WIZARD_STEPS[index + 1]
    : undefined
}

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

function normalizedSelection(input: DesktopSetupWizardInput): DesktopSetupWizardSelection {
  return {
    mode: 'compatibility',
    macosMaterial: input.macosMaterial,
    windowsMaterial: input.platform === 'win32' && input.windowsMaterial === 'mica' && !input.micaSupported
      ? 'off'
      : input.windowsMaterial,
    openBrowser: false,
    networkExposure: 'loopback',
    market: input.market,
    notifications: { ...input.notifications },
  }
}

function finish(selection: DesktopSetupWizardSelection): void {
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
  window.location.assign(url.href)
}

function Choice({
  id,
  value,
  title,
  body,
  selected,
  disabled = false,
  badge,
}: {
  readonly id: string
  readonly value: string
  readonly title: string
  readonly body: string
  readonly selected: boolean
  readonly disabled?: boolean
  readonly badge?: string
}): JSX.Element {
  return <Label
    className={`flex w-full items-start gap-3 rounded-xl border p-4 text-left leading-normal outline-none transition-colors ${disabled ? 'cursor-not-allowed opacity-50' : 'cursor-pointer'} ${selected ? 'border-primary bg-muted/70' : 'hover:bg-muted/40'}`}
    htmlFor={id}
  >
    <RadioGroupItem className="mt-0.5" disabled={disabled} id={id} value={value} />
    <span className="min-w-0">
      <span className="flex flex-wrap items-center gap-2 text-sm font-medium">
        <span>{title}</span>
        {badge === undefined ? null : <Badge variant="secondary">{badge}</Badge>}
      </span>
      <span className="mt-1 block text-xs leading-relaxed text-muted-foreground">{body}</span>
    </span>
  </Label>
}

function ToggleRow({
  id,
  label,
  description,
  checked,
  disabled = false,
  onChange,
}: {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly checked: boolean
  readonly disabled?: boolean
  readonly onChange: (checked: boolean) => void
}): JSX.Element {
  return <div className="flex items-center justify-between gap-5 rounded-xl border p-4">
    <div className="min-w-0 space-y-1">
      <Label className="block text-sm font-medium" htmlFor={id}>{label}</Label>
      {description === undefined ? null : <p className="text-xs leading-relaxed text-muted-foreground">{description}</p>}
    </div>
    <Switch
      aria-label={label}
      checked={checked}
      disabled={disabled}
      id={id}
      onCheckedChange={onChange}
    />
  </div>
}

function Page({
  step,
  title,
  subtitle,
  children,
}: {
  readonly step: DesktopSetupWizardStep
  readonly title: string
  readonly subtitle: string
  readonly children: ReactNode
}): JSX.Element {
  return <div className="mx-auto flex w-full max-w-2xl flex-col py-5" data-orientation="vertical" data-setup-step={step}>
    <header className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{subtitle}</p>
    </header>
    <Card><CardContent className="space-y-3 p-4 sm:p-5">{children}</CardContent></Card>
  </div>
}

type MaterialOption = {
  readonly value: DesktopSetupWizardMacosMaterial | DesktopSetupWizardWindowsMaterial
  readonly title: string
  readonly body: string
}

function MaterialOptions({
  copy,
  input,
  selection,
  update,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly input: DesktopSetupWizardInput
  readonly selection: DesktopSetupWizardSelection
  readonly update: (selection: DesktopSetupWizardSelection) => void
}): JSX.Element {
  const options: readonly MaterialOption[] = input.platform === 'darwin' ? [
    { value: 'off', title: copy.materialOff, body: copy.materialOffBody },
    { value: 'transparent', title: copy.materialTransparent, body: copy.materialTransparentBody },
  ] : input.platform === 'win32' ? [
    { value: 'off', title: copy.materialOff, body: copy.materialOffBody },
    ...(input.micaSupported ? [{ value: 'mica' as const, title: copy.materialMica, body: copy.materialMicaBody }] : []),
  ] : [
    { value: 'off', title: copy.materialOff, body: copy.unavailableOnLinux },
  ]
  const selected = input.platform === 'darwin' ? selection.macosMaterial
    : input.platform === 'win32' ? selection.windowsMaterial : 'off'
  const choose = (value: MaterialOption['value']): void => {
    if (input.platform === 'darwin' && (value === 'off' || value === 'transparent')) {
      update({ ...selection, macosMaterial: value })
    } else if (input.platform === 'win32' && (value === 'off' || value === 'mica')) {
      update({ ...selection, windowsMaterial: value })
    }
  }
  return <RadioGroup
    aria-label={copy.windowMaterial}
    aria-orientation="vertical"
    name="setup-window-material"
    onValueChange={value => {
      if (value === 'off' || value === 'transparent' || value === 'mica') choose(value)
    }}
    value={selected}
  >{options.map(option => <Choice
    body={option.body}
    disabled={input.platform === 'linux'}
    id={`setup-window-material-${option.value}`}
    key={option.value}
    selected={selected === option.value}
    title={option.title}
    value={option.value}
  />)}</RadioGroup>
}

function MarketOptions({
  copy,
  selection,
  update,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly selection: DesktopSetupWizardSelection
  readonly update: (selection: DesktopSetupWizardSelection) => void
}): JSX.Element {
  const markets: readonly { readonly value: DesktopSetupWizardMarket; readonly title: string; readonly body: string }[] = [
    { value: 'disabled', title: copy.marketDisabled, body: copy.marketDisabledBody },
    { value: 'dsh-market', title: copy.dshMarket, body: copy.dshMarketBody },
  ]
  return <RadioGroup
    aria-label={copy.marketTitle}
    aria-orientation="vertical"
    name="setup-plugin-market"
    onValueChange={value => {
      if (value === 'disabled' || value === 'dsh-market') {
        update({ ...selection, market: value })
      }
    }}
    value={selection.market}
  >{markets.map(option => <Choice
    body={option.body}
    id={`setup-plugin-market-${option.value}`}
    key={option.value}
    selected={selection.market === option.value}
    title={option.title}
    value={option.value}
  />)}</RadioGroup>
}

function NotificationOptions({
  copy,
  notifications,
  update,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly notifications: DesktopSetupWizardNotifications
  readonly update: (notifications: DesktopSetupWizardNotifications) => void
}): JSX.Element {
  const set = (key: keyof DesktopSetupWizardNotifications, checked: boolean): void => {
    update({ ...notifications, [key]: checked })
  }
  return <div className="space-y-3" data-orientation="vertical">
    <ToggleRow checked={notifications.enabled} id="setup-notifications-enabled" label={copy.notificationsEnabled} onChange={checked => { set('enabled', checked) }} />
    <div className="space-y-3 border-l pl-4">
      <ToggleRow checked={notifications.notifyOnTurnCompletion} disabled={!notifications.enabled} id="setup-turn-completion" label={copy.turnCompletion} onChange={checked => { set('notifyOnTurnCompletion', checked) }} />
      <ToggleRow checked={notifications.notifyOnTurnFailure} disabled={!notifications.enabled} id="setup-turn-failure" label={copy.turnFailure} onChange={checked => { set('notifyOnTurnFailure', checked) }} />
      <ToggleRow checked={notifications.notifyOnJobCompletion} disabled={!notifications.enabled} id="setup-job-completion" label={copy.jobCompletion} onChange={checked => { set('notifyOnJobCompletion', checked) }} />
      <ToggleRow checked={notifications.notifyOnJobFailure} disabled={!notifications.enabled} id="setup-job-failure" label={copy.jobFailure} onChange={checked => { set('notifyOnJobFailure', checked) }} />
    </div>
  </div>
}

export function SetupWizardStepPage({
  step,
  copy,
  input,
  selection,
  update,
}: {
  readonly step: DesktopSetupWizardStep
  readonly copy: DesktopSetupWizardCopy
  readonly input: DesktopSetupWizardInput
  readonly selection: DesktopSetupWizardSelection
  readonly update: (selection: DesktopSetupWizardSelection) => void
}): JSX.Element {
  if (step === 'material') return <Page step={step} subtitle={copy.windowMaterialBody} title={copy.windowMaterial}><MaterialOptions copy={copy} input={input} selection={selection} update={update} /></Page>
  if (step === 'market') return <Page step={step} subtitle={copy.marketBody} title={copy.marketTitle}><MarketOptions copy={copy} selection={selection} update={update} /></Page>
  if (step === 'notifications') return <Page step={step} subtitle={copy.notificationsBody} title={copy.notificationsTitle}><NotificationOptions copy={copy} notifications={selection.notifications} update={notifications => { update({ ...selection, notifications }) }} /></Page>
  return <div data-setup-step={step} />
}

function SetupWizardSkipDialog({
  copy,
  onSkip,
  outlined = false,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly onSkip: () => void
  readonly outlined?: boolean
}): JSX.Element {
  return <Dialog>
    <DialogTrigger render={<Button type="button" variant={outlined ? 'outline' : 'ghost'} />}><SkipForward />{copy.skip}</DialogTrigger>
    <DialogContent aria-describedby="skip-warning-body" aria-labelledby="skip-warning-title" aria-modal="true" role="alertdialog" showCloseButton={false}>
      <DialogHeader>
        <DialogTitle id="skip-warning-title">{copy.skipDialogTitle}</DialogTitle>
        <DialogDescription id="skip-warning-body">{copy.skipDialogBody}</DialogDescription>
      </DialogHeader>
      <DialogFooter>
        <DialogClose render={<Button autoFocus type="button" variant="outline" />}>{copy.cancelSkip}</DialogClose>
        <Button onClick={onSkip} type="button">{copy.confirmSkip}</Button>
      </DialogFooter>
    </DialogContent>
  </Dialog>
}

export function SetupWizardWelcome({
  appVersion,
  copy,
  profileName,
  onStart,
  onSkip,
}: {
  readonly appVersion: string
  readonly copy: DesktopSetupWizardCopy
  readonly profileName: string
  readonly onStart: () => void
  readonly onSkip: () => void
}): JSX.Element {
  return <div className="flex flex-1 items-center justify-center py-5" data-align="center" data-setup-step="welcome">
    <div className="flex w-full max-w-xl flex-col items-stretch text-left">
      <div className="flex flex-wrap items-end gap-x-2 gap-y-1">
        <h1 className="text-2xl font-semibold tracking-tight">{copy.welcomeTitle}</h1>
        <Badge
          className="mb-0.5 px-1.5 py-0 text-[10px] leading-4"
          variant="secondary"
        >v{appVersion}</Badge>
      </div>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.welcomeBody}</p>
      <Card className="mt-7 w-full text-left">
        <CardContent className="space-y-3 p-5">
          <div>
            <span className="block text-xs font-medium uppercase tracking-wide text-muted-foreground">{copy.profile}</span>
            <span className="mt-1 block break-all text-base font-semibold">{profileName}</span>
          </div>
          <p className="text-sm leading-relaxed text-muted-foreground">{copy.firstProfileSetup}</p>
        </CardContent>
      </Card>
      <div className="mt-8 flex flex-wrap items-center justify-end gap-3">
        <SetupWizardSkipDialog copy={copy} onSkip={onSkip} outlined />
        <Button onClick={onStart} size="lg" type="button">{copy.startSetup}</Button>
      </div>
    </div>
  </div>
}

export function SetupWizardNavigation({
  copy,
  step,
  onBack,
  onNext,
  onSkip,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly step: DesktopSetupWizardStep
  readonly onBack: () => void
  readonly onNext: () => void
  readonly onSkip: () => void
}): JSX.Element | null {
  if (step === 'welcome' || step === 'success') return null
  return <footer className="flex shrink-0 items-center justify-between gap-3 border-t pt-4">
    <SetupWizardSkipDialog copy={copy} onSkip={onSkip} />
    <div className="flex items-center gap-2">
      <Button aria-label={copy.back} disabled={previousDesktopSetupWizardStep(step) === undefined} onClick={onBack} size="icon" title={copy.back} type="button" variant="outline"><ArrowLeft /></Button>
      <Button aria-label={copy.next} onClick={onNext} size="icon" title={copy.next} type="button"><ArrowRight /></Button>
    </div>
  </footer>
}

export function SetupWizardSuccess({
  copy,
  onStart,
}: {
  readonly copy: DesktopSetupWizardCopy
  readonly onStart: () => void
}): JSX.Element {
  return <div className="flex flex-1 items-center justify-center" data-align="center" data-setup-step="success">
    <div className="flex max-w-md flex-col items-center text-center">
      <span className="mb-5 flex size-16 items-center justify-center rounded-full bg-primary text-primary-foreground"><CheckCircle2 className="size-8" /></span>
      <h1 className="text-2xl font-semibold tracking-tight">{copy.successTitle}</h1>
      <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.successBody}</p>
      <Button className="mt-8" onClick={onStart} size="lg" type="button">{copy.startUsing}</Button>
    </div>
  </div>
}

export function SetupWizardApp(): JSX.Element {
  const locale = localLocale(window.location.search)
  const copy = desktopSetupWizardCopy(locale)
  const input = decodeDesktopSetupWizardInput(window.location.search)
  const [selection, setSelection] = useState<DesktopSetupWizardSelection | undefined>(() => input === undefined ? undefined : normalizedSelection(input))
  const [step, setStep] = useState<DesktopSetupWizardStep>('welcome')
  if (input === undefined || selection === undefined) {
    return <><DesktopFrame /><main className="dshNativeContent flex h-screen items-center justify-center p-6"><div className="w-full max-w-lg space-y-4"><Alert variant="destructive"><AlertTriangle /><AlertTitle>{copy.title}</AlertTitle><AlertDescription>{copy.invalidState}</AlertDescription></Alert><div className="flex justify-end"><SetupWizardSkipDialog copy={copy} onSkip={() => { window.location.assign(`${SCHEME}//skip`) }} outlined /></div></div></main></>
  }

  const skip = (): void => {
    window.location.assign(`${SCHEME}//skip`)
  }

  const advance = (): void => {
    const next = nextDesktopSetupWizardStep(step)
    if (next === undefined) return
    setStep(next)
  }

  const startUsing = (): void => {
    finish(selection)
  }

  return <><DesktopFrame /><main className="dshNativeContent h-screen overflow-hidden p-5 sm:p-6"><section className="mx-auto flex h-full w-full max-w-3xl flex-col">
    <div className="flex min-h-0 flex-1 overflow-y-auto">
      {step === 'welcome'
        ? <SetupWizardWelcome
          appVersion={input.appVersion}
          copy={copy}
          onSkip={skip}
          onStart={() => { setStep('material') }}
          profileName={input.profileName}
        />
        : step === 'success'
          ? <SetupWizardSuccess copy={copy} onStart={startUsing} />
          : <SetupWizardStepPage copy={copy} input={input} selection={selection} step={step} update={setSelection} />}
    </div>
    <SetupWizardNavigation
      copy={copy}
      onBack={() => {
        const previous = previousDesktopSetupWizardStep(step)
        if (previous !== undefined) setStep(previous)
      }}
      onNext={advance}
      onSkip={skip}
      step={step}
    />
  </section></main>
  </>
}
