import { mkdir, mkdtemp, rm, symlink, unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Readable } from 'node:stream'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { apply, buildExpertsView, DesktopExpertCenter, expertRoot, EXPERT_MANIFEST_MAX_BYTES } from '../src/expert-center.ts'

type ExpertRoute = {
  path: string
  handler: (req: unknown, res: { statusCode: number, setHeader: (...args: unknown[]) => void, end: (value?: string) => void }) => Promise<void>
}

const roots: string[] = []

afterEach(async () => {
  await Promise.all(roots.splice(0).map(root => rm(root, { recursive: true, force: true })))
})

async function fixture(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'clawclaw-experts-'))
  roots.push(root)
  return root
}

async function writeExpert(
  root: string,
  id: string,
  files: { preset?: string; plugins?: string; manifest?: string },
): Promise<void> {
  const directory = join(root, id)
  await mkdir(directory, { recursive: true })
  if (files.preset !== undefined) await writeFile(join(directory, 'preset.yml'), files.preset)
  if (files.plugins !== undefined) await writeFile(join(directory, 'agent.cordis.yml'), files.plugins)
  if (files.manifest !== undefined) await writeFile(join(directory, 'expert.yml'), files.manifest)
}

const VALID_MANIFEST = `
id: data-analyst
version: 1.0.0
category: data-ai
display:
  name: 数据分析师
  title: 商业数据与可视化顾问
  description: 清洗数据、识别异常并输出图表和报告。
  tags: [Excel, CSV, 图表]
entry:
  defaultPrompt: 帮我分析这份数据并输出管理层摘要
  quickPrompts:
    - 分析销售数据
    - 制作经营周报
`

interface MockExpertCtx {
  readonly get: (name: string) => unknown
  readonly sessionController: {
    create: (request: { agentPreset?: string; workspaceId?: string }) => Promise<{ sessionId: string; agentPreset?: string }>
  }
}

function mockCtx(presets: readonly { id: string; broken?: string }[] = []) {
  const list = vi.fn(async () => presets.map(preset => ({ ...preset })))
  const resolve = vi.fn(async (id: string) => {
    const found = presets.find(preset => preset.id === id)
    if (found === undefined) throw new Error(`Unknown agent preset: ${id}`)
    return { id, ...(found.broken === undefined ? {} : { broken: found.broken }) }
  })
  const create = vi.fn(async (request: { agentPreset?: string; workspaceId?: string }) => ({
    sessionId: `session-${request.agentPreset}`,
    ...(request.agentPreset === undefined ? {} : { agentPreset: request.agentPreset }),
  }))
  const ctx: MockExpertCtx = {
    get: (name: string) => name === 'agentPresets' ? { list, resolve } : undefined,
    sessionController: { create },
  }
  return { ctx, list, resolve, create }
}

describe('expert package discovery', () => {
  it('lists a valid expert bound to a registered preset', async () => {
    const root = await fixture()
    await writeExpert(root, 'data-analyst', {
      preset: 'name: Data Analyst\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST,
    })
    const { ctx } = mockCtx([{ id: 'data-analyst' }])
    const center = new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never)
    const view = await center.list()
    expect(view.experts).toHaveLength(1)
    expect(view.experts[0]).toMatchObject({
      id: 'data-analyst', version: '1.0.0', category: 'data-ai',
      presetId: 'data-analyst', available: true,
    })
    expect(view.experts[0]!.display).toMatchObject({ name: '数据分析师', title: '商业数据与可视化顾问' })
    expect(view.experts[0]!.entry.quickPrompts).toEqual(['分析销售数据', '制作经营周报'])
    expect(view.invalid).toEqual([])
    expect(view.categories).toEqual(['data-ai'])
  })

  it('returns an empty view when the root does not exist', async () => {
    const { ctx } = mockCtx()
    const center = new DesktopExpertCenter(ctx as never, join(tmpdir(), 'clawclaw-no-such-root'), ctx.sessionController as never)
    const view = await center.list()
    expect(view.experts).toEqual([])
    expect(view.invalid).toEqual([])
    expect(view.categories).toEqual([])
  })

  it('isolates a package missing required files', async () => {
    const root = await fixture()
    await writeExpert(root, 'missing-files', {
      preset: 'name: X\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'missing-files'),
    })
    const { ctx } = mockCtx()
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts).toEqual([])
    expect(view.invalid).toHaveLength(1)
    expect(view.invalid[0]!.id).toBe('missing-files')
    expect(view.invalid[0]!.reason).toContain('missing required file')
  })

  it('isolates a package with illegal YAML', async () => {
    const root = await fixture()
    await writeExpert(root, 'bad-yaml', {
      preset: 'name: X\n',
      plugins: '- name: plugin\n',
      manifest: 'id: bad-yaml\nversion: 1.0.0\ncategory: x\ndisplay: [unclosed\n',
    })
    const { ctx } = mockCtx()
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts).toEqual([])
    expect(view.invalid[0]!.reason).toMatch(/YAML|parse|error/i)
  })

  it('isolates a package whose id does not match the directory name', async () => {
    const root = await fixture()
    await writeExpert(root, 'wrong-dir', {
      preset: 'name: X\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'actual-id'),
    })
    const { ctx } = mockCtx()
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts).toEqual([])
    expect(view.invalid[0]!.reason).toContain('does not match directory name')
  })

  it('isolates duplicate expert ids', () => {
    const view = buildExpertsView([
      { view: { id: 'first', version: '1.0.0', category: 'x', display: { name: 'A', title: 't', description: 'd', tags: [] }, entry: { defaultPrompt: 'p', quickPrompts: [] }, presetId: 'first', available: false } },
      { view: { id: 'first', version: '1.0.0', category: 'x', display: { name: 'B', title: 't', description: 'd', tags: [] }, entry: { defaultPrompt: 'p', quickPrompts: [] }, presetId: 'first', available: false } },
    ], [{ id: 'first' }])
    expect(view.experts.map(expert => expert.id)).toEqual(['first'])
    expect(view.invalid).toHaveLength(1)
    expect(view.invalid[0]!.reason).toContain('duplicate expert id')
  })

  it('rejects symlinked expert directories and files', async () => {
    const root = await fixture()
    const real = join(root, 'real-expert')
    await writeExpert(root, 'real-expert', {
      preset: 'name: Real\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'real-expert'),
    })
    await symlink(real, join(root, 'linked-expert'), 'dir')
    const { ctx } = mockCtx([{ id: 'real-expert' }])
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts.map(expert => expert.id)).toEqual(['real-expert'])
    expect(view.invalid.some(item => item.id === 'linked-expert' && /symlink|symbolic|regular directory/i.test(item.reason))).toBe(true)
  })

  it('rejects an expert directory symlink that escapes the root', async () => {
    const root = await fixture()
    const outside = join(tmpdir(), `clawclaw-escape-${process.pid}`)
    await mkdir(outside, { recursive: true })
    await writeExpert(outside, 'escaped', {
      preset: 'name: Escaped\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'escaped'),
    })
    await symlink(outside, join(root, 'escaped'), 'dir')
    const { ctx } = mockCtx([{ id: 'escaped' }])
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts).toEqual([])
    expect(view.invalid.some(item => item.id === 'escaped' && /symlink|symbolic|regular directory/i.test(item.reason))).toBe(true)
    await rm(outside, { recursive: true, force: true })
  })

  it('marks an expert unavailable when its preset is not registered', async () => {
    const root = await fixture()
    await writeExpert(root, 'ghost', {
      preset: 'name: Ghost\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'ghost'),
    })
    const { ctx } = mockCtx([])
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts[0]!.available).toBe(false)
    expect(view.experts[0]!.unavailableReason).toContain('not registered')
  })

  it('marks an expert unavailable when its preset is broken', async () => {
    const root = await fixture()
    await writeExpert(root, 'broken', {
      preset: 'name: Broken\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'broken'),
    })
    const { ctx } = mockCtx([{ id: 'broken', broken: 'plugin failed to load' }])
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts[0]!.available).toBe(false)
    expect(view.experts[0]!.unavailableReason).toContain('plugin failed to load')
  })

  it('rejects a symlinked manifest file inside an otherwise valid package', async () => {
    const root = await fixture()
    const real = join(root, 'real-expert')
    await writeExpert(root, 'real-expert', {
      preset: 'name: Real\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'real-expert'),
    })
    await unlink(join(real, 'expert.yml'))
    await symlink(join(real, 'preset.yml'), join(real, 'expert.yml'), 'file')
    const { ctx } = mockCtx([{ id: 'real-expert' }])
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts).toEqual([])
    expect(view.invalid.some(item => item.id === 'real-expert' && /symlink|symbolic|regular file/i.test(item.reason))).toBe(true)
  })

  it('rejects an oversized manifest file', async () => {
    const root = await fixture()
    await writeExpert(root, 'huge', {
      preset: 'name: Huge\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'huge') + 'x'.repeat(EXPERT_MANIFEST_MAX_BYTES),
    })
    const { ctx } = mockCtx()
    const view = await new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never).list()
    expect(view.experts).toEqual([])
    expect(view.invalid.some(item => item.id === 'huge' && /exceeds|bytes/i.test(item.reason))).toBe(true)
  })

  it('filters experts server-side by keyword and category', async () => {
    const root = await fixture()
    await writeExpert(root, 'data-analyst', {
      preset: 'name: Data Analyst\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST,
    })
    await writeExpert(root, 'writer', {
      preset: 'name: Writer\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST
        .replace('data-analyst', 'writer')
        .replace('category: data-ai', 'category: content')
        .replace('数据分析师', '文案写手')
        .replace('商业数据与可视化顾问', '营销文案顾问')
        .replace('清洗数据、识别异常并输出图表和报告。', '撰写营销文案')
        .replace('Excel, CSV, 图表', '写作')
        .replace('帮我分析这份数据并输出管理层摘要', '写一篇产品发布文案')
        .replace('分析销售数据', '撰写公众号推文')
        .replace('制作经营周报', '策划营销活动'),
    })
    const { ctx } = mockCtx([{ id: 'data-analyst' }, { id: 'writer' }])
    const center = new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never)
    const all = await center.list()
    expect(all.experts.map(expert => expert.id).sort()).toEqual(['data-analyst', 'writer'])
    const byKeyword = await center.list({ query: 'Excel', category: '' })
    expect(byKeyword.experts.map(expert => expert.id)).toEqual(['data-analyst'])
    const byCategory = await center.list({ query: '', category: 'content' })
    expect(byCategory.experts.map(expert => expert.id)).toEqual(['writer'])
    const combined = await center.list({ query: '文案', category: 'content' })
    expect(combined.experts.map(expert => expert.id)).toEqual(['writer'])
    const none = await center.list({ query: 'xyz', category: '' })
    expect(none.experts).toEqual([])
    expect(none.invalid).toEqual(all.invalid)
    expect(none.categories).toEqual(all.categories)
    const byId = await center.list({ query: '', category: '', id: 'writer' })
    expect(byId.experts.map(expert => expert.id)).toEqual(['writer'])
    expect(byId.invalid).toEqual(all.invalid)
    expect(byId.categories).toEqual(all.categories)
  })

})

describe('expert summon', () => {
  it('creates a session bound to the target Agent preset', async () => {
    const root = await fixture()
    await writeExpert(root, 'data-analyst', {
      preset: 'name: Data Analyst\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST,
    })
    const { ctx, create } = mockCtx([{ id: 'data-analyst' }])
    const center = new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never)
    const result = await center.summon({ action: 'summon', expertId: 'data-analyst' })
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toMatchObject({ agentPreset: 'data-analyst' })
    expect(result).toEqual({ sessionId: 'session-data-analyst', agentPreset: 'data-analyst' })
  })

  it('attaches the session to the requested workspace', async () => {
    const root = await fixture()
    await writeExpert(root, 'data-analyst', {
      preset: 'name: Data Analyst\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST,
    })
    const { ctx, create } = mockCtx([{ id: 'data-analyst' }])
    const center = new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never)
    await center.summon({ action: 'summon', expertId: 'data-analyst', workspaceId: 'ws-1' })
    expect(create.mock.calls[0]![0]).toMatchObject({ agentPreset: 'data-analyst', workspaceId: 'ws-1' })
  })

  it('refuses to summon an unknown expert without creating a session', async () => {
    const root = await fixture()
    const { ctx, create } = mockCtx()
    const center = new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never)
    await expect(center.summon({ action: 'summon', expertId: 'missing' })).rejects.toThrow('unknown expert')
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses to summon an unavailable expert without creating a session', async () => {
    const root = await fixture()
    await writeExpert(root, 'broken', {
      preset: 'name: Broken\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST.replace('data-analyst', 'broken'),
    })
    const { ctx, create } = mockCtx([{ id: 'broken', broken: 'plugin failed to load' }])
    const center = new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never)
    await expect(center.summon({ action: 'summon', expertId: 'broken' })).rejects.toThrow('plugin failed to load')
    expect(create).not.toHaveBeenCalled()
  })

  it('refuses an illegal expert id', async () => {
    const root = await fixture()
    const { ctx, create } = mockCtx()
    const center = new DesktopExpertCenter(ctx as never, root, ctx.sessionController as never)
    await expect(center.summon({ action: 'summon', expertId: '../escape' })).rejects.toThrow('invalid expertId')
    expect(create).not.toHaveBeenCalled()
  })

  it('resolves the expert root from DSH_HOME by default', () => {
    expect(expertRoot()).toContain('.agent-presets')
  })
})

describe('expert API routes', () => {
  it('passes q, category and id query parameters to the listing', async () => {
    const root = await fixture()
    await writeExpert(root, 'data-analyst', {
      preset: 'name: Data Analyst\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST,
    })
    await writeExpert(root, 'writer', {
      preset: 'name: Writer\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST
        .replace('data-analyst', 'writer')
        .replace('category: data-ai', 'category: content')
        .replace('数据分析师', '文案写手')
        .replace('商业数据与可视化顾问', '营销文案顾问')
        .replace('清洗数据、识别异常并输出图表和报告。', '撰写营销文案')
        .replace('Excel, CSV, 图表', '写作')
        .replace('帮我分析这份数据并输出管理层摘要', '写一篇产品发布文案')
        .replace('分析销售数据', '撰写公众号推文')
        .replace('制作经营周报', '策划营销活动'),
    })
    const routes: ExpertRoute[] = []
    const ctx = {
      effect: (setup: () => unknown) => setup(),
      connection: { requestRejection: () => undefined },
      webServer: { port: 12345, register: (route: ExpertRoute) => { routes.push(route) } },
      get: (name: string) => name === 'agentPresets'
        ? { list: async () => [{ id: 'data-analyst' }, { id: 'writer' }], resolve: async (id: string) => ({ id }) }
        : undefined,
      sessionController: { create: async () => ({ sessionId: 'session-x', agentPreset: 'data-analyst' }) },
    }
    apply(ctx as never, { root })
    const get = async (url: string): Promise<unknown> => {
      const req = Object.assign(Readable.from([]), {
        method: 'GET', url,
        headers: { host: '127.0.0.1:12345', referer: 'http://127.0.0.1:12345/', 'sec-fetch-site': 'same-origin' },
        socket: { remoteAddress: '127.0.0.1' },
      })
      let body = ''
      const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn((value?: string) => { body = value ?? '' }) }
      await routes[0]!.handler(req as never, res as never)
      return JSON.parse(body)
    }
    const all = await get('/api/desktop/experts') as { experts: readonly { id: string }[] }
    expect(all.experts.map(expert => expert.id).sort()).toEqual(['data-analyst', 'writer'])
    const byQuery = await get('/api/desktop/experts?q=Excel') as { experts: readonly { id: string }[] }
    expect(byQuery.experts.map(expert => expert.id)).toEqual(['data-analyst'])
    const byCategory = await get('/api/desktop/experts?category=content') as { experts: readonly { id: string }[] }
    expect(byCategory.experts.map(expert => expert.id)).toEqual(['writer'])
    const byId = await get('/api/desktop/experts?id=writer') as { experts: readonly { id: string }[] }
    expect(byId.experts.map(expert => expert.id)).toEqual(['writer'])
  })

  it('creates a preset-bound session through the summon action route', async () => {
    const root = await fixture()
    await writeExpert(root, 'data-analyst', {
      preset: 'name: Data Analyst\n',
      plugins: '- name: plugin\n',
      manifest: VALID_MANIFEST,
    })
    const create = vi.fn(async (request: { agentPreset?: string }) => ({ sessionId: 'session-x', agentPreset: request.agentPreset ?? 'data-analyst' }))
    const routes: ExpertRoute[] = []
    const ctx = {
      effect: (setup: () => unknown) => setup(),
      connection: { requestRejection: () => undefined },
      webServer: { port: 12345, register: (route: ExpertRoute) => { routes.push(route) } },
      get: (name: string) => name === 'agentPresets'
        ? { list: async () => [{ id: 'data-analyst' }], resolve: async (id: string) => ({ id }) }
        : undefined,
      sessionController: { create },
    }
    apply(ctx as never, { root })
    const req = Object.assign(Readable.from([JSON.stringify({ action: 'summon', expertId: 'data-analyst' })]), {
      method: 'POST', url: '/api/desktop/experts/action',
      headers: { host: '127.0.0.1:12345', origin: 'http://127.0.0.1:12345', 'content-type': 'application/json', 'sec-fetch-site': 'same-origin' },
      socket: { remoteAddress: '127.0.0.1' },
    })
    let body = ''
    const res = { statusCode: 0, setHeader: vi.fn(), end: vi.fn((value?: string) => { body = value ?? '' }) }
    await routes[1]!.handler(req as never, res as never)
    expect(res.statusCode).toBe(200)
    expect(JSON.parse(body)).toEqual({ sessionId: 'session-x', agentPreset: 'data-analyst' })
    expect(create).toHaveBeenCalledOnce()
    expect(create.mock.calls[0]![0]).toMatchObject({ agentPreset: 'data-analyst' })
  })
})
