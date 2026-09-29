/** Opt-in, bounded local evidence for qualifying the desktop update path. */

import { randomUUID } from 'node:crypto'
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeFileSync,
} from 'node:fs'
import { isAbsolute, join } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'

export type DesktopUpdateQualificationPhase =
  | 'launch-ready'
  | 'check-requested'
  | 'check-completed'
  | 'download-confirmed'
  | 'download-declined'
  | 'release-reconfirmed'
  | 'stage-completed'
  | 'install-handoff'
  | 'operation-failed'

export type DesktopUpdateQualificationOutcome =
  | 'available'
  | 'up-to-date'
  | 'unavailable'
  | 'completed'
  | 'deferred'
  | 'cancelled'

export type DesktopUpdateQualificationError =
  | 'check-unavailable'
  | 'release-changed'
  | 'download-failed'
  | 'cancelled'
  | 'storage-failed'

export interface DesktopUpdateQualificationEvent {
  readonly phase: DesktopUpdateQualificationPhase
  readonly targetVersion?: string
  readonly outcome?: DesktopUpdateQualificationOutcome
  readonly errorCategory?: DesktopUpdateQualificationError
  readonly durationMs?: number
  readonly artifactDigest?: string
}

interface StoredDesktopUpdateQualificationEvent extends DesktopUpdateQualificationEvent {
  readonly sequence: number
  readonly time: string
}

export const DESKTOP_UPDATE_JOURNAL_FILE_LIMIT = 4
export const DESKTOP_UPDATE_JOURNAL_FILE_BYTES = 64 * 1024
export const DESKTOP_UPDATE_JOURNAL_TOTAL_BYTES = 256 * 1024
export const DESKTOP_UPDATE_JOURNAL_NAME = /^update-journal-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-[0-9a-f-]+\.json$/u

const MAX_EVENTS = 128
const VERSION_PATTERN = /^[0-9A-Za-z][0-9A-Za-z.+-]{0,126}$/u
const DIGEST_PATTERN = /^[0-9a-f]{64}$/u
const PHASES = new Set<DesktopUpdateQualificationPhase>([
  'launch-ready', 'check-requested', 'check-completed', 'download-confirmed', 'download-declined',
  'release-reconfirmed', 'stage-completed', 'install-handoff', 'operation-failed',
])
const OUTCOMES = new Set<DesktopUpdateQualificationOutcome>([
  'available', 'up-to-date', 'unavailable', 'completed', 'deferred', 'cancelled',
])
const ERRORS = new Set<DesktopUpdateQualificationError>([
  'check-unavailable', 'release-changed', 'download-failed', 'cancelled', 'storage-failed',
])

function assertDirectory(directory: string): void {
  if (!isAbsolute(directory)) throw new Error('dsh-plugin-desktop: update journal directory must be absolute')
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  const stats = lstatSync(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('dsh-plugin-desktop: update journal directory is invalid')
  }
  try { chmodSync(directory, 0o700) } catch {}
}

function existingSafeFile(path: string): boolean {
  try {
    const stats = lstatSync(path)
    return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return false
    throw cause
  }
}

function assertSafeTarget(path: string): void {
  try {
    const stats = lstatSync(path)
    if (!stats.isFile() || stats.isSymbolicLink() || stats.nlink !== 1) {
      throw new Error('dsh-plugin-desktop: update journal target is invalid')
    }
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return
    throw cause
  }
}

function assertEvent(event: DesktopUpdateQualificationEvent): void {
  if (!PHASES.has(event.phase)) throw new TypeError('dsh-plugin-desktop: invalid update journal phase')
  if (event.outcome !== undefined && !OUTCOMES.has(event.outcome)) {
    throw new TypeError('dsh-plugin-desktop: invalid update journal outcome')
  }
  if (event.errorCategory !== undefined && !ERRORS.has(event.errorCategory)) {
    throw new TypeError('dsh-plugin-desktop: invalid update journal error category')
  }
  if (event.targetVersion !== undefined && !VERSION_PATTERN.test(event.targetVersion)) {
    throw new TypeError('dsh-plugin-desktop: invalid update journal target version')
  }
  if (event.durationMs !== undefined
    && (!Number.isSafeInteger(event.durationMs) || event.durationMs < 0)) {
    throw new TypeError('dsh-plugin-desktop: invalid update journal duration')
  }
  if (event.artifactDigest !== undefined && !DIGEST_PATTERN.test(event.artifactDigest)) {
    throw new TypeError('dsh-plugin-desktop: invalid update journal artifact digest')
  }
}

function prune(directory: string): void {
  const files = readdirSync(directory)
    .filter(name => DESKTOP_UPDATE_JOURNAL_NAME.test(name))
    .flatMap((name) => {
      const path = join(directory, name)
      const stats = lstatSync(path)
      return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1
        ? [{ name, path, size: stats.size }]
        : []
    })
    .sort((left, right) => right.name.localeCompare(left.name, 'en'))
  let bytes = 0
  for (const [index, file] of files.entries()) {
    bytes += file.size
    if (index < DESKTOP_UPDATE_JOURNAL_FILE_LIMIT && bytes <= DESKTOP_UPDATE_JOURNAL_TOTAL_BYTES) continue
    unlinkSync(file.path)
  }
}

/** Remove only recognized, single-link journal files. */
export function clearDesktopUpdateQualificationJournals(directory: string): void {
  assertDirectory(directory)
  for (const name of readdirSync(directory)) {
    if (!DESKTOP_UPDATE_JOURNAL_NAME.test(name)) continue
    const path = join(directory, name)
    if (existingSafeFile(path)) unlinkSync(path)
  }
}

/** One process-local journal; each event replaces one complete JSON snapshot atomically. */
export class DesktopUpdateQualificationJournal {
  readonly path: string
  private readonly startedAt: string
  private readonly events: StoredDesktopUpdateQualificationEvent[] = []
  private sequence = 0
  private readonly directory: string
  private readonly installedVersion: string
  private readonly now: () => Date

  constructor(
    directory: string,
    installedVersion: string,
    now: () => Date = () => new Date(),
  ) {
    if (!VERSION_PATTERN.test(installedVersion)) {
      throw new TypeError('dsh-plugin-desktop: invalid installed version for update journal')
    }
    this.directory = directory
    this.installedVersion = installedVersion
    this.now = now
    assertDirectory(directory)
    this.startedAt = now().toISOString()
    this.path = join(directory, `update-journal-${this.startedAt.replaceAll(/[:.]/gu, '-')}-${randomUUID()}.json`)
  }

  record(event: DesktopUpdateQualificationEvent): void {
    assertEvent(event)
    this.events.push(Object.freeze({
      sequence: this.sequence++,
      time: this.now().toISOString(),
      phase: event.phase,
      ...(event.targetVersion === undefined ? {} : { targetVersion: event.targetVersion }),
      ...(event.outcome === undefined ? {} : { outcome: event.outcome }),
      ...(event.errorCategory === undefined ? {} : { errorCategory: event.errorCategory }),
      ...(event.durationMs === undefined ? {} : { durationMs: event.durationMs }),
      ...(event.artifactDigest === undefined ? {} : { artifactDigest: event.artifactDigest }),
    }))
    while (this.events.length > MAX_EVENTS) this.events.shift()
    this.persist()
  }

  private persist(): void {
    assertDirectory(this.directory)
    assertSafeTarget(this.path)
    let text = this.serialize()
    while (Buffer.byteLength(text) > DESKTOP_UPDATE_JOURNAL_FILE_BYTES && this.events.length > 1) {
      this.events.shift()
      text = this.serialize()
    }
    if (Buffer.byteLength(text) > DESKTOP_UPDATE_JOURNAL_FILE_BYTES) {
      throw new Error('dsh-plugin-desktop: update journal event exceeds the file limit')
    }
    const temporary = join(this.directory, `.${randomUUID()}.tmp`)
    try {
      writeFileSync(temporary, text, { flag: 'wx', mode: 0o600, flush: true })
      assertSafeTarget(this.path)
      renameSync(temporary, this.path)
    } finally {
      try { unlinkSync(temporary) } catch {}
    }
    prune(this.directory)
  }

  private serialize(): string {
    return `${JSON.stringify({
      schemaVersion: 1,
      installedVersion: this.installedVersion,
      startedAt: this.startedAt,
      events: this.events,
    }, null, 2)}\n`
  }
}

/** Runtime-toggleable facade used by the update lifecycle and settings clear action. */
export class DesktopUpdateQualificationJournalManager {
  private enabled = false
  private journal: DesktopUpdateQualificationJournal | undefined
  readonly directory: string
  private readonly installedVersion: string
  private readonly now: () => Date

  constructor(
    directory: string,
    installedVersion: string,
    now: () => Date = () => new Date(),
  ) {
    this.directory = directory
    this.installedVersion = installedVersion
    this.now = now
  }

  setEnabled(enabled: boolean): void {
    if (enabled === this.enabled) return
    if (!enabled) {
      this.enabled = false
      this.journal = undefined
      return
    }
    const journal = new DesktopUpdateQualificationJournal(this.directory, this.installedVersion, this.now)
    journal.record({ phase: 'launch-ready', outcome: 'completed' })
    this.journal = journal
    this.enabled = true
  }

  record(event: DesktopUpdateQualificationEvent): void {
    this.journal?.record(event)
  }

  clear(): void {
    clearDesktopUpdateQualificationJournals(this.directory)
    this.journal = this.enabled
      ? new DesktopUpdateQualificationJournal(this.directory, this.installedVersion, this.now)
      : undefined
  }
}

declare module '@deepseek-ai/cordis' {
  interface Context {
    desktopUpdateQualificationJournal: DesktopUpdateQualificationJournalManager
  }
}

export type DesktopUpdateQualificationJournalContext = Context
