// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { CustomExpertEditor } from '../src/experts/client/custom-editor.ts'
import { customZh } from '../src/experts/client/custom-locales.ts'

let root: Root | undefined

afterEach(async () => {
  await act(async () => { root?.unmount() })
  root = undefined
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

describe('expert capability selectors', () => {
  it('loads selectable Skills and MCP servers into multi-select controls', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    const skillsApi = { read: vi.fn(async () => [
      { name: 'review', description: 'Review work', source: 'user', provider: 'desktop', modelInvocable: true, userInvocable: true, editable: true },
    ]) }
    const mcpApi = { read: vi.fn(async () => [
      { serverName: 'docs', transport: 'stdio' as const, command: 'docs', args: [], cwd: '', env: {}, timeoutMs: 1,
        reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 }, enabled: true, state: 'running' as const,
        tools: [{ name: 'mcp__docs__search', description: 'Search docs' }], credentialsReady: true },
    ]) }

    await act(async () => {
      root!.render(createElement(CustomExpertEditor, {
        enabled: false, revision: 0, divisions: ['specialized'], remote: {} as never,
        skillsApi, mcpApi, locale: 'zh', t: (key: keyof typeof customZh) => customZh[key],
        onSaved: vi.fn(), onClose: vi.fn(),
      } as never))
      await Promise.resolve()
    })

    expect(skillsApi.read).toHaveBeenCalledOnce()
    expect(mcpApi.read).toHaveBeenCalledOnce()
    expect(document.querySelectorAll('.aag-capability-select')).toHaveLength(2)
    expect(document.querySelector('[aria-label="组合技能"]')?.getAttribute('role')).toBe('combobox')
    expect(document.querySelector('[aria-label="可用 MCP"]')?.getAttribute('role')).toBe('combobox')
    expect(document.querySelector('textarea[aria-label="组合技能"]')).toBeNull()
    expect(document.querySelector('textarea[aria-label="可用 MCP"]')).toBeNull()
  })

  it('keeps the Skill selector available when the MCP catalog fails', async () => {
    vi.stubGlobal('IS_REACT_ACT_ENVIRONMENT', true)
    const container = document.createElement('div')
    document.body.append(container)
    root = createRoot(container)
    await act(async () => {
      root!.render(createElement(CustomExpertEditor, {
        enabled: false, revision: 0, divisions: ['specialized'], remote: {} as never,
        skillsApi: { read: async () => [{ name: 'review', description: '', source: 'user', provider: 'desktop', modelInvocable: true, userInvocable: true, editable: true }] },
        mcpApi: { read: async () => { throw new Error('offline') } },
        locale: 'zh', t: (key: keyof typeof customZh) => customZh[key], onSaved: vi.fn(), onClose: vi.fn(),
      } as never))
      await Promise.resolve()
    })

    expect(document.querySelectorAll('[role="alert"]')).toHaveLength(1)
    await act(async () => {
      document.querySelector('[aria-label="组合技能"]')?.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
    })
    expect(document.body.textContent).toContain('review')
  })
})
