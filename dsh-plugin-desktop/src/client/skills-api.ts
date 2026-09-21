import {
  DESKTOP_SKILLS_ACTION_PATH, DESKTOP_SKILLS_PATH,
  type DesktopRecycledSkill, type DesktopSkillDetail, type DesktopSkillsView, type DesktopSkillView,
  type DesktopSkillInput, type DesktopSkillsScope, type DesktopSkillsWorkspace,
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
  let installed: DesktopSkillsView['installed']
  if (value.installed !== undefined) {
    if (!Array.isArray(value.installed) || value.installed.length > 10_000) throw new Error('Invalid Skill installations')
    installed = value.installed.map(item => {
      if (!isRecord(item) || !text(item.name, 512) || !text(item.path, 8192)
        || !['effective', 'overridden', 'not-discovered', 'invalid', 'unavailable'].includes(String(item.status))) throw new Error('Invalid Skill installation')
      if ((item.reason !== undefined && !['missing-file', 'unreadable-file', 'inspection-limit', 'invalid-document'].includes(String(item.reason)))
        || (item.effectivePath !== undefined && !text(item.effectivePath, 8192))
        || (item.effectiveSource !== undefined && !text(item.effectiveSource, 256))) throw new Error('Invalid Skill installation')
      return { name: item.name, path: item.path, status: item.status as NonNullable<DesktopSkillsView['installed']>[number]['status'],
        ...(item.reason === undefined ? {} : { reason: item.reason as NonNullable<NonNullable<DesktopSkillsView['installed']>[number]['reason']> }),
        ...(item.effectivePath === undefined ? {} : { effectivePath: item.effectivePath }),
        ...(item.effectiveSource === undefined ? {} : { effectiveSource: item.effectiveSource }) }
    })
  }
  if (value.refreshPending !== undefined && typeof value.refreshPending !== 'boolean') throw new Error('Invalid Skill refresh state')
  if (new Set(skills.map(skill => skill.name)).size !== skills.length) throw new Error('dsh-plugin-desktop: duplicate Skill response row')
  if (!Array.isArray(value.recycled) || value.recycled.length > 10_000) throw new Error('dsh-plugin-desktop: invalid Skills recycle response')
  const recycled = value.recycled.map(value => {
    if (!isRecord(value) || !text(value.id, 512) || !text(value.name, 256) || !text(value.deletedAt, 256)) throw new Error('dsh-plugin-desktop: invalid recycled Skill')
    return Object.freeze({ id: value.id, name: value.name, deletedAt: value.deletedAt }) as DesktopRecycledSkill
  })
  let locations: DesktopSkillsView['locations']
  if (value.locations !== undefined) {
    const paths = value.locations
    if (!isRecord(paths) || !text(paths.userLibrary, 8192) || paths.userLibrary === ''
      || !text(paths.recycleBin, 8192) || paths.recycleBin === ''
      || (paths.preset !== undefined && (!text(paths.preset, 512) || paths.preset === ''))
      || (paths.cwd !== undefined && (!text(paths.cwd, 8192) || paths.cwd === ''))) throw new Error('Invalid Skill locations')
    locations = Object.freeze({ userLibrary: paths.userLibrary, recycleBin: paths.recycleBin,
      ...(paths.cwd === undefined ? {} : { cwd: paths.cwd }),
      ...(paths.preset === undefined ? {} : { preset: paths.preset }) })
  }
  return Object.freeze({ skills: Object.freeze(skills), recycled: Object.freeze(recycled),
    ...(installed === undefined ? {} : { installed }),
    ...(value.refreshPending === true ? { refreshPending: true } : {}),
    ...(locations === undefined ? {} : { locations }) })
}
export function parseDesktopSkillDetail(value: unknown): DesktopSkillDetail {
  const skill = parseSkill(value)
  if (!isRecord(value) || !text(value.content, 256 * 1024) || (value.path !== undefined && !text(value.path, 8_192))) {
    throw new Error('dsh-plugin-desktop: invalid Skill detail response')
  }
  if (value.revision !== undefined && (typeof value.revision !== 'string' || !/^[a-f0-9]{64}$/u.test(value.revision))) throw new Error('Invalid Skill revision')
  return Object.freeze({ ...skill, content: value.content, ...(value.path === undefined ? {} : { path: value.path }),
    ...(value.revision === undefined ? {} : { revision: value.revision }) })
}
async function readResponse(response: Response): Promise<unknown> {
  let value: unknown
  try { value = await response.json() as unknown } catch { throw new Error('Skills response was not JSON') }
  if (!response.ok) throw new Error(isRecord(value) && typeof value.error === 'string' ? value.error : `HTTP ${String(response.status)}`)
  return value
}
export interface DesktopSkillsApi {
  forPreset(preset?: string): DesktopSkillsApi
  forScope(scope: DesktopSkillsScope): DesktopSkillsApi
  workspaces(): Promise<readonly DesktopSkillsWorkspace[]>
  presets(): Promise<readonly { id: string, name: string }[]>
  read(): Promise<readonly DesktopSkillView[]>
  readView(): Promise<DesktopSkillsView>
  detail(name: string): Promise<DesktopSkillDetail>
  setModelInvocable(name: string, enabled: boolean): Promise<readonly DesktopSkillView[]>
  setUserInvocable(name: string, enabled: boolean): Promise<readonly DesktopSkillView[]>
  importDocument(content: string): Promise<DesktopSkillsView>
  create(input: DesktopSkillInput): Promise<DesktopSkillsView>
  update(name: string, input: DesktopSkillInput, revision?: string): Promise<DesktopSkillsView>
  recycle(name: string): Promise<DesktopSkillsView>
  restore(id: string): Promise<DesktopSkillsView>
}
export function createDesktopSkillsApi(fetcher: FetchLike = globalThis.fetch.bind(globalThis), preset?: string, scope: DesktopSkillsScope = {}): DesktopSkillsApi {
  const selection = { ...scope }
  const post = async (body: object): Promise<unknown> => readResponse(await fetcher(DESKTOP_SKILLS_ACTION_PATH, {
    method: 'POST', credentials: 'same-origin', redirect: 'error',
    headers: { Accept: 'application/json', 'Content-Type': 'application/json' }, body: JSON.stringify({ ...body, ...selection, ...(preset === undefined ? {} : { preset }) }),
  }))
  return Object.freeze({
    forPreset(next?: string) { return createDesktopSkillsApi(fetcher, next, selection) },
    forScope(next: DesktopSkillsScope) { return createDesktopSkillsApi(fetcher, preset, next) },
    async workspaces() {
      const value = await post({ action: 'workspaces' })
      if (!isRecord(value) || !Array.isArray(value.workspaces) || value.workspaces.length > 10_000) throw new Error('Invalid Workspaces')
      return value.workspaces.map(item => {
        if (!isRecord(item) || !text(item.id, 512) || item.id === '' || !text(item.title, 512) || !text(item.path, 8192)) throw new Error('Invalid Workspace')
        return { id: item.id, title: item.title, path: item.path }
      })
    },
    async presets() {
      const value = await post({ action: 'presets' })
      if (!isRecord(value) || !Array.isArray(value.presets) || value.presets.length > 10_000) throw new Error('Invalid Agent presets')
      return value.presets.map(item => {
        if (!isRecord(item) || !text(item.id, 128) || !text(item.name, 512)) throw new Error('Invalid Agent preset')
        return { id: item.id, name: item.name }
      })
    },
    async read() {
      if (preset !== undefined || selection.workspaceId !== undefined || selection.sessionId !== undefined) return parseDesktopSkillsView(await post({ action: 'read' })).skills
      const value = await readResponse(await fetcher(DESKTOP_SKILLS_PATH, { method: 'GET', credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }))
      return parseDesktopSkillsView(value).skills
    },
    async readView() {
      if (preset !== undefined || selection.workspaceId !== undefined || selection.sessionId !== undefined) return parseDesktopSkillsView(await post({ action: 'read' }))
      const value = await readResponse(await fetcher(DESKTOP_SKILLS_PATH, { method: 'GET', credentials: 'same-origin',
        redirect: 'error', cache: 'no-store', headers: { Accept: 'application/json' } }))
      return parseDesktopSkillsView(value)
    },
    async detail(name: string) { return parseDesktopSkillDetail(await post({ action: 'detail', name })) },
    async setModelInvocable(name: string, enabled: boolean) {
      const view = parseDesktopSkillsView(await post({ action: 'set-model-invocable', name, enabled }))
      if (view.refreshPending) throw new Error('skillSavedRefreshPending')
      return view.skills
    },
    async setUserInvocable(name: string, enabled: boolean) {
      const view = parseDesktopSkillsView(await post({ action: 'set-user-invocable', name, enabled }))
      if (view.refreshPending) throw new Error('skillSavedRefreshPending')
      return view.skills
    },
    async importDocument(content: string) { return parseDesktopSkillsView(await post({ action: 'import', content })) },
    async create(input: DesktopSkillInput) { return parseDesktopSkillsView(await post({ action: 'create', input })) },
    async update(name: string, input: DesktopSkillInput, revision?: string) { return parseDesktopSkillsView(await post({ action: 'update', name, input, ...(revision === undefined ? {} : { revision }) })) },
    async recycle(name: string) { return parseDesktopSkillsView(await post({ action: 'recycle', name })) },
    async restore(id: string) { return parseDesktopSkillsView(await post({ action: 'restore', id })) },
  })
}
