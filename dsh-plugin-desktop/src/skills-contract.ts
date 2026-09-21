export const DESKTOP_SKILLS_PATH = '/api/desktop/skills'
export const DESKTOP_SKILLS_ACTION_PATH = '/api/desktop/skills/action'

export interface DesktopSkillsScope {
  readonly workspaceId?: string
  readonly sessionId?: string
}
export interface DesktopSkillsWorkspace {
  readonly id: string
  readonly title: string
  readonly path: string
}

export interface DesktopSkillView {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly source: string
  readonly provider: string
  readonly modelInvocable: boolean
  readonly userInvocable: boolean
  readonly editable: boolean
}

export interface DesktopSkillDetail extends DesktopSkillView {
  readonly content: string
  readonly path?: string
  readonly revision?: string
}

export interface DesktopRecycledSkill {
  readonly id: string
  readonly name: string
  readonly deletedAt: string
}

export interface DesktopSkillsView {
  readonly installed?: readonly DesktopSkillInstallation[]
  readonly refreshPending?: boolean
  readonly skills: readonly DesktopSkillView[]
  readonly recycled: readonly DesktopRecycledSkill[]
  readonly locations?: {
    readonly userLibrary: string
    readonly recycleBin: string
    readonly cwd?: string
    readonly preset?: string
  }
}

export interface DesktopSkillInstallation {
  readonly name: string
  readonly path: string
  readonly status: 'effective' | 'overridden' | 'not-discovered' | 'invalid' | 'unavailable'
  readonly reason?: 'missing-file' | 'unreadable-file' | 'inspection-limit' | 'invalid-document'
  readonly effectivePath?: string
  readonly effectiveSource?: string
}

export interface DesktopSkillInput {
  readonly name: string
  readonly description: string
  readonly whenToUse?: string
  readonly instructions: string
}
