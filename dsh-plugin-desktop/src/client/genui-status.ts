import type { ToolChatData, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { GENUI_RENDER_TOOL, GENUI_VALIDATE_TOOL, GENUI_ROUTING_MARKER } from '../genui-contract.ts'
export type GenuiActivity = 'generating' | 'redirecting' | 'failed'

/** Public feedback comes from real tool lifecycle, never from guessed model prose. */
export function genuiActivity(tools: readonly ToolChatData[], closed: boolean): GenuiActivity | undefined {
  let pending = false
  let rendered = false
  let latest: ToolResultNode | undefined
  const visit = (block: ToolChatData['root']): void => {
    const relevant = block.name === GENUI_RENDER_TOOL || block.name === GENUI_VALIDATE_TOOL
    if ('kind' in block) {
      const redirected = block.isError && block.content.some(item => item.type === 'text' && item.text.includes(GENUI_ROUTING_MARKER))
      if ((relevant || redirected) && (!latest || block.seq > latest.seq)) latest = block
      if (block.name === GENUI_RENDER_TOOL && !block.isError) rendered = true
    } else if (relevant) pending = true
    for (const child of block.subCalls) visit(child)
  }
  for (const tool of tools) visit(tool.root)
  if (pending) return closed ? 'failed' : 'generating'
  if (!latest) return undefined
  if (latest.name === GENUI_RENDER_TOOL && !latest.isError) return undefined
  // Validation never turns a working result into a failure notice.
  if (rendered && latest.name === GENUI_VALIDATE_TOOL) return undefined
  if (closed) return 'failed'
  return latest.content.some(item => item.type === 'text' && item.text.includes(GENUI_ROUTING_MARKER)) ? 'redirecting' : 'generating'
}
