/** Product-owned default data and Workspace layout. */

import { chmodSync, lstatSync, mkdirSync, renameSync } from 'node:fs'
import { join, resolve } from 'node:path'

const PRIVATE_DIRECTORY_MODE = 0o700

export interface ClawClawDataLayout {
  readonly rootDir: string
  readonly dshHome: string
  readonly defaultWorkspace: string
}

export interface ClawClawDataPreparation extends ClawClawDataLayout {
  readonly migratedLegacyHome: boolean
  readonly legacyHomeConflict: boolean
}

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

/**
 * Prepare the product default and move a sole legacy ~/.dsh into it.
 * When both locations exist, preserve both and select the new product root;
 * the caller reports the conflict instead of merging two state stores.
 */
export function prepareClawClawDataLayout(
  userHome: string,
  legacyHome = join(resolve(userHome), '.dsh'),
): ClawClawDataPreparation {
  const layout = clawClawDataLayout(userHome)
  const targetState = directoryState(layout.dshHome)
  const legacyState = directoryState(legacyHome)
  if (targetState === 'unsafe') {
    throw new Error(`ClawClaw data path must be a real directory: ${layout.dshHome}`)
  }
  if (legacyState === 'unsafe') {
    throw new Error(`Legacy DSH home must be a real directory: ${legacyHome}`)
  }

  ensurePrivateDirectory(layout.rootDir)
  let migratedLegacyHome = false
  if (targetState === 'missing' && legacyState === 'directory') {
    renameSync(legacyHome, layout.dshHome)
    if (process.platform !== 'win32') chmodSync(layout.dshHome, PRIVATE_DIRECTORY_MODE)
    migratedLegacyHome = true
  } else if (targetState === 'missing') {
    ensurePrivateDirectory(layout.dshHome)
  }

  return Object.freeze({
    ...layout,
    migratedLegacyHome,
    legacyHomeConflict: targetState === 'directory' && legacyState === 'directory',
  })
}
