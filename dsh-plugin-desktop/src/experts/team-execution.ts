import type { ExpertSummary } from './expert-contract.js'
import type { ExpertTeam, TeamEngineStatus } from './team-contract.js'
import { teamText, type TeamLocale } from './team-i18n.js'

/** Shared by Host routing and Client explanations; Agent Team cannot isolate member tools. */
export function teamRequiresToolFilter(
  team: { readonly members: ReadonlyArray<{ readonly expertSlug: string }> },
  experts: readonly Pick<ExpertSummary, 'slug' | 'mcpServers'>[],
): boolean {
  return team.members.some(member => experts.find(expert => expert.slug === member.expertSlug)
    ?.mcpServers.some(binding => binding.enabled))
}

/** A library-level forecast. The Host checks the active conversation's tools again at dispatch. */
export function teamExecutionEngine(
  team: ExpertTeam,
  experts: readonly Pick<ExpertSummary, 'slug' | 'mcpServers'>[],
  host: TeamEngineStatus | undefined,
  locale: TeamLocale,
): TeamEngineStatus {
  const tx = (key: string) => teamText(locale, key)
  const base = host ?? { state: 'unsupported' as const, mode: 'subagent' as const, reason: '', recommendation: '' }
  if (team.runtime.mode === 'lead') return {
    ...base, mode: 'subagent', recommendation: '',
    reason: tx('该专家团使用独立主理人执行器，智能体团队开关不改变其协作流程。'),
  }
  if (base.mode === 'native' && teamRequiresToolFilter(team, experts)) return {
    ...base, mode: 'subagent', recommendation: '',
    reason: tx('团队成员配置了 MCP 绑定，本次使用普通子代理以隔离未绑定工具。'),
  }
  return base
}
