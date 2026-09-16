/** Register the product-owned default Workspace through the upstream registry. */

import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type { Workspace } from '@deepseek-ai/dsh-workspace'
import { RemoteError } from '@deepseek-ai/dsh-typert-protocol'
import z from '@deepseek-ai/schemastery'
import type { DesktopWorkspaceSettings } from './workspace-settings.ts'
import { DESKTOP_WORKSPACE_SETTINGS_NAMESPACE } from './workspace-settings.ts'

const DIRECTORY_MODE = 0o700

declare module '@deepseek-ai/dsh-typert-protocol' {
  interface RemoteErrorDetailsMap {
    'workspace/protected': { workspaceId: string }
  }
}

const DesktopWorkspaceSettingsSchema: z<DesktopWorkspaceSettings> = z.object({
  defaultWorkspaceId: z.string().default(''),
  activeWorkspaceId: z.string().default(''),
})

export const name = 'desktop-default-workspace'
export const inject = ['workspaceRegistry', 'settings']

export interface DefaultWorkspaceConfig {
  readonly path?: string
}

export interface DefaultWorkspaceProvision {
  readonly workspace: Workspace
  readonly created: boolean
}

/** Protect the product-owned registration for this Host generation. */
export function protectDefaultWorkspace(
  registry: Context['workspaceRegistry'],
  workspaceId: Workspace['id'],
): () => void {
  // Cordis exposes context-specific service proxies. Decorate their shared
  // target so every caller sees the guard and cleanup can compare identities.
  registry = Reflect.get(registry, Symbol.for('cordis.original')) as typeof registry ?? registry
  const originalDelete = registry.delete
  const guardedDelete: typeof registry.delete = async (id) => {
    if (id === workspaceId) {
      throw new RemoteError('workspace/protected', '默认工作区不能删除', { workspaceId: id })
    }
    return await originalDelete.call(registry, id)
  }
  registry.delete = guardedDelete
  return () => {
    if (registry.delete === guardedDelete) registry.delete = originalDelete
  }
}

/** Ensure the product default exists without replacing any registered Workspace. */
export async function provisionDefaultWorkspace(
  registry: Context['workspaceRegistry'],
  path: string,
): Promise<DefaultWorkspaceProvision> {
  if (path.length === 0 || path.includes('\0') || !isAbsolute(path)) {
    throw new TypeError('ClawClaw default Workspace path must be an absolute path without NUL')
  }
  const target = resolve(path)
  mkdirSync(target, { recursive: true, mode: DIRECTORY_MODE })
  const info = lstatSync(target)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`ClawClaw default Workspace must be a real directory: ${target}`)
  }
  if (process.platform !== 'win32') chmodSync(target, DIRECTORY_MODE)
  const existing = await registry.resolveByPath(target)
  if (existing !== undefined) {
    if (existing.title !== '默认') await existing.setTitle('默认')
    return Object.freeze({ workspace: existing, created: false })
  }
  const workspace = await registry.create(target, '默认')
  return Object.freeze({ workspace, created: true })
}

export async function apply(ctx: Context, config: DefaultWorkspaceConfig = {}): Promise<void> {
  // Headless profile verification does not launch through Electron and has no
  // product path. The Desktop launcher always supplies this value.
  if (config.path === undefined) return
  const provision = await provisionDefaultWorkspace(ctx.workspaceRegistry, config.path)
  ctx.effect(
    () => protectDefaultWorkspace(ctx.workspaceRegistry, provision.workspace.id),
    'dsh-plugin-desktop: protect default Workspace',
  )
  ctx.settings.register(
    DESKTOP_WORKSPACE_SETTINGS_NAMESPACE,
    DesktopWorkspaceSettingsSchema,
    {
      applies: 'live',
      base: {
        defaultWorkspaceId: provision.workspace.id,
        activeWorkspaceId: '',
      },
    },
  )
}
