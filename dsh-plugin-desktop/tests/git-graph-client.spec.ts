// @vitest-environment jsdom
import * as React from 'react'
import * as ReactDOM from 'react-dom'
import * as ReactJSX from 'react/jsx-runtime'
import * as primitives from '@deepseek-ai/dsh-client-ui-primitives'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { gitGraphClientFactorySource } from '../scripts/git-graph-client-artifact.ts'
import { installGitGraphInteractions } from '../src/client/git-graph-interactions.ts'

const require = createRequire(import.meta.url)
const artifact = readFileSync(require.resolve('@linxin666/dsh-client-ui-git-graph/client'), 'utf8')
const source = gitGraphClientFactorySource(artifact)
const modules: Record<string, unknown> = { react: React, 'react-dom': ReactDOM, 'react/jsx-runtime': ReactJSX, '@deepseek-ai/dsh-client-ui-primitives': primitives }
const factory = new Function(source.replace('export default ', 'return '))() as (resolve: (id: string) => unknown) => { BranchChip: React.ComponentType<Record<string, unknown>>; apply(ctx: unknown): void }
const client = factory(id => {
  if (!(id in modules)) throw new Error(`Unexpected Git UI dependency: ${id}`)
  return modules[id]
})
const { BranchChip } = client
const repo = { root: '/fixture', branch: 'main', head: 'a'.repeat(40), dirtyFiles: 0, untrackedFiles: 0, conflicts: 0, operationInProgress: false }
const branches = { ...repo, branches: [{ name: 'main', current: true }, { name: 'feature', current: false }] }
function props() {
  return {
    sessionId: 'fixture-session', session: { blank: true, openState: 'open' },
    useSessions: (select: (value: unknown) => unknown) => select({ byId: { 'fixture-session': { blank: true } } }),
    t: (key: string) => key,
    repoStatus: vi.fn(async () => repo), branches: vi.fn(async () => branches),
    switchBranch: vi.fn(async (_id: unknown, branch: string) => ({ ok: true, branch })),
    createBranch: vi.fn(async (_id: unknown, branch: string) => ({ ok: true, branch })),
    graph: vi.fn(async () => ({ root: '/fixture', branch: 'main', hasMore: true, commits: [{ oid: 'a'.repeat(40), parents: [], subject: 'fixture commit', author: 'Offline fixture', authorTime: 1, refs: ['main'] }] })),
    createWorktreeSession: vi.fn(async () => ({ ok: true, path: '/fixture-worktree', name: 'isolated', branch: 'wt/isolated' })),
    worktrees: vi.fn(async () => ({ root: '/fixture', worktrees: [{ path: '/fixture', branch: 'main', head: 'a'.repeat(40), main: true }, { path: '/fixture-worktree', branch: 'wt/isolated', head: 'a'.repeat(40), main: false }] })),
    removeWorktree: vi.fn(async () => ({ ok: true })),
    gitConfig: vi.fn(async () => ({ autoIsolate: false, autoBaseline: 'current', worktreesHome: '/fixture-worktrees' })),
    subscribeChanges: vi.fn(() => () => {}),
  }
}
async function openBranch(p = props()) {
  render(React.createElement(BranchChip, p))
  fireEvent.click(await screen.findByRole('button', { name: 'chip.aria.branch' }))
  await screen.findByRole('listbox')
  return p
}
let disposeInteractions: () => void
const vendorDisposers: Array<() => void> = []
beforeEach(() => { disposeInteractions = installGitGraphInteractions() })
afterEach(() => { vendorDisposers.splice(0).reverse().forEach(dispose => { dispose() }); disposeInteractions(); cleanup(); vi.restoreAllMocks(); vi.unstubAllGlobals() })

function activateBusiness() {
  const settings = { autoIsolate: false, autoBaseline: 'current', worktreesHome: '/fixture-worktrees' }
  const requests: Array<{ url: string; payload: Record<string, unknown> }> = []
  vi.stubGlobal('fetch', vi.fn(async (url: string, input: RequestInit) => {
    requests.push({ url, payload: JSON.parse(String(input.body)) as Record<string, unknown> })
    const values: Record<string, unknown> = {
      'git/config': settings, 'git/status': repo,
      'git/worktree-add': { path: '/fixture-worktrees/repo/test', branch: 'wt/test', name: 'test' },
      'git/worktree-remove': { removed: true },
    }
    if (!(url in values)) throw new Error(`Unexpected route ${url}`)
    return new Response(JSON.stringify({ ok: true, value: values[url] }))
  }))
  type Business = { createWorktreeSession(id: string, name: string): Promise<{ ok: boolean }> }
  let business: Business | undefined
  const workspace = { workspaceId: 'original', path: '/fixture', sessionIds: ['fixture-session'] }
  const originalStart = vi.fn()
  const context = {
    effect(mount: () => unknown) { const dispose = mount(); if (typeof dispose === 'function') vendorDisposers.push(dispose as () => void) },
    inject(_keys: string[], install: (scope: unknown) => void) { install(context); return { dispose() {} } },
    locale: { register: () => () => {} },
    slots: {
      inject(_name: string, mount: () => unknown) { mount() },
      register(entry: { inject: () => Business }) { business = entry.inject(); return () => {} },
    },
    sessions: {
      list: { getSnapshot: () => ({ byId: { 'fixture-session': { id: 'fixture-session', cwd: '/fixture', retainedBy: { mainView: 1 } } } }) },
      create: vi.fn(async () => 'created-session'),
    },
    workspaces: {
      list: { getSnapshot: () => ({ items: [workspace] }) },
      create: vi.fn(async () => ({ workspaceId: 'linked' })), delete: vi.fn(async () => {}),
    },
    uiWorkspace: { startSession: originalStart as (id?: string) => void, openSession: vi.fn((_id: string) => {}) },
  }
  client.apply(context)
  if (!business) throw new Error('Git branch seat did not register')
  return { context, settings, requests, originalStart, business, workspace }
}

it('removes the complete telemetry implementation and fails closed if the pinned anchors change', () => {
  expect(source).not.toMatch(/dsh-market\.com|reportDailyHeartbeat|telemetry-visitor/)
  expect(() => gitGraphClientFactorySource(artifact.replace('reportDailyHeartbeat([{', 'changed([{'))).toThrow(/anchors changed/)
})

it('filters local branches, selects a branch, and reflects refresh without changing sessions', async () => {
  const p = await openBranch()
  fireEvent.change(screen.getByPlaceholderText('branch.search'), { target: { value: 'feature' } })
  expect(screen.queryByRole('option', { name: 'main' })).toBeNull()
  fireEvent.click(screen.getByRole('option', { name: 'feature' }))
  await waitFor(() => { expect(p.switchBranch).toHaveBeenCalledWith('fixture-session', 'feature') })
  expect(p.createWorktreeSession).not.toHaveBeenCalled()
})

it('creates a branch only after a nonblank name is entered and supports cancel', async () => {
  const p = await openBranch()
  fireEvent.click(screen.getByText('branch.create'))
  const confirm = screen.getByRole('button', { name: 'branch.createDialog.confirm' })
  expect((confirm as HTMLButtonElement).disabled).toBe(true)
  fireEvent.change(screen.getByLabelText('branch.createDialog.nameLabel'), { target: { value: 'new-branch' } })
  fireEvent.click(confirm)
  await waitFor(() => { expect(p.createBranch).toHaveBeenCalledWith('fixture-session', 'new-branch') })
  await waitFor(() => { expect(screen.queryByRole('dialog')).toBeNull() })
})

it('opens graph history, loads more commits, and closes the graph', async () => {
  const p = await openBranch()
  fireEvent.click(screen.getByText('branch.graph'))
  await screen.findByText('fixture commit')
  expect(p.graph).toHaveBeenCalledWith('fixture-session', 200)
  fireEvent.click(screen.getByRole('button', { name: 'graph.loadMore' }))
  await waitFor(() => { expect(p.graph).toHaveBeenLastCalledWith('fixture-session', 101) })
  fireEvent.click(screen.getByRole('button', { name: 'graph.close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('creates a worktree Session with the chosen name and base branch', async () => {
  const p = await openBranch()
  fireEvent.click(screen.getByText('worktree.create'))
  fireEvent.change(screen.getByLabelText('worktree.dialog.nameLabel'), { target: { value: 'isolated' } })
  fireEvent.change(screen.getByLabelText('worktree.dialog.baseLabel'), { target: { value: 'feature' } })
  fireEvent.click(screen.getByRole('button', { name: 'worktree.dialog.confirm' }))
  await waitFor(() => { expect(p.createWorktreeSession).toHaveBeenCalledWith('fixture-session', 'isolated', 'feature') })
})

it('manages only linked worktrees, leaving the primary checkout protected', async () => {
  const p = await openBranch()
  fireEvent.click(screen.getByText('worktree.manage'))
  await screen.findByText('wt/isolated')
  const remove = screen.getAllByRole('button', { name: 'worktree.manager.remove' })
  expect(remove).toHaveLength(1)
  fireEvent.click(remove[0]!)
  await waitFor(() => { expect(p.removeWorktree).toHaveBeenCalledWith('fixture-session', '/fixture-worktree', { force: false, deleteBranch: false }) })
  fireEvent.click(screen.getByRole('button', { name: 'worktree.manager.close' }))
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('does not expose a branch mutation control for an active Session', async () => {
  const p = props()
  render(React.createElement(BranchChip, { ...p, session: { blank: false, openState: 'open' }, useSessions: () => false }))
  expect(screen.queryByRole('button')).toBeNull()
  expect(p.repoStatus).not.toHaveBeenCalled()
  expect(p.subscribeChanges).not.toHaveBeenCalled()
})

it('keeps keyboard focus inside dialogs and restores the branch control on Escape', async () => {
  await openBranch()
  fireEvent.click(screen.getByText('branch.create'))
  const dialog = await screen.findByRole('dialog')
  await waitFor(() => { expect(dialog.getAttribute('aria-modal')).toBe('true') })
  const input = screen.getByLabelText('branch.createDialog.nameLabel')
  input.focus()
  fireEvent.keyDown(input, { key: 'Tab', shiftKey: true })
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'branch.createDialog.cancel' }))
  fireEvent.keyDown(document.activeElement!, { key: 'Escape' })
  expect(screen.queryByRole('dialog')).toBeNull()
  expect(document.activeElement).toBe(screen.getByRole('button', { name: 'chip.aria.branch' }))
})

it('cancels both creation dialogs without mutating a branch or worktree', async () => {
  const p = await openBranch()
  fireEvent.click(screen.getByText('branch.create'))
  fireEvent.click(screen.getByRole('button', { name: 'branch.createDialog.cancel' }))
  fireEvent.click(screen.getByRole('button', { name: 'chip.aria.branch' }))
  fireEvent.click(await screen.findByText('worktree.create'))
  fireEvent.click(screen.getByRole('button', { name: 'worktree.dialog.cancel' }))
  expect(p.createBranch).not.toHaveBeenCalled(); expect(p.createWorktreeSession).not.toHaveBeenCalled()
  expect(screen.queryByRole('dialog')).toBeNull()
})

it('requires a second explicit action before forcing a dirty worktree removal', async () => {
  const p = props()
  p.removeWorktree.mockResolvedValueOnce({ ok: false, error: { code: 'worktree-dirty', message: 'dirty fixture' } } as never)
  await openBranch(p)
  fireEvent.click(screen.getByText('worktree.manage'))
  await screen.findByText('wt/isolated')
  fireEvent.click(screen.getByLabelText('worktree.manager.deleteBranch'))
  fireEvent.click(screen.getByRole('button', { name: 'worktree.manager.remove' }))
  const force = await screen.findByRole('button', { name: 'worktree.manager.forceYes' })
  expect(p.removeWorktree).toHaveBeenCalledTimes(1)
  expect(p.removeWorktree).toHaveBeenLastCalledWith('fixture-session', '/fixture-worktree', { force: false, deleteBranch: true })
  await waitFor(() => { expect((force as HTMLButtonElement).disabled).toBe(false) })
  fireEvent.click(force)
  await waitFor(() => { expect(p.removeWorktree).toHaveBeenLastCalledWith('fixture-session', '/fixture-worktree', { force: true, deleteBranch: true }) })
})

it('hides the branch selector for non-Git workspaces', async () => {
  const p = props(); p.repoStatus.mockResolvedValue(null as never)
  render(React.createElement(BranchChip, p))
  await waitFor(() => { expect(p.repoStatus).toHaveBeenCalled() })
  expect(screen.queryByRole('button', { name: 'chip.aria.branch' })).toBeNull()
})

it('creates and opens a new worktree Session through the actual injected business face', async () => {
  const { business, context, requests } = activateBusiness()
  expect(await business.createWorktreeSession('fixture-session', 'test')).toMatchObject({ ok: true })
  expect(context.workspaces.create).toHaveBeenCalledWith({ path: '/fixture-worktrees/repo/test' })
  expect(context.sessions.create).toHaveBeenCalledWith({ workspaceId: 'linked' })
  expect(context.uiWorkspace.openSession).toHaveBeenCalledWith('created-session')
  expect(requests.map(request => request.url)).toEqual(['git/worktree-add'])
})

it('cleans up registration before rollback if Session creation fails', async () => {
  const { business, context, requests } = activateBusiness()
  context.sessions.create.mockRejectedValueOnce(new Error('fixture Session failure'))
  expect(await business.createWorktreeSession('fixture-session', 'test')).toMatchObject({ ok: false })
  expect(context.workspaces.delete).toHaveBeenCalledWith('linked')
  expect(requests.at(-1)).toMatchObject({ url: 'git/worktree-remove', payload: { force: true } })
})

it('retains the created Session and files if only navigation fails', async () => {
  const { business, context, requests } = activateBusiness()
  context.uiWorkspace.openSession.mockImplementationOnce(() => { throw new Error('fixture navigation failure') })
  expect(await business.createWorktreeSession('fixture-session', 'test')).toMatchObject({ ok: false })
  expect(context.workspaces.delete).not.toHaveBeenCalled()
  expect(requests.some(request => request.url === 'git/worktree-remove')).toBe(false)
})

it('retains the checkout when workspace rollback cannot unregister it', async () => {
  const { business, context, requests } = activateBusiness()
  context.sessions.create.mockRejectedValueOnce(new Error('fixture Session failure'))
  context.workspaces.delete.mockRejectedValueOnce(new Error('fixture registry failure'))
  expect(await business.createWorktreeSession('fixture-session', 'test')).toMatchObject({ ok: false })
  expect(requests.some(request => request.url === 'git/worktree-remove')).toBe(false)
})

it('preserves the default new-session behavior when automatic isolation is off', async () => {
  const { context, requests, originalStart } = activateBusiness()
  context.uiWorkspace.startSession('original')
  await waitFor(() => { expect(originalStart).toHaveBeenCalledWith('original') })
  expect(context.workspaces.create).not.toHaveBeenCalled()
  expect(requests.map(request => request.url)).toEqual(['git/config'])
})

it('isolates one opted-in new session and absorbs a duplicate click', async () => {
  const { context, settings, originalStart, requests } = activateBusiness()
  settings.autoIsolate = true; settings.autoBaseline = 'default'
  context.uiWorkspace.startSession('original'); context.uiWorkspace.startSession('original')
  await waitFor(() => { expect(originalStart).toHaveBeenCalledWith('linked') })
  expect(context.workspaces.create).toHaveBeenCalledTimes(1)
  const creations = requests.filter(request => request.url === 'git/worktree-add')
  expect(creations).toHaveLength(1)
  expect(creations[0]?.payload.baseRef).toBe('origin/HEAD')
})
