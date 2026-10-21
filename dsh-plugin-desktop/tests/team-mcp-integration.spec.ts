import { Context } from '@deepseek-ai/cordis'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import type { Agent } from '@deepseek-ai/dsh-agent'
import type { SettingsScope } from '@deepseek-ai/dsh-settings'
import { readFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it, vi } from 'vitest'
import { DesktopMcpController, parseDesktopMcpServer, type DesktopMcpSettings } from '../src/mcp.ts'
import { DESKTOP_MCP_LIFECYCLE_SERVICE } from '../src/mcp-contract.ts'
import { isMcpServerReady } from '../src/mcp-readiness.ts'
import { preflightExpertTeam, resolveExpertComposition } from '../src/experts/index.ts'
import { executeTeam } from '../src/experts/team-runtime.ts'
import { BUILTIN_TEAMS } from '../src/experts/team-contract.ts'
import type { ExpertSummary } from '../src/experts/expert-contract.ts'

describe('real local Team Skill MCP composition', () => {
  it('discovers tools, runs member calculations and blocks a disconnected dependency', async () => {
    const ctx = new Context()
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    const fixture = fileURLToPath(new URL('./fixtures/team-mcp-server.mjs', import.meta.url))
    let settingsValue: DesktopMcpSettings = { mcpServers: [parseDesktopMcpServer({
      serverName: 'office-test', transport: 'stdio', command: process.execPath, args: [fixture], cwd: dirname(fixture),
      enabled: true, reconnect: { enabled: false, initialDelayMs: 100, maxDelayMs: 1000, maxAttempts: 1 },
    })] }
    const settings = { get: () => settingsValue, watch: () => () => {}, update: async (patch: Partial<DesktopMcpSettings>) => { settingsValue = { ...settingsValue, ...patch } } } as unknown as SettingsScope<DesktopMcpSettings>
    const controller = new DesktopMcpController(ctx, settings)
    try {
      const content = await readFile(new URL('../assets/skills/office-excel-workflow/SKILL.md', import.meta.url), 'utf8')
      ctx.reflect.provide('skills', { get: async (name: string) => name === 'office-excel-workflow' ? { name, content, invocation: { modelInvocable: true } } : undefined })
      ctx.reflect.provide(DESKTOP_MCP_LIFECYCLE_SERVICE, { read: () => controller.read() })
      controller.start()
      await vi.waitFor(async () => { expect(isMcpServerReady((await controller.read()).mcpServers[0]!)).toBe(true) }, { timeout: 10_000 })
      const experts: ExpertSummary[] = ['analyst', 'reviewer'].map(slug => ({
        slug, name: slug, nameEn: slug, description: 'Calculations', descriptionEn: 'Calculations', emoji: '', division: 'support', divisionZh: '支持', custom: false,
        skills: [{ name: 'office-excel-workflow', required: true, enabled: true }],
        mcpServers: [{ name: 'office-test', required: true, enabled: true }],
      }))
      const team = { ...structuredClone(BUILTIN_TEAMS.find(item => item.id === 'team-data')!), members: experts.map(expert => ({ expertSlug: expert.slug, duty: 'Check totals', instructions: 'Use the provided values.' })) }
      const parent = { session: { header: { cwd: dirname(fixture) } } } as unknown as Agent
      await preflightExpertTeam(ctx, team, experts, parent)
      const result = await executeTeam({ team, experts, enabled: experts.map(expert => expert.slug), task: 'Sum 10, 20 and 30.', revision: 1,
        readPersona: async expert => expert.description,
        run: async member => {
          const composition = await resolveExpertComposition(ctx, experts.find(expert => expert.slug === member.slug)!, parent, member.persona)
          expect(composition.persona).toContain('office-excel-workflow')
          expect(composition.deniedTools).not.toContain('mcp__office-test__sum')
          const value = await ctx.tools.execute({ name: 'mcp__office-test__sum', arguments: { values: [10, 20, 30] }, callId: ToolCallId(member.slug), signal: new AbortController().signal })
          expect(value).toMatchObject({ isError: false, value: { content: [{ type: 'text', text: '60' }] } })
          return 'Verified total: 60'
        },
      })
      expect(result.coverage).toMatchObject({ status: 'complete', completed: 2 })
      expect(result.results.every(member => member.answer === 'Verified total: 60')).toBe(true)
      await controller.toggle('office-test', false)
      await expect(preflightExpertTeam(ctx, team, experts, parent)).rejects.toThrow('MCP server unavailable: office-test')
    } finally {
      await controller.dispose()
      await ctx.fiber.dispose()
    }
  }, 20_000)
})
