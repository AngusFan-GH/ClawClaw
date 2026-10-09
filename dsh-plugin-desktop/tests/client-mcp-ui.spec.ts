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
  connectorId: 'local-tools', capabilities: ['knowledge.search'], state: 'running', tools: [], credentialsReady: true,
  diagnostic: { code: 'tools-pending', stage: 'discovery', checkedAt: 1 },
}

async function mount(configure?: (api: DesktopMcpApi) => void, options: { embedded?: boolean } = {}): Promise<DesktopMcpApi> {
  vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
  const api: DesktopMcpApi = {
    read: vi.fn(async () => ({ mcpServers: [server], catalog: [] })), save: vi.fn(async saved => [{ ...server, ...saved, state: 'running', tools: [], credentialsReady: true }]),
    remove: vi.fn(async () => []), toggle: vi.fn(async () => [server]), test: vi.fn(async () => [server]), import: vi.fn(async () => [server]),
    install: vi.fn(async () => ({ mcpServers: [server], catalog: [] })),
    authorize: vi.fn(async () => ({ authorizationUrl: 'https://identity.example.com/authorize' })),
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
  it('renders the actionable diagnostic stage and last check time', async () => {
    await mount()
    expect(document.body.textContent).toContain(zh.diagnosticToolsPending)
    expect(document.body.textContent).toContain(zh.lastChecked.split('{time}')[0])
    expect(document.querySelector('[data-diagnostic="tools-pending"]')).not.toBeNull()
  })

  it('supports searching embedded MCP cards by server and tool names', async () => {
    await mount(api => { vi.mocked(api.read).mockResolvedValue({ mcpServers: [
      { ...server, serverName: 'documents', tools: [{ name: 'mcp__documents__search', description: 'Search documents' }] },
      { ...server, serverName: 'calendar', tools: [{ name: 'mcp__calendar__events', description: 'List events' }] },
    ], catalog: [] }) }, { embedded: true })
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
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('form.dshMcpEditor')).not.toBeNull()
    expect(document.querySelector('.dshMcpPage form.dshMcpEditor')).toBeNull()
    expect(document.querySelector('.dshMcpInstalledList')).not.toBeNull()
    expect([...document.querySelectorAll('.dshMcpFormSection h4')].map(item => item.textContent)).toEqual([
      zh.identityAndTransport, zh.connection,
    ])
    expect([...document.querySelectorAll('.dshMcpFormDisclosure summary')].map(item => item.textContent)).toEqual([
      zh.credentials, zh.advancedSettings,
    ])
    expect(field(zh.initialDelay).value).toBe('1250')
    expect(field(zh.maxDelay).value).toBe('42000')
    expect(field(zh.maxAttempts).value).toBe('7')
    expect(document.querySelector<HTMLInputElement>('.dshIntegrationsEditor fieldset input[type="checkbox"]')?.checked).toBe(false)
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ reconnect: server.reconnect, connectorId: 'local-tools', capabilities: ['knowledge.search'] }), 'local', undefined)
  })

  it('refreshes registered tools silently every five seconds', async () => {
    vi.useFakeTimers()
    const api = await mount()
    vi.mocked(api.read).mockResolvedValue({ mcpServers: [{ ...server, tools: [{ name: 'mcp__local__search', description: 'Search' }] }], catalog: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(document.body.textContent).toContain('mcp__local__search')
    expect(document.body.textContent).not.toContain(zh.loading)
  })

  it('installs a catalog connector through the existing MCP controller API', async () => {
    const api = await mount(candidate => { vi.mocked(candidate.read).mockResolvedValue({ mcpServers: [server], catalog: [{
      id: 'playwright', name: 'Playwright Browser', description: 'Browser automation', category: 'development',
      sourceUrl: 'https://github.com/microsoft/playwright-mcp', license: 'Apache-2.0', capabilities: ['browser.automation'],
      credentials: [], server: { serverName: 'playwright', transport: 'stdio', command: 'npx', args: ['-y', '@playwright/mcp@0.0.83'],
        cwd: '', env: {}, timeoutMs: 60_000, reconnect: server.reconnect, enabled: true },
    }] }) })
    await act(async () => { button(zh.connectorCatalog).click() })
    expect(document.body.textContent).toContain('Playwright Browser')
    expect(document.querySelector('.dshMcpInstalledList')).toBeNull()
    expect(document.querySelector('.dshMcpCatalogGrid .dshMcpCatalogCard')).not.toBeNull()
    expect([...document.querySelectorAll('button')].some(item => item.textContent === zh.addServer)).toBe(false)
    await act(async () => { button(zh.installConnector).click() })
    expect(api.install).toHaveBeenCalledWith('playwright')
  })

  it('uses an operational list for connected servers', async () => {
    await mount()
    expect(document.querySelector('.dshMcpInstalledList .dshMcpServerCard')).not.toBeNull()
    expect(document.querySelector('.dshMcpCatalogGrid')).toBeNull()
    expect(document.querySelector('.dshMcpServerStatus [role="switch"]')).not.toBeNull()
  })

  it('opens create and import workflows in dialogs without inserting forms above the list', async () => {
    await mount()
    await act(async () => { button(zh.addServer).click() })
    expect(document.querySelector('[role="dialog"] form.dshMcpEditor')).not.toBeNull()
    expect(document.querySelector('.dshMcpPage form')).toBeNull()
    await act(async () => { button(zh.cancel).click() })
    await act(async () => { button(zh.importJson).click() })
    expect(document.querySelector('[role="dialog"] form[id$="-mcp-import"]')).not.toBeNull()
    expect(document.querySelector('.dshMcpPage form')).toBeNull()
  })

  it('opens the system-browser OAuth flow for an OAuth HTTP server', async () => {
    const oauthServer: DesktopMcpServerView = { ...server, transport: 'streamable-http', url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { issuer: 'https://identity.example.com', scope: 'mcp:tools' }, diagnostic: { code: 'authorization-required', stage: 'authorization' },
      state: 'error', credentialsReady: false }
    const open = vi.spyOn(window, 'open').mockImplementation(() => null)
    const api = await mount(candidate => { vi.mocked(candidate.read).mockResolvedValue({ mcpServers: [oauthServer], catalog: [] }) })
    await act(async () => { button(zh.authorize).click() })
    expect(api.authorize).toHaveBeenCalledWith('local')
    expect(open).toHaveBeenCalledWith('https://identity.example.com/authorize', '_blank', 'noopener,noreferrer')
  })
})
