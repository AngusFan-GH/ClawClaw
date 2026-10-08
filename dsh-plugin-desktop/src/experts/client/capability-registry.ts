import type { DesktopMcpApi } from '../../client/mcp-api.js'
import type { DesktopSkillsApi } from '../../client/skills-api.js'
import type { DesktopMcpServerView } from '../../mcp-contract.js'
import type { DesktopSkillView } from '../../skills-contract.js'
import { expertCapabilityCatalog, type ExpertCapabilityCatalog } from './capability-options.js'

export interface CapabilityRegistrySnapshot {
  readonly catalog: ExpertCapabilityCatalog
  readonly loading: boolean
  readonly skillsError?: string
  readonly mcpError?: string
  readonly revision: number
}

const EMPTY_CATALOG: ExpertCapabilityCatalog = Object.freeze({ skills: Object.freeze([]), mcpServers: Object.freeze([]) })

export class ExpertCapabilityRegistry {
  private snapshot: CapabilityRegistrySnapshot = Object.freeze({ catalog: EMPTY_CATALOG, loading: true, revision: 0 })
  private readonly listeners = new Set<() => void>()
  private pending: Promise<void> | undefined
  private timer: ReturnType<typeof setInterval> | undefined
  private generation = 0
  private skills: readonly DesktopSkillView[] = []
  private mcpServers: readonly DesktopMcpServerView[] = []

  constructor(
    private readonly skillsApi: Pick<DesktopSkillsApi, 'read'>,
    private readonly mcpApi: Pick<DesktopMcpApi, 'read'>,
  ) {}

  getSnapshot = (): CapabilityRegistrySnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (this.listeners.size === 1) {
      void this.refresh()
      this.timer = setInterval(() => { void this.refresh(true) }, 5_000)
    }
    return () => {
      this.listeners.delete(listener)
      if (this.listeners.size === 0 && this.timer !== undefined) {
        clearInterval(this.timer)
        this.timer = undefined
      }
    }
  }

  refresh(silent = false): Promise<void> {
    if (this.pending !== undefined) return this.pending
    const generation = ++this.generation
    if (!silent && !this.snapshot.loading) this.publish({ ...this.snapshot, loading: true })
    const pending = Promise.allSettled([this.skillsApi.read(), this.mcpApi.read()]).then(([skills, mcp]) => {
      if (generation !== this.generation) return
      if (skills.status === 'fulfilled') this.skills = skills.value
      if (mcp.status === 'fulfilled') this.mcpServers = mcp.value
      const catalog = expertCapabilityCatalog(this.skills, this.mcpServers)
      this.publish(Object.freeze({
        catalog,
        loading: false,
        ...(skills.status === 'rejected' ? { skillsError: errorMessage(skills.reason) } : {}),
        ...(mcp.status === 'rejected' ? { mcpError: errorMessage(mcp.reason) } : {}),
        revision: this.snapshot.revision + 1,
      }))
    }).finally(() => { if (this.pending === pending) this.pending = undefined })
    this.pending = pending
    return pending
  }

  invalidate(): void {
    this.generation++
    this.pending = undefined
    void this.refresh(true)
  }

  private publish(next: CapabilityRegistrySnapshot): void {
    this.snapshot = next
    for (const listener of this.listeners) listener()
  }
}

function errorMessage(value: unknown): string {
  return value instanceof Error ? value.message : String(value)
}
