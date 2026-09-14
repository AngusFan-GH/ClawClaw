/** Product-owned replacements for the upstream welcome and DeepSeek credential steps. */
import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { SettingsScope } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SPIRITX_ONBOARDING_COPY, SPIRITX_ONBOARDING_SHADOW, spiritXCredentialState, type SpiritXCredentialState } from './spiritx-onboarding-state.ts'

const CREDENTIAL_REF = 'SPIRITX_API_KEY'
const LOCALE_NS = 'desktop.spiritx-onboarding'
const WELCOME_FIELD = 'welcomeNoticeVersion'
const WELCOME_VERSION = 'spiritx-2026-09-14.1'
type Copy = typeof SPIRITX_ONBOARDING_COPY.en
type CopyKey = keyof Copy
type CredentialState = { kind: 'loading' } | SpiritXCredentialState
type WelcomeSection = Record<string, unknown>

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.spiritx-onboarding': CopyKey }
}

interface WelcomeInjected { scope: SettingsScope<WelcomeSection>; t: (key: CopyKey) => string }
interface CredentialInjected {
  loadCredential: () => Promise<CredentialState>
  storeCredential: (value: string) => Promise<string | undefined>
  t: (key: CopyKey) => string
}
type WelcomeProps = PropsRuntime<'settings.onboarding'> & InjectFace<WelcomeInjected>
type CredentialProps = PropsRuntime<'settings.onboarding'> & InjectFace<CredentialInjected>
const ignoreImplicitDismiss = (): void => {}

function ProductOnboardingModal({ title, focusTitle = false, children }: {
  title: string; focusTitle?: boolean; children: ReactNode
}): ReactNode {
  const titleRef = useRef<HTMLHeadingElement | null>(null)
  useEffect(() => {
    const appRoot = document.getElementById('root')
    if (appRoot === null) return
    const previous = appRoot.inert
    appRoot.inert = true
    return () => { appRoot.inert = previous }
  }, [])
  useEffect(() => { if (focusTitle) titleRef.current?.focus() }, [focusTitle])
  return <Modal open title={title} onClose={ignoreImplicitDismiss} headless className="spiritxOnboardingDialog">
    <div className="spiritxOnboardingContent">
      <h2 ref={titleRef} className="spiritxOnboardingTitle" tabIndex={focusTitle ? -1 : undefined}>{title}</h2>
      <div className="spiritxOnboardingBody">{children}</div>
    </div>
  </Modal>
}

function SpiritXWelcome({ complete, scope, t }: WelcomeProps): ReactNode {
  const snapshot = useSyncExternalStore(listener => scope.subscribe(listener), () => scope.getSnapshot())
  const [saving, setSaving] = useState(false)
  const [failure, setFailure] = useState(false)
  const acknowledged = snapshot.value?.[WELCOME_FIELD] === WELCOME_VERSION
  useEffect(() => { if (acknowledged) complete() }, [acknowledged, complete])
  if (snapshot.status === 'loading' || acknowledged) return null
  const acknowledge = async (): Promise<void> => {
    if (snapshot.mode === 'memory') { complete(); return }
    setSaving(true); setFailure(false)
    try {
      await scope.set(WELCOME_FIELD, WELCOME_VERSION)
      if (scope.getSnapshot().value?.[WELCOME_FIELD] === WELCOME_VERSION) complete()
      else setFailure(true)
    } finally { setSaving(false) }
  }
  return <ProductOnboardingModal title={t('welcomeTitle')} focusTitle>
    <div className="spiritxWelcomeCopy">
      {t('welcomeBody').split('\n\n').map(paragraph => <p key={paragraph}>{paragraph}</p>)}
    </div>
    {failure ? <p className="spiritxOnboardingError" role="alert">{t('welcomeError')}</p> : null}
    <div className="spiritxOnboardingActions">
      <Button variant="primary" disabled={saving} onClick={() => { void acknowledge() }}>{t('welcomeContinue')}</Button>
    </div>
  </ProductOnboardingModal>
}

function SpiritXCredential({ complete, loadCredential, storeCredential, t }: CredentialProps): ReactNode {
  const [state, setState] = useState<CredentialState>({ kind: 'loading' })
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  useEffect(() => {
    let stale = false
    void loadCredential().then(next => { if (!stale) setState(next) })
    return () => { stale = true }
  }, [loadCredential])
  useEffect(() => { if (state.kind === 'configured') complete() }, [complete, state.kind])
  if (state.kind === 'loading' || state.kind === 'configured') return null
  const save = async (): Promise<void> => {
    const value = key.trim()
    if (value.length === 0) { setFailure(t('required')); return }
    setBusy(true); setFailure(undefined)
    try {
      const refused = await storeCredential(value)
      if (refused !== undefined) { setFailure(refused); return }
      complete()
    } finally { setBusy(false) }
  }
  return <ProductOnboardingModal title={t('title')}>
    <p className="spiritxOnboardingDescription">{t('description')}</p>
    {state.kind === 'unavailable'
      ? <p className="spiritxOnboardingError" role="alert">{t('unavailable')}</p>
      : <label className="spiritxOnboardingField">
          <span>{t('keyLabel')}</span>
          <input type="password" autoComplete="off" autoFocus value={key} placeholder={t('keyPlaceholder')}
            aria-invalid={failure !== undefined} disabled={busy || !state.writable}
            onChange={(event) => { setKey(event.target.value); setFailure(undefined) }} />
        </label>}
    {failure === undefined ? null : <p className="spiritxOnboardingError" role="alert">{failure}</p>}
    <div className="spiritxOnboardingActions">
      <Button variant="outline" disabled={busy} onClick={complete}>{t('later')}</Button>
      {state.kind === 'missing' ? <Button variant="primary" disabled={busy || !state.writable}
        onClick={() => { void save() }}>{busy ? t('saving') : t('save')}</Button> : null}
    </div>
  </ProductOnboardingModal>
}

const STYLES = `
.spiritxOnboardingDialog { width: min(600px, 100%); padding: 0; }
.spiritxOnboardingContent { display: flex; flex-direction: column; box-sizing: border-box; max-height: calc(100vh - 48px); padding: 28px; overflow-y: auto; }
.spiritxOnboardingTitle { margin: 0; color: var(--dsw-alias-label-primary); font-size: 20px; line-height: 28px; font-weight: 500; letter-spacing: 0; outline: none; }
.spiritxOnboardingBody { margin-top: 20px; }
.spiritxWelcomeCopy, .spiritxOnboardingDescription { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 24px; }
.spiritxWelcomeCopy p { margin: 0; } .spiritxWelcomeCopy p + p { margin-top: 12px; }
.spiritxOnboardingField { display: flex; flex-direction: column; gap: 6px; margin-top: 24px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.spiritxOnboardingField input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; }
.spiritxOnboardingField input:focus { outline: none; border-color: var(--dsw-alias-brand-primary); }
.spiritxOnboardingField input::placeholder { color: var(--dsw-alias-label-dimmed); }
.spiritxOnboardingField input:disabled { cursor: default; opacity: .6; }
.spiritxOnboardingError { margin: 12px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.spiritxOnboardingActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
@media (max-width: 560px) { .spiritxOnboardingContent { padding: 24px; } .spiritxOnboardingActions > button:only-child { width: 100%; } }
`

function valueAt(root: unknown, path: readonly string[]): unknown {
  let current = root
  for (const segment of path) {
    if (typeof current !== 'object' || current === null || Array.isArray(current)) return undefined
    current = (current as Record<string, unknown>)[segment]
  }
  return current
}

/** Register product replacements in the same slot cells as the upstream steps. */
export function applySpiritXOnboarding(ctx: ClientContext): void {
  ctx.effect(() => ctx.locale.register(LOCALE_NS, SPIRITX_ONBOARDING_COPY), 'dsh-plugin-desktop: SpiritX onboarding copy')
  const t = ctx.locale.bind(LOCALE_NS) as WelcomeInjected['t']
  const welcomeScope = ctx.settingsScope.bind<WelcomeSection>({
    namespace: 'ui-onboarding',
    decode: section => typeof section === 'object' && section !== null && !Array.isArray(section)
      ? section as WelcomeSection : {},
  })
  const loadCredential = async (): Promise<CredentialState> => {
    const [registered, directory] = await Promise.all([ctx.remote.llm.listProviders(), ctx.remote.llm.listConfigurableProviders()])
    if (!registered.ok || !directory.ok) return { kind: 'unavailable' }
    const active = new Set(registered.value.map(provider => provider.id))
    const target = directory.value.find(entry => entry.provider === 'spiritx')
    if (target === undefined || !active.has(target.provider)) return { kind: 'unavailable' }
    const mirror = ctx.settingsScope.describe()
    await mirror.ensure()
    const settings = mirror.getSnapshot().view
    if (settings === undefined) return { kind: 'unavailable' }
    const namespaces = new Map(settings.namespaces.map(namespace => [namespace.ns, namespace]))
    const addressed = directory.value.filter(entry => active.has(entry.provider)).map((entry) => {
      const namespace = namespaces.get(entry.settingsNs)
      const profile = namespace === undefined ? undefined : valueAt(namespace.value, entry.settingsPath)
      const ref = typeof profile === 'object' && profile !== null && !Array.isArray(profile)
        ? (profile as { apiKeyEnv?: unknown }).apiKeyEnv : undefined
      return { entry, ref: typeof ref === 'string' && ref.length > 0 ? ref : undefined }
    })
    if (registered.value.some(provider => !directory.value.some(entry => entry.provider === provider.id))) return { kind: 'configured' }
    const refs = [...new Set(addressed.flatMap(row => row.ref === undefined ? [] : [row.ref]))]
    const credentials = await ctx.remote.credentials.describe(refs)
    if (!credentials.ok) return { kind: 'unavailable' }
    if (addressed.some(row => row.ref === undefined || credentials.value[row.ref]?.configured === true)) return { kind: 'configured' }
    const targetRow = addressed.find(row => row.entry.provider === 'spiritx')
    if (targetRow?.ref !== CREDENTIAL_REF) return { kind: 'unavailable' }
    return spiritXCredentialState(credentials.value[CREDENTIAL_REF])
  }
  const storeCredential = async (value: string): Promise<string | undefined> => {
    const response = await ctx.remote.credentials.set(CREDENTIAL_REF, value)
    return response.ok ? undefined : response.error.message
  }
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', ...SPIRITX_ONBOARDING_SHADOW.welcome,
    inject: () => ({ scope: welcomeScope, t }),
  }, SpiritXWelcome))
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', ...SPIRITX_ONBOARDING_SHADOW.credential,
    inject: () => ({ loadCredential, storeCredential, t }),
  }, SpiritXCredential))
  const style = document.createElement('style')
  style.dataset.pluginCss = 'dsh-plugin-desktop/spiritx-onboarding'
  style.textContent = STYLES
  document.head.append(style)
  ctx.effect(() => () => { style.remove() }, 'dsh-plugin-desktop: SpiritX onboarding styles')
}
