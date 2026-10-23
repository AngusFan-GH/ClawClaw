import { execFile } from 'node:child_process'
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
// @ts-expect-error The fixture deliberately keeps vendor source out of Desktop's type program.
import { GitService } from './git-graph-service-fixture.mjs'

const exec = promisify(execFile)
let home: string
let repo: string
let service: InstanceType<typeof GitService>
const git = async (...argv: string[]) => (await exec('git', argv, { cwd: repo })).stdout.trim()

beforeEach(async () => {
  home = await realpath(await mkdtemp(join(tmpdir(), 'clawclaw-git-graph-')))
  vi.stubEnv('DSH_HOME', home)
  repo = join(home, 'repo'); await mkdir(repo)
  await git('init', '-b', 'main')
  await git('config', 'user.name', 'Offline fixture')
  await git('config', 'user.email', 'fixture@example.invalid')
  await writeFile(join(repo, 'tracked.txt'), 'baseline\n')
  await git('add', '.'); await git('commit', '-m', 'baseline')
  service = new GitService({
    async run(argv: readonly string[], cwd: string, signal?: AbortSignal) {
      try {
        const result = await exec('git', [...argv], { cwd, ...(signal ? { signal } : {}) })
        return { exitCode: 0, stdout: result.stdout, stderr: result.stderr }
      } catch (error) {
        const result = error as { code?: number; stdout?: string; stderr?: string }
        return { exitCode: typeof result.code === 'number' ? result.code : 127, stdout: result.stdout ?? '', stderr: result.stderr ?? '' }
      }
    },
  }, async (path: string) => path === repo ? { ok: true, canonical: repo } : { ok: false, error: { code: 'workspace-unknown', message: 'fixture is not registered' } })
})

afterEach(async () => { vi.unstubAllEnvs(); await rm(home, { recursive: true, force: true }) })

it('reads status and graph, creates/switches local branches, and pages merged history', async () => {
  expect((await service.status(repo))?.branch).toBe('main')
  expect(await service.createBranch(repo, 'feature')).toEqual({ ok: true, branch: 'feature' })
  await writeFile(join(repo, 'feature.txt'), 'feature\n'); await git('add', '.'); await git('commit', '-m', 'feature change')
  expect(await service.switchBranch(repo, 'main')).toEqual({ ok: true, branch: 'main' })
  await git('merge', '--no-ff', 'feature', '-m', 'merge feature')
  const page = await service.graph(repo, 1)
  expect(page?.commits).toHaveLength(1); expect(page?.hasMore).toBe(true)
  const all = await service.graph(repo, 200)
  expect(all?.commits).toHaveLength(3); expect(all?.hasMore).toBe(false)
  expect(all?.commits[0]?.parents).toHaveLength(2)
  expect((await service.branches(repo))?.branches.map((branch: { name: string }) => branch.name)).toEqual(expect.arrayContaining(['main', 'feature']))
})

it('rejects invalid/duplicate/missing branches and unregistered workspaces without mutation', async () => {
  expect(await service.createBranch(repo, '../escape')).toMatchObject({ ok: false, error: { code: 'invalid-branch-name' } })
  expect(await service.createBranch(repo, 'main')).toMatchObject({ ok: false, error: { code: 'branch-already-exists' } })
  expect(await service.switchBranch(repo, 'missing')).toMatchObject({ ok: false, error: { code: 'target-branch-not-found' } })
  expect(await service.createBranch(home, 'escape')).toMatchObject({ ok: false, error: { code: 'workspace-unknown' } })
  expect(await service.graph(home)).toBeNull()
  expect(await git('branch', '--show-current')).toBe('main')
})

it('preserves uncommitted files when a branch switch would overwrite them', async () => {
  await git('switch', '-c', 'other')
  await writeFile(join(repo, 'tracked.txt'), 'other branch\n'); await git('commit', '-am', 'other')
  await git('switch', 'main'); await writeFile(join(repo, 'tracked.txt'), 'local unsaved work\n')
  expect(await service.switchBranch(repo, 'other')).toMatchObject({ ok: false, error: { code: 'tracked-changes-would-be-overwritten' } })
  expect(await readFile(join(repo, 'tracked.txt'), 'utf8')).toBe('local unsaved work\n')
  expect(await git('branch', '--show-current')).toBe('main')
})

it('blocks branch changes during an in-progress Git operation', async () => {
  await git('branch', 'other')
  await writeFile(join(repo, '.git', 'MERGE_HEAD'), `${await git('rev-parse', 'HEAD')}\n`)
  expect(await service.switchBranch(repo, 'other')).toMatchObject({ ok: false, error: { code: 'operation-in-progress' } })
  expect(await git('branch', '--show-current')).toBe('main')
})

it('creates isolated worktrees, blocks occupied branches, and protects dirty/outside trees', async () => {
  const created = await service.addWorktree(repo, 'isolated', 'main')
  expect(created.ok).toBe(true)
  if (!created.ok) throw new Error('worktree fixture creation failed')
  expect(created.path.startsWith(join(home, 'worktrees'))).toBe(true)
  expect(await git('branch', '--show-current')).toBe('main')
  expect(await service.switchBranch(repo, created.branch)).toMatchObject({ ok: false, error: { code: 'branch-in-other-worktree' } })
  expect((await service.worktrees(repo))?.worktrees).toHaveLength(2)
  expect(await service.removeWorktree(repo, repo)).toMatchObject({ ok: false })
  await writeFile(join(created.path, 'unsaved.txt'), 'preserve me')
  expect(await service.removeWorktree(repo, created.path)).toMatchObject({ ok: false, error: { code: 'worktree-dirty' } })
  expect(await readFile(join(created.path, 'unsaved.txt'), 'utf8')).toBe('preserve me')
  // Force is exercised only against this disposable test-created worktree.
  expect(await service.removeWorktree(repo, created.path, { force: true })).toEqual({ ok: true })
  expect((await service.worktrees(repo))?.worktrees).toHaveLength(1)
  expect(await git('branch', '--list', created.branch)).toContain(created.branch)
})
