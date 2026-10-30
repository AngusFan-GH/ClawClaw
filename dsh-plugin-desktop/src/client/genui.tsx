import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import { genuiActivity, type GenuiActivity } from './genui-status.ts'
import { useMemo, useState, useSyncExternalStore } from 'react'
import type { Context } from '@deepseek-ai/cordis'
import type { ToolCallViewProps } from '@deepseek-ai/dsh-client-ui-tool/client'
import type { AssistantChatData, ChatSnapshot, ToolChatData, TurnProcessChatData } from '@deepseek-ai/dsh-client-ui-chat/client'
import type { ObservableSnapshot } from '@deepseek-ai/dsh-client-store'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import { GENUI_ENTRY, GENUI_RENDER_TOOL, type GenuiSettings } from '../genui-contract.ts'
import { GENUI_STYLES } from './genui-styles.ts'
import { GenuiTextFallback } from './genui-text-fallback.tsx'
import { GenuiResultView } from './genui-result.tsx'
import { genuiResultId, genuiResults } from './genui-results.ts'
import { inlineGenuiIds } from './genui-placement.ts'
import { installGenuiInline } from './genui-inline.tsx'
export { GenuiResultView, type GenuiResultViewProps } from './genui-result.tsx'
export { genuiResults, latestGenuiResult } from './genui-results.ts'

export function GenuiToolView(props: ToolCallViewProps & { zh?: boolean }) {
  if (props.phase !== 'result') return <p role="status">{props.zh ? '正在生成交互内容…' : 'Generating interactive content…'}</p>
  // The answer owns the interactive instance. Expanding tool history must
  // not run old attempts again or create competing copies of the same iframe.
  return <div className="clawGenuiToolSummary"><p>{props.block.isError
    ? (props.zh ? '本次生成未完成。' : 'This generation attempt did not complete.')
    : (props.zh ? '已提交交互内容，见本轮回答。' : 'Interactive content submitted. See this turn’s answer.')}</p>
    <details><summary>{props.zh ? '查看工具记录' : 'View tool record'}</summary>
      <pre className="clawGenuiFallback">{props.block.content.filter(block => block.type === 'text').map(block => block.text).join('\n')}</pre>
    </details>
  </div>
}

export type GenuiTurnTailProps = PropsRuntime<'conversation.chat.turnTail'> & {
  chat: ObservableSnapshot<ChatSnapshot | undefined>
  zh: boolean
  retry?: (turn: number) => Promise<void>
  placement?: ObservableSnapshot<boolean>
}

const EMPTY_TOOL_DATA: readonly ToolChatData[] = []
const EMPTY_TOOL_SOURCE: ObservableSnapshot<readonly ToolChatData[]> = {
  getSnapshot: () => EMPTY_TOOL_DATA, subscribe: () => () => {},
}
const EMPTY_DATA: readonly never[] = []
const EMPTY_SOURCE = { getSnapshot: () => EMPTY_DATA, subscribe: () => () => {} }
const NO_PLACEMENT = { getSnapshot: () => false, subscribe: () => () => {} }

function GenuiStatus({ activity, zh, retry, hasResults }: { activity: GenuiActivity; zh: boolean; retry: (() => Promise<void>) | undefined; hasResults: boolean }) {
  const [attempt, setAttempt] = useState<'idle' | 'sending' | 'sent' | 'error'>('idle')
  const message = activity === 'redirecting' ? (zh ? '正在改为对话内展示…' : 'Preparing an inline result…')
    : activity === 'generating' ? (zh ? '正在生成交互内容…' : 'Generating interactive content…')
    : hasResults ? (zh ? '部分交互内容未能显示，已保留可用结果。' : 'Some interactive content could not be displayed. Available results are kept.')
    : (zh ? '交互内容未能显示，可请求重新生成。' : 'Interactive content could not be displayed. You can request regeneration.')
  return <div className="clawGenuiStatus" role="status"><span>{message}</span>
    {activity === 'failed' && retry && <button type="button" title={zh ? '请求助手在后续回答中重新生成内容' : 'Ask the assistant to regenerate this content in a follow-up answer'} disabled={attempt === 'sending' || attempt === 'sent'} onClick={() => {
      setAttempt('sending')
      void retry().then(() => setAttempt('sent')).catch(() => setAttempt('error'))
    }}>{attempt === 'sending' ? (zh ? '正在发送…' : 'Sending…') : attempt === 'sent' ? (zh ? '已发送请求' : 'Request sent') : (zh ? '请求重新生成' : 'Request regeneration')}</button>}
    {attempt === 'sent' && <span>{zh ? '请在后续回答中查看重新生成的内容。' : 'Look for the regenerated content in a follow-up answer.'}</span>}
    {attempt === 'error' && <span>{zh ? '重新生成请求发送失败，请再试一次。' : 'The regeneration request could not be sent. Please try again.'}</span>}
  </div>
}

/** The completed answer's public tail stays visible when its process is collapsed. */
export function GenuiTurnTail({ chat, sessionId, turn, zh, retry, placement = NO_PLACEMENT }: GenuiTurnTailProps) {
  const snapshot = useSyncExternalStore(listener => chat.subscribe(listener), () => chat.getSnapshot())
  const tools = snapshot?.nodes.turnDataSource(turn.turn, 'tool-call') ?? EMPTY_TOOL_SOURCE
  const data = useSyncExternalStore(listener => tools.subscribe(listener), () => tools.getSnapshot())
  const assistantSource = snapshot?.nodes.turnDataSource(turn.turn, 'assistant-step') ?? EMPTY_SOURCE
  const processSource = snapshot?.nodes.turnDataSource(turn.turn, 'turn-process') ?? EMPTY_SOURCE
  const assistants = useSyncExternalStore<readonly AssistantChatData[]>(listener => assistantSource.subscribe(listener), () => assistantSource.getSnapshot())
  const processes = useSyncExternalStore<readonly TurnProcessChatData[]>(listener => processSource.subscribe(listener), () => processSource.getSnapshot())
  const enabled = useSyncExternalStore(listener => placement.subscribe(listener), () => placement.getSnapshot())
  const results = useMemo(() => genuiResults(data), [data])
  const answerStep = processes[0]?.answerStep
  const references = useMemo(() => enabled ? inlineGenuiIds(assistants, answerStep) : new Set<string>(), [enabled, assistants, answerStep])
  let awaitingPlacement = false
  const visible = results.filter(result => {
    const id = genuiResultId(result)
    if (id !== undefined && references.has(id)) return false
    // Do not start an iframe at the tail and remount it in the answer seconds later.
    if (enabled && id !== undefined && turn.status === 'open' && answerStep == null) { awaitingPlacement = true; return false }
    return true
  })
  const activity = turn.status === 'unknown' ? undefined : genuiActivity(data, turn.status === 'closed' || (snapshot?.legacy?.turnEnds.has(turn.turn) ?? false))
    ?? (awaitingPlacement ? 'generating' : undefined)
  if (visible.length === 0 && activity === undefined) return null
  return <div className="clawGenuiResults">
    {activity === 'failed' && results.length === 0 && snapshot && <GenuiTextFallback snapshot={snapshot} turn={turn.turn} zh={zh} />}
    {activity && <GenuiStatus activity={activity} zh={zh} retry={retry ? () => retry(turn.turn) : undefined} hasResults={results.length > 0} />}
    {visible.map(result => <GenuiResultView key={JSON.stringify([sessionId, result.callId])}
    sessionId={String(sessionId)} callId={result.callId} meta={result.meta} isError={false} {...(retry === undefined ? {} : { repair: () => retry(turn.turn) })}
    text={result.content.filter(block => block.type === 'text').map(block => block.text).join('\n')} zh={zh} />)}</div>
}

/** Follow confirmed Host settings; disabled mode keeps only readable historical text. */
export function applyDesktopGenui(ctx: Context): void {
  ctx.inject(['slots', 'configForms', 'locale', 'uiConversation', 'sessions'], scope => {
    const settings = scope.configForms.get<GenuiSettings>(GENUI_ENTRY)
    scope.effect(() => {
      const retry = async (sessionId: Parameters<ISessions['binding']>[0], failedTurn: number) => {
        const sessions = scope.get('sessions') as unknown as ISessions
        const target = sessions.binding(sessionId)?.session
        if (!target) throw new Error('Conversation unavailable')
        const zh = scope.locale.getSnapshot().active.startsWith('zh')
        const response = await target.prompt([{ type: 'text', text: zh
          ? `请修复并重新展示当前对话第 ${failedTurn} 轮无法显示或操作出错的交互内容。检查完整脚本和所有按钮函数，沿用原对话语言和已有说明，直接内联渲染，不要用浏览器页面代替。`
          : `Fix and redisplay the interactive content in turn ${failedTurn}. Check the complete script and every button handler. Keep the original conversation language and explanation. Render inline instead of opening a browser.` }], 'queue')
        if (!response.ok) throw new Error(response.error.message)
      }
      // Keep historical placement references readable even when visuals are off.
      const inline = installGenuiInline(scope, (id, turn) => retry(id as never, turn), {
        getSnapshot: () => settings.getSnapshot().value?.enabled === true,
        subscribe: listener => settings.subscribe(listener),
      })
      let dispose: (() => void) | undefined
      const reconcile = (): void => {
        if (settings.getSnapshot().value?.enabled !== true) { dispose?.(); dispose = undefined; return }
        if (dispose !== undefined) return
        const style = document.createElement('style')
        style.dataset.clawGenui = ''
        style.textContent = GENUI_STYLES
        document.head.appendChild(style)
        try {
          const stopTool = scope.slots.inject('tool.call.toolview', () => scope.slots.register({
            name: 'tool.call.toolview', key: GENUI_RENDER_TOOL,
          }, function LocalizedGenuiToolView(props) {
            const locale = useSyncExternalStore(listener => scope.locale.subscribe(listener), () => scope.locale.getSnapshot())
            return <GenuiToolView {...props} zh={locale.active.startsWith('zh')} />
          }))
          let stopTail: () => void
          try {
            stopTail = scope.slots.inject('conversation.chat.turnTail', () => scope.slots.register({
              name: 'conversation.chat.turnTail', id: GENUI_ENTRY, order: 0,
              inject: sessionId => ({ chat: scope.uiConversation.binding(sessionId).target('chat'), placement: inline.available,
                retry: (turn: number) => retry(sessionId, turn),
              }),
            }, function LocalizedGenuiTurnTail(props) {
              const locale = useSyncExternalStore(listener => scope.locale.subscribe(listener), () => scope.locale.getSnapshot())
              return <GenuiTurnTail {...props} zh={locale.active.startsWith('zh')} />
            }))
          } catch (cause) { stopTool(); throw cause }
          dispose = () => { stopTail(); stopTool(); style.remove() }
        } catch (cause) { style.remove(); throw cause }
      }
      const stop = settings.subscribe(reconcile)
      try { reconcile() } catch (cause) { stop(); inline.dispose(); throw cause }
      return () => { stop(); dispose?.(); inline.dispose() }
    }, 'desktop: optional GenUI result cards')
  })
}
