import { describe, expect, it, vi } from 'vitest'
import { ExpertCapabilityRegistry } from '../src/experts/client/capability-registry.ts'

describe('ExpertCapabilityRegistry', () => {
  it('publishes a shared catalog and retains the last successful side after a partial failure', async () => {
    const skills = [{ name: 'review', description: '', source: 'user', provider: 'desktop', modelInvocable: true, userInvocable: true, editable: true }]
    const mcp = [{ serverName: 'docs', transport: 'stdio' as const, command: 'docs', args: [], cwd: '', env: {}, timeoutMs: 1,
      reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 }, enabled: true, state: 'running' as const,
      tools: [{ name: 'mcp__docs__search', description: '' }], credentialsReady: true }]
    const skillsApi = { read: vi.fn().mockResolvedValueOnce(skills).mockRejectedValueOnce(new Error('skill offline')) }
    const mcpApi = { read: vi.fn().mockResolvedValue({ mcpServers: mcp, catalog: [] }) }
    const registry = new ExpertCapabilityRegistry(skillsApi, mcpApi)
    const listener = vi.fn()
    const dispose = registry.subscribe(listener)
    await registry.refresh()
    expect(registry.getSnapshot().catalog.skills.map(item => item.value)).toEqual(['review'])
    expect(registry.getSnapshot().catalog.mcpServers.map(item => item.value)).toEqual(['docs'])
    await registry.refresh()
    expect(registry.getSnapshot().skillsError).toBe('skill offline')
    expect(registry.getSnapshot().catalog.skills.map(item => item.value)).toEqual(['review'])
    expect(listener).toHaveBeenCalled()
    dispose()
  })
})
