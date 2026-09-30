import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, readLegacyAgentPreset } from '../src/legacy-agent-presets.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-legacy-presets-'))
  roots.push(root)
  return root
}

describe('legacy Agent preset registrar', () => {
  it('preserves metadata, expressions and preset-relative plugin paths', async () => {
    const root = await fixture()
    const directory = join(root, 'custom')
    await mkdir(directory)
    await writeFile(join(directory, 'preset.yml'), 'name: Custom\ndescription: Historical preset\norder: 7\n')
    await writeFile(join(directory, 'agent.cordis.yml'), [
      '- id: local',
      '  name: ./plugin.mjs',
      '  disabled: !!js process.platform === "win32"',
      '',
    ].join('\n'))

    const definition = await readLegacyAgentPreset(directory, 'custom')
    expect(definition).toMatchObject({ id: 'custom', name: 'Custom', description: 'Historical preset', order: 7 })
    expect(definition.plugins[0]).toMatchObject({
      id: 'local',
      name: expect.stringMatching(/^file:/),
      disabled: { __jsExpr: 'process.platform === "win32"' },
    })
    expect(definition.plugins.find(row => row.id === 'skill-filesystem')).toMatchObject({
      name: '@deepseek-ai/dsh-skill-filesystem',
      config: {
        includeDefaultRoots: false,
        customSkillDirs: [expect.stringContaining('skills')],
        bundledSkillDir: expect.stringContaining('skills'),
      },
    })
    expect(definition.plugins.find(row => row.id === 'clawclaw-skill-filesystem')).toEqual({
      id: 'clawclaw-skill-filesystem',
      name: 'dsh-plugin-desktop/clawclaw-skill-filesystem',
    })
  })

  it('isolates invalid presets, lets official ids win, and disposes successful registrations', async () => {
    const root = await fixture()
    for (const [id, composition] of [['custom', '- name: plugin\n'], ['broken', '- no-name: true\n'], ['standard', '- name: shadow\n']] as const) {
      const directory = join(root, id)
      await mkdir(directory)
      await writeFile(join(directory, 'preset.yml'), `name: ${id}\n`)
      await writeFile(join(directory, 'agent.cordis.yml'), composition)
    }
    const dispose = vi.fn(async () => {})
    const register = vi.fn(async (definition: { id: string }) => {
      if (definition.id === 'standard') throw new Error('Duplicate agent preset: standard')
      return dispose
    })
    let cleanup: (() => Promise<void>) | undefined
    const warn = vi.fn()
    const ctx = {
      agentPresets: { register },
      logger: { warn },
      effect: (factory: () => () => Promise<void>) => { cleanup = factory() },
    }
    await apply(ctx as never, { root })
    expect(register.mock.calls.map(([definition]) => definition.id)).toEqual(['custom', 'standard'])
    expect(warn).toHaveBeenCalledTimes(2)
    await cleanup?.()
    expect(dispose).toHaveBeenCalledOnce()
  })
})
