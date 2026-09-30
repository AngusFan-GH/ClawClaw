import type { LaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'

const DSH_HOME = 'DSH_HOME'
const DSH_AGENTS_HOME = 'DSH_AGENTS_HOME'

export function withDesktopDshHome(
  environment: LaunchEnvironmentSnapshot,
  homeDir: string,
): LaunchEnvironmentSnapshot {
  const entry = Object.freeze({ value: homeDir, source: 'process' as const })
  return Object.freeze({
    get: (name: string) => {
      const normalized = name.toUpperCase()
      if (normalized === DSH_HOME) return entry
      if (normalized === DSH_AGENTS_HOME) return undefined
      return environment.get(name)
    },
    getFrom: (name: string, sources: Parameters<LaunchEnvironmentSnapshot['getFrom']>[1]) => {
      const normalized = name.toUpperCase()
      if (normalized === DSH_HOME) return sources.includes('process') ? entry : undefined
      if (normalized === DSH_AGENTS_HOME) return undefined
      return environment.getFrom(name, sources)
    },
  })
}
