import { existsSync, lstatSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { provisionDefaultWorkspace } from '../src/default-workspace.ts'

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
  it('creates and registers ClawClaw when the registry is empty', async () => {
    const path = temporaryPath()
    const registry = {
      list: vi.fn(() => []),
      create: vi.fn(async () => ({})),
    }
    await expect(provisionDefaultWorkspace(registry as never, path)).resolves.toBe(true)
    expect(registry.create).toHaveBeenCalledWith(path, 'ClawClaw')
    expect(existsSync(path)).toBe(true)
    expect(lstatSync(path).isDirectory()).toBe(true)
  })

  it('does not create or register a default when a Workspace exists', async () => {
    const path = temporaryPath()
    const registry = {
      list: vi.fn(() => [{}]),
      create: vi.fn(),
    }
    await expect(provisionDefaultWorkspace(registry as never, path)).resolves.toBe(false)
    expect(registry.create).not.toHaveBeenCalled()
    expect(existsSync(path)).toBe(false)
  })

  it('rejects a relative default path', async () => {
    const registry = { list: () => [], create: vi.fn() }
    await expect(provisionDefaultWorkspace(registry as never, 'relative')).rejects.toThrow(
      'must be an absolute path',
    )
  })
})
