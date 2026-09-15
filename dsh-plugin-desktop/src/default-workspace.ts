/** Register the product-owned default Workspace through the upstream registry. */

import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { isAbsolute, resolve } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-workspace'

const DIRECTORY_MODE = 0o700

export const name = 'desktop-default-workspace'
export const inject = ['workspaceRegistry']

export interface DefaultWorkspaceConfig {
  readonly path?: string
}

/** Create and register a default only when the durable registry is empty. */
export async function provisionDefaultWorkspace(
  registry: Context['workspaceRegistry'],
  path: string,
): Promise<boolean> {
  if (registry.list().length > 0) return false
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
  await registry.create(target, 'ClawClaw')
  return true
}

export async function apply(ctx: Context, config: DefaultWorkspaceConfig = {}): Promise<void> {
  // Headless profile verification does not launch through Electron and has no
  // product path. The Desktop launcher always supplies this value.
  if (config.path === undefined) return
  await provisionDefaultWorkspace(ctx.workspaceRegistry, config.path)
}
