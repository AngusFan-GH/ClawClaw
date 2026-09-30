import type { Context } from '@deepseek-ai/cordis'
import type { SkillEntry } from '@deepseek-ai/dsh-api-remotes/client'
import type { InputState, InsertTextRequest } from '@deepseek-ai/dsh-client-ui-conversation/client'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
import type { ISessions } from '@deepseek-ai/dsh-api-session-controller/client'
import type {} from '@deepseek-ai/dsh-client-ui-commands/client'
import type {} from './skills-settings.ts'
import { ConversationSkills } from './ConversationSkills.tsx'

export interface ConversationSkillCatalog {
  readonly skills: readonly SkillEntry[]
  readonly commands: readonly string[]
}

export function rankConversationSkills(skills: readonly SkillEntry[], query: string): SkillEntry[] {
  const needle = query.trim().toLocaleLowerCase()
  const score = (skill: SkillEntry): number => {
    const name = skill.name.toLocaleLowerCase()
    if (needle === '' || name === needle) return 0
    if (name.startsWith(needle)) return 1
    if (name.includes(needle)) return 2
    if (skill.description.toLocaleLowerCase().includes(needle)) return 3
    return skill.whenToUse?.toLocaleLowerCase().includes(needle) === true ? 4 : 5
  }
  return skills.map(skill => ({ skill, score: score(skill) })).filter(item => item.score < 5)
    .sort((left, right) => left.score - right.score || left.skill.name.localeCompare(right.skill.name)).map(item => item.skill)
}
export interface ConversationSkillsApi {
  list(signal: AbortSignal): Promise<ConversationSkillCatalog>
  select(name: string, signal: AbortSignal): Promise<void>
}
export type SkillPickErrorCode = 'skillUnavailable' | 'skillCommandConflict' | 'skillDraftChanged'
export class SkillPickError extends Error {
  constructor(readonly code: SkillPickErrorCode) { super(code) }
}

/** Insert a gesture without replacing the editor's references or attachments. */
export function skillInsertion(name: string, state: Pick<InputState, 'draft' | 'draftRev' | 'phase'>, catalog: ConversationSkillCatalog): InsertTextRequest {
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(name) || !catalog.skills.some(skill => skill.name === name)) throw new SkillPickError('skillUnavailable')
  const leading = /^\s*\/([^\s]+)/u.exec(state.draft)?.[1]
  if (catalog.commands.includes(name) || (leading !== undefined && catalog.commands.includes(leading))) throw new SkillPickError('skillCommandConflict')
  if (state.phase !== 'plain') throw new SkillPickError('skillDraftChanged')
  const alreadySelected = new RegExp(`(^|\\s)/${name}(?=\\s|$)`, 'u').test(state.draft)
  return { text: alreadySelected ? '' : `/${name} `, span: { start: 0, end: 0, draftRev: state.draftRev } }
}

export function createConversationSkillsApi(deps: {
  list(signal: AbortSignal): Promise<ConversationSkillCatalog>
  snapshot(): Pick<InputState, 'draft' | 'draftRev' | 'phase'>
  generation(): unknown
  insert(request: InsertTextRequest): boolean
}): ConversationSkillsApi {
  return {
    list: deps.list,
    async select(name, signal) {
      const generation = deps.generation()
      const before = deps.snapshot()
      const catalog = await deps.list(signal)
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError')
      const current = deps.snapshot()
      if (generation !== deps.generation() || before.draftRev !== current.draftRev) throw new SkillPickError('skillDraftChanged')
      const request = skillInsertion(name, current, catalog)
      if (request.text !== '' && !deps.insert(request)) throw new SkillPickError('skillDraftChanged')
    },
  }
}

export function applyConversationSkills(ctx: Context): void {
  ctx.inject(['conversation', 'remote.skills', 'remote.commands'], scope => {
    // Host and Client faces share Cordis declarations; keep this boundary
    // explicitly Client-shaped even in the combined Host/Client test program.
    const sessions = scope.get('sessions') as unknown as Pick<ISessions, 'scope'>
    const remote = scope.get('remote') as unknown as {
      commands: { list(id: SessionId): Promise<{ ok: true; value: readonly { name: string }[] } | { ok: false; error: { message: string } }> }
    }
    let generation = 0
    scope.remote.$on('agent-preset/selected', () => { generation++ })
    scope.on('connection/reset', () => { generation++ })
    scope.slots.inject('conversation.input.left', () => scope.slots.register({
      name: 'conversation.input.left', id: 'desktop-skills', order: 30, locale: 'desktop.skills',
      inject: (sessionId: SessionId) => {
        const actx = sessions.scope(sessionId)
        if (actx === undefined) throw new Error('Skills: session scope unavailable')
        // Published client declarations can carry the other release's nominal
        // Context/SessionId brands. Runtime values retain the same wire shape.
        const input = scope.conversation.input.for(actx as unknown as Parameters<typeof scope.conversation.input.for>[0])
        const api = createConversationSkillsApi({
          async list(signal) {
            const skills = await scope.remote.skills.list({ sessionId: sessionId as unknown as Parameters<typeof scope.remote.skills.list>[0]['sessionId'] }, signal)
            if (!skills.ok) throw new Error(skills.error.message)
            const commands = await remote.commands.list(sessionId)
            if (!commands.ok) throw new Error(commands.error.message)
            return { skills: skills.value.skills, commands: commands.value.map(command => command.name) }
          },
          snapshot: () => input.state.getSnapshot(),
          generation: () => generation,
          insert: request => actx.bail('slash/input-insert-text', request) === true,
        })
        return { api }
      },
    }, ConversationSkills))
  })
}
