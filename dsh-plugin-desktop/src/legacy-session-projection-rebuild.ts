/** One-time repair for predecessor projection rows that lost blank-list semantics. */

import { lstat, readdir, readFile } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import {
  SESSION_FORMAT_VERSION,
  SessionId,
  type SessionEvent,
  type SessionHeader,
  type SessionLogOffset,
} from '@deepseek-ai/dsh-session'

const BIN_NAME = 'dsh-plugin-desktop'
const CACHE_DIRECTORY = ['storages', 'session_projcache', 'sessions'] as const
const MAX_CACHE_RECORD_BYTES = 16 * 1024 * 1024
const SESSION_CACHE_FILENAME = /^(session-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\.json$/u

interface LegacyLifecycleIdentity {
  readonly formatVersion: number
  readonly createdAt: number
  readonly cwd?: string
  readonly isSeeded: boolean
}

export interface LegacyBlankProjectionCandidate {
  readonly sessionId: string
  readonly identity: LegacyLifecycleIdentity
}

export interface CurrentSessionLog {
  readonly session: SessionHeader
  readonly inheritedEventCount: SessionLogOffset
  readonly events: readonly SessionEvent[]
}

export interface LegacyProjectionRebuildRuntime {
  readonly readSession: (sessionId: SessionId) => Promise<CurrentSessionLog>
  readonly hasCurrentProjection: (header: SessionHeader) => boolean
  readonly rebuildProjection: (log: CurrentSessionLog) => void
}

export interface LegacyProjectionRebuildOptions {
  readonly maxRecordBytes?: number
  readonly settleAttempts?: number
  readonly settleDelayMs?: number
  readonly sleep?: (delayMs: number) => Promise<void>
  readonly warn?: (message: string) => void
}

export interface LegacyProjectionRebuildResult {
  readonly candidates: number
  readonly rebuilt: number
  readonly alreadyCurrent: number
  readonly mismatched: number
  readonly failed: number
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}

function optionalString(value: unknown): value is string | undefined {
  return value === undefined || typeof value === 'string'
}

function candidateFromDocument(
  sessionId: string,
  value: unknown,
): LegacyBlankProjectionCandidate | undefined {
  if (!isRecord(value) || !isRecord(value.record)) return undefined
  const { identity, rows } = value.record
  if (!isRecord(identity) || !isRecord(rows)) return undefined
  if (!Number.isSafeInteger(identity.formatVersion)
    || (identity.formatVersion as number) < 0
    || (identity.formatVersion as number) >= SESSION_FORMAT_VERSION
    || !Number.isSafeInteger(identity.createdAt)
    || (identity.createdAt as number) < 0
    || !optionalString(identity.cwd)
    || typeof identity.isSeeded !== 'boolean') return undefined

  const metadata = rows.sessionListMetadata
  if (!isRecord(metadata) || !isRecord(metadata.val) || metadata.val.blank !== true) return undefined
  const title = rows.title
  if (title !== undefined) {
    if (!isRecord(title)) return undefined
    if (title.val !== null && title.val !== undefined && title.val !== '') return undefined
  }

  return {
    sessionId,
    identity: {
      formatVersion: identity.formatVersion as number,
      createdAt: identity.createdAt as number,
      ...(identity.cwd === undefined ? {} : { cwd: identity.cwd }),
      isSeeded: identity.isSeeded,
    },
  }
}

function lifecycleMatches(candidate: LegacyBlankProjectionCandidate, header: SessionHeader): boolean {
  return header.id === candidate.sessionId
    && header.version === SESSION_FORMAT_VERSION
    && candidate.identity.formatVersion < header.version
    && header.createdAt === candidate.identity.createdAt
    && header.cwd === candidate.identity.cwd
    && header.isSeeded === candidate.identity.isSeeded
}

function defaultSleep(delayMs: number): Promise<void> {
  return new Promise(resolve => { setTimeout(resolve, delayMs) })
}

/** Find only predecessor rows that explicitly claimed blank and never carried a title. */
export async function findLegacyBlankProjectionCandidates(
  homeDir: string,
  options: Pick<LegacyProjectionRebuildOptions, 'maxRecordBytes' | 'warn'> = {},
): Promise<LegacyBlankProjectionCandidate[]> {
  if (!isAbsolute(homeDir) || homeDir.includes('\0')) {
    throw new Error(`${BIN_NAME}: legacy projection rebuild requires an absolute DSH home path`)
  }
  const directory = join(homeDir, ...CACHE_DIRECTORY)
  let entries
  try {
    entries = await readdir(directory, { withFileTypes: true })
  } catch (cause) {
    if ((cause as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw cause
  }
  const maxRecordBytes = options.maxRecordBytes ?? MAX_CACHE_RECORD_BYTES
  if (!Number.isSafeInteger(maxRecordBytes) || maxRecordBytes < 1) {
    throw new TypeError(`${BIN_NAME}: legacy projection rebuild record limit must be a positive integer`)
  }
  const candidates: LegacyBlankProjectionCandidate[] = []
  for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
    const match = SESSION_CACHE_FILENAME.exec(entry.name)
    if (match?.[1] === undefined || !entry.isFile() || entry.isSymbolicLink()) continue
    const path = join(directory, entry.name)
    try {
      const stat = await lstat(path)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxRecordBytes) continue
      const candidate = candidateFromDocument(match[1], JSON.parse(await readFile(path, 'utf8')) as unknown)
      if (candidate !== undefined) candidates.push(candidate)
    } catch (cause) {
      options.warn?.(`could not inspect ${entry.name}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return candidates
}

async function waitForCurrentProjection(
  runtime: LegacyProjectionRebuildRuntime,
  header: SessionHeader,
  options: LegacyProjectionRebuildOptions,
): Promise<boolean> {
  const attempts = options.settleAttempts ?? 200
  const delayMs = options.settleDelayMs ?? 10
  if (!Number.isSafeInteger(attempts) || attempts < 1
    || !Number.isSafeInteger(delayMs) || delayMs < 0) {
    throw new TypeError(`${BIN_NAME}: legacy projection rebuild settle policy is invalid`)
  }
  const sleep = options.sleep ?? defaultSleep
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (runtime.hasCurrentProjection(header)) return true
    await sleep(delayMs)
  }
  return runtime.hasCurrentProjection(header)
}

/** Recompute candidates from authoritative current-format logs and wait for each cache write. */
export async function rebuildLegacyBlankSessionProjections(
  homeDir: string,
  runtime: LegacyProjectionRebuildRuntime,
  options: LegacyProjectionRebuildOptions = {},
): Promise<LegacyProjectionRebuildResult> {
  const candidates = await findLegacyBlankProjectionCandidates(homeDir, options)
  let rebuilt = 0
  let alreadyCurrent = 0
  let mismatched = 0
  let failed = 0
  for (const candidate of candidates) {
    try {
      const log = await runtime.readSession(SessionId(candidate.sessionId))
      if (!lifecycleMatches(candidate, log.session)) {
        mismatched += 1
        continue
      }
      if (runtime.hasCurrentProjection(log.session)) {
        alreadyCurrent += 1
        continue
      }
      runtime.rebuildProjection(log)
      if (!await waitForCurrentProjection(runtime, log.session, options)) {
        throw new Error('current projection cache write did not settle')
      }
      rebuilt += 1
    } catch (cause) {
      failed += 1
      options.warn?.(`could not rebuild ${candidate.sessionId}: ${cause instanceof Error ? cause.message : String(cause)}`)
    }
  }
  return { candidates: candidates.length, rebuilt, alreadyCurrent, mismatched, failed }
}
