import { useEffect, useRef, useState, useSyncExternalStore, type ComponentType } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm, ConfigFormSnapshot } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { PropsRuntime, StoredEntry } from '@deepseek-ai/dsh-client-ui-slots'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import { Switch } from '@deepseek-ai/dsh-client-ui-primitives'
import { INPUT_SUGGESTIONS_ENTRY, INPUT_SUGGESTIONS_PATH, type InputSuggestionsSettings, type SuggestionResult } from '../input-suggestions-contract.ts'
import { emptySuggestionInput, InputSuggestionState, type SuggestionSnapshot, type SuggestionTransport } from './input-suggestions-state.ts'
import { registerEntryProjection } from './shortcut-presentation.tsx'
import { CONTINUATION_ENTRY, OPTIMIZATION_ENTRY } from '../input-assistance-contract.ts'
import { DraftAssistanceProvider, DraftOptimizationButton } from './input-assistance.tsx'
import { installInputAssistanceStyles } from './input-assistance-styles.ts'
import { inputSettingEnabled, trackConfirmedInputSetting } from './input-assistance-settings.ts'

/** The runtime reads this service directly; Cordis forbids undeclared access. */
export const INPUT_SUGGESTIONS_INJECT = ['conversation'] as const

const transport: SuggestionTransport = {
  generate: async (sessionId, requestId, endSeq, signal) => {
    const response = await fetch(`${INPUT_SUGGESTIONS_PATH}/action`, { method: 'POST', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ sessionId, requestId, endSeq }) })
    if (!response.ok) {
      console.debug(`[input-suggestions] HTTP ${response.status}`)
      transport.report?.('transport-failed', endSeq)
      throw new Error('Suggestion unavailable')
    }
    return await response.json() as SuggestionResult
  },
  cancel: requestId => {
    void fetch(`${INPUT_SUGGESTIONS_PATH}/action`, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: requestId }) }).catch(() => undefined)
  },
  report: (diagnostic, endSeq) => {
    console.debug(`[input-suggestions] ${diagnostic} endSeq=${endSeq}`)
    void fetch(`${INPUT_SUGGESTIONS_PATH}/action`, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ diagnostic, endSeq }) }).catch(() => undefined)
  },
}

/** All observations use public SessionBinding, input, and trigger-menu read faces. */
export function createSuggestionRuntime(ctx: Context, sessionId: SessionId, settings: ConfigForm<InputSuggestionsSettings>,
  changed: () => void, api: SuggestionTransport = transport, visible: () => boolean = () => true) {
  const sessions = ctx.get('sessions') as unknown as ISessions
  const binding = sessions.binding(sessionId)
  if (binding === undefined) return undefined
  const input = ctx.conversation.input.for(binding.ctx)
  const menu = ctx.inputTriggers.sessionOf(binding.ctx).menu
  const model = binding.session.projections.faceOf('modelSelection')
  const state = new InputSuggestionState({
    cancel: id => api.cancel(id),
    generate: async (id, requestId, seq, signal) => {
      sync()
      signal.throwIfAborted()
      const result = await api.generate(id, requestId, seq, signal)
      sync()
      return result
    },
  }, () => {
    if (state.text !== '') api.report?.('shown', endSeq)
    changed()
  })
  let contextVersion = 0
  let endSeq = -1
  let opportunity = false
  let historyOpportunity = true
  let wasEnabled = inputSettingEnabled(settings)
  let lastRevision = binding.eventSource.getSnapshot().revision
  let mounted = false
  let composing = false
  let compositionUntil = 0
  let compositionTimer: ReturnType<typeof setTimeout> | undefined
  let priorInputRev = input.state.getSnapshot().draftRev
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  let generation = connection.generation.getSnapshot()
  const snapshot = (): SuggestionSnapshot => {
    const session = binding.session.getSnapshot()
    return {
      sessionId, context: JSON.stringify([sessionId, contextVersion, model.getSnapshot()]), endSeq,
      enabled: inputSettingEnabled(settings),
      visible: document.visibilityState === 'visible' && mounted && visible(),
      idle: !session.running && !session.removed && session.openState === 'open' && session.pendingSubmissions.length === 0,
      menu: menu.getSnapshot().open || composing || Date.now() < compositionUntil,
      input: input.state.getSnapshot(),
    }
  }
  const sync = (): void => {
    let completed = false
    const currentGeneration = connection.generation.getSnapshot()
    if (currentGeneration !== generation) {
      generation = currentGeneration
      contextVersion++
      opportunity = false
    }
    const window = binding.eventSource.getSnapshot()
    const enabled = inputSettingEnabled(settings)
    if (enabled && !wasEnabled) historyOpportunity = true
    wasEnabled = enabled
    if (window.revision !== lastRevision) {
      lastRevision = window.revision
      if (window.change.kind === 'replace') { contextVersion++; opportunity = false; endSeq = -1; historyOpportunity = true }
      if (window.change.kind === 'settle-assistant') contextVersion++
      if (window.change.kind === 'append') for (const entry of window.change.entries) {
        if (entry.type !== 'event') continue
        const event = entry.event
        if (event.surfaceOp !== undefined || event.type === 'turn/start' || event.type === 'turn/end'
          || event.type === 'model/selection' || event.type === 'request/header') {
          contextVersion++
          opportunity = false
        }
        if (event.type === 'turn/end' && event.data.reason.kind === 'completed') {
          endSeq = event.seq
          opportunity = true
          completed = true
        }
      }
    }
    if (historyOpportunity && enabled) {
      historyOpportunity = false
      const end = (window.entries ?? []).findLast(entry => entry.type === 'event' && entry.event.type === 'turn/end')
      if (end?.type === 'event' && end.event.type === 'turn/end' && end.event.data.reason.kind === 'completed') {
        endSeq = end.event.seq; opportunity = true
      }
    }
    const next = snapshot()
    if (completed && next.enabled) api.report?.(!next.visible ? 'completion-hidden' : next.menu ? 'completion-menu'
      : !emptySuggestionInput(next.input) || binding.session.getSnapshot().pendingSubmissions.length > 0 ? 'completion-input'
      : !next.idle ? 'completion-running' : 'completion-eligible', endSeq)
    if (next.input.draftRev !== priorInputRev || !next.enabled || !next.visible || next.menu
      || !emptySuggestionInput(next.input) || binding.session.getSnapshot().pendingSubmissions.length > 0) opportunity = false
    priorInputRev = next.input.draftRev
    // turn/end arrives before agent/status idle; carry only this live opportunity across that gap.
    const trigger = opportunity && next.idle
    if (trigger) opportunity = false
    state.update(next, trigger)
  }
  const start = (): (() => void) => {
    mounted = true
    const stops = [input.state.subscribe(sync), binding.session.subscribe(sync), binding.eventSource.subscribe(sync),
      model.subscribe(sync), menu.subscribe(sync), settings.subscribe(sync), connection.generation.subscribe(sync)]
    const remote = ctx.get('remote') as unknown as ClientRemote
    const invalidateModel = (): void => { contextVersion++; opportunity = false; sync() }
    stops.push(remote.$on('llm/adapters-updated', invalidateModel), remote.$on('credentials/reference-updated', invalidateModel))
    const visibility = (): void => { opportunity = false; sync() }
    document.addEventListener('visibilitychange', visibility)
    sync()
    return () => {
      mounted = false
      clearTimeout(compositionTimer)
      stops.forEach(stop => stop())
      document.removeEventListener('visibilitychange', visibility)
      state.dispose()
    }
  }
  return {
    state, start, sync,
    composition(active: boolean): void {
      clearTimeout(compositionTimer)
      composing = active
      compositionUntil = active ? 0 : Date.now() + 10
      opportunity = false
      state.interacting()
      sync()
      if (!active) compositionTimer = setTimeout(sync, 10)
    },
    interacting(): void { opportunity = false; state.interacting() },
    accept(event: Parameters<InputSuggestionState['accept']>[0], actions: InputActions): boolean {
      const shown = state.text
      sync() // Read the authoritative stores again at the exact adoption boundary.
      if (shown === '' || state.text !== shown) return false
      return state.accept(event, actions, composing || Date.now() < compositionUntil)
    },
  }
}

type ComposerProps = PropsRuntime<'conversation.composer.bar'> & Record<string, unknown> & {
  sectionComponent: ComponentType<Record<string, unknown>>
  suggestionContext: Context
  suggestionSettings: ConfigForm<InputSuggestionsSettings>
  continuationSettings?: ConfigForm<InputSuggestionsSettings>
  optimizationSettings?: ConfigForm<InputSuggestionsSettings>
}

/** Forward every upstream seat untouched. Only documented owner placeholder copy is supplied. */
export function SuggestionComposer(props: ComposerProps): JSX.Element {
  const { sectionComponent: Composer, suggestionContext, suggestionSettings, continuationSettings, optimizationSettings, ...original } = props
  if (props.sessionId === undefined || props.inputActions === undefined) return <Composer {...original} />
  return <LiveSuggestionComposer key={props.sessionId} {...props} />
}

function LiveSuggestionComposer({ sectionComponent: Composer, suggestionContext: ctx, suggestionSettings: settings, continuationSettings, optimizationSettings, ...props }: ComposerProps): JSX.Element {
  const root = useRef<HTMLDivElement>(null)
  const blocked = props.disabled === true || props.blocked !== undefined || props.workspacePickerOpen === true
  const blockedRef = useRef(blocked)
  blockedRef.current = blocked
  const runtimeRef = useRef<ReturnType<typeof createSuggestionRuntime>>(undefined)
  const [text, setText] = useState('')
  useEffect(() => {
    const runtime = createSuggestionRuntime(ctx, props.sessionId!, settings, () => { setText(runtime?.state.text ?? '') }, transport,
      () => !blockedRef.current && root.current?.dataset.aiOptimizing !== 'true'
        && (root.current?.checkVisibility?.({ checkVisibilityCSS: true, checkOpacity: true }) ?? true))
    runtimeRef.current = runtime
    const stop = runtime?.start()
    const observer = typeof IntersectionObserver === 'undefined' ? undefined : new IntersectionObserver(() => runtime?.sync())
    if (root.current !== null) observer?.observe(root.current)
    const target = root.current
    const sync = () => runtime?.sync()
    target?.addEventListener('desktop-assist-change', sync)
    return () => { target?.removeEventListener('desktop-assist-change', sync); observer?.disconnect(); runtimeRef.current = undefined; stop?.() }
  }, [ctx, props.sessionId, props.inputActions, settings])
  useEffect(() => runtimeRef.current?.sync(), [blocked])
  // React capture is scoped to this public composer slot, ahead of the upstream
  // editor's native keymap. There is no window/document key listener or editor handle.
  return <DraftAssistanceProvider ctx={ctx} sessionId={props.sessionId!} actions={props.inputActions!}
    root={root} blocked={blocked} {...(continuationSettings === undefined ? {} : { continuation: continuationSettings })}
    {...(optimizationSettings === undefined ? {} : { optimization: optimizationSettings })}>
    <div ref={root} style={{ width: '100%', minWidth: 0 }}
    onCompositionStartCapture={() => runtimeRef.current?.composition(true)}
    onCompositionEndCapture={() => runtimeRef.current?.composition(false)}
    onBeforeInputCapture={() => runtimeRef.current?.interacting()}
    onPasteCapture={() => runtimeRef.current?.interacting()}
    onDropCapture={() => runtimeRef.current?.interacting()}
    onKeyDownCapture={event => {
      if (!(event.target instanceof Element) || root.current?.contains(event.target) !== true
        || event.target.closest('[contenteditable="true"]') === null) return
      if (props.disabled === true || props.blocked !== undefined || props.workspacePickerOpen === true) return
      if (props.inputActions !== undefined && runtimeRef.current?.accept(event.nativeEvent, props.inputActions) === true) {
        event.preventDefault(); event.stopPropagation()
      }
    }}>
    <Composer {...props} {...(text === '' || blocked ? {} : { placeholder: text })} />
  </div></DraftAssistanceProvider>
}

const zh = { title: 'AI 输入建议', description: '基于当前对话调用已配置的模型，生成下一步请求建议。按 Tab 或 Enter 采纳后可编辑或发送。' }
const en: Record<keyof typeof zh, string> = { title: 'AI input suggestions', description: 'Uses your configured model and current conversation to suggest a next request. Press Tab or Enter to adopt, then edit or send.' }
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap { 'desktop.input-suggestions': keyof typeof zh }
  interface LocaleNamespaceMap { 'desktop.continuation': keyof typeof zh }
}

export function SuggestionSettings({ settings, t }: { settings: ConfigForm<InputSuggestionsSettings>; t: (key: keyof typeof zh) => string }): JSX.Element {
  const snapshot = useSyncExternalStore(listener => settings.subscribe(listener), () => settings.getSnapshot(), () => settings.getSnapshot())
  const [busy, setBusy] = useState(false)
  return <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 24, padding: '16px 0', borderBottom: '0.5px solid var(--dsw-alias-border-l2)' }}>
    <div style={{ flex: 1, minWidth: 0 }}>
      <div style={{ fontSize: 14, lineHeight: '20px' }}>{t('title')}</div>
      <div style={{ marginTop: 4, color: 'var(--dsw-alias-label-secondary)', fontSize: 12, lineHeight: '18px' }}>{t('description')}</div>
    </div>
    <Switch label={t('title')} checked={snapshot.value?.enabled === true} disabled={busy || snapshot.writable === false}
      onChange={enabled => {
        setBusy(true)
        void settings.set('enabled', enabled).catch(() => undefined).finally(() => { setBusy(false) })
      }} />
  </div>
}

/** Hide/cancel synchronously on a toggle, while the existing form serializes Profile writes. */
export function immediateSuggestionSettings(source: ConfigForm<InputSuggestionsSettings>): ConfigForm<InputSuggestionsSettings> {
  let optimistic: boolean | undefined
  let write = 0
  let cached: ConfigFormSnapshot<InputSuggestionsSettings> | undefined
  let previous: ConfigFormSnapshot<InputSuggestionsSettings> | undefined
  let previousOptimistic: boolean | undefined
  const listeners = new Set<() => void>()
  const notify = (): void => { listeners.forEach(listener => listener()) }
  return trackConfirmedInputSetting({
    getSnapshot: () => {
      const current = source.getSnapshot()
      if (cached === undefined || previous !== current || previousOptimistic !== optimistic) {
        previous = current; previousOptimistic = optimistic
        cached = optimistic === undefined ? current : { ...current, value: { enabled: optimistic } }
      }
      return cached
    },
    subscribe: listener => {
      listeners.add(listener)
      const stop = source.subscribe(listener)
      return () => { listeners.delete(listener); stop() }
    },
    set: async (field, value) => {
      const generation = ++write
      if (field === 'enabled' && typeof value === 'boolean') { optimistic = value; notify() }
      try { return await source.set(field, value) }
      finally { if (generation === write) { optimistic = undefined; notify() } }
    },
    mutate: (...args) => source.mutate(...args), unset: field => source.unset(field),
  }, source)
}

export function applyInputSuggestions(ctx: Context): void {
  ctx.effect(() => installInputAssistanceStyles(), 'desktop: input assistance styles')
  const settings = immediateSuggestionSettings(ctx.configForms.get<InputSuggestionsSettings>(INPUT_SUGGESTIONS_ENTRY))
  const continuationSettings = immediateSuggestionSettings(ctx.configForms.get<InputSuggestionsSettings>(CONTINUATION_ENTRY))
  const optimizationSettings = immediateSuggestionSettings(ctx.configForms.get<InputSuggestionsSettings>(OPTIMIZATION_ENTRY))
  ctx.effect(() => ctx.locale.register('desktop.input-suggestions', { zh, en }), 'desktop: input suggestions locale')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: INPUT_SUGGESTIONS_ENTRY, order: 36, locale: 'desktop.input-suggestions',
    inject: () => ({ settings }),
  }, SuggestionSettings))
  ctx.effect(() => ctx.locale.register('desktop.continuation', {
    zh: { title: '输入时 AI 续写', description: '输入至少六个字并停顿后，生成灰色续写；Tab 采纳，Enter 仅发送原草稿。功能调用已配置的模型。' },
    en: { title: 'AI continuation', description: 'After typing at least six characters and pausing, show a gray continuation. Tab accepts; Enter sends only your draft. Uses your configured model.' },
  }), 'desktop: continuation locale')
  ctx.slots.inject('settings.general.item', () => ctx.slots.register({
    name: 'settings.general.item', id: CONTINUATION_ENTRY, order: 37, locale: 'desktop.continuation', inject: () => ({ settings: continuationSettings }),
  }, SuggestionSettings))
  ctx.slots.inject('conversation.input.left', () => ctx.slots.register({
    name: 'conversation.input.left', id: OPTIMIZATION_ENTRY, order: 31,
  }, DraftOptimizationButton))
  ctx.effect(() => {
    let source: StoredEntry | undefined
    let dispose: (() => void) | undefined
    let updating = false
    const reconcile = (): void => {
      if (updating) return
      const next = [settings, continuationSettings, optimizationSettings].some(form => form.getSnapshot().value?.enabled === true)
        ? ctx.slots.entries('conversation.composer.bar').filter(entry => entry.component !== SuggestionComposer)
          .sort((a, b) => (a.options.priority ?? 0) - (b.options.priority ?? 0))[0]
        : undefined
      if (next === source) return
      updating = true
      try {
        dispose?.()
        source = next
        dispose = next === undefined ? undefined : registerEntryProjection(ctx, next,
          { name: 'conversation.composer.bar', priority: -100 }, SuggestionComposer,
          () => ({ suggestionContext: ctx, suggestionSettings: settings, continuationSettings, optimizationSettings }))
      } finally { updating = false }
    }
    const stop = ctx.slots.subscribe('conversation.composer.bar', reconcile)
    const stopSettings = settings.subscribe(reconcile)
    const stopContinuation = continuationSettings.subscribe(reconcile)
    const stopOptimization = optimizationSettings.subscribe(reconcile)
    reconcile()
    return () => { stop(); stopSettings(); stopContinuation(); stopOptimization(); dispose?.() }
  }, 'desktop: public composer suggestion presentation')
}
