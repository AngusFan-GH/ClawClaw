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
async function setField(label: string, value: string): Promise<void> {
  await act(async () => {
    const input = field(label)
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(input, value)
    input.dispatchEvent(new Event('input', { bubbles: true }))
  })
}
async function submit(): Promise<void> {
  await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
}
async function mountRemoteHeader(): Promise<DesktopMcpApi> {
  const api = await mount(api => { vi.mocked(api.read).mockResolvedValue({ mcpServers: [{ ...server, transport: 'streamable-http', url: 'https://example.com/mcp', headers: { Authorization: 'SHARED_TOKEN' } }], catalog: [] }) })
  await openServerMenu()
  await act(async () => { button(zh.editServer).click() })
  return api
}

async function openServerMenu(): Promise<void> {
  await act(async () => { document.querySelector<HTMLButtonElement>('.dshMcpMoreTrigger')!.click() })
}

afterEach(async () => {
  await act(async () => { root?.unmount() }); root = undefined
  document.body.replaceChildren(); vi.useRealTimers(); vi.unstubAllGlobals()
})

describe('MCP settings UI', () => {
  it('navigates catalog tabs with the keyboard and labels the selected panel', async () => {
    await mount()
    const tabs = [...document.querySelectorAll<HTMLButtonElement>('[role="tab"]')]
    tabs[0]!.focus()
    await act(async () => { tabs[0]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true })) })
    expect(document.activeElement).toBe(tabs[1])
    expect(tabs[1]!.getAttribute('aria-selected')).toBe('true')
    expect(tabs[0]!.tabIndex).toBe(-1)
    expect(document.querySelector('[role="tabpanel"]')?.getAttribute('aria-labelledby')).toBe(tabs[1]!.id)
    await act(async () => { tabs[1]!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Home', bubbles: true })) })
    expect(document.activeElement).toBe(tabs[0])
    expect(tabs[0]!.getAttribute('aria-selected')).toBe('true')
  })

  it('shows transport guidance and focuses linked validation errors before saving', async () => {
    const api = await mount()
    await act(async () => { button(zh.addServer).click() })
    expect(document.body.textContent).toContain(zh.stdioDescription)
    expect(document.body.textContent).toContain(zh.httpDescription)
    expect(document.body.textContent).toContain(zh.sseDescription)
    await act(async () => { button('HTTP').click() })
    await setField(zh.serverName, '中文名称')
    await setField(zh.url, 'http://remote.example/mcp')
    await submit()
    expect(api.save).not.toHaveBeenCalled()
    expect(field(zh.serverName).getAttribute('aria-invalid')).toBe('true')
    expect(field(zh.url).getAttribute('aria-invalid')).toBe('true')
    const summary = document.querySelector<HTMLDivElement>('.dshMcpErrorSummary')!
    expect(document.activeElement).toBe(summary)
    expect(summary.textContent).toContain(zh.remoteUrlError)
    await act(async () => { [...summary.querySelectorAll('a')].find(link => link.textContent === zh.remoteUrlError)!.click() })
    expect(document.activeElement).toBe(field(zh.url))
  })

  it('opens advanced settings from a validation error link', async () => {
    const api = await mount()
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    await setField(zh.maxAttempts, '0')
    await submit()
    expect(api.save).not.toHaveBeenCalled()
    const link = [...document.querySelectorAll<HTMLAnchorElement>('.dshMcpErrorSummary a')].find(item => item.textContent === zh.maxAttemptsRangeError)!
    await act(async () => { link.click() })
    const advanced = field(zh.maxAttempts).closest('details')!
    expect(advanced.open).toBe(true)
    expect(advanced.contains(document.activeElement)).toBe(true)
  })

  it('rejects duplicate IDs before making a save request', async () => {
    const api = await mount()
    await act(async () => { button(zh.addServer).click() })
    await setField(zh.serverName, 'local')
    await setField(zh.command, 'node')
    await submit()
    expect(api.save).not.toHaveBeenCalled()
    expect(document.querySelector('.dshMcpErrorSummary')?.textContent).toContain(zh.duplicateServerName)
  })

  it('explains and blocks conflicting OAuth and Authorization headers', async () => {
    const api = await mountRemoteHeader()
    await act(async () => { button(zh.oauthPkce).click() })
    expect(document.body.textContent).toContain(zh.oauthFlowHint)
    expect(document.querySelector('[aria-labelledby$="-mcp-auth-heading"] .dshMcpCredentials')).not.toBeNull()
    await submit()
    expect(api.save).not.toHaveBeenCalled()
    expect(document.querySelector('.dshMcpErrorSummary')?.textContent).toContain(zh.oauthHeaderConflict)
  })

  it('locks the editor and prevents duplicate submissions while saving', async () => {
    let finish!: (servers: readonly DesktopMcpServerView[]) => void
    const api = await mount(candidate => { vi.mocked(candidate.save).mockImplementation(() => new Promise(resolve => { finish = resolve })) })
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    await submit()
    await submit()
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(document.querySelector<HTMLFieldSetElement>('.dshMcpEditorFields')?.disabled).toBe(true)
    expect(button(zh.savingConnector).disabled).toBe(true)
    await act(async () => { finish([{ ...server, diagnostic: { code: 'ready', stage: 'ready' } }]) })
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="status"]')?.textContent).toBe(zh.savedConnected)
  })

  it('keeps persisted settings editable after connection failure and clears entered secrets', async () => {
    const api = await mountRemoteHeader()
    vi.mocked(api.save).mockImplementation(async saved => [{ ...server, ...saved, state: 'error', diagnostic: { code: 'connection-failed', stage: 'connection' } }])
    await setField(zh.headerValue, 'Bearer private-value')
    await submit()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    expect(document.querySelector('.dshMcpErrorSummary')?.textContent).toContain(zh.savedConnectionFailed)
    expect(field(zh.headerValue).value).toBe('')
    expect(field(zh.headerValue).placeholder).toBe(zh.configuredValue)
    vi.mocked(api.save).mockImplementation(async saved => [{ ...server, ...saved }])
    await submit()
    expect(api.save).toHaveBeenLastCalledWith(expect.objectContaining({ serverName: 'local' }), 'local', undefined)
  })

  it.each([
    ['authorization-required', 'authorization', 'error', 'savedNeedsAuthorization'],
    ['tools-pending', 'discovery', 'running', 'savedDiscovering'],
    ['disabled', 'configuration', 'disabled', 'savedDisabled'],
  ] as const)('reports %s separately from successful tool readiness', async (code, stage, state, message) => {
    const api = await mount(candidate => { vi.mocked(candidate.save).mockImplementation(async saved => [{ ...server, ...saved, state,
      enabled: code !== 'disabled', diagnostic: { code, stage } }]) })
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    if (code === 'disabled') {
      await act(async () => { document.querySelector<HTMLInputElement>('.dshMcpDialogFooter input[type="checkbox"]')!.click() })
    }
    await submit()
    expect(api.save).toHaveBeenCalledTimes(1)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(document.querySelector('[role="status"]')?.textContent).toBe(zh[message])
  })

  it('does not replace newly saved settings with an older refresh response', async () => {
    let finishRead!: (value: Awaited<ReturnType<DesktopMcpApi['read']>>) => void
    const api = await mount()
    vi.mocked(api.read).mockImplementation(() => new Promise(resolve => { finishRead = resolve }))
    await act(async () => { button(zh.refresh).click() })
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    await setField(zh.serverName, 'updated')
    await submit()
    await act(async () => { finishRead({ mcpServers: [server], catalog: [] }) })
    expect(document.querySelector('.dshMcpServerTitle')?.textContent).toContain('updated')
  })

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
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    const dialog = document.querySelector('[role="dialog"]')
    expect(dialog).not.toBeNull()
    expect(dialog?.querySelector('form.dshMcpEditor')).not.toBeNull()
    expect(document.querySelector('.dshMcpPage form.dshMcpEditor')).toBeNull()
    expect(document.querySelector('.dshMcpInstalledList')).not.toBeNull()
    expect([...document.querySelectorAll('.dshMcpFormSection h4')].map(item => item.textContent)).toEqual([
      zh.connection,
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

  it('saves a directly entered SSE header through an automatic credential reference', async () => {
    const api = await mount()
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    await act(async () => { button('SSE').click() })
    expect(button('SSE').getAttribute('aria-pressed')).toBe('true')
    expect(document.body.textContent).not.toContain(zh.headerReferencesHint)
    await setField(zh.url, 'https://example.com/sse')
    await act(async () => { button(zh.addHeader).click() })
    expect(field(zh.headerName).placeholder).toBe(zh.headerNamePlaceholder)
    expect(field(zh.headerValue).placeholder).toBe(zh.bearerValuePlaceholder)
    await setField(zh.headerName, 'X-API-Key')
    expect(field(zh.headerValue).placeholder).toBe(zh.headerValuePlaceholder)
    await setField(zh.headerName, 'Authorization')
    await setField(zh.headerValue, 'Bearer test-secret')
    expect(field(zh.headerValue).type).toBe('password')
    await act(async () => { button(zh.showValue).click() })
    expect(field(zh.headerValue).type).toBe('text')
    await submit()
    const [saved, previousName, secrets] = vi.mocked(api.save).mock.calls[0]!
    expect(saved).toMatchObject({ transport: 'sse', url: 'https://example.com/sse' })
    if (saved.transport === 'stdio') throw new Error('Expected remote server')
    expect(previousName).toBe('local')
    expect(saved.headers.Authorization).toMatch(/^MCP_HEADER_/u)
    expect(secrets).toEqual({ [saved.headers.Authorization!]: 'Bearer test-secret' })
    expect(JSON.stringify(saved)).not.toContain('test-secret')
  })

  it('preserves configured values without fetching or re-entering secrets', async () => {
    const api = await mountRemoteHeader()
    expect(field(zh.headerValue).value).toBe('')
    expect(field(zh.headerValue).placeholder).toBe(zh.configuredValue)
    expect(document.body.textContent).not.toContain('SHARED_TOKEN')
    await submit()
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ headers: { Authorization: 'SHARED_TOKEN' } }), 'local', undefined)
  })

  it('uses a fresh credential when replacing a shared value', async () => {
    const api = await mountRemoteHeader()
    await setField(zh.headerValue, 'Bearer replacement')
    await submit()
    const [saved, , secrets] = vi.mocked(api.save).mock.calls[0]!
    if (saved.transport === 'stdio') throw new Error('Expected remote server')
    expect(saved.headers.Authorization).not.toBe('SHARED_TOKEN')
    expect(secrets).toEqual({ [saved.headers.Authorization!]: 'Bearer replacement' })
  })

  it('allows using existing credentials through the advanced option', async () => {
    const api = await mountRemoteHeader()
    await act(async () => { button(zh.useExistingCredential).click() })
    expect(field(zh.existingCredential).value).toBe('SHARED_TOKEN')
    expect(field(zh.existingCredential).placeholder).toBe(zh.credentialRefPlaceholder)
    await setField(zh.existingCredential, 'MY_EXISTING_TOKEN')
    await submit()
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ headers: { Authorization: 'MY_EXISTING_TOKEN' } }), 'local', undefined)
  })

  it('removes a configured header explicitly and does not send its value', async () => {
    const api = await mountRemoteHeader()
    await act(async () => { button(zh.removeHeader + ' Authorization').click() })
    await submit()
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ headers: {} }), 'local', undefined)
  })

  it('validates new values and case-insensitive duplicate header names', async () => {
    const api = await mountRemoteHeader()
    await act(async () => { button(zh.addHeader).click() })
    const second = document.querySelectorAll<HTMLInputElement>('.dshMcpCredentialInputs input')[2]!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(second, 'X-Api-Key')
      second.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await submit()
    expect(document.body.textContent).toContain(zh.headerValueRequired)
    expect(api.save).not.toHaveBeenCalled()
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')!.set!.call(second, 'authorization')
      second.dispatchEvent(new Event('input', { bubbles: true }))
    })
    await submit()
    expect(document.body.textContent).toContain(zh.duplicateHeaderError)
    expect(api.save).not.toHaveBeenCalled()
  })

  it.each(['stdio', 'streamable-http', 'sse'] as const)('edits %s credentials directly and keeps values out of settings', async transport => {
    const api = await mount()
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    if (transport !== 'stdio') {
      await act(async () => { button(transport === 'sse' ? 'SSE' : 'HTTP').click() })
      expect(field(zh.url).placeholder).toBe(transport === 'sse' ? zh.sseUrlHint : zh.urlHint)
      await setField(zh.url, 'https://example.com/mcp')
    } else {
      expect(document.querySelector<HTMLTextAreaElement>('textarea')?.placeholder).toBe(zh.argumentsHint)
    }
    await act(async () => { button(transport === 'stdio' ? zh.addEnvironment : zh.addHeader).click() })
    await setField(transport === 'stdio' ? zh.environmentName : zh.headerName, transport === 'stdio' ? 'API_KEY' : 'Authorization')
    await setField(zh.headerValue, 'example-value=with spaces')
    await submit()
    const [saved, , secrets] = vi.mocked(api.save).mock.calls[0]!
    expect(saved.transport).toBe(transport)
    const references = saved.transport === 'stdio' ? saved.env : saved.headers
    const ref = references[transport === 'stdio' ? 'API_KEY' : 'Authorization']!
    expect(ref).toMatch(/^MCP_(ENV|HEADER)_/u)
    expect(secrets).toEqual({ [ref]: 'example-value=with spaces' })
    expect(JSON.stringify(saved)).not.toContain('example-value')
  })

  it('retains stdio environment references without re-entering values', async () => {
    const api = await mount(candidate => { vi.mocked(candidate.read).mockResolvedValue({ mcpServers: [{ ...server, env: { API_KEY: 'OLD_TOKEN' } }], catalog: [] }) })
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    expect(field(zh.headerValue).value).toBe('')
    expect(field(zh.headerValue).placeholder).toBe(zh.configuredValue)
    await submit()
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ env: { API_KEY: 'OLD_TOKEN' } }), 'local', undefined)
  })

  it('keeps environment and header drafts separate across transport switches', async () => {
    const api = await mount()
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    await act(async () => { button(zh.addEnvironment).click() })
    await setField(zh.environmentName, 'API_KEY')
    await setField(zh.headerValue, 'environment-secret')
    await act(async () => { button('HTTP').click() })
    expect(document.querySelectorAll('.dshMcpCredentialRow')).toHaveLength(0)
    await setField(zh.url, 'https://example.com/mcp')
    await act(async () => { button(zh.addHeader).click() })
    await setField(zh.headerName, 'Authorization')
    await setField(zh.headerValue, 'Bearer header-secret')
    await act(async () => { button('stdio').click() })
    expect(field(zh.environmentName).value).toBe('API_KEY')
    expect(field(zh.headerValue).value).toBe('environment-secret')
    await act(async () => { button('SSE').click() })
    expect(field(zh.headerName).value).toBe('Authorization')
    expect(field(zh.headerValue).value).toBe('Bearer header-secret')
    await submit()
    const [saved, , secrets] = vi.mocked(api.save).mock.calls[0]!
    expect(saved.transport).toBe('sse')
    expect(JSON.stringify(secrets)).not.toContain('environment-secret')
  })

  it('rejects invalid environment names without saving credentials', async () => {
    const api = await mount()
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    await act(async () => { button(zh.addEnvironment).click() })
    expect(field(zh.environmentName).placeholder).toBe(zh.environmentNamePlaceholder)
    expect(field(zh.headerValue).placeholder).toBe(zh.environmentValuePlaceholder)
    await setField(zh.environmentName, 'INVALID-NAME')
    await setField(zh.headerValue, 'example-secret')
    await submit()
    expect(api.save).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(zh.environmentNameError)
  })

  it('preserves SSE endpoint and OAuth settings while editing', async () => {
    const api = await mount(api => { vi.mocked(api.read).mockResolvedValue({ mcpServers: [{ ...server, transport: 'sse', url: 'https://example.com/sse', headers: {}, oauth: { scope: 'mcp:tools' } }], catalog: [] }) })
    expect(document.querySelector('.dshMcpTransport')?.textContent).toBe('SSE')
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    expect(field(zh.url).value).toBe('https://example.com/sse')
    expect(button('SSE').getAttribute('aria-pressed')).toBe('true')
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ transport: 'sse', oauth: { scope: 'mcp:tools' } }), 'local', undefined)
  })

  it('refreshes registered tools silently every five seconds', async () => {
    vi.useFakeTimers()
    const api = await mount()
    vi.mocked(api.read).mockResolvedValue({ mcpServers: [{ ...server, tools: [{ name: 'mcp__local__search', description: 'Search' }] }], catalog: [] })
    await act(async () => { await vi.advanceTimersByTimeAsync(5_000) })
    expect(document.body.textContent).not.toContain('mcp__local__search')
    const tools = button(`1 ${zh.tools}`)
    expect(tools.getAttribute('aria-expanded')).toBe('false')
    await act(async () => { tools.click() })
    expect(tools.getAttribute('aria-expanded')).toBe('true')
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
    expect(document.querySelector('.dshMcpMoreTrigger')).not.toBeNull()
    await openServerMenu()
    expect(button(zh.testServer).closest('[role="menu"]')).not.toBeNull()
  })

  it('keeps destructive removal behind a second menu selection', async () => {
    const api = await mount()
    await openServerMenu()
    await act(async () => { button(zh.removeServer).click() })
    expect(api.remove).not.toHaveBeenCalled()
    await openServerMenu()
    await act(async () => { button(zh.confirmRemove).click() })
    expect(api.remove).toHaveBeenCalledWith('local')
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

  it.each(['streamable-http', 'sse'] as const)('edits a pre-registered %s OAuth client without exposing its secret', async transport => {
    const oauthServer: DesktopMcpServerView = { ...server, transport, url: 'https://mcp.example.com/mcp', headers: {},
      oauth: { scope: 'mcp:tools', clientId: 'desktop-client', clientSecretRef: 'MCP_CLIENT_SECRET',
        tokenEndpointAuthMethod: 'client_secret_post' }, managedCredentialRefs: ['MCP_CLIENT_SECRET'] }
    const api = await mount(candidate => { vi.mocked(candidate.read).mockResolvedValue({ mcpServers: [oauthServer], catalog: [] }) })
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    expect(field(zh.oauthClientId).value).toBe('desktop-client')
    expect(field(zh.oauthClientSecret).value).toBe('')
    expect(field(zh.oauthClientSecret).placeholder).toBe(zh.configuredValue)
    expect(document.querySelector<HTMLSelectElement>('select')?.value).toBe('client_secret_post')
    expect(document.body.textContent).not.toContain('client-secret-value')
    await act(async () => { document.querySelector('form')!.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true })) })
    expect(api.save).toHaveBeenCalledWith(expect.objectContaining({ oauth: expect.objectContaining({
      clientId: 'desktop-client', clientSecretRef: 'MCP_CLIENT_SECRET', tokenEndpointAuthMethod: 'client_secret_post',
    }) }), 'local', undefined)
    await openServerMenu()
    await act(async () => { button(zh.editServer).click() })
    await setField(zh.oauthClientSecret, 'new-client-secret')
    await submit()
    const [saved, , secrets] = vi.mocked(api.save).mock.calls[1]!
    if (saved.transport === 'stdio') throw new Error('Expected OAuth server')
    expect(saved.oauth?.clientSecretRef).not.toBe('MCP_CLIENT_SECRET')
    expect(secrets).toEqual({ [saved.oauth!.clientSecretRef!]: 'new-client-secret' })
    expect(JSON.stringify(saved)).not.toContain('new-client-secret')
  })
})
