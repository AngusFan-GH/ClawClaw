/** Product-owned onboarding without the upstream preview notice. */
import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import { Button, Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import type { InjectFace, PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { SPIRITX_ONBOARDING_COPY, SPIRITX_ONBOARDING_SHADOW, SPIRITX_PLATFORM_URL, spiritXCredentialState, type SpiritXCredentialState } from './spiritx-onboarding-state.ts'
import { hasUsableSpiritXProfile, provisionSpiritX, syncSpiritXModelProtocols, SPIRITX_API_KEY_REF } from './spiritx-provisioning.ts'

const LOCALE_NS = 'desktop.spiritx-onboarding'
const LOADING_FEEDBACK_DELAY_MS = 500
type Copy = typeof SPIRITX_ONBOARDING_COPY.en
type CopyKey = keyof Copy
type CredentialState = { kind: 'loading' } | SpiritXCredentialState

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.spiritx-onboarding': CopyKey }
}

interface CredentialInjected {
  loadCredential: () => Promise<CredentialState>
  storeCredential: (value: string) => Promise<string | undefined>
  t: (key: CopyKey) => string
}
type CredentialProps = PropsRuntime<'settings.onboarding'> & InjectFace<CredentialInjected>
const ignoreImplicitDismiss = (): void => {}

/** Advance the onboarding coordinator without displaying or acknowledging the upstream notice. */
function SkipPreviewNotice({ complete }: PropsRuntime<'settings.onboarding'>): ReactNode {
  useEffect(() => { complete() }, [complete])
  return null
}

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

export function SpiritXCredential({ complete, loadCredential, storeCredential, t }: CredentialProps): ReactNode {
  const [state, setState] = useState<CredentialState>({ kind: 'loading' })
  const [showLoading, setShowLoading] = useState(false)
  const [key, setKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string | undefined>()
  const [attempt, setAttempt] = useState(0)
  const saving = useRef(false)
  const finished = useRef(false)
  const finish = useCallback(() => {
    if (finished.current) return
    finished.current = true
    complete()
  }, [complete])
  useEffect(() => {
    let stale = false
    setState({ kind: 'loading' })
    setShowLoading(false)
    // New conversations remount this step. Keep quick checks from opening a modal.
    const feedbackTimer = setTimeout(() => {
      if (!stale && !finished.current) setShowLoading(true)
    }, LOADING_FEEDBACK_DELAY_MS)
    void loadCredential().then(
      next => {
        clearTimeout(feedbackTimer)
        if (!stale && !finished.current) setState(next)
      },
      () => {
        clearTimeout(feedbackTimer)
        if (!stale && !finished.current) setState({ kind: 'unavailable' })
      },
    )
    return () => { stale = true; clearTimeout(feedbackTimer) }
  }, [loadCredential, attempt])
  useEffect(() => {
    if (state.kind === 'configured') finish()
  }, [finish, state.kind])
  if (state.kind === 'configured' || (state.kind === 'loading' && !showLoading)) return null
  if (state.kind === 'loading' || state.kind === 'unavailable') return <ProductOnboardingModal title={t('title')} focusTitle>
    <p className="spiritxOnboardingDescription" role={state.kind === 'loading' ? 'status' : 'alert'}>{t(state.kind === 'loading' ? 'loading' : 'unavailable')}</p>
    <p className="spiritxOnboardingDescription">{t('laterHelp')}</p>
    <div className="spiritxOnboardingActions">
      <Button variant="outline" onClick={finish}>{t('later')}</Button>
      {state.kind === 'unavailable' ? <Button variant="primary" onClick={() => { setAttempt(value => value + 1) }}>{t('retry')}</Button> : null}
    </div>
  </ProductOnboardingModal>
  const save = async (): Promise<void> => {
    if (saving.current) return
    const value = key.trim()
    if (value.length === 0) { setFailure(t('required')); return }
    saving.current = true
    setBusy(true); setFailure(undefined)
    try {
      const refused = await storeCredential(value)
      if (refused !== undefined) { setFailure(refused); return }
      setKey('')
      finish()
    } catch {
      setFailure(t('saveFailed'))
    } finally { saving.current = false; setBusy(false) }
  }
  return <ProductOnboardingModal title={t('title')} focusTitle>
    <p className="spiritxOnboardingDescription">{t('description')}</p>
    <section className="spiritxOnboardingGuide" aria-labelledby="spiritx-get-key-title">
      <h3 id="spiritx-get-key-title">{t('getKeyTitle')}</h3>
      <ol>
        <li>{t('registerStep')}</li>
        <li>{t('findKeyStep')}</li>
        <li>{t('createKeyStep')}</li>
        <li>{t('connectKeyStep')}</li>
      </ol>
      <a className="spiritxOnboardingPlatformLink" href={SPIRITX_PLATFORM_URL} target="_blank" rel="noopener noreferrer"
        aria-describedby="spiritx-browser-help">{t('getKey')}
        <svg aria-hidden="true" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5">
          <path d="M6 3h7v7M13 3 3 13" />
        </svg>
      </a>
      <p id="spiritx-browser-help">{t('browserHelp')}</p>
    </section>
    <form aria-busy={busy} onSubmit={event => { event.preventDefault(); void save() }}>
    <label className="spiritxOnboardingField">
      <span>{t('keyLabel')}</span>
      <input type="password" autoComplete="off" value={key} placeholder={t('keyPlaceholder')}
        aria-invalid={failure !== undefined} aria-describedby="spiritx-key-help spiritx-onboarding-help spiritx-onboarding-error" disabled={busy || !state.writable}
        onChange={(event) => { setKey(event.target.value); setFailure(undefined) }} />
    </label>
    <p className="spiritxOnboardingDescription" id="spiritx-key-help">{t('keyHelp')}</p>
    <p className="spiritxOnboardingDescription" id="spiritx-onboarding-help">{t('laterHelp')}</p>
    <p className="spiritxOnboardingError" id="spiritx-onboarding-error" role="alert">{failure}</p>
    <div className="spiritxOnboardingActions">
      <Button type="button" variant="outline" disabled={busy} onClick={finish}>{t('later')}</Button>
      <Button type="submit" variant="primary" disabled={busy || !state.writable}>{busy ? t('saving') : t('save')}</Button>
    </div>
    </form>
  </ProductOnboardingModal>
}

const STYLES = `
.spiritxOnboardingDialog { width: min(600px, 100%); padding: 0; }
.spiritxOnboardingContent { display: flex; flex-direction: column; box-sizing: border-box; max-height: calc(100vh - 48px); padding: 28px; overflow-y: auto; }
.spiritxOnboardingTitle { margin: 0; color: var(--dsw-alias-label-primary); font-size: 20px; line-height: 28px; font-weight: 500; letter-spacing: 0; outline: none; }
.spiritxOnboardingBody { margin-top: 20px; }
.spiritxOnboardingDescription { margin: 0; color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 24px; }
.spiritxOnboardingGuide { margin-top: 20px; padding: 16px; border: 1px solid var(--dsw-alias-border-l4); border-radius: 12px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-secondary); font-size: 14px; line-height: 24px; }
.spiritxOnboardingGuide h3 { margin: 0; color: var(--dsw-alias-label-primary); font-size: 14px; font-weight: 500; }
.spiritxOnboardingGuide ol { margin: 8px 0 12px; padding-left: 22px; }
.spiritxOnboardingGuide p { margin: 6px 0 0; font-size: 12px; line-height: 20px; }
.spiritxOnboardingPlatformLink { display: inline-flex; align-items: center; gap: 6px; min-height: 32px; max-width: 100%; color: var(--dsh-color-accent); text-decoration: underline; text-underline-offset: 3px; }
.spiritxOnboardingPlatformLink:hover { text-decoration-thickness: 2px; }
.spiritxOnboardingPlatformLink:focus-visible { outline: 2px solid var(--dsh-color-accent); outline-offset: 3px; border-radius: 4px; }
.spiritxOnboardingField { display: flex; flex-direction: column; gap: 6px; margin-top: 24px; color: var(--dsw-alias-label-secondary); font-size: 12px; line-height: 18px; font-weight: 500; }
.spiritxOnboardingField input { box-sizing: border-box; width: 100%; height: 32px; padding: 0 10px; border: .5px solid var(--dsw-alias-border-l4); border-radius: 8px; background: var(--dsw-alias-bg-layer-1); color: var(--dsw-alias-label-primary); font: inherit; font-size: 14px; line-height: 22px; }
.spiritxOnboardingField input:focus { outline: none; border-color: var(--dsh-color-accent); }
.spiritxOnboardingField input::placeholder { color: var(--dsw-alias-label-dimmed); }
.spiritxOnboardingField input:disabled { cursor: default; opacity: .6; }
.spiritxOnboardingError { margin: 12px 0 0; color: var(--dsw-alias-state-error-primary); font-size: 12px; line-height: 18px; }
.spiritxOnboardingActions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 24px; }
@media (max-width: 560px) { .spiritxOnboardingContent { padding: 24px; } .spiritxOnboardingActions { flex-wrap: wrap; } .spiritxOnboardingActions > button { flex: 1 1 auto; } }
`

/** Skip the upstream preview notice and retain product credential onboarding. */
export function applySpiritXOnboarding(ctx: ClientContext): void {
  if (typeof document === 'undefined') return
  ctx.effect(() => ctx.locale.register(LOCALE_NS, SPIRITX_ONBOARDING_COPY), 'dsh-plugin-desktop: SpiritX onboarding copy')
  const t = ctx.locale.bind(LOCALE_NS) as CredentialInjected['t']
  let protocolSync: Promise<void> | undefined
  const refreshProtocols = (): Promise<void> => {
    protocolSync ??= syncSpiritXModelProtocols(ctx).catch(() => {}).finally(() => { protocolSync = undefined })
    return protocolSync
  }
  ctx.effect(() => {
    const dispose = ctx.on('connection/reset', () => { void refreshProtocols() })
    // Existing conversations also need current capabilities; onboarding only
    // mounts for a blank conversation. Reconnects retry failed discovery.
    void refreshProtocols()
    return dispose
  }, 'dsh-plugin-desktop: SpiritX protocol discovery')
  const loadCredential = async (): Promise<CredentialState> => {
    const directory = await ctx.remote.llm.listConfigurableProviders()
    if (!directory.ok || !directory.value.some(entry => entry.provider === 'spiritx')) return { kind: 'unavailable' }
    const [credentials, profileConfigured] = await Promise.all([
      ctx.remote.credentials.describe([SPIRITX_API_KEY_REF]),
      hasUsableSpiritXProfile(ctx),
    ])
    if (!credentials.ok) return { kind: 'unavailable' }
    if (profileConfigured && credentials.value[SPIRITX_API_KEY_REF]?.configured) {
      // Offline discovery must not prevent an already configured app from opening.
      await refreshProtocols()
    }
    return spiritXCredentialState(credentials.value[SPIRITX_API_KEY_REF], profileConfigured)
  }
  const storeCredential = async (value: string): Promise<string | undefined> => {
    return provisionSpiritX(ctx, value)
  }
  ctx.slots.inject('settings.onboarding', () => ctx.slots.register({
    name: 'settings.onboarding', ...SPIRITX_ONBOARDING_SHADOW.welcome,
  }, SkipPreviewNotice))
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
