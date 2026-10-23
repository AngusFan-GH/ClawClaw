/** Offline Git routes check on the real, disposable Desktop Profile. */
import assert from 'node:assert/strict'
import { execFile } from 'node:child_process'
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { promisify } from 'node:util'

export async function verifyGitGraph(ctx, headers) {
  assert.match(ctx.profileContext.home, /dsh-desktop-profile-/)
  const repo = join(await realpath(ctx.profileContext.home), 'git-graph-fixture')
  await mkdir(repo)
  const exec = promisify(execFile)
  const git = async (...args) => (await exec('git', args, { cwd: repo })).stdout.trim()
  await git('init', '-b', 'main')
  await git('config', 'user.email', 'fixture@example.invalid')
  await git('config', 'user.name', 'Offline fixture')
  await writeFile(join(repo, 'keep.txt'), 'original workspace data\n')
  await git('add', '.'); await git('commit', '-m', 'fixture commit')
  await ctx.workspaceRegistry.create(repo)
  const origin = `http://127.0.0.1:${ctx.webServer.port}`
  const withoutCookie = { ...headers, 'content-type': 'application/json' }
  delete withoutCookie.Cookie
  const rejected = await fetch(`${origin}/git/status`, {
    method: 'POST', headers: withoutCookie, body: JSON.stringify({ path: repo }),
  })
  await rejected.body?.cancel()
  assert.equal(rejected.status, 401, 'renderer capability alone must not bypass the connection cookie')
  const call = async (verb, payload = {}, extraHeaders = {}) => {
    const response = await fetch(`${origin}/git/${verb}`, {
      method: 'POST', headers: { ...headers, 'content-type': 'application/json', ...extraHeaders }, body: JSON.stringify(payload),
    })
    assert.equal(response.status, 200, `${verb}: HTTP ${response.status}`)
    return response.json()
  }
  const config = await call('config')
  assert.equal(config.value.autoIsolate, false)
  assert.equal(config.value.autoBaseline, 'current')
  assert.equal(config.value.worktreesHome, join(ctx.profileContext.home, 'worktrees'))
  const initial = await call('status', { path: repo })
  assert.equal(initial.value.branch, 'main')
  assert.equal((await call('graph', { path: repo })).value.commits.length, 1)
  assert.equal((await call('create-branch', { path: repo, name: 'fixture-feature' })).ok, true)
  assert.equal((await call('switch', { path: repo, branch: 'main' })).ok, true)
  assert.equal((await call('branches', { path: repo })).value.branches.length, 2)
  const outside = join(repo, 'unregistered-child'); await mkdir(outside)
  assert.equal((await call('status', { path: outside })).value, null, 'unregistered path must remain gated')
  const added = await call('worktree-add', { path: repo, name: 'fixture-worktree', baseRef: 'main' })
  assert.equal(added.ok, true)
  assert.ok(added.value.path.startsWith(config.value.worktreesHome))
  assert.equal((await call('worktrees', { path: repo })).value.worktrees.length, 2)
  assert.equal((await call('worktree-remove', { path: repo, worktreePath: added.value.path })).ok, true)
  assert.equal((await call('worktrees', { path: repo })).value.worktrees.length, 1)
  assert.equal(await git('branch', '--show-current'), 'main')
  assert.equal(await readFile(join(repo, 'keep.txt'), 'utf8'), 'original workspace data\n')
  console.log('verify-git-graph: real Profile authentication, config, status, branches, graph, branch mutations, isolated worktrees and workspace gate passed')
}
