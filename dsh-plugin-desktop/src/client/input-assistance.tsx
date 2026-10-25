import { createContext, useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode, type RefObject } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ConfigForm } from '@deepseek-ai/dsh-client-ui-settings/client'
import type { InputActions } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type { ClientRemote } from '@deepseek-ai/dsh-api-remotes/client'
import type { ConnectionHandle } from '@deepseek-ai/dsh-client-connection/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { Button, Modal, IconCheckOutlineRegular, IconCloseOutlineRegular, IconRefreshOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
// @ts-expect-error package subpath has no declaration file
import Sparkles from 'lucide-react/dist/esm/icons/sparkles.mjs'
// @ts-expect-error package subpath has no declaration file
import FileText from 'lucide-react/dist/esm/icons/file-text.mjs'
import { ASSISTANCE_PATH, type DraftAssistResult, type ContinuationDiagnostic } from '../input-assistance-contract.ts'
import { DraftAssistanceState, type AssistTransport } from './input-assistance-state.ts'
import { inputSettingEnabled } from './input-assistance-settings.ts'

type EnabledForm = ConfigForm<{ enabled: boolean }>
const AssistanceContext = createContext<{ state: DraftAssistanceState; sync(): void; language: string; optimizationEnabled: boolean } | undefined>(undefined)
const transport: AssistTransport = {
  generate: async (request, signal) => {
    const response = await fetch(`${ASSISTANCE_PATH}/${request.kind}/action`, { method: 'POST', signal,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify(request) })
    if (!response.ok) throw new Error('Draft assistance unavailable')
    return await response.json() as DraftAssistResult
  },
  cancel: (request, reason) => {
    void fetch(`${ASSISTANCE_PATH}/${request.kind}/action`, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ cancel: request.requestId, reason, draftRev: request.draftRev }) }).catch(() => undefined)
  },
  report: (diagnostic, draftRev) => {
    void fetch(`${ASSISTANCE_PATH}/continuation/action`, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ diagnostic, draftRev }) }).catch(() => undefined)
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
  let editFrame: number | undefined
  let diagnosticTimer: ReturnType<typeof setTimeout> | undefined
  let diagnostic: ContinuationDiagnostic = 'edit-unavailable'
  let inputRevision = input.state.getSnapshot().draftRev
  let contextVersion = 0
  let events = binding.eventSource.getSnapshot().revision
  const state = new DraftAssistanceState({
    cancel: (request, reason) => api.cancel(request, reason),
    generate: async (request, signal) => { sync(); signal.throwIfAborted(); const result = await api.generate(request, signal); sync(); return result },
  }, () => {
    if (state.phase === 'idle' && state.text !== '') api.report?.(position() === undefined ? 'result-unpositioned' : 'result-shown', input.state.getSnapshot().draftRev)
    changed()
  })
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
    const snapshot = { sessionId, context: JSON.stringify([sessionId, contextVersion, model.getSnapshot(), connection.generation.getSnapshot()]),
      input: input.state.getSnapshot(), continuationEnabled: inputSettingEnabled(continuation),
      optimizationEnabled: inputSettingEnabled(optimization), atEnd: atEnd(),
      available: mounted && !blocked() && document.visibilityState === 'visible' && !composing && Date.now() >= compositionUntil
        && !menu.getSnapshot().open && !session.running && !session.removed && session.openState === 'open'
        && session.pendingSubmissions.length === 0 && (root.current?.checkVisibility?.({ checkVisibilityCSS: true, checkOpacity: true }) ?? true) }
    diagnostic = !snapshot.continuationEnabled ? 'edit-disabled' : !snapshot.available ? 'edit-unavailable'
      : !snapshot.atEnd ? 'edit-caret' : snapshot.input.phase !== 'plain' || snapshot.input.claim !== undefined
        || snapshot.input.attachmentIds.length > 0 || snapshot.input.occurrences.length > 0 || snapshot.input.queue.length > 0
        || snapshot.input.draft.length > 4000 ? 'edit-content' : snapshot.input.draft.replace(/\s/gu, '').length < 6 ? 'edit-short'
      : state.phase !== 'idle' ? 'edit-optimization' : 'edit-eligible'
    state.update(snapshot, false)
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
    const settledEdit = (revision: number) => {
      if (editFrame !== undefined) cancelAnimationFrame(editFrame)
      editFrame = requestAnimationFrame(() => {
        editFrame = undefined; sync(); state.edited(revision)
        clearTimeout(diagnosticTimer)
        diagnosticTimer = setTimeout(() => {
          sync()
          if (mounted && input.state.getSnapshot().draftRev === revision) api.report?.(diagnostic, revision)
        }, 800)
      })
    }
    const inputChanged = () => {
      const revision = input.state.getSnapshot().draftRev
      const edited = revision !== inputRevision; inputRevision = revision
      sync()
      // The public editor publishes its new revision before the browser finishes
      // reconciling the caret. Wait for its frame before reserving this revision.
      if (edited) settledEdit(revision)
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
        if (revision !== compositionRevision) settledEdit(revision)
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
      clearTimeout(diagnosticTimer)
      if (editFrame !== undefined) cancelAnimationFrame(editFrame)
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
    <Button variant="toolbar" size="sm" className="dshAiOptimizeTrigger" aria-label={label}
      icon={<Sparkles size={14} aria-hidden="true" />} title={limited ? (zh ? '为保留引用和命令，此草稿暂不支持优化' : 'References and commands cannot be replaced') : label}
      disabled={limited || !state.optimizationAvailable || state.phase !== 'idle'}
      onClick={() => { sync(); state.optimize() }}><span className="dshAiOptimizeTriggerLabel">{label}</span></Button>
    <Modal open={state.phase !== 'idle'} onClose={() => state.close()} title={label} closeLabel={zh ? '关闭' : 'Close'}
      className="dshAiOptimizeDialog" contentClassName="dshAiOptimizeDialogContent"
      description={zh ? '整理表达与结构，保留原意和约束。确认替换前，原草稿保持不变。' : 'Improve clarity and structure while preserving meaning and constraints. Your draft stays unchanged until you replace it.'}
      footer={<div className="dshAiOptimizeActions"><Button variant="outline" icon={<IconCloseOutlineRegular />} onClick={() => state.close()}>{zh ? '取消' : 'Cancel'}</Button>
        {state.phase === 'preview' && <Button variant="primary" icon={<IconCheckOutlineRegular />} onClick={() => { sync(); state.replace(inputActions) }}>{zh ? '替换草稿' : 'Replace draft'}</Button>}
        {(state.phase === 'error' || state.phase === 'empty') && <Button variant="primary" icon={<IconRefreshOutlineRegular />} onClick={() => { sync(); state.optimize() }}>{zh ? '重试' : 'Retry'}</Button>}</div>}>
      {state.phase === 'generating' && <div className="dshAiOptimizeStatus" role="status" aria-live="polite"><IconRefreshOutlineRegular className="dshAiOptimizeSpinner" size={24} /><p>{zh ? '正在优化草稿…' : 'Optimizing draft…'}</p></div>}
      {state.phase === 'empty' && <div className="dshAiOptimizeStatus" role="status"><Sparkles size={24} aria-hidden="true" /><p>{zh ? '未生成可用的修改，已保留原草稿。' : 'No usable changes. Your original draft is preserved.'}</p></div>}
      {state.phase === 'error' && <div className="dshAiOptimizeStatus" role="alert"><p>{zh ? '优化失败或超时，请重试。' : 'Optimization failed or timed out. Please retry.'}</p></div>}
      {state.phase === 'preview' && <div className="dshAiOptimizePreview">
        <section className="dshAiOptimizePane"><h3><FileText size={14} aria-hidden="true" />{zh ? '原文' : 'Original'}</h3><pre>{state.original}</pre></section>
        <section className="dshAiOptimizePane" data-result><h3><Sparkles size={14} aria-hidden="true" />{zh ? '优化后' : 'Optimized'}</h3><pre>{state.text}</pre></section>
        {state.notes.length > 0 && <section className="dshAiOptimizeNotes"><h3>{zh ? '待补充信息' : 'Missing information'}</h3><ul>{state.notes.map((note, i) => <li key={i}>{note}</li>)}</ul></section>}
      </div>}
    </Modal>
  </>
}
