import { DESKTOP_LEGACY_AGENT_PRESETS_ACTION_PATH, DESKTOP_LEGACY_AGENT_PRESETS_PATH, type DesktopLegacyAgentPreset, type DesktopLegacyAgentPresetsView } from '../legacy-agent-presets-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export function parseDesktopLegacyAgentPresetsView(value: unknown): DesktopLegacyAgentPresetsView {
  if (!isRecord(value) || !Array.isArray(value.presets) || value.presets.length > 1_000) throw new Error('Invalid Agent presets response')
  const presets = value.presets.map((item): DesktopLegacyAgentPreset => {
    if (!isRecord(item) || typeof item.id !== 'string' || !/^[A-Za-z0-9_-]{1,128}$/u.test(item.id)
      || typeof item.name !== 'string' || item.name.length === 0 || item.name.length > 512
      || (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 4_000))) throw new Error('Invalid Agent preset response')
    return Object.freeze({ id: item.id, name: item.name, ...(item.description === undefined ? {} : { description: item.description }) })
  })
  if (new Set(presets.map(preset => preset.id)).size !== presets.length) throw new Error('Duplicate Agent preset response')
  return Object.freeze({ presets: Object.freeze(presets) })
}

async function responseValue(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('Agent presets response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}

export interface DesktopLegacyAgentPresetsApi {
  read(): Promise<DesktopLegacyAgentPresetsView>
  remove(id: string): Promise<DesktopLegacyAgentPresetsView>
}

export function createDesktopLegacyAgentPresetsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopLegacyAgentPresetsApi {
  const request = async (input: RequestInfo | URL, init: RequestInit): Promise<DesktopLegacyAgentPresetsView> => parseDesktopLegacyAgentPresetsView(await responseValue(await fetcher(input, init)))
  return Object.freeze({
    read: () => request(DESKTOP_LEGACY_AGENT_PRESETS_PATH, { method: 'GET', credentials: 'same-origin', redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }),
    remove: (id: string) => request(DESKTOP_LEGACY_AGENT_PRESETS_ACTION_PATH, { method: 'POST', credentials: 'same-origin', redirect: 'error', headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'delete', id }) }),
  })
}
