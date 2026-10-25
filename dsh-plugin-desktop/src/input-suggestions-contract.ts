/** Browser-safe wire contract; credentials and conversation text stay on the Host. */
export const INPUT_SUGGESTIONS_ENTRY = 'desktop-input-suggestions'
export const INPUT_SUGGESTIONS_NAMESPACE = 'dsh-desktop-input-suggestions'
export const INPUT_SUGGESTIONS_PATH = '/api/desktop/input-suggestions'
export interface InputSuggestionsSettings { enabled: boolean }
export interface SuggestionRequest { sessionId: string; requestId: string; endSeq: number }
export interface SuggestionResult { text: string; requestId: string; endSeq: number }
export const SUGGESTION_CLIENT_DIAGNOSTICS = ['completion-eligible', 'completion-running', 'completion-input', 'completion-hidden', 'completion-menu', 'shown', 'transport-failed'] as const
export type SuggestionClientDiagnostic = typeof SUGGESTION_CLIENT_DIAGNOSTICS[number]

export function suggestionText(value: unknown): string {
  if (typeof value !== 'string') return ''
  const text = value.trim()
  if (text.length < 2 || text.length > 240 || /[\r\n\u0000-\u001f]/u.test(text)) return ''
  if (/^(?:[-*#>`"“]|\d+[.)、]|suggestion\s*:|建议[：:]|下一步[：:])/iu.test(text)) return ''
  if (/(?:\.\.\.|…|[:：,，;；])$/u.test(text) || /[<>{}]/u.test(text)) return ''
  return text
}
