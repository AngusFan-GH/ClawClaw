import { useCallback, useSyncExternalStore } from 'react'
import type { ExpertSummary } from '../expert-contract.js'
import type { ExpertTeam } from '../team-contract.js'
import { teamCapabilityBindings } from '../capability-composition.js'
import { expertCapabilityHealth } from './capability-options.js'
import type { ExpertCapabilityRegistry } from './capability-registry.js'

const subscribeNone = () => () => {}
const emptySnapshot = () => undefined

/** Reuse the same scoped registry for experts, teams and both selection menus. */
export function useTeamCapabilityHealth(registry?: ExpertCapabilityRegistry) {
  const snapshot = useSyncExternalStore(registry?.subscribe ?? subscribeNone, registry?.getSnapshot ?? emptySnapshot)
  return useCallback((team: ExpertTeam, experts: readonly ExpertSummary[]) => snapshot === undefined ? undefined : expertCapabilityHealth(
    teamCapabilityBindings(team, experts), snapshot.catalog, snapshot.loading,
    { skills: snapshot.skillsLoaded, mcpServers: snapshot.mcpLoaded },
  ), [snapshot])
}
