// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { McpSettingsSection, type McpSettingsSectionProps } from '../src/client/McpSettingsSection.tsx'
import type { DesktopMcpApi } from '../src/client/mcp-api.ts'
import { zh } from '../src/client/mcp-locales.ts'
import type { DesktopMcpServerView } from '../src/mcp-contract.ts'

let root: Root | undefined
const server: DesktopMcpServerView = {
  serverName: 'local', transport: 'stdio', command: 'node', args: ['server.js'], cwd: '', env: {}, timeoutMs: 45_000,
  reconnect: { enabled: false, initialDelayMs: 1_250, maxDelayMs: 42_000, maxAttempts: 7 }, enabled: true,
  state: 'running', tools: [], credentialsReady: true,
}

async function mount(configure?: (api: DesktopMcpApi) => void, options: { embedded?: boolean } = {}): Promise<DesktopMcpApi> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const api: DesktopMcpApi = {
    read: vi.fn(async () => [server]), save: vi.fn(async saved => [{ ...server, ...saved, state: 'running', tools: [], credentialsReady: true }]),
    remove: vi.fn(async () => []), toggle: vi.fn(async () => [server]), test: vi.fn(async () => [server]), import: vi.fn(async () => [server]),
  }
  configure?.(api)
  const container = document.createElement('div'); document.body.append(container); root = createRoot(container)
  await act(async () => { root!.render(createElement(McpSettingsSection, { api, embedded: options.embedded, t: key => zh[key as keyof typeof zh] } as McpSettingsSectionProps)) })
  return api
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll('button')].find(item => item.textContent === label || item.getAttribute('aria-label') === label)
  if (found === undefined) throw new Error(`Missing button: ${label}`)
  return found
}
function field(label: string): HTMLInputElement {
  const found = [...document.querySelectorAll('label')].find(item => item.querySelector('span')?.textContent === label)?.querySelector('input')
  if (!(found instanceof HTMLInputElement)) throw new Error(`Missing field: ${label}`)
  return found
}

afterEach(async () => {
  await act(async () => { root?.unmount() }); root = undefined
  document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('MCP settings UI', () => {
  it('supports searching embedded MCP cards by server and tool names', async () => {
    await mount(api => { vi.mocked(api.read).mockResolvedValue([
      { ...server, serverName: 'documents', tools: [{ name: 'mcp__documents__search', description: 'Search documents' }] },
      { ...server, serverName: 'calendar', tools: [{ name: 'mcp__calendar__events', description: 'List events' }] },
    ]) }, { embedded: true })
    expect(document.querySelector('.dshMcpPage>header')).toBeNull()
    const search = document.querySelector<HTMLInputElement>(`input[aria-label="${zh.searchServers}"]`)!
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, 'events')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect([...document.querySelectorAll('.dshIntegrationsMcp')].map(item => item.textContent)).toEqual([expect.stringContaining('calendar')])
    await act(async () => {
      const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set
      setter?.call(search, 'missing')
      search.dispatchEvent(new Event('input', { bubbles: true }))
    })
    expect(document.querySelectorAll('.dshIntegrationsMcp')).toHaveLength(0)
    await act(async () => { button(zh.clearSearch).click() })
    expect(document.querySelectorAll('.dshIntegrationsMcp')).toHaveLength(2)
  })

  it('preserves reconnect settings while editing a server', async () => {
    const api = await mount()
    await act(async () => { button(zh.editServer).click() })
    expect(field(zh.initialDelay).value).toBe('1250')
    expect(field(zh.maxDelay).value).toBe('42000')
    expect(field(zh.maxAttempts).value).toBe('7')
    expect(document.querySelector<HTMLInputElement>('.dshIntegrationsEditor fieldset input[type="checkbox"]')?.checked).toBe(false)
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ reconnect: server.reconnect }), 'local', undefined)
  })

  it('refreshes registered tools silently every five seconds', async () => {
    vi.useFakeTimers()
    const api = await mount()
    vi.mocked(api.read).mockResolvedValue([{ ...server, tools: [{ name: 'mcp__local__search', description: 'Search' }] }])
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(document.body.textContent).toContain('mcp__local__search')
    expect(document.body.textContent).not.toContain(zh.loading)
  })
})
