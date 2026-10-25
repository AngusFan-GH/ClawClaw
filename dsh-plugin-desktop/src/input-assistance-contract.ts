export const CONTINUATION_ENTRY = 'desktop-ai-continuation'
export const OPTIMIZATION_ENTRY = 'desktop-ai-draft-optimization'
export const ASSISTANCE_PATH = '/api/desktop/input-assistance'
// Reasoning and gateway routes can spend the original three-second budget
// before producing visible text. Keep a bounded call and a transport margin.
export const AUTOMATIC_ASSIST_TIMEOUT_MS = 10_000
export const AUTOMATIC_ASSIST_CLIENT_TIMEOUT_MS = 11_000
export const OPTIMIZATION_TIMEOUT_MS = 60_000
export const OPTIMIZATION_CLIENT_TIMEOUT_MS = 61_000
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
  error?: 'failed' | 'timeout' | 'unavailable' | 'busy'
}
export interface DraftAssistProgress {
  requestId: string
  draftRev: number
  channel: 'reasoning' | 'text'
  delta: string
}

/** Locate a top-level string field without mistaking quoted/nested data for a key. */
function optimizedStringStart(raw: string): number | undefined {
  const prefix = /^\s*\{/u.exec(raw)
  if (prefix === null) return undefined
  let depth = 1, key = true
  for (let i = prefix[0].length; i < raw.length; i++) {
    const char = raw[i]!
    if (char === '"') {
      const start = i++
      for (; i < raw.length; i++) {
        if (raw[i] === '\\') i++
        else if (raw[i] === '"') break
      }
      if (i >= raw.length) return undefined
      if (depth === 1 && key) {
        let name: unknown
        try { name = JSON.parse(raw.slice(start, i + 1)) } catch { return undefined }
        key = false
        if (name === 'optimized') {
          const value = /^\s*:\s*"/u.exec(raw.slice(i + 1))
          return value === null ? undefined : i + 1 + value[0].length
        }
      }
    } else if (char === '{' || char === '[') depth++
    else if (char === '}' || char === ']') { if (--depth === 0) return undefined }
    else if (char === ',' && depth === 1) key = true
  }
  return undefined
}

/** Decode a partial optimized string for display; never an adoptable result. */
export function optimizationPreview(raw: string): string {
  const start = optimizedStringStart(raw)
  if (start === undefined) return ''
  let text = ''
  for (let i = start; i < raw.length && text.length < 8000; i++) {
    const char = raw[i]!
    if (char === '"') break
    if (char !== '\\') { if (char < ' ') return ''; text += char; continue }
    const escaped = raw[++i]
    if (escaped === undefined) break
    if (escaped === 'u') {
      const hex = raw.slice(i + 1, i + 5)
      if (hex.length < 4) break
      if (!/^[\da-f]{4}$/iu.test(hex)) return ''
      text += String.fromCharCode(parseInt(hex, 16)); i += 4
    } else {
      const replacements: Record<string, string> = { '"': '"', '\\': '\\', '/': '/', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t' }
      if (replacements[escaped] === undefined) return ''
      text += replacements[escaped]
    }
  }
  // Do not display half of an escaped surrogate pair at a chunk boundary.
  return /[\ud800-\udbff]$/u.test(text) ? text.slice(0, -1) : text
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
