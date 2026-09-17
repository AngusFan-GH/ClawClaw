import {
  DESKTOP_SKILLS_ACTION_PATH, DESKTOP_SKILLS_PATH,
  type DesktopRecycledSkill, type DesktopSkillDetail, type DesktopSkillsView, type DesktopSkillView,
} from '../skills-contract.ts'

type FetchLike = (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}
function text(value: unknown, max = 16_384): value is string { return typeof value === 'string' && value.length <= max }
function parseSkill(value: unknown): DesktopSkillView {
  if (!isRecord(value) || !text(value.name, 256) || value.name.length === 0 || !text(value.description)
    || !text(value.source, 256) || !text(value.provider, 256) || typeof value.modelInvocable !== 'boolean'
    || typeof value.userInvocable !== 'boolean' || typeof value.editable !== 'boolean'
    || (value.whenToUse !== undefined && !text(value.whenToUse))) throw new Error('dsh-plugin-desktop: invalid Skill response')
  return Object.freeze({ name: value.name, description: value.description,
    ...(value.whenToUse === undefined ? {} : { whenToUse: value.whenToUse }), source: value.source, provider: value.provider,
    modelInvocable: value.modelInvocable, userInvocable: value.userInvocable, editable: value.editable })
}
export function parseDesktopSkillsView(value: unknown): DesktopSkillsView {
  if (!isRecord(value) || !Array.isArray(value.skills) || value.skills.length > 10_000) {
    throw new Error('dsh-plugin-desktop: invalid Skills response')
  }
  const skills = value.skills.map(parseSkill)
  if (new Set(skills.map(skill => skill.name)).size !== skills.length) throw new Error('dsh-plugin-desktop: duplicate Skill response row')
  if (!Array.isArray(value.recycled) || value.recycled.length > 10_000) throw new Error('dsh-plugin-desktop: invalid Skills recycle response')
  const recycled = value.recycled.map(value => {
    if (!isRecord(value) || !text(value.id, 512) || !text(value.name, 256) || !text(value.deletedAt, 256)) throw new Error('dsh-plugin-desktop: invalid recycled Skill')
    return Object.freeze({ id: value.id, name: value.name, deletedAt: value.deletedAt }) as DesktopRecycledSkill
  })
  return Object.freeze({ skills: Object.freeze(skills), recycled: Object.freeze(recycled) })
}
export function parseDesktopSkillDetail(value: unknown): DesktopSkillDetail {
  const skill = parseSkill(value)
  if (!isRecord(value) || !text(value.content, 256 * 1024) || (value.path !== undefined && !text(value.path, 8_192))) {
    throw new Error('dsh-plugin-desktop: invalid Skill detail response')
  }
  return Object.freeze({ ...skill, content: value.content, ...(value.path === undefined ? {} : { path: value.path }) })
}
async function readResponse(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('Skills response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}
export interface DesktopSkillsApi {
  read(): Promise<readonly DesktopSkillView[]>
  readView(): Promise<DesktopSkillsView>
  detail(name: string): Promise<DesktopSkillDetail>
  setModelInvocable(name: string, enabled: boolean): Promise<readonly DesktopSkillView[]>
  setUserInvocable(name: string, enabled: boolean): Promise<readonly DesktopSkillView[]>
  importDocument(content: string): Promise<DesktopSkillsView>
  recycle(name: string): Promise<DesktopSkillsView>
  restore(id: string): Promise<DesktopSkillsView>
}
export function createDesktopSkillsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis)): DesktopSkillsApi {
  const post = async (body: object): Promise<unknown> => readResponse(await fetcher(DESKTOP_SKILLS_ACTION_PATH, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify(body),
  }))
  return Object.freeze({
    async read() {
      const value = await readResponse(await fetcher(DESKTOP_SKILLS_PATH, { method: 'GET', credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }))
      return parseDesktopSkillsView(value).skills
    },
    async readView() {
      const value = await readResponse(await fetcher(DESKTOP_SKILLS_PATH, { method: 'GET', credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }))
      return parseDesktopSkillsView(value)
    },
    async detail(name: string) { return parseDesktopSkillDetail(await post({ action: 'detail', name })) },
    async setModelInvocable(name: string, enabled: boolean) {
      return parseDesktopSkillsView(await post({ action: 'set-model-invocable', name, enabled })).skills
    },
    async setUserInvocable(name: string, enabled: boolean) { return parseDesktopSkillsView(await post({ action: 'set-user-invocable', name, enabled })).skills },
    async importDocument(content: string) { return parseDesktopSkillsView(await post({ action: 'import', content })) },
    async recycle(name: string) { return parseDesktopSkillsView(await post({ action: 'recycle', name })) },
    async restore(id: string) { return parseDesktopSkillsView(await post({ action: 'restore', id })) },
  })
}
