import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import type { Context } from '@deepseek-ai/cordis'
import type { Agent } from '@deepseek-ai/dsh-agent'
import { describe, expect, it, vi } from 'vitest'
import { customExpertSchema } from '../src/experts/expert-contract.ts'
import {
  DEFAULT_DIVISIONS,
  loadCatalog,
  readLocalizedExpertPrompt,
  resolveExpertComposition,
  teamRequiresToolFilter,
} from '../src/experts/index.ts'
import { detectTeamEngine, type NativeTeamService } from '../src/experts/team-engine.ts'
import { capabilityCatalogSelectOptions, capabilitySelectOptions, expertCapabilityCatalog, expertCapabilityHealth, selectableExpertCapabilities, updateCapabilityBindings } from '../src/experts/client/capability-options.ts'

const catalogRoot = fileURLToPath(new URL('../assets/experts/catalog/', import.meta.url))
const chineseRoot = fileURLToPath(new URL('../assets/experts/catalog-zh/', import.meta.url))

const parent = {
  session: { header: { cwd: '/workspace' } },
} as unknown as Agent

function compositionContext(options: {
  skill?: { name: string; content: string; modelInvocable?: boolean }
  tools?: string[]
} = {}): Context {
  const skill = options.skill
  return {
    get: () => undefined,
    skills: {
      get: vi.fn(async (name: string) => name === skill?.name ? {
        ...skill,
        invocation: { modelInvocable: skill.modelInvocable ?? true },
      } : undefined),
    },
    tools: {
      schemas: () => (options.tools ?? []).map(name => ({ name })),
    },
  } as unknown as Context
}

function nativeService(): NativeTeamService {
  return {
    tryMembership: () => undefined,
    listMembers: () => [],
    spawnTeammate: vi.fn(),
    sendMessage: vi.fn(),
    createTask: vi.fn(),
    updateTask: vi.fn(),
    waitForChange: vi.fn(),
    interrupt: vi.fn(),
  } as unknown as NativeTeamService
}

describe('ClawClaw experts', () => {
  it('ships the complete 321-expert catalog and localized personas', async () => {
    const catalog = await loadCatalog(catalogRoot, DEFAULT_DIVISIONS)
    expect(catalog.size).toBe(321)
    expect(new Set([...catalog.values()].map(expert => expert.division))).toEqual(new Set(DEFAULT_DIVISIONS))

    const english = await readLocalizedExpertPrompt(catalogRoot, chineseRoot, 'design-ux-researcher', 'design', 'en')
    const chinese = await readLocalizedExpertPrompt(catalogRoot, chineseRoot, 'design-ux-researcher', 'design', 'zh')
    expect(english.prompt).toContain('UX Researcher Agent Personality')
    expect(chinese.prompt).toContain('UX 研究员 Agent 人格')
    expect(chinese.prompt).not.toBe(english.prompt)
  })

  it('defaults capability bindings for records saved before Skill and MCP support', () => {
    const expert = customExpertSchema.parse({
      slug: 'custom-12345678-1234-4123-8123-123456789abc',
      name: 'Reviewer',
      description: 'Reviews designs',
      division: 'design',
      emoji: '',
      avatar: 0,
      prompt: 'Review the supplied design.',
    })
    expect(expert.skills).toEqual([])
    expect(expert.mcpServers).toEqual([])
  })

  it('offers only live selectable Skills and MCP servers while preserving stale bindings', () => {
    const available = selectableExpertCapabilities([
      { name: 'review', description: '', source: 'user', provider: 'desktop', modelInvocable: true, userInvocable: true, editable: true },
      { name: 'manual-only', description: '', source: 'user', provider: 'desktop', modelInvocable: false, userInvocable: true, editable: true },
    ], [
      { serverName: 'docs', transport: 'stdio', command: 'docs', args: [], cwd: '', env: {}, timeoutMs: 1, reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 }, enabled: true, state: 'running', tools: [{ name: 'mcp__docs__search', description: '' }], credentialsReady: true },
      { serverName: 'offline', transport: 'stdio', command: 'offline', args: [], cwd: '', env: {}, timeoutMs: 1, reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 }, enabled: true, state: 'error', tools: [], credentialsReady: true },
    ])
    expect(available).toEqual({ skills: ['review'], mcpServers: ['docs'] })
    expect(capabilitySelectOptions(available.skills, ['review', 'old-skill'], 'unavailable')).toEqual([
      { value: 'review', label: 'review' },
      { value: 'old-skill', label: 'old-skill (unavailable)' },
    ])
    expect(updateCapabilityBindings([{ name: 'old-skill', required: false, enabled: false }], ['old-skill', 'review'])).toEqual([
      { name: 'old-skill', required: false, enabled: false },
      { name: 'review', required: true, enabled: true },
    ])
  })

  it('keeps the complete capability catalog visible and derives expert health', () => {
    const catalog = expertCapabilityCatalog([
      { name: 'ready', description: '', source: 'user', provider: 'desktop', modelInvocable: true, userInvocable: true, editable: true },
      { name: 'manual', description: '', source: 'user', provider: 'desktop', modelInvocable: false, userInvocable: true, editable: true },
    ], [
      { serverName: 'offline', transport: 'stdio', command: 'offline', args: [], cwd: '', env: {}, timeoutMs: 1, reconnect: { enabled: true, initialDelayMs: 1, maxDelayMs: 1, maxAttempts: 1 }, enabled: true, state: 'error', tools: [], credentialsReady: true },
    ])
    expect(capabilityCatalogSelectOptions(catalog.skills, ['missing'], state => state)).toEqual([
      { value: 'manual', label: 'manual (disabled)' },
      { value: 'ready', label: 'ready' },
      { value: 'missing', label: 'missing (missing)' },
    ])
    expect(expertCapabilityHealth({
      skills: [{ name: 'ready', required: true, enabled: true }, { name: 'manual', required: false, enabled: true }],
      mcpServers: [{ name: 'offline', required: true, enabled: true }],
    }, catalog)).toMatchObject({ state: 'blocked', ready: 1, total: 3 })
    expect(expertCapabilityHealth({
      skills: [{ name: 'manual', required: false, enabled: true }], mcpServers: [],
    }, catalog)).toMatchObject({ state: 'degraded', ready: 0, total: 1 })
    expect(expertCapabilityHealth({ skills: [{ name: 'missing', required: true, enabled: true }], mcpServers: [] }, catalog, true))
      .toMatchObject({ state: 'unknown', ready: 0, total: 1 })
  })

  it('injects bound Skills and denies unbound MCP servers', async () => {
    const result = await resolveExpertComposition(compositionContext({
      skill: { name: 'review', content: 'Inspect evidence before making claims.' },
      tools: ['read_file', 'mcp__docs__search', 'mcp__github__issues'],
    }), {
      skills: [{ name: 'review', required: true, enabled: true }],
      mcpServers: [{ name: 'docs', required: true, enabled: true }],
    }, parent, 'Base persona')

    expect(result.persona).toContain('## Bound Skill: review')
    expect(result.persona).toContain('Inspect evidence before making claims.')
    expect(result.deniedTools).toContain('mcp__github__issues')
    expect(result.deniedTools).not.toContain('mcp__docs__search')
    expect(result.deniedTools).toContain('summon_expert')
  })

  it('fails required capabilities and reports missing optional capabilities', async () => {
    const ctx = compositionContext({ tools: [] })
    await expect(resolveExpertComposition(ctx, {
      skills: [{ name: 'required-skill', required: true, enabled: true }],
      mcpServers: [],
    }, parent, 'Persona')).rejects.toThrow('Skill unavailable: required-skill')

    const optional = await resolveExpertComposition(ctx, {
      skills: [{ name: 'optional-skill', required: false, enabled: true }],
      mcpServers: [{ name: 'optional-server', required: false, enabled: true }],
    }, parent, 'Persona')
    expect(optional.diagnostics).toEqual([
      'Skill unavailable: optional-skill',
      'MCP server unavailable: optional-server',
    ])
    expect(optional.persona).toContain('## Capability diagnostics')
  })

  it('does not apply an MCP allowlist when every saved binding is disabled', async () => {
    const result = await resolveExpertComposition(compositionContext({ tools: ['mcp__docs__search', 'mcp__github__issues'] }), {
      skills: [], mcpServers: [{ name: 'docs', required: true, enabled: false }],
    }, parent, 'Persona')
    expect(result.deniedTools).not.toContain('mcp__docs__search')
    expect(result.deniedTools).not.toContain('mcp__github__issues')
  })

  it('uses standard subagents when a team member needs MCP isolation', () => {
    const experts = [{
      slug: 'reviewer',
      mcpServers: [{ name: 'docs', required: true, enabled: true }],
    }]
    expect(teamRequiresToolFilter({ members: [{ expertSlug: 'reviewer' }] }, experts)).toBe(true)
    expect(detectTeamEngine(nativeService(), true, undefined, 'en', true)).toMatchObject({
      state: 'enabled',
      mode: 'subagent',
      reason: expect.stringContaining('isolate tools'),
    })
  })

  it('does not advertise a plugin toggle when the native team service is absent', () => {
    expect(detectTeamEngine(undefined)).toEqual(expect.objectContaining({
      state: 'unsupported',
      mode: 'subagent',
      recommendation: '',
    }))
  })

  it('only recommends reloading when a mounted native service lacks conversation tools', () => {
    const status = detectTeamEngine(nativeService(), false, undefined, 'en')
    expect(status).toMatchObject({ state: 'disabled', mode: 'subagent' })
    expect(status.recommendation).toContain('Create or reload the conversation')
    expect(status.recommendation).not.toMatch(/Plugins|Host|Web/u)
  })

  it('does not retain the external expert package in manifests or the lockfile', async () => {
    const files = await Promise.all([
      readFile(new URL('../package.json', import.meta.url), 'utf8'),
      readFile(new URL('../../pnpm-lock.yaml', import.meta.url), 'utf8'),
      readFile(new URL('../cordis.patch.yml', import.meta.url), 'utf8'),
    ])
    expect(files.join('\n')).not.toContain('dsh-agency-agents')
  })
})
