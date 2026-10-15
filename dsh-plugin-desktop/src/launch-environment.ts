import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const DSH_HOME = 'DSH_HOME'
const DSH_AGENTS_HOME = 'DSH_AGENTS_HOME'
const SPIRITX_API_KEY = 'SPIRITX_API_KEY'

export function withDesktopLaunchEnvironment(
  environment: LaunchEnvironmentSnapshot,
  homeDir: string,
): LaunchEnvironmentSnapshot {
  const entry = Object.freeze({ value: homeDir, source: 'process' as const })
  return Object.freeze({
    get: (name: string) => {
      const normalized = name.toUpperCase()
      if (normalized === DSH_HOME) return entry
      if (normalized === DSH_AGENTS_HOME) return undefined
      if (normalized === SPIRITX_API_KEY) {
        // The GUI owns this credential. Keep an inherited value as a migration
        // fallback, but let credentials-local persist and override a replacement.
        const inherited = environment.getFrom(SPIRITX_API_KEY, ['process'])
        return inherited === undefined
          ? environment.get(SPIRITX_API_KEY)
          : Object.freeze({ ...inherited, source: 'project-env' as const })
      }
      return environment.get(name)
    },
    getFrom: (name: string, sources: Parameters<LaunchEnvironmentSnapshot['getFrom']>[1]) => {
      const normalized = name.toUpperCase()
      if (normalized === DSH_HOME) return sources.includes('process') ? entry : undefined
      if (normalized === DSH_AGENTS_HOME) return undefined
      if (normalized === SPIRITX_API_KEY) {
        if (sources.includes('project-env')) {
          const inherited = environment.getFrom(SPIRITX_API_KEY, ['process'])
          if (inherited !== undefined) {
            return Object.freeze({ ...inherited, source: 'project-env' as const })
          }
        }
        return environment.getFrom(SPIRITX_API_KEY, sources.filter(source => source !== 'process'))
      }
      return environment.getFrom(name, sources)
    },
  })
}
