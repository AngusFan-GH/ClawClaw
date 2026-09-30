import { mkdir, mkdtemp, rm, writeFile, symlink, lstat } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { stringify } from 'yaml'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DesktopExpertsController, scanExpertPackages, parseExpertManifest } from '../src/experts.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-experts-'))
  roots.push(root)
  return root
}

async function writeExpertPackage(directory: string, files: Record<string, string>): Promise<void> {
  await mkdir(directory, { recursive: true })
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(directory, name), content, 'utf8')
  }
}

/** A complete expert.yml whose id matches the directory name. */
function expertYaml(id: string, overrides: Record<string, unknown> = {}): string {
  const base: Record<string, unknown> = {
    id,
    version: '1.0.0',
    category: 'data-ai',
    display: {
      name: '数据分析师',
      title: '商业数据与可视化顾问',
      description: '清洗数据、识别异常并输出图表和报告。',
      tags: ['Excel', 'CSV', '图表'],
    },
    entry: {
      defaultPrompt: '帮我分析这份数据并输出管理层摘要',
      quickPrompts: ['分析销售数据', '制作经营周报', '排查指标异常'],
    },
  }
  return stringify({ ...base, ...overrides })
}

const PRESET_YML = 'name: Data Analyst\ndescription: Business data advisor\n'
const AGENT_CORDIS = '- name: data-analyst-plugin\n'

function makeRuntime(overrides: {
  presets?: readonly { id: string; name?: string; broken?: string }[]
  resolve?: (id: string) => Promise<{ id: string; broken?: string }>
  create?: (request: { workspaceId?: string; agentPreset?: string }) => Promise<{ sessionId: string; agentPreset?: string }>
  defaultWorkspaceId?: string
} = {}) {
  const create = vi.fn(async (request: { workspaceId?: string; agentPreset?: string }) => ({
    sessionId: 'session-new',
    agentPreset: request.agentPreset ?? '',
  }))
  const resolve = overrides.resolve ?? vi.fn(async (id: string) => {
    const found = overrides.presets?.find(row => row.id === id)
    if (found === undefined) throw new Error(`Unknown agent preset: ${id}`)
    return { id: found.id, ...(found.broken === undefined ? {} : { broken: found.broken }) }
  })
  return {
    runtime: {
      agentPresets: {
        list: vi.fn(async () => overrides.presets ?? []),
        resolve,
      },
      sessionController: { create: overrides.create ?? create },
      workspaceRegistry: {
        list: () => [{ id: 'ws-default', title: '默认', path: '/tmp/workspace-default' }],
        get: (id: string) => id === 'ws-default' ? { id: 'ws-default', path: '/tmp/workspace-default' } : undefined,
      },
      defaultWorkspaceId: () => overrides.defaultWorkspaceId ?? 'ws-default',
    },
    create,
    resolve,
  }
}

describe('expert manifest validation', () => {
  it('accepts a complete expert.yml', async () => {
    const root = await fixture()
    const directory = join(root, 'data-analyst')
    await writeExpertPackage(directory, { 'expert.yml': expertYaml('data-analyst') })
    const manifest = await parseExpertManifest(directory, 'data-analyst')
    expect(manifest).toMatchObject({
      id: 'data-analyst', version: '1.0.0', category: 'data-ai',
      display: { name: '数据分析师', title: '商业数据与可视化顾问', tags: ['Excel', 'CSV', '图表'] },
      entry: { defaultPrompt: '帮我分析这份数据并输出管理层摘要', quickPrompts: ['分析销售数据', '制作经营周报', '排查指标异常'] },
    })
  })

  it('rejects illegal YAML', async () => {
    const root = await fixture()
    const directory = join(root, 'broken')
    await writeExpertPackage(directory, { 'expert.yml': 'id: [unclosed\n  version: 1.0.0\n' })
    await expect(parseExpertManifest(directory, 'broken')).rejects.toThrow(/expert.yml/)
  })

  it('rejects an id that differs from the directory name', async () => {
    const root = await fixture()
    const directory = join(root, 'wrong-dir')
    await writeExpertPackage(directory, { 'expert.yml': expertYaml('data-analyst') })
    await expect(parseExpertManifest(directory, 'wrong-dir')).rejects.toThrow(/does not match directory name/)
  })

  it('rejects illegal id characters', async () => {
    const root = await fixture()
    const directory = join(root, 'bad-id')
    await writeExpertPackage(directory, { 'expert.yml': expertYaml('bad id') })
    await expect(parseExpertManifest(directory, 'bad-id')).rejects.toThrow(/illegal expert id/)
  })

  it('rejects missing required display and entry fields', async () => {
    const root = await fixture()
    const directory = join(root, 'missing')
    await writeExpertPackage(directory, { 'expert.yml': 'id: missing\nversion: 1.0.0\ncategory: x\n' })
    await expect(parseExpertManifest(directory, 'missing')).rejects.toThrow(/display/)
  })
})

describe('expert package scanning', () => {
  it('isolates invalid packages and keeps valid ones', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'data-analyst'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('data-analyst'),
    })
    // expert.yml present but preset.yml missing: invalid expert package.
    await writeExpertPackage(join(root, 'missing-preset'), {
      'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('missing-preset'),
    })
    await writeExpertPackage(join(root, 'broken-yaml'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': 'id: [oops\n',
    })
    await writeExpertPackage(join(root, 'mismatch-dir'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('declared-other-id'),
    })
    const result = await scanExpertPackages(root)
    expect(result.experts.map(expert => expert.id)).toEqual(['data-analyst'])
    expect(result.invalid.map(item => item.id).sort()).toEqual(['broken-yaml', 'mismatch-dir', 'missing-preset'])
    expect(result.invalid.find(item => item.id === 'mismatch-dir')?.reason).toMatch(/does not match directory name/)
  })

  it('skips directories that are legacy presets (no expert.yml)', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'data-analyst'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('data-analyst'),
    })
    // A historical preset package without expert.yml is owned by the legacy registrar.
    await writeExpertPackage(join(root, 'legacy-only'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
    })
    const result = await scanExpertPackages(root)
    expect(result.experts.map(expert => expert.id)).toEqual(['data-analyst'])
    expect(result.invalid).toEqual([])
  })

  it('rejects duplicate ids: the package owning the id wins, the other is isolated', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'shared-id'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('shared-id'),
    })
    await writeExpertPackage(join(root, 'impostor'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('shared-id'),
    })
    const result = await scanExpertPackages(root)
    expect(result.experts.map(expert => expert.id)).toEqual(['shared-id'])
    expect(result.invalid).toHaveLength(1)
    expect(result.invalid[0]?.id).toBe('impostor')
    expect(result.invalid[0]?.reason).toMatch(/duplicate expert id "shared-id".*shared-id/)
  })

  it('rejects symlinked expert.yml and oversize files', async () => {
    const root = await fixture()
    const directory = join(root, 'link-package')
    await mkdir(directory)
    await writeFile(join(directory, 'preset.yml'), PRESET_YML)
    await writeFile(join(directory, 'agent.cordis.yml'), AGENT_CORDIS)
    await symlink(join(root, 'outside.yml'), join(directory, 'expert.yml'))
    await writeFile(join(root, 'outside.yml'), expertYaml('link-package'))
    const linkResult = await scanExpertPackages(root)
    expect(linkResult.experts).toEqual([])
    expect(linkResult.invalid[0]?.reason).toMatch(/regular file/)

    const big = await fixture()
    const bigDir = join(big, 'big-package')
    await writeExpertPackage(bigDir, {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('big-package') + 'x'.repeat(4 * 1024 * 1024),
    })
    const bigResult = await scanExpertPackages(big)
    expect(bigResult.experts).toEqual([])
    expect(bigResult.invalid[0]?.reason).toMatch(/exceeds/)
  })

  it('ignores symlinked directories and non-directory entries', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'real'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('real'),
    })
    await symlink(join(root, 'real'), join(root, 'link-dir'))
    await writeFile(join(root, 'loose-file.yml'), 'id: x\n')
    const result = await scanExpertPackages(root)
    expect(result.experts.map(expert => expert.id)).toEqual(['real'])
    expect(result.invalid).toEqual([])
    const info = await lstat(join(root, 'link-dir'))
    expect(info.isSymbolicLink()).toBe(true)
  })
})

describe('expert availability, search and filtering', () => {
  it('marks experts available only when their preset is registered and healthy', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'data-analyst'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('data-analyst'),
    })
    await writeExpertPackage(join(root, 'writer'), {
      'preset.yml': 'name: Writer\n', 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('writer', {
        category: 'writing',
        display: { name: '技术写作', title: '技术文档与报告写作', description: '撰写技术文档、发布说明与报告。', tags: ['文档', '报告'] },
        entry: { defaultPrompt: '帮我撰写一份产品发布说明', quickPrompts: ['撰写 API 文档', '整理发布说明'] },
      }),
    })
    const { runtime } = makeRuntime({
      presets: [
        { id: 'data-analyst', name: '数据分析师' },
        { id: 'writer', name: '技术写作', broken: 'mount failed: missing plugin' },
      ],
    })
    const controller = new DesktopExpertsController(runtime, root)
    const view = await controller.read()
    const byId = new Map(view.experts.map(expert => [expert.id, expert]))
    expect(byId.get('data-analyst')?.available).toBe(true)
    expect(byId.get('writer')?.available).toBe(false)
    expect(byId.get('writer')?.unavailableReason).toContain('mount failed')
    expect(view.categories).toEqual(['data-ai', 'writing'])
  })

  it('filters by keyword and category', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'data-analyst'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('data-analyst'),
    })
    await writeExpertPackage(join(root, 'writer'), {
      'preset.yml': 'name: Writer\n', 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('writer', {
        category: 'writing',
        display: { name: '技术写作', title: '技术文档与报告写作', description: '撰写技术文档、发布说明与报告。', tags: ['文档', '报告'] },
        entry: { defaultPrompt: '帮我撰写一份产品发布说明', quickPrompts: ['撰写 API 文档', '整理发布说明'] },
      }),
    })
    const { runtime } = makeRuntime({ presets: [{ id: 'data-analyst' }, { id: 'writer' }] })
    const controller = new DesktopExpertsController(runtime, root)
    expect((await controller.read('销售')).experts.map(e => e.id)).toEqual(['data-analyst'])
    expect((await controller.read(undefined, 'writing')).experts.map(e => e.id)).toEqual(['writer'])
    expect((await controller.read('不存在')).experts).toEqual([])
  })
})

describe('expert summon flow', () => {
  it('creates a session with the target Agent preset', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'data-analyst'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('data-analyst'),
    })
    const { runtime, create } = makeRuntime({ presets: [{ id: 'data-analyst', name: '数据分析师' }] })
    const controller = new DesktopExpertsController(runtime, root)
    const result = await controller.summon('data-analyst', '分析销售数据')
    expect(create).toHaveBeenCalledOnce()
    expect(create).toHaveBeenCalledWith({ workspaceId: 'ws-default', agentPreset: 'data-analyst' })
    expect(result).toMatchObject({ sessionId: 'session-new', agentPreset: 'data-analyst', workspaceId: 'ws-default', expertName: '数据分析师' })
  })

  it('does not create a session when the preset is unavailable', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'broken'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('broken'),
    })
    const { runtime, create } = makeRuntime({
      presets: [{ id: 'broken', broken: 'mount failed' }],
    })
    const controller = new DesktopExpertsController(runtime, root)
    await expect(controller.summon('broken')).rejects.toThrow(/mount failed/)
    expect(create).not.toHaveBeenCalled()
  })

  it('does not create a session when the preset is unknown', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'ghost'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS,
      'expert.yml': expertYaml('ghost'),
    })
    const { runtime, create } = makeRuntime({ presets: [] })
    const controller = new DesktopExpertsController(runtime, root)
    await expect(controller.summon('ghost')).rejects.toThrow(/Unknown agent preset/)
    expect(create).not.toHaveBeenCalled()
  })

  it('does not create a session for an invalid or unknown expert', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'broken-yaml'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': 'id: [oops\n',
    })
    const { runtime, create } = makeRuntime({ presets: [{ id: 'broken-yaml' }] })
    const controller = new DesktopExpertsController(runtime, root)
    await expect(controller.summon('broken-yaml')).rejects.toThrow(/unavailable/)
    expect(create).not.toHaveBeenCalled()
    await expect(controller.summon('missing')).rejects.toThrow(/Unknown expert/)
    expect(create).not.toHaveBeenCalled()
  })

  it('rejects a mismatched resolved preset id', async () => {
    const root = await fixture()
    await writeExpertPackage(join(root, 'data-analyst'), {
      'preset.yml': PRESET_YML, 'agent.cordis.yml': AGENT_CORDIS, 'expert.yml': expertYaml('data-analyst'),
    })
    const { runtime, create } = makeRuntime({
      resolve: async () => ({ id: 'different-preset' }),
    })
    const controller = new DesktopExpertsController(runtime, root)
    await expect(controller.summon('data-analyst')).rejects.toThrow(/resolved to different-preset/)
    expect(create).not.toHaveBeenCalled()
  })
})
