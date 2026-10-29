import { useSyncExternalStore } from 'react'
import { MarkdownText } from '@deepseek-ai/dsh-client-ui-primitives'
import type { ChatSnapshot } from '@deepseek-ai/dsh-client-ui-chat/client'

/** Recover saved prose only when a failed visual turn has no public answer. */
export function GenuiTextFallback({ snapshot, turn, zh }: { snapshot: ChatSnapshot; turn: number; zh: boolean }) {
  const assistantSource = snapshot.nodes.turnDataSource(turn, 'assistant-step')
  const processSource = snapshot.nodes.turnDataSource(turn, 'turn-process')
  const assistants = useSyncExternalStore(listener => assistantSource.subscribe(listener), () => assistantSource.getSnapshot())
  const processes = useSyncExternalStore(listener => processSource.subscribe(listener), () => processSource.getSnapshot())
  if (processes[0]?.answerAnchorSeq !== null) return null
  const last = assistants.findLast(assistant => assistant.blocks.some(block => block.kind === 'text' && block.text.trim()))
  const text = last?.blocks.flatMap(block => block.kind === 'text' ? [block.text] : []).join('\n')
  return text?.trim() ? <div className="clawGenuiTextFallback" tabIndex={0} role="region" aria-label={zh ? '已生成的文字说明' : 'Saved explanation'}><MarkdownText text={text} streaming={false} labels={{
    code: { copyLabel: zh ? '复制' : 'Copy', copiedLabel: zh ? '已复制' : 'Copied', toolbarLabels: {
      codeLabel: zh ? '代码' : 'Code', wrapLabel: zh ? '自动换行' : 'Wrap', unwrapLabel: zh ? '取消换行' : 'Unwrap',
    } }, footnotes: zh ? '脚注' : 'Footnotes',
  }} /></div> : null
}
