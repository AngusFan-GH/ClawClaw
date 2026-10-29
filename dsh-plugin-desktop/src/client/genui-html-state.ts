import { GENUI_STATE_PATH, validHtmlState, type GenuiHtmlState, type GenuiStateIdentity } from '../genui-state-contract.ts'
export interface HtmlStateStorage { load(): Promise<GenuiHtmlState | null>; save(state: GenuiHtmlState): Promise<void>; clear(): Promise<void> }
const pendingWrites = new Map<string, Promise<void>>()
export function htmlStateStorage(identity: Omit<GenuiStateIdentity, 'sourceHash'>, html: string): HtmlStateStorage {
  let hash: Promise<string> | undefined
  const key = JSON.stringify([identity, html])
  async function request(action: string, state?: GenuiHtmlState) {
    hash ??= crypto.subtle.digest('SHA-256', new TextEncoder().encode(html)).then(buffer =>
      Array.from(new Uint8Array(buffer), byte => byte.toString(16).padStart(2, '0')).join(''))
    const response = await fetch(`${GENUI_STATE_PATH}/action`, { method: 'POST', keepalive: true,
      headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ...identity, sourceHash: await hash, action, state }) })
    if (!response.ok) throw new Error('Could not persist snippet state')
    return await response.json() as { state?: unknown }
  }
  const write = (action: string, state?: GenuiHtmlState) => {
    const pending = (pendingWrites.get(key) ?? Promise.resolve()).catch(() => {}).then(() => request(action, state)).then(() => {})
    pendingWrites.set(key, pending)
    const done = () => { if (pendingWrites.get(key) === pending) pendingWrites.delete(key) }
    void pending.then(done, done)
    return pending
  }
  return { async load() { await pendingWrites.get(key)?.catch(() => {}); const result = await request('load');
    if (result.state === null) return null
    if (!validHtmlState(result.state)) throw new Error('Invalid saved state')
    return result.state }, save: state => write('save', state), clear: () => write('clear') }
}
