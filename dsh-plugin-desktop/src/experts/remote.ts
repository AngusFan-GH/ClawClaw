import { AGENCY_TEAM_SERVICE, type AgencyTeamLibrary } from './team-library.js'
import { nativeTeamMemberName } from './team-engine.js'
import { teamText } from './team-i18n.js'
import type { TeamInput, TeamSnapshot, TeamEngineStatus } from './team-contract.js'
import type { Context } from '@deepseek-ai/cordis'
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { TypertContribution } from '@deepseek-ai/dsh-typert-registry'
import type {} from '@deepseek-ai/dsh-typert-registry'
import { AGENCY_AGENTS_DESCRIPTORS } from './remote-contract.js'
import { AGENCY_PERSONA_SERVICE, type AgencyPersonaSource } from './index.js'
import { formatHost, readHostLocale } from './i18n.js'
import { AGENCY_LIBRARY_SERVICE, type AgencyExpertLibrary } from './expert-library.js'
import type { CatalogSnapshot, CustomExpertInput } from './expert-contract.js'

export { readExpertPrompt, readLocalizedExpertPrompt } from './index.js'

function personaSource(ctx: Context): AgencyPersonaSource {
  try {
    const source = ctx.get(AGENCY_PERSONA_SERVICE) as AgencyPersonaSource | undefined
    if (source !== undefined) return source
  } catch (cause: unknown) {
    throw new Error(formatHost(readHostLocale(ctx), 'error.personaSourceUnavailable'), { cause })
  }
  throw new Error(formatHost(readHostLocale(ctx), 'error.personaSourceUnavailable'))
}

/**
 * Host 严格描述符。Gateway 优先读取它，避免启动期间的 SRC 扫描缓存遗漏
 * 后加载的外部插件服务。
 */
const TYPERT = {
  package: 'dsh-plugin-desktop/experts',
  face: 'host',
  schemas: [],
  model: { services: [], events: [], objects: [] },
  invocations: AGENCY_AGENTS_DESCRIPTORS,
} satisfies TypertContribution

/** 供客户端读取和保存已启用专家的顶层 Host Remote 服务。 */
export default class AgencyAgentsRemote extends TypertRemoteService {
  static inject = ['settings', 'typert']

  constructor(ctx: Context) {
    super(ctx, 'agencyAgents')
    this.ctx.typert.register(TYPERT)
  }

  private teams(): AgencyTeamLibrary {
    const library = this.ctx.get(AGENCY_TEAM_SERVICE) as AgencyTeamLibrary | undefined
    if (!library) throw new Error(teamText(readHostLocale(this.ctx), '专家团服务不可用，请重新加载插件。'))
    return library
  }
  async getTeams(): Promise<TeamSnapshot> {
    const snapshot = await this.teams().snapshot()
    const engine = this.ctx.get('agencyAgentsTeamEngine') as (() => TeamEngineStatus) | undefined
    const nativeMembers = Object.fromEntries(snapshot.teams.flatMap(team => team.members.map(member => [nativeTeamMemberName(team.id, member.expertSlug), member.expertSlug])))
    return { ...snapshot, nativeMembers, ...(engine ? { engine: engine() } : {}) }
  }
  async saveTeam(team: TeamInput, enabled: boolean, expectedRevision: number): Promise<TeamSnapshot> { return this.teams().save(team, enabled, expectedRevision) }
  async setTeamEnabled(id: string, enabled: boolean, expectedRevision: number): Promise<TeamSnapshot> { return this.teams().setEnabled(id, enabled, expectedRevision) }
  async deleteTeam(id: string, expectedRevision: number): Promise<TeamSnapshot> { return this.teams().remove(id, expectedRevision) }

  private library(): AgencyExpertLibrary {
    const library = this.ctx.get(AGENCY_LIBRARY_SERVICE) as AgencyExpertLibrary | undefined
    if (library === undefined) throw new Error(formatHost(readHostLocale(this.ctx), 'error.personaSourceUnavailable'))
    return library
  }

  /** 返回动态名册，不预加载任何专家提示词正文。 */
  async getCatalog(): Promise<CatalogSnapshot> { return this.library().catalog() }

  async getCustomExpert(slug: string): Promise<CustomExpertInput> {
    const { deleted: _deleted, wasEnabled: _wasEnabled, ...expert } = await this.library().getCustom(slug)
    return expert
  }

  /** 新建或更新自定义专家，同时提交启用状态；过期修订号拒绝写入。 */
  async saveCustomExpert(expert: CustomExpertInput, enabled: boolean, expectedRevision: number): Promise<CatalogSnapshot> {
    return this.library().saveCustom(expert, enabled, expectedRevision)
  }

  async deleteCustomExpert(slug: string, expectedRevision: number): Promise<CatalogSnapshot> {
    return this.library().deleteCustom(slug, expectedRevision)
  }

  /** Compatibility endpoint backed by the same authoritative snapshot as getCatalog(). */
  async getEnabled(): Promise<{ enabled: string[]; revision: number }> {
    const { enabled, revision } = await this.library().catalog()
    return { enabled, revision }
  }

  /** 整体替换启用的专家 slug 列表。 */
  async setEnabled(enabled: string[], expectedRevision: number): Promise<{ enabled: string[]; revision: number }> {
    return this.library().setEnabled(enabled, expectedRevision)
  }

  /** 按需读取一位专家的 persona 正文，避免将完整提示词随客户端名册预加载。 */
  async getPrompt(slug: string, division: string): Promise<{ prompt: string }> {
    return personaSource(this.ctx).getPrompt(slug, division, readHostLocale(this.ctx))
  }
}

// Keep Remote metadata explicit so the published Node 22 artifact does not
// depend on untransformed decorator syntax.
Object.defineProperty(AgencyAgentsRemote.prototype, '@deepseek-ai/dsh-typert-protocol/remote-methods', {
  configurable: true,
  value: Object.freeze({
    version: 1,
    methods: Object.freeze([
      'getTeams',
      'saveTeam',
      'setTeamEnabled',
      'deleteTeam',
      'getCatalog',
      'getCustomExpert',
      'saveCustomExpert',
      'deleteCustomExpert',
      'getEnabled',
      'setEnabled',
      'getPrompt',
    ].map(method => Object.freeze({ method, invocation: Object.freeze({ kind: 'direct' as const }) }))),
  }),
})
