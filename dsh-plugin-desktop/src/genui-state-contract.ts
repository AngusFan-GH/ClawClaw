/** Only bounded JSON presentation state crosses the iframe boundary. */
export const GENUI_STATE_PATH = '/api/desktop/genui-state'
export interface GenuiHtmlState {
  controls: { index: number; value: string; checked?: boolean; selected?: number[] }[]
  custom: unknown
}
export interface GenuiStateIdentity { sessionId: string; callId: string; path: string; sourceHash: string }
export function validHtmlState(value: unknown): value is GenuiHtmlState {
  let nodes = 0
  const json = (v: unknown, depth: number): boolean => {
    if (++nodes > 1000 || depth > 8) return false
    if (v === null || typeof v === 'boolean') return true
    if (typeof v === 'number') return Number.isFinite(v)
    if (typeof v === 'string') return v.length <= 2000
    if (typeof v !== 'object') return false
    if (Array.isArray(v)) return v.length <= 100 && v.every(x => json(x, depth + 1))
    if (Object.getPrototypeOf(v) !== Object.prototype && Object.getPrototypeOf(v) !== null) return false
    return Object.entries(v).length <= 100 && Object.entries(v).every(([k, x]) => !['__proto__', 'constructor', 'prototype'].includes(k) && json(x, depth + 1))
  }
  try {
    if (!json(value, 0) || new TextEncoder().encode(JSON.stringify(value)).length > 16 * 1024) return false
    const state = value as GenuiHtmlState
    return Array.isArray(state.controls) && 'custom' in state && state.controls.every(item => Number.isSafeInteger(item.index)
      && item.index >= 0 && item.index < 100 && typeof item.value === 'string'
      && (item.checked === undefined || typeof item.checked === 'boolean')
      && (item.selected === undefined || Array.isArray(item.selected) && item.selected.every(i => Number.isSafeInteger(i) && i >= 0 && i < 1000)))
  } catch { return false }
}
