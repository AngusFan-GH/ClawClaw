import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { DEFAULT_WORKSPACE_TITLE, protectDefaultWorkspace, provisionDefaultWorkspace } from '../src/default-workspace.ts'
import { WorkspaceId } from '@deepseek-ai/dsh-workspace'
import { Context, Service } from '@deepseek-ai/cordis'

const roots: string[] = []

function temporaryPath(): string {
  const root = mkdtempSync(join(tmpdir(), 'clawclaw-workspace-'))
  roots.push(root)
  return join(root, 'workspaces', 'default')
}

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true })
})

describe('ClawClaw default Workspace', () => {
  it('protects calls across Cordis service proxies and restores the shared target', async () => {
    const ctx = new Context()
    const deleted: string[] = []
    class Registry extends Service {
      constructor() { super(ctx, 'workspaceRegistry') }
      async delete(id: string): Promise<boolean> {
        deleted.push(id)
        return true
      }
    }
    const target = new Registry()
    const originalDelete = target.delete
    const dispose = protectDefaultWorkspace(ctx.workspaceRegistry, WorkspaceId('default-id'))
    await expect(ctx.extend().workspaceRegistry.delete(WorkspaceId('default-id'))).rejects.toThrow(
      '默认工作区不能删除',
    )
    await expect(ctx.extend().workspaceRegistry.delete(WorkspaceId('project-id'))).resolves.toBe(true)
    expect(deleted).toEqual(['project-id'])
    dispose()
    expect(target.delete).toBe(originalDelete)
  })

  it('rejects deletion by identity while preserving other deletions and cleanup', async () => {
    const defaultId = WorkspaceId('default-id')
    const projectId = WorkspaceId('project-id')
    const originalDelete = vi.fn(async function (this: unknown, id: unknown) {
      expect(this).toBe(registry)
      return id === projectId
    })
    const registry = { delete: originalDelete }
    const dispose = protectDefaultWorkspace(registry as never, defaultId)
    await expect(registry.delete(defaultId)).rejects.toMatchObject({
      code: 'workspace/protected',
      message: '默认工作区不能删除',
    })
    expect(originalDelete).not.toHaveBeenCalled()
    await expect(registry.delete(projectId)).resolves.toBe(true)
    await expect(registry.delete(WorkspaceId('missing'))).resolves.toBe(false)
    dispose()
    expect(registry.delete).toBe(originalDelete)
  })

  it('creates and registers the product default when it is missing', async () => {
    const path = temporaryPath()
    const workspace = { id: 'default-id', title: DEFAULT_WORKSPACE_TITLE }
    const registry = {
      resolveByPath: vi.fn(async () => undefined),
      create: vi.fn(async () => workspace),
    }
    await expect(provisionDefaultWorkspace(registry as never, path)).resolves.toEqual({
      workspace,
      created: true,
    })
    expect(registry.create).toHaveBeenCalledWith(path, DEFAULT_WORKSPACE_TITLE)
    expect(existsSync(path)).toBe(true)
    expect(lstatSync(path).isDirectory()).toBe(true)
  })

  it('reuses and migrates the Workspace already registered for the default path to the locale-neutral title', async () => {
    const path = temporaryPath()
    const workspace = { id: 'default-id', title: '默认', setTitle: vi.fn(async () => {}) }
    const registry = {
      resolveByPath: vi.fn(async () => workspace),
      create: vi.fn(),
    }
    await expect(provisionDefaultWorkspace(registry as never, path)).resolves.toEqual({
      workspace,
      created: false,
    })
    expect(workspace.setTitle).toHaveBeenCalledWith(DEFAULT_WORKSPACE_TITLE)
    expect(registry.create).not.toHaveBeenCalled()
    expect(existsSync(path)).toBe(true)
  })

  it('rejects a relative default path', async () => {
    const registry = { resolveByPath: vi.fn(), create: vi.fn() }
    await expect(provisionDefaultWorkspace(registry as never, 'relative')).rejects.toThrow(
      'must be an absolute path',
    )
  })
})
