import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Modal } from '@deepseek-ai/dsh-client-ui-primitives'
import { ASSISTANCE_PATH, type DraftAssistResult } from '../input-assistance-contract.ts'
import { DraftAssistanceState, type AssistTransport } from './input-assistance-state.ts'

type EnabledForm = ConfigForm<{ enabled: boolean }>
const AssistanceContext = createContext<{ state: DraftAssistanceState; sync(): void; language: string; optimizationEnabled: boolean } | undefined>(undefined)
const transport: AssistTransport = {
  generate: async (request, signal) => {
    const response = await fetch(`${ASSISTANCE_PATH}/${request.kind}/action`, { method: 'POST', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
    if (!response.ok) throw new Error('Draft assistance unavailable')
    return await response.json() as DraftAssistResult
  },
  cancel: request => {
    void fetch(`${ASSISTANCE_PATH}/${request.kind}/action`, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: request.requestId }) }).catch(() => undefined)
  },
}

export function DraftAssistanceProvider({ ctx, sessionId, actions, continuation, optimization, root, blocked, children }: {
  ctx: Context; sessionId: SessionId; actions: InputActions; continuation?: EnabledForm; optimization?: EnabledForm
  root: RefObject<HTMLDivElement | null>; blocked: boolean; children: ReactNode
}): JSX.Element {
  const [, render] = useState(0)
  const [runtime, setRuntime] = useState<ReturnType<typeof createDraftAssistanceRuntime>>()
  const blockedRef = useRef(blocked); blockedRef.current = blocked
  const language = useSyncExternalStore(listener => ctx.locale.subscribe?.(listener) ?? (() => {}), () => ctx.locale.getSnapshot?.().active ?? 'zh')
  const optimizationEnabled = useSyncExternalStore(listener => optimization?.subscribe(listener) ?? (() => {}), () => optimization?.getSnapshot().value?.enabled === true)
  useEffect(() => {
    if (continuation === undefined && optimization === undefined) return
    let next: ReturnType<typeof createDraftAssistanceRuntime>
    next = createDraftAssistanceRuntime(ctx, sessionId, actions, root, () => blockedRef.current, continuation, optimization,
      () => {
        if (root.current) {
          root.current.dataset.aiOptimizing = String(next?.state.phase !== 'idle')
          root.current.dispatchEvent(new Event('desktop-assist-change'))
        }
        render(value => value + 1)
      })
    setRuntime(next)
    const stop = next?.start()
    return () => { stop?.(); if (root.current) delete root.current.dataset.aiOptimizing }
  }, [ctx, sessionId, actions, root, continuation, optimization])
  useEffect(() => runtime?.sync(), [blocked, runtime])
  const state = runtime?.state
  const ghost = state?.phase === 'idle' ? state.text : ''
  const position = ghost ? runtime?.position() : undefined
  return <AssistanceContext.Provider value={runtime === undefined ? undefined : { ...runtime, language, optimizationEnabled }}>
    {children}
    {ghost !== '' && position !== undefined && <div aria-hidden="true" data-claw-ai-continuation
      style={{ position: 'fixed', left: position.left, top: position.top, maxWidth: position.width, whiteSpace: 'pre-wrap',
        pointerEvents: 'none', color: 'var(--dsw-alias-label-tertiary)', fontSize: 14, lineHeight: '22px', zIndex: 1 }}>{ghost}</div>}
  </AssistanceContext.Provider>
}

export function createDraftAssistanceRuntime(ctx: Context, sessionId: SessionId, actions: InputActions,
  root: RefObject<HTMLDivElement | null>, blocked: () => boolean, continuation: EnabledForm | undefined,
  optimization: EnabledForm | undefined, changed: () => void, api: AssistTransport = transport) {
  const binding = (ctx.get('sessions') as unknown as ISessions).binding(sessionId)
  if (binding === undefined) return undefined
  const input = ctx.conversation.input.for(binding.ctx)
  const menu = ctx.inputTriggers.sessionOf(binding.ctx).menu
  const model = binding.session.projections.faceOf('modelSelection')
  const connection = ctx.get('connection') as unknown as ConnectionHandle
  let composing = false; let mounted = false; let compositionUntil = 0
  let compositionTimer: ReturnType<typeof setTimeout> | undefined
  let compositionRevision = -1
  let inputRevision = input.state.getSnapshot().draftRev
  let contextVersion = 0
  let events = binding.eventSource.getSnapshot().revision
  const state = new DraftAssistanceState({
    cancel: request => api.cancel(request),
    generate: async (request, signal) => { sync(); signal.throwIfAborted(); const result = await api.generate(request, signal); sync(); return result },
  }, changed)
  const atEnd = (): boolean => {
    const selection = document.getSelection()
    if (root.current === null || !root.current.contains(document.activeElement) || document.activeElement?.closest('[contenteditable="true"]') === null
      || selection === null || !selection.isCollapsed
      || selection.anchorNode === null || !root.current.contains(selection.anchorNode)) return false
    const span = actions.captureInsertion(); const value = input.state.getSnapshot()
    return span.draftRev === value.draftRev && span.start === value.draft.length && span.end === span.start
  }
  const sync = (): void => {
    if (events !== binding.eventSource.getSnapshot().revision) { events = binding.eventSource.getSnapshot().revision; contextVersion++ }
    const session = binding.session.getSnapshot()
    state.update({ sessionId, context: JSON.stringify([sessionId, contextVersion, model.getSnapshot(), connection.generation.getSnapshot()]),
      input: input.state.getSnapshot(), continuationEnabled: continuation?.getSnapshot().value?.enabled === true,
      optimizationEnabled: optimization?.getSnapshot().value?.enabled === true, atEnd: atEnd(),
      available: mounted && !blocked() && document.visibilityState === 'visible' && !composing && Date.now() >= compositionUntil
        && !menu.getSnapshot().open && !session.running && !session.removed && session.openState === 'open'
        && session.pendingSubmissions.length === 0 && (root.current?.checkVisibility?.({ checkVisibilityCSS: true, checkOpacity: true }) ?? true) })
  }
  const position = () => {
    if (!atEnd()) return undefined
    const range = document.getSelection()?.getRangeAt(0)
    const rect = range?.getBoundingClientRect?.()
    const bounds = root.current?.getBoundingClientRect()
    if (rect === undefined || bounds === undefined || rect.height === 0 || rect.bottom > bounds.bottom || rect.right > bounds.right) return undefined
    const width = Math.max(0, bounds.right - rect.right - 16)
    return width < 40 ? { left: bounds.left + 16, top: rect.bottom, width: Math.max(0, bounds.width - 32) }
      : { left: rect.right, top: rect.top, width }
  }
  const start = (): (() => void) => {
    mounted = true
    const inputChanged = () => {
      const revision = input.state.getSnapshot().draftRev
      const edited = revision !== inputRevision; inputRevision = revision
      sync()
      // The public editor publishes its new revision before the browser finishes
      // reconciling the caret. Observe the settled selection after this edit.
      if (edited) queueMicrotask(() => { sync(); state.edited(revision) })
    }
    const stops = [input.state.subscribe(inputChanged), binding.session.subscribe(sync), binding.eventSource.subscribe(sync), model.subscribe(sync),
      menu.subscribe(sync), connection.generation.subscribe(sync)]
    if (continuation) stops.push(continuation.subscribe(sync))
    if (optimization) stops.push(optimization.subscribe(sync))
    const remote = ctx.get('remote') as unknown as ClientRemote
    const invalidate = () => { contextVersion++; sync() }
    stops.push(remote.$on('llm/adapters-updated', invalidate), remote.$on('credentials/reference-updated', invalidate))
    const target = root.current
    const interact = () => state.interacting()
    const compositionStart = () => { compositionRevision = input.state.getSnapshot().draftRev; composing = true; interact(); sync() }
    const compositionEnd = () => {
      composing = false; compositionUntil = Date.now() + 10; clearTimeout(compositionTimer)
      compositionTimer = setTimeout(() => {
        sync()
        const revision = input.state.getSnapshot().draftRev
        if (revision !== compositionRevision) state.edited(revision)
      }, 10)
      sync()
    }
    const blur = () => queueMicrotask(sync)
    const key = (event: KeyboardEvent) => {
      const shown = state.text
      sync()
      if (shown !== '' && state.text === shown && position() !== undefined) state.accept(event, actions)
      if (event.key === 'Enter') state.interacting() // Enter sends only the real draft.
    }
    target?.addEventListener('keydown', key, true)
    target?.addEventListener('beforeinput', interact, true)
    target?.addEventListener('paste', interact, true)
    target?.addEventListener('drop', interact, true)
    target?.addEventListener('compositionstart', compositionStart, true)
    target?.addEventListener('compositionend', compositionEnd, true)
    target?.addEventListener('focusin', sync)
    target?.addEventListener('focusout', blur)
    document.addEventListener('selectionchange', sync)
    document.addEventListener('visibilitychange', sync)
    const layout = () => { sync(); changed() }
    window.addEventListener('resize', layout); window.addEventListener('scroll', layout, true)
    sync()
    return () => {
      mounted = false; clearTimeout(compositionTimer); stops.forEach(stop => stop()); state.dispose()
      target?.removeEventListener('keydown', key, true)
      target?.removeEventListener('beforeinput', interact, true); target?.removeEventListener('paste', interact, true); target?.removeEventListener('drop', interact, true)
      target?.removeEventListener('compositionstart', compositionStart, true); target?.removeEventListener('compositionend', compositionEnd, true)
      target?.removeEventListener('focusin', sync); target?.removeEventListener('focusout', blur)
      document.removeEventListener('selectionchange', sync); document.removeEventListener('visibilitychange', sync)
      window.removeEventListener('resize', layout); window.removeEventListener('scroll', layout, true)
    }
  }
  return { state, sync, start, position }
}

export function DraftOptimizationButton({ inputActions, useInput }: PropsRuntime<'conversation.input.left'>): JSX.Element | null {
  const runtime = useContext(AssistanceContext)
  const input = useInput(value => value)
  if (runtime === undefined || !runtime.optimizationEnabled) return null
  const { state, sync } = runtime
  const zh = runtime.language.startsWith('zh')
  const label = zh ? '优化草稿' : 'Optimize draft'
  const limited = input.occurrences.length > 0 || input.phase !== 'plain' || input.claim !== undefined
  return <>
    <button type="button" title={limited ? (zh ? '为保留引用和命令，此草稿暂不支持优化' : 'References and commands cannot be replaced') : label}
      disabled={limited || !state.optimizationAvailable || state.phase !== 'idle'}
      style={{ border: 0, borderRadius: 6, background: 'transparent', color: 'var(--dsw-alias-label-secondary)', padding: '4px 8px', cursor: 'pointer', fontSize: 12 }}
      onClick={() => { sync(); state.optimize() }}>{label}</button>
    <Modal open={state.phase !== 'idle'} onClose={() => state.close()} title={label} closeLabel={zh ? '关闭' : 'Close'}
      footer={<><button type="button" onClick={() => state.close()}>{zh ? '取消' : 'Cancel'}</button>
        {state.phase === 'preview' && <button type="button" onClick={() => { sync(); state.replace(inputActions) }}>{zh ? '替换草稿' : 'Replace draft'}</button>}
        {(state.phase === 'error' || state.phase === 'empty') && <button type="button" onClick={() => { sync(); state.optimize() }}>{zh ? '重试' : 'Retry'}</button>}</>}>
      {state.phase === 'generating' && <p>{zh ? '正在优化草稿…' : 'Optimizing draft…'}</p>}
      {state.phase === 'empty' && <p>{zh ? '未生成可用的修改，已保留原草稿。' : 'No usable changes. Your original draft is preserved.'}</p>}
      {state.phase === 'error' && <p role="alert">{zh ? '优化失败或超时，请重试。' : 'Optimization failed or timed out. Please retry.'}</p>}
      {state.phase === 'preview' && <div style={{ display: 'grid', gap: 16 }}>
        <section><h3>{zh ? '原文' : 'Original'}</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.original}</pre></section>
        <section><h3>{zh ? '优化后' : 'Optimized'}</h3><pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>{state.text}</pre></section>
        {state.notes.length > 0 && <section><h3>{zh ? '待补充信息' : 'Missing information'}</h3><ul>{state.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></section>}
      </div>}
    </Modal>
  </>
}
