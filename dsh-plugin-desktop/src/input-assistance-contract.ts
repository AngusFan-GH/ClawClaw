export const CONTINUATION_ENTRY = 'desktop-ai-continuation'
export const OPTIMIZATION_ENTRY = 'desktop-ai-draft-optimization'
export const ASSISTANCE_PATH = '/api/desktop/input-assistance'
// Reasoning and gateway routes can spend the original three-second budget
// before producing visible text. Keep a bounded call and a transport margin.
export const AUTOMATIC_ASSIST_TIMEOUT_MS = 10_000
export const AUTOMATIC_ASSIST_CLIENT_TIMEOUT_MS = 11_000
export const CONTINUATION_DIAGNOSTICS = ['edit-eligible', 'edit-disabled', 'edit-unavailable', 'edit-caret', 'edit-content', 'edit-short', 'edit-optimization', 'result-shown', 'result-unpositioned'] as const
export type ContinuationDiagnostic = typeof CONTINUATION_DIAGNOSTICS[number]
export const ASSIST_CANCELLATIONS = ['draft-edited', 'context-changed', 'unavailable', 'caret-moved', 'disabled', 'content-changed', 'interaction', 'optimization-started', 'closed', 'disposed', 'timeout'] as const
export type AssistCancellation = typeof ASSIST_CANCELLATIONS[number]
export type DraftAssistKind = 'continuation' | 'optimization'
export interface DraftAssistRequest {
  kind: DraftAssistKind
  sessionId: string
  requestId: string
  draft: string
  draftRev: number
}
export interface DraftAssistResult {
  requestId: string
  draftRev: number
  text: string
  notes: readonly string[]
}

/** Keep whitespace at the join: trimming an English suffix joins two words. */
export function continuationText(value: unknown, draft: string): string {
  if (typeof value !== 'string' || value.trim() === '' || value.length > 300
    || /[\u0000-\u0008\u000b-\u001f<>]/u.test(value)
    || /^\s*(?:```|[-*•]\s|(?:sure|here is|certainly)\b)/iu.test(value)) return ''
  const suffix = value.trim().toLocaleLowerCase()
  const source = draft.trim().toLocaleLowerCase()
  const lastLine = source.split('\n').at(-1) ?? ''
  if (source !== '' && (suffix.startsWith(source) || (lastLine !== '' && suffix.startsWith(lastLine)))) return ''
  return value
}

/** A malformed/truncated JSON response must never become replacement prose. */
export function optimizationValue(value: unknown): { text: string; notes: readonly string[] } | undefined {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return undefined
  const record = value as Record<string, unknown>
  if (typeof record.optimized !== 'string' || record.optimized.length > 8000
    || !Array.isArray(record.notes) || record.notes.length > 12
    || record.notes.some(note => typeof note !== 'string' || note.length > 500)) return undefined
  return { text: record.optimized.trim(), notes: (record.notes as string[]).map(note => note.trim()).filter(Boolean) }
}
