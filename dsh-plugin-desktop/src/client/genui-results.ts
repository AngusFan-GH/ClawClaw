import type { ToolChatData, ToolResultNode } from '@deepseek-ai/dsh-client-ui-chat/client'
import { GENUI_RENDER_TOOL, type GenuiNode } from '../genui-contract.ts'
import { validateGenuiDocument } from '../genui-core.ts'

export function genuiResultId(result: ToolResultNode): string | undefined {
  const parsed = validateGenuiDocument(result.meta)
  return parsed.ok ? parsed.document.resultId : undefined
}

const containsHtml = (nodes: GenuiNode[]): boolean => nodes.some(node => node.type === 'html'
  || (node.type === 'card' || node.type === 'row') && containsHtml(node.items))

/** Unnamed HTML is one replaceable interactive area per turn; explicit IDs stay independent. */
export function genuiResults(tools: readonly ToolChatData[]): ToolResultNode[] {
  const calls = new Map<string, ToolResultNode>()
  const visit = (block: ToolChatData['root']): void => {
    if ('kind' in block && block.name === GENUI_RENDER_TOOL && !block.isError) {
      const previous = calls.get(block.callId)
      if (!previous || block.seq > previous.seq) calls.set(block.callId, block)
    }
    for (const child of block.subCalls) visit(child)
  }
  for (const tool of tools) visit(tool.root)
  const results = new Map<string, ToolResultNode>()
  for (const result of [...calls.values()].sort((a, b) => a.seq - b.seq)) {
    const parsed = validateGenuiDocument(result.meta)
    // Invalid updates must not replace a working result; their saved text stays visible separately.
    const id = parsed.ok ? parsed.document.resultId : undefined
    const key = id !== undefined ? `result:${id}`
      : parsed.ok && containsHtml(parsed.document.items) ? 'html:default' : `call:${result.callId}`
    results.set(key, result)
  }
  return [...results.values()]
}

/** Retained for callers that need the last successful tool event. */
export function latestGenuiResult(tools: readonly ToolChatData[]): ToolResultNode | undefined {
  return genuiResults(tools).reduce<ToolResultNode | undefined>((latest, result) =>
    latest === undefined || result.seq > latest.seq ? result : latest, undefined)
}
