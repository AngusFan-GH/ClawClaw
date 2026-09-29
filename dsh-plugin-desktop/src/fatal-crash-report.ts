/** Bounded local evidence for fatal main and Host failures. */

import { randomUUID } from 'node:crypto'
import { chmodSync, lstatSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { maskSecrets } from './mask-secrets.ts'

export type DesktopFatalSource = 'main' | 'host' | 'native-child'

export interface DesktopFatalReportInput {
  readonly source: DesktopFatalSource
  readonly error: unknown
  readonly version: string
  readonly platform: string
  readonly arch: string
  readonly processRole: 'electron-main' | 'host-supervisor'
  readonly time?: Date
  readonly privatePaths?: readonly string[]
}

export const DESKTOP_FATAL_REPORT_LIMIT = 10
export const DESKTOP_FATAL_REPORT_TOTAL_BYTES = 1024 * 1024
export const DESKTOP_FATAL_REPORT_MAX_BYTES = 128 * 1024
export const DESKTOP_FATAL_REPORT_NAME = /^fatal-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z-(?:main|host|native-child)-[0-9a-f-]+\.json$/u

function sanitized(value: string, privatePaths: readonly string[]): string {
  let result = maskSecrets(value)
  for (const path of privatePaths.filter(Boolean).sort((a, b) => b.length - a.length)) {
    result = result.replaceAll(path, '<private-path>')
  }
  return result.slice(0, DESKTOP_FATAL_REPORT_MAX_BYTES)
}

function errorFacts(error: unknown, privatePaths: readonly string[]): { message: string; stack?: string } {
  if (error instanceof Error) {
    return {
      message: sanitized(error.message, privatePaths),
      ...(error.stack === undefined ? {} : { stack: sanitized(error.stack, privatePaths) }),
    }
  }
  return { message: sanitized(String(error), privatePaths) }
}

function serializeBoundedReport(report: Record<string, unknown>): string {
  const serialize = (value: Record<string, unknown>): string => `${JSON.stringify(value, null, 2)}\n`
  if (Buffer.byteLength(serialize(report)) <= DESKTOP_FATAL_REPORT_MAX_BYTES) return serialize(report)

  const fitField = (field: 'message' | 'stack', value: string): void => {
    let low = 0
    let high = value.length
    while (low < high) {
      const middle = Math.ceil((low + high) / 2)
      report[field] = value.slice(0, middle)
      if (Buffer.byteLength(serialize(report)) <= DESKTOP_FATAL_REPORT_MAX_BYTES) low = middle
      else high = middle - 1
    }
    report[field] = value.slice(0, low)
  }

  const stack = typeof report.stack === 'string' ? report.stack : undefined
  if (stack !== undefined) {
    report.stack = ''
    if (Buffer.byteLength(serialize(report)) <= DESKTOP_FATAL_REPORT_MAX_BYTES) {
      fitField('stack', stack)
      return serialize(report)
    }
    delete report.stack
  }
  fitField('message', String(report.message ?? ''))
  return serialize(report)
}

function assertPrivateDirectory(directory: string): void {
  const stats = lstatSync(directory)
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error('dsh-plugin-desktop: fatal report directory is invalid')
  }
  try { chmodSync(directory, 0o700) } catch {}
}

/** Atomically write one private report and prune only recognized report files. */
export function writeDesktopFatalReport(directory: string, input: DesktopFatalReportInput): string {
  mkdirSync(directory, { recursive: true, mode: 0o700 })
  assertPrivateDirectory(directory)
  const time = input.time ?? new Date()
  const name = `fatal-${time.toISOString().replaceAll(/[:.]/gu, '-')}-${input.source}-${randomUUID()}.json`
  const path = join(directory, name)
  const temporary = join(directory, `.${name}.tmp`)
  const facts = errorFacts(input.error, input.privatePaths ?? [])
  const report: Record<string, unknown> = {
    schemaVersion: 1,
    time: time.toISOString(),
    source: input.source,
    processRole: input.processRole,
    version: input.version,
    platform: input.platform,
    arch: input.arch,
    pid: process.pid,
    ...facts,
  }
  try {
    writeFileSync(temporary, serializeBoundedReport(report), { flag: 'wx', mode: 0o600 })
    renameSync(temporary, path)
  } finally {
    try { unlinkSync(temporary) } catch {}
  }
  pruneDesktopFatalReports(directory)
  return path
}

export function pruneDesktopFatalReports(
  directory: string,
  retained = DESKTOP_FATAL_REPORT_LIMIT,
  maxBytes = DESKTOP_FATAL_REPORT_TOTAL_BYTES,
): void {
  assertPrivateDirectory(directory)
  const reports = readdirSync(directory)
    .filter(name => DESKTOP_FATAL_REPORT_NAME.test(name))
    .flatMap((name) => {
      const stats = lstatSync(join(directory, name))
      return stats.isFile() && !stats.isSymbolicLink() && stats.nlink === 1
        ? [{ name, size: stats.size }]
        : []
    })
    .sort((a, b) => b.name.localeCompare(a.name, 'en'))
  let bytes = 0
  for (const [index, report] of reports.entries()) {
    bytes += report.size
    if (index < retained && bytes <= maxBytes) continue
    unlinkSync(join(directory, basename(report.name)))
  }
}

/** Parse only reports emitted by this writer, for focused diagnostics tests. */
export function readDesktopFatalReport(path: string): unknown {
  return JSON.parse(readFileSync(path, 'utf8'))
}
