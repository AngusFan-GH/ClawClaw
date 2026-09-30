/** Product-owned default data and Workspace layout. */

import { chmodSync, lstatSync, mkdirSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PRIVATE_DIRECTORY_MODE = 0o700

export interface ClawClawDataLayout {
  readonly rootDir: string
  readonly dshHome: string
  readonly defaultWorkspace: string
}

export type ClawClawDataPreparation = ClawClawDataLayout

function directoryState(path: string): 'missing' | 'directory' | 'unsafe' {
  try {
    const info = lstatSync(path)
    return info.isDirectory() && !info.isSymbolicLink() ? 'directory' : 'unsafe'
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return 'missing'
    throw cause
  }
}

function ensurePrivateDirectory(path: string): void {
  mkdirSync(path, { recursive: true, mode: PRIVATE_DIRECTORY_MODE })
  const info = lstatSync(path)
  if (!info.isDirectory() || info.isSymbolicLink()) {
    throw new Error(`ClawClaw data path must be a real directory: ${path}`)
  }
  if (process.platform !== 'win32') chmodSync(path, PRIVATE_DIRECTORY_MODE)
}

/** Resolve the stable per-user layout without touching the filesystem. */
export function clawClawDataLayout(userHome: string): ClawClawDataLayout {
  const rootDir = join(resolve(userHome), '.clawclaw')
  return Object.freeze({
    rootDir,
    dshHome: join(rootDir, 'data'),
    defaultWorkspace: join(rootDir, 'workspaces', 'default'),
  })
}

/** Prepare the product-owned default without inspecting another application's data. */
export function prepareClawClawDataLayout(userHome: string): ClawClawDataPreparation {
  const layout = clawClawDataLayout(userHome)
  const targetState = directoryState(layout.dshHome)
  if (targetState === 'unsafe') {
    throw new Error(`ClawClaw data path must be a real directory: ${layout.dshHome}`)
  }

  ensurePrivateDirectory(layout.rootDir)
  if (targetState === 'missing') ensurePrivateDirectory(layout.dshHome)
  return layout
}
