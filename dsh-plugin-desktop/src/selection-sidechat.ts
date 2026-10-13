/** Private host endpoint for selection-scoped side conversations. */

import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-agent'
import type {} from '@deepseek-ai/dsh-host-webserver'
import type {} from '@deepseek-ai/dsh-subagent'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type {} from '@deepseek-ai/dsh-tools'

export const DESKTOP_SELECTION_SIDECHAT_PATH = '/api/desktop/selection-sidechat'
export const SELECTION_SIDECHAT_MAX_CHARS = 4_000
export const SELECTION_SIDECHAT_MAX_HISTORY = 8
const BODY_LIMIT = 64 * 1024
const TIMEOUT_MS = 180_000
const READ_ONLY_TOOL_NAMES = Object.freeze([
  'read', 'glob', 'grep', 'read_image',
  'web_search', 'web_fetch', 'read_page',
  'session_search', 'session_trace', 'session_event_read', 'session_event_search',
  'job_list', 'job_output',
])

interface SideChatTurn { readonly answer: string; readonly question: string }
interface SideChatRequest {
  readonly history: readonly SideChatTurn[]
  readonly question: string
  readonly selection: string
  readonly sessionId: string
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

export function parseSelectionSideChatRequest(value: unknown): SideChatRequest {
  if (!isRecord(value) || typeof value.sessionId !== 'string' || value.sessionId.trim() === ''
    || typeof value.selection !== 'string' || value.selection.trim() === ''
    || typeof value.question !== 'string' || value.question.trim() === ''
    || !Array.isArray(value.history)) throw new Error('Invalid side-chat request')
  const history = value.history.slice(-SELECTION_SIDECHAT_MAX_HISTORY).map(item => {
    if (!isRecord(item) || typeof item.question !== 'string' || typeof item.answer !== 'string') {
      throw new Error('Invalid side-chat history')
    }
    return Object.freeze({ question: item.question.slice(0, 2_000), answer: item.answer.slice(0, 8_000) })
  })
  return Object.freeze({
    sessionId: value.sessionId,
    selection: value.selection.trim().slice(0, SELECTION_SIDECHAT_MAX_CHARS),
    question: value.question.trim().slice(0, 2_000),
    history: Object.freeze(history),
  })
}

export function selectionSideChatPrompt(request: SideChatRequest): string {
  const history = request.history.length === 0 ? '' : `\n\n此前追问：\n${request.history.map(turn => `用户：${turn.question}\n助手：${turn.answer}`).join('\n\n')}`
  return `请只围绕下面的引用内容回答问题。不要修改文件、调用外部服务或执行操作；信息不足时明确说明。\n\n引用内容：\n<quote>\n${request.selection}\n</quote>${history}\n\n当前问题：${request.question}`
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let bytes = 0
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    bytes += buffer.byteLength
    if (bytes > BODY_LIMIT) throw new Error('Request body is too large')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown
}

function answerText(output: readonly unknown[]): string {
  return output.flatMap(block => isRecord(block) && block.type === 'text' && typeof block.text === 'string' ? [block.text] : []).join('\n').trim()
}

function writeJson(res: ServerResponse, status: number, value: unknown): void {
  if (res.destroyed || res.writableEnded) return
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(value))
}

/** Keep the reading assistant inside the live registry's known, non-mutating tools. */
export function selectionSideChatToolFilter(ctx: Context): { readonly allow: readonly string[] } | undefined {
  const tools = ctx.get('tools')
  if (tools === undefined) return undefined
  try {
    const known = new Set(tools.schemas().map(schema => schema.name))
    return Object.freeze({ allow: Object.freeze(READ_ONLY_TOOL_NAMES.filter(name => known.has(name))) })
  } catch {
    return undefined
  }
}

export interface SelectionSideChatRegistrationOptions {
  readonly authorize: (req: IncomingMessage, res: ServerResponse) => boolean
  readonly rendererOrigin: string
}

export function registerSelectionSideChatApi(ctx: Context, options: SelectionSideChatRegistrationOptions): void {
  ctx.effect(() => ctx.webServer.register({
    kind: 'exact', path: DESKTOP_SELECTION_SIDECHAT_PATH,
    handler: async (req: IncomingMessage, res: ServerResponse) => {
      if (options.authorize(req, res)) return
      if (req.method !== 'POST' || req.headers.origin !== options.rendererOrigin) {
        writeJson(res, 405, { error: 'Method not allowed' })
        return
      }
      let request: SideChatRequest
      try { request = parseSelectionSideChatRequest(await readJson(req)) } catch (cause) {
        writeJson(res, 400, { error: cause instanceof Error ? cause.message : String(cause) })
        return
      }
      const agents = ctx.get('agents')
      const subagents = ctx.get('subagents')
      const parent = agents?.get(request.sessionId as SessionId)
      if (parent === undefined) {
        writeJson(res, 409, { error: '当前会话没有活动的智能体，请在进行中的会话里发起侧边提问。' })
        return
      }
      const providers = subagents?.list() ?? []
      const supportsReadOnly = (name: string) => subagents?.getProvider(name)?.capabilities.toolFilter === true
      const provider = providers.includes('spawn') && supportsReadOnly('spawn')
        ? 'spawn'
        : providers.find(supportsReadOnly)
      if (provider === undefined) {
        writeJson(res, 503, { error: '当前组合没有支持只读隔离的独立作答引擎。' })
        return
      }
      const toolFilter = selectionSideChatToolFilter(ctx)
      if (toolFilter === undefined) {
        writeJson(res, 503, { error: '当前组合无法建立只读工具边界。' })
        return
      }
      const controller = new AbortController()
      const abortOnClose = () => { if (!res.writableEnded) controller.abort() }
      res.once('close', abortOnClose)
      const timer = setTimeout(() => { controller.abort() }, TIMEOUT_MS)
      timer.unref?.()
      let run: Awaited<ReturnType<NonNullable<typeof subagents>['start']>> | undefined
      try {
        if (subagents === undefined) throw new Error('当前组合没有可用的独立作答引擎。')
        const descriptor = subagents.getProvider(provider)
        run = await subagents.start(provider, {
          label: `侧边提问：${request.question.slice(0, 36)}`,
          prompt: [{ type: 'text', text: selectionSideChatPrompt(request) }],
          parent,
          signal: controller.signal,
          toolFilter,
          ...(descriptor?.capabilities.persona === true ? { persona: '你是简洁、严谨的阅读助手，只回答用户围绕引用内容提出的问题。' } : {}),
        })
        const result = await run.result
        const answer = answerText(result.output)
        if (result.stopReason !== 'completed' || answer === '') {
          throw new Error(result.diagnostic ?? (result.stopReason === 'aborted' ? '作答已超时或取消。' : `作答未完成：${result.stopReason}`))
        }
        writeJson(res, 200, { answer })
      } catch (cause) {
        writeJson(res, controller.signal.aborted ? 504 : 500, { error: cause instanceof Error ? cause.message : String(cause) })
      } finally {
        clearTimeout(timer)
        res.off('close', abortOnClose)
        await run?.dispose().catch(() => undefined)
      }
    },
  }), 'dsh-plugin-desktop: private selection side-chat route')
}
