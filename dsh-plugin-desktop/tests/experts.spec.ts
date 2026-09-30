import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { Context } from '@deepseek-ai/cordis'
import { ExpertCatalog, ExpertSummonError, apply, handleExpertAction, parseExpertManifest,
  type ExpertPresetRow } from '../src/experts.ts'
import { EXPERT_MANIFEST_MAX_BYTES } from '../src/experts-contract.ts'

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-experts-'))
  roots.push(root)
  return root
}

const MANIFEST = [
  'id: data-analyst',
  'version: 1.0.0',
  'category: data-ai',
  'display:',
  '  name: 数据分析师',
  '  title: 商业数据与可视化顾问',
  '  description: 清洗数据、识别异常并输出图表和报告。',
  '  tags: [Excel, CSV, 图表]',
  'entry:',
  '  defaultPrompt: 帮我分析这份数据并输出管理层摘要',
  '  quickPrompts:',
  '    - 分析销售数据',
  '    - 制作经营周报',
  '',
].join('\n')

async function writePackage(root: string, id: string, options: {
  manifest?: string
  preset?: string
  composition?: string
  skip?: readonly string[]
} = {}): Promise<string> {
  const directory = join(root, id)
  await mkdir(directory, { recursive: true })
  const skip = options.skip ?? []
  if (!skip.includes('expert.yml')) {
    await writeFile(join(directory, 'expert.yml'), options.manifest ?? MANIFEST.replace('id: data-analyst', `id: ${id}`))
  }
  if (!skip.includes('preset.yml')) await writeFile(join(directory, 'preset.yml'), options.preset ?? `name: ${id}\n`)
  if (!skip.includes('agent.cordis.yml')) {
    await writeFile(join(directory, 'agent.cordis.yml'), options.composition ?? '- name: "@deepseek-ai/dsh-tool-fs"\n')
  }
  return directory
}

function catalogFor(root: string, rows: readonly ExpertPresetRow[] = [{ id: 'data-analyst' }], createSession?: (
  presetId: string,
  workspaceId: string | undefined,
) => Promise<{ sessionId: string }>): ExpertCatalog {
  return new ExpertCatalog({
    root,
    roster: () => ({ list: async () => rows }),
    ...(createSession === undefined ? {} : { createSession }),
  })
}

describe('expert manifest validation', () => {
  it('accepts the documented manifest and normalizes its display text', () => {
    const manifest = parseExpertManifest(MANIFEST)
    expect(manifest).toEqual({
      id: 'data-analyst', version: '1.0.0', category: 'data-ai',
      display: { name: '数据分析师', title: '商业数据与可视化顾问', description: '清洗数据、识别异常并输出图表和报告。', tags: ['Excel', 'CSV', '图表'] },
      entry: { defaultPrompt: '帮我分析这份数据并输出管理层摘要', quickPrompts: ['分析销售数据', '制作经营周报'] },
    })
  })

  it.each([
    ['unparseable YAML', 'id: [unclosed\n', 'invalid-yaml'],
    ['missing display name', MANIFEST.replace('  name: 数据分析师\n', ''), 'invalid-manifest'],
    ['missing version', MANIFEST.replace('version: 1.0.0\n', ''), 'invalid-manifest'],
    ['unsafe id', MANIFEST.replace('id: data-analyst', 'id: ../escape'), 'invalid-manifest'],
    ['control characters', MANIFEST.replace('name: 数据分析师', 'name: "bad\\u0007name"'), 'invalid-manifest'],
    ['quick prompts as text', MANIFEST.replace('  quickPrompts:', '  quickPrompts: 分析销售数据'), 'invalid-manifest'],
  ])('rejects %s', (_label, source, problem) => {
    expect(() => parseExpertManifest(source as string)).toThrowError(expect.objectContaining({ problem }))
  })
})

describe('expert package discovery', () => {
  it('reports one available expert with preset display metadata', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst', { preset: 'name: 数据分析师\ndescription: 数据工作预设\n' })
    const view = await catalogFor(root).read()
    expect(view.root).toBe(root)
    expect(view.truncated).toBe(false)
    expect(view.categories).toEqual([{ id: 'data-ai', count: 1 }])
    expect(view.experts).toHaveLength(1)
    expect(view.experts[0]).toMatchObject({
      id: 'data-analyst', presetId: 'data-analyst', presetName: '数据分析师', presetDescription: '数据工作预设',
      status: 'available', version: '1.0.0', category: 'data-ai', directory: join(root, 'data-analyst'),
    })
    expect(view.experts[0]?.entry?.quickPrompts).toEqual(['分析销售数据', '制作经营周报'])
    expect(view.experts[0]?.problem).toBeUndefined()
  })

  it('isolates invalid packages and keeps plain Agent presets out of the catalog', async () => {
    const root = await fixture()
    await writePackage(root, 'good')
    await writePackage(root, 'no-preset', { skip: ['preset.yml'] })
    await writePackage(root, 'no-composition', { skip: ['agent.cordis.yml'] })
    await writePackage(root, 'broken-yaml', { manifest: 'id: [unclosed\n' })
    await writePackage(root, 'mismatch', { manifest: MANIFEST })
    await writePackage(root, 'plain-preset', { skip: ['expert.yml'] })
    const view = await catalogFor(root, [{ id: 'good' }]).read()
    expect(view.experts.map(expert => [expert.id, expert.status, expert.problem ?? null])).toEqual([
      ['broken-yaml', 'invalid', 'invalid-yaml'],
      ['good', 'available', null],
      ['mismatch', 'invalid', 'id-mismatch'],
      ['no-composition', 'invalid', 'missing-files'],
      ['no-preset', 'invalid', 'missing-files'],
    ])
    expect(view.experts.find(expert => expert.id === 'good')?.entry?.defaultPrompt).toBe('帮我分析这份数据并输出管理层摘要')
    expect(view.experts.find(expert => expert.id === 'no-preset')?.message).toContain('preset.yml')
  })

  it('refuses symlinked members, unsafe directory names, and oversized manifests', async () => {
    const root = await fixture()
    await writePackage(root, 'linked')
    await rm(join(root, 'linked', 'expert.yml'))
    await writeFile(join(root, 'linked', 'real-expert.yml'), MANIFEST.replace('data-analyst', 'linked'))
    await symlink(join(root, 'linked', 'real-expert.yml'), join(root, 'linked', 'expert.yml'))
    await writePackage(root, 'nested')
    await mkdir(join(root, 'unsafe name'), { recursive: true })
    await writeFile(join(root, 'unsafe name', 'expert.yml'), MANIFEST.replace('data-analyst', 'unsafe name'))
    const outside = join(root, 'outside')
    await mkdir(outside)
    await symlink(outside, join(root, 'linked-directory'))
    await writePackage(root, 'huge', { manifest: `${MANIFEST}\n# ${'x'.repeat(EXPERT_MANIFEST_MAX_BYTES)}` })
    const view = await catalogFor(root, [{ id: 'nested' }]).read()
    const byId = new Map(view.experts.map(expert => [expert.id, expert]))
    expect(byId.get('linked')?.problem).toBe('unsafe-path')
    expect(byId.get('unsafe name')?.problem).toBe('unsafe-path')
    expect(byId.has('linked-directory')).toBe(false)
    expect(byId.get('huge')?.problem).toBe('too-large')
    expect(byId.get('nested')?.status).toBe('available')
  })

  it('marks a case-folded duplicate id instead of reporting two experts', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    await writePackage(root, 'DATA-ANALYST', { manifest: MANIFEST.replace('data-analyst', 'DATA-ANALYST') })
    const view = await catalogFor(root, [{ id: 'data-analyst' }, { id: 'DATA-ANALYST' }]).read()
    expect(view.experts).toHaveLength(2)
    expect(view.experts.map(expert => expert.problem ?? null).sort()).toEqual(['duplicate-id', null])
    expect(view.experts.filter(expert => expert.status === 'available')).toHaveLength(1)
  })

  it.each([
    [[{ id: 'other' }], 'preset-missing'],
    [[{ id: 'data-analyst', broken: 'composition failed' }], 'preset-broken'],
  ] as const)('reports the linked preset state through the roster', async (rows, problem) => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const view = await catalogFor(root, rows).read()
    expect(view.experts[0]).toMatchObject({ status: 'unavailable', problem })
  })

  it('reports an invalid composition when the preset never registered', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst', { composition: '- no-name: true\n' })
    const view = await catalogFor(root, []).read()
    expect(view.experts[0]).toMatchObject({ status: 'unavailable', problem: 'preset-invalid' })
    expect(view.experts[0]?.message).toContain('names no plugin')
  })

  it('reports an absent registry instead of failing the read', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const catalog = new ExpertCatalog({ root, roster: () => undefined })
    expect((await catalog.read()).experts[0]).toMatchObject({ status: 'unavailable', problem: 'preset-registry-unavailable' })
  })

  it('stops at the scan ceiling and reports truncation instead of failing', async () => {
    const root = await fixture()
    for (const id of ['alpha', 'bravo', 'charlie']) await writePackage(root, id)
    const catalog = new ExpertCatalog({
      root,
      roster: () => ({ list: async () => [{ id: 'alpha' }] }),
      packageLimit: 2,
    })
    const view = await catalog.read()
    expect(view.truncated).toBe(true)
    expect(view.experts.map(expert => expert.id)).toEqual(['alpha', 'bravo'])
  })

  it('serves one expert by id and refuses ids no package claims', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const catalog = catalogFor(root)
    expect((await catalog.detail('data-analyst')).status).toBe('available')
    await expect(catalog.detail('missing')).rejects.toBeInstanceOf(ExpertSummonError)
  })
})

describe('expert search and category filter', () => {
  it('searches display text, tags, and prompts, and filters by category', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    await writePackage(root, 'writer', {
      manifest: [
        'id: writer',
        'version: 1.0.0',
        'category: writing',
        'display:',
        '  name: 文案专家',
        '  title: 品牌文案顾问',
        '  description: 撰写营销文案与品牌故事。',
        '  tags: [文案, 品牌]',
        'entry:',
        '  defaultPrompt: 帮我写一篇新品发布文案',
        '',
      ].join('\n'),
    })
    const catalog = catalogFor(root, [{ id: 'data-analyst' }, { id: 'writer' }])
    expect((await catalog.read({ q: '图表' })).experts.map(expert => expert.id)).toEqual(['data-analyst'])
    expect((await catalog.read({ q: '经营周报' })).experts.map(expert => expert.id)).toEqual(['data-analyst'])
    expect((await catalog.read({ q: 'writer' })).experts.map(expert => expert.id)).toEqual(['writer'])
    expect((await catalog.read({ category: 'writing' })).experts.map(expert => expert.id)).toEqual(['writer'])
    expect((await catalog.read({ category: 'data-ai', q: '文案' })).experts).toEqual([])
    expect((await catalog.read({ category: '' })).experts).toHaveLength(2)
    const categories = (await catalog.read()).categories
    expect(categories).toEqual([{ id: 'data-ai', count: 1 }, { id: 'writing', count: 1 }])
  })
})

describe('expert summon', () => {
  it('creates the Session with the expert Agent preset and returns the default prompt', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const createSession = vi.fn(async () => ({ sessionId: 'session-1' }))
    const catalog = catalogFor(root, [{ id: 'data-analyst' }], createSession)
    const summoned = await catalog.summon('data-analyst', { workspaceId: 'ws-1' })
    expect(createSession).toHaveBeenCalledWith('data-analyst', 'ws-1')
    expect(summoned).toEqual({
      sessionId: 'session-1', expertId: 'data-analyst', presetId: 'data-analyst',
      prompt: '帮我分析这份数据并输出管理层摘要',
    })
  })

  it('prefers an explicit quick task over the default prompt', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const catalog = catalogFor(root, [{ id: 'data-analyst' }], async () => ({ sessionId: 'session-2' }))
    expect(await catalog.summon('data-analyst', { prompt: '分析销售数据' })).toMatchObject({
      sessionId: 'session-2', prompt: '分析销售数据',
    })
  })

  it('refuses to create a Session when the target preset is unavailable', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const createSession = vi.fn(async () => ({ sessionId: 'session-3' }))
    const catalog = catalogFor(root, [{ id: 'data-analyst', broken: 'nope' }], createSession)
    await expect(catalog.summon('data-analyst')).rejects.toThrowError(expect.objectContaining({ problem: 'preset-broken' }))
    expect(createSession).not.toHaveBeenCalled()
  })

  it('surfaces a refused creation without pretending a Session exists', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const catalog = catalogFor(root, [{ id: 'data-analyst' }], async () => { throw new Error('preset "data-analyst" not found') })
    await expect(catalog.summon('data-analyst')).rejects.toThrowError(/not found/)
  })

  it('rejects unknown experts before touching the Session controller', async () => {
    const root = await fixture()
    const createSession = vi.fn(async () => ({ sessionId: 'session-4' }))
    const catalog = catalogFor(root, [], createSession)
    await expect(catalog.summon('ghost')).rejects.toThrowError(expect.objectContaining({ problem: 'expert-not-found' }))
    expect(createSession).not.toHaveBeenCalled()
  })
})

describe('expert action routing', () => {
  it('validates every request field', async () => {
    const root = await fixture()
    await writePackage(root, 'data-analyst')
    const catalog = catalogFor(root, [{ id: 'data-analyst' }], async () => ({ sessionId: 'session-5' }))
    await expect(handleExpertAction(catalog, null)).rejects.toThrowError(TypeError)
    await expect(handleExpertAction(catalog, { action: 'nope' })).rejects.toThrowError(TypeError)
    await expect(handleExpertAction(catalog, { action: 'summon', id: '../escape' })).rejects.toThrowError(TypeError)
    await expect(handleExpertAction(catalog, { action: 'summon', id: 'data-analyst', workspaceId: '' })).rejects.toThrowError(TypeError)
    await expect(handleExpertAction(catalog, { action: 'list', q: 'x'.repeat(64 * 1024) })).rejects.toThrowError(TypeError)
    expect(await handleExpertAction(catalog, { action: 'list', category: 'data-ai' })).toMatchObject({ experts: [{ id: 'data-analyst' }] })
    expect(await handleExpertAction(catalog, { action: 'detail', id: 'data-analyst' })).toMatchObject({ id: 'data-analyst' })
    expect(await handleExpertAction(catalog, { action: 'summon', id: 'data-analyst' })).toMatchObject({ sessionId: 'session-5', presetId: 'data-analyst' })
  })
})

describe('expert Host routes', () => {
  it('mounts the same-origin read/action pair and summons through the Session controller', async () => {
    const root = await fixture()
    await writePackage(join(root, '.agent-presets'), 'data-analyst')
    const routes: { path: string, handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> }[] = []
    const create = vi.fn(async () => ({ sessionId: 'session-9', agentPreset: 'data-analyst' }))
    const ctx = {
      effect: (setup: () => void) => setup(),
      get: (name: string) => name === 'agentPresets'
        ? { list: async () => [{ id: 'data-analyst' }] }
        : name === 'sessionController' ? { create } : undefined,
      connection: { requestRejection: () => undefined },
      webServer: { port: 12345, register: (route: typeof routes[number]) => { routes.push(route); return () => {} } },
      env: { DSH_HOME: root },
    } as unknown as Context
    vi.stubEnv('DSH_HOME', root)
    apply(ctx)
    expect(routes.map(route => route.path)).toEqual(['/api/desktop/experts', '/api/desktop/experts/action'])
    const request = (body: object): IncomingMessage => Object.assign(Readable.from([JSON.stringify(body)]), {
      method: 'POST', headers: { host: '127.0.0.1:12345', origin: 'http://127.0.0.1:12345', 'content-type': 'application/json' },
      socket: { remoteAddress: '127.0.0.1' },
    }) as unknown as IncomingMessage
    const respond = async (req: IncomingMessage): Promise<{ status: number, body: unknown }> => {
      let status = 0
      let payload = ''
      const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn((value?: string) => { payload = value ?? '' }) }
      await routes[1]!.handler(req, response as unknown as ServerResponse)
      status = response.statusCode
      return { status, body: JSON.parse(payload) as unknown }
    }
    const summoned = await respond(request({ action: 'summon', id: 'data-analyst', workspaceId: 'ws-7' }))
    expect(summoned.status).toBe(200)
    expect(summoned.body).toMatchObject({ sessionId: 'session-9', expertId: 'data-analyst', presetId: 'data-analyst' })
    expect(create).toHaveBeenCalledWith({ agentPreset: 'data-analyst', workspaceId: 'ws-7' })
    const unfiltered = await respond(request({ action: 'list' }))
    expect(unfiltered).toMatchObject({ status: 200, body: { experts: [{ id: 'data-analyst', status: 'available' }] } })
    const refused = await respond(request({ action: 'summon', id: 'ghost' }))
    expect(refused.status).toBe(409)
    expect(create).toHaveBeenCalledTimes(1)
    vi.unstubAllEnvs()
  })
})
