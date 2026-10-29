import type { AssistantChatData } from '@deepseek-ai/dsh-client-ui-chat/client'

export type GenuiTextPart = { kind: 'text'; text: string } | { kind: 'result'; id: string } | { kind: 'pending' }

/** Only standalone references outside fenced/indented code are presentation markers. */
export function splitGenuiText(text: string): GenuiTextPart[] {
  const parts: GenuiTextPart[] = []
  let start = 0
  let offset = 0
  let fence: { char: string; length: number } | undefined
  for (const raw of text.match(/[^\n]*\n|[^\n]+$/g) ?? []) {
    const line = raw.replace(/\r?\n$/, '')
    const delimiter = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    if (delimiter) {
      if (!fence) fence = { char: delimiter[1]![0]!, length: delimiter[1]!.length }
      else if (delimiter[1]![0] === fence.char && delimiter[1]!.length >= fence.length && !delimiter[2]!.trim()) fence = undefined
    } else if (!fence) {
      const match = /^ {0,3}\[\[clawclaw-ui:([^\]\r\n]+)\]\][ \t]*$/.exec(line)
      let id: string | undefined
      if (match) try { id = decodeURIComponent(match[1]!) } catch { /* Keep invalid references as literal text. */ }
      const pending = !match && /^ {0,3}\[\[clawclaw-ui:[^\]\r\n]*$/.test(line) && offset + raw.length === text.length
      if (id?.trim() && id.length <= 160 || pending) {
        if (offset > start) parts.push({ kind: 'text', text: text.slice(start, offset) })
        parts.push(pending ? { kind: 'pending' } : { kind: 'result', id: id! })
        start = offset + raw.length
      }
    }
    offset += raw.length
  }
  if (start < text.length) parts.push({ kind: 'text', text: text.slice(start) })
  return parts
}

/** Cross-segment reference definitions require one native Markdown pass; retain tail placement. */
export function canPlaceGenuiText(text: string): boolean {
  return !/^ {0,3}\[[^\]\n]+\]:/m.test(text)
}

export function inlineGenuiIds(assistants: readonly AssistantChatData[], answerStep: number | null | undefined): Set<string> {
  const ids = new Set<string>()
  for (const assistant of assistants) {
    if (assistant.step !== answerStep || assistant.status !== 'settled') continue
    for (const block of assistant.blocks) if (block.kind === 'text' && canPlaceGenuiText(block.text)) {
      for (const part of splitGenuiText(block.text)) if (part.kind === 'result') ids.add(part.id)
    }
  }
  return ids
}
