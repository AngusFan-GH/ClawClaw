import type { SessionId } from '@deepseek-ai/dsh-session/types'

export const DESKTOP_SELECTION_SIDECHAT_PATH = '/api/desktop/selection-sidechat'
export const DESKTOP_SELECTION_SIDECHAT_CREATE_PATH = `${DESKTOP_SELECTION_SIDECHAT_PATH}/create`

export interface SelectionSideChatCreateRequest {
  readonly parentSessionId: SessionId
}

export interface SelectionSideChatCreateResult {
  readonly sessionId: SessionId
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Selection side-chat payload must be an object')
  }
  return value as Record<string, unknown>
}

export function parseSelectionSideChatCreateRequest(value: unknown): SelectionSideChatCreateRequest {
  const input = record(value)
  if (typeof input.parentSessionId !== 'string' || input.parentSessionId.trim() === '') {
    throw new TypeError('Selection side-chat parentSessionId must be a non-empty string')
  }
  return { parentSessionId: input.parentSessionId as SessionId }
}

export function parseSelectionSideChatCreateResult(value: unknown): SelectionSideChatCreateResult {
  const output = record(value)
  if (typeof output.sessionId !== 'string' || output.sessionId === '') {
    throw new TypeError('Selection side-chat response has no sessionId')
  }
  return { sessionId: output.sessionId as SessionId }
}
