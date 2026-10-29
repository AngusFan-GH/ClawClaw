import type { ToolExecution } from '@deepseek-ai/dsh-tools'

/** A presentation choice, not a general browser/security policy. Research URLs remain available. */
export function inlinePresentationReason(request: string, name: string, args: unknown): string | undefined {
  if (!/(?:^|[_.])browser_navigate$/.test(name)) return
  if (!args || typeof args !== 'object' || !('url' in args) || typeof args.url !== 'string') return
  let url: URL
  try { url = new URL(args.url) } catch { return }
  if (url.protocol !== 'file:' && !(['http:', 'https:'].includes(url.protocol)
    && ['localhost', '127.0.0.1', '[::1]'].includes(url.hostname))) return
  const inline = /(?:对话|聊天|消息).{0,40}(?:展示|显示|讲解|交互|卡片|图表|html)|(?:展示|显示|呈现|渲染|嵌入).{0,12}(?:对话|聊天|消息)|交互式卡片|内联展示|\b(?:show|display|render).{0,60}(?:inline|in (?:this |the )?(?:chat|conversation))\b/iu.test(request)
  if (!inline) return
  const positive = request.replace(/(?:不要|无需|不用|不需要|别).{0,8}浏览器/gu, '').replace(/\b(?:do not|don't|without|no need to).{0,20}browser\b/giu, '')
  if (/(?:打开|使用|通过|用)浏览器|在浏览器|浏览器(?:中|里|预览|测试|验证)|\b(?:open|use).{0,15}browser\b|\bin (?:the |a )?browser\b/iu.test(positive)) return
  return '本轮用户要求在对话内展示，不能将本地页面导航到浏览器。clawclaw_validate_ui 只校验，不会展示。请将完整 HTML 放入 html 组件，使用 document_json 调用 clawclaw_render_ui，完成内联渲染。Do not open a local browser as a substitute for the requested inline result.'
}

export function genuiPresentationGuard(exec: Readonly<ToolExecution>): string | undefined {
  if (!/(?:^|[_.])browser_navigate$/.test(exec.name)) return
  const events = exec.agent?.session.snapshotEvents()
  const latest = events?.findLast(event => event.type === 'user/message' && event.data.source.kind === 'user')
  if (latest?.type !== 'user/message') return
  const text = latest.data.content.filter(block => block.type === 'text').map(block => block.text).join('\n')
  return inlinePresentationReason(text, exec.name, exec.arguments)
}
