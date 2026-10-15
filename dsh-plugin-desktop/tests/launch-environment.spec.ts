import { createLaunchEnvironmentSnapshot } from '@deepseek-ai/dsh-launch-environment'
import { describe, expect, it } from 'vitest'
import { withDesktopLaunchEnvironment } from '../src/launch-environment.ts'

describe('Desktop launch environment policy', () => {
  const homeDir = 'C:\\Users\\Desktop User\\AppData\\Roaming\\ClawClaw\\safe-mode\\dsh-home'

  it.each(['DSH_HOME', 'dsh_home', 'Dsh_Home'])('overrides %s for Windows Host child launches', name => {
    const environment = createLaunchEnvironmentSnapshot([{
      source: 'process',
      values: { DSH_HOME: 'C:\\Users\\Desktop User\\.dsh' },
    }])
    const launch = withDesktopLaunchEnvironment(environment, homeDir)

    expect(launch.get(name)).toEqual({ value: homeDir, source: 'process' })
    expect(launch.getFrom(name, ['process'])).toEqual({ value: homeDir, source: 'process' })
    expect(environment.get('DSH_HOME')?.value).toBe('C:\\Users\\Desktop User\\.dsh')
    expect(Object.isFrozen(launch)).toBe(true)
    expect(Object.isFrozen(launch.get(name))).toBe(true)
  })

  it('supplies the selected home even when it was absent from the inherited environment', () => {
    const environment = createLaunchEnvironmentSnapshot([{ source: 'process', values: {} }])
    const launch = withDesktopLaunchEnvironment(environment, homeDir)

    expect(launch.get('DSH_HOME')).toEqual({ value: homeDir, source: 'process' })
    expect(launch.getFrom('DSH_HOME', ['project-env', 'user-env'])).toBeUndefined()
    expect(launch.getFrom('DSH_HOME', [])).toBeUndefined()
  })

  it('preserves unrelated values, source restrictions, and file provenance', () => {
    const environment = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { VALUE: 'inherited' } },
      { source: 'project-env', path: 'C:\\Project\\.env', values: { VALUE: 'project' } },
      { source: 'user-env', path: 'C:\\Home\\.env', values: { VALUE: 'user' } },
    ])
    const launch = withDesktopLaunchEnvironment(environment, homeDir)

    expect(launch.get('VALUE')).toEqual(environment.get('VALUE'))
    expect(launch.getFrom('VALUE', ['project-env'])).toEqual(environment.getFrom('VALUE', ['project-env']))
    expect(launch.getFrom('VALUE', ['user-env'])).toEqual(environment.getFrom('VALUE', ['user-env']))
    expect(launch.get('MISSING')).toBeUndefined()
  })

  it.each(['DSH_AGENTS_HOME', 'dsh_agents_home'])('does not expose inherited %s to the embedded Host', name => {
    const environment = createLaunchEnvironmentSnapshot([
      { source: 'process', values: { DSH_AGENTS_HOME: 'C:\\Users\\Desktop User\\.agents' } },
      { source: 'project-env', path: 'C:\\Project\\.env', values: { DSH_AGENTS_HOME: 'C:\\Project\\.agents' } },
    ])
    const launch = withDesktopLaunchEnvironment(environment, homeDir)

    expect(launch.get(name)).toBeUndefined()
    expect(launch.getFrom(name, ['process', 'project-env'])).toBeUndefined()
  })

  it.each(['SPIRITX_API_KEY', 'spiritx_api_key'])('makes inherited %s a writable compatibility fallback', name => {
    const environment = createLaunchEnvironmentSnapshot([{
      source: 'process', values: { SPIRITX_API_KEY: 'inherited-key' },
    }])
    const launch = withDesktopLaunchEnvironment(environment, homeDir)

    expect(launch.get(name)).toEqual({ value: 'inherited-key', source: 'project-env' })
    expect(launch.getFrom(name, ['process'])).toBeUndefined()
    expect(launch.getFrom(name, ['project-env'])).toEqual({
      value: 'inherited-key', source: 'project-env',
    })
  })

  it('preserves normal read-only precedence for credentials not owned by the Desktop product', () => {
    const environment = createLaunchEnvironmentSnapshot([{
      source: 'process', values: { OTHER_API_KEY: 'inherited-key' },
    }])
    const launch = withDesktopLaunchEnvironment(environment, homeDir)

    expect(launch.getFrom('OTHER_API_KEY', ['process'])).toEqual({
      value: 'inherited-key', source: 'process',
    })
  })
})
