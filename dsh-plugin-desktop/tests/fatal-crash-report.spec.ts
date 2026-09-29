import { linkSync, mkdtempSync, mkdirSync, readdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  DESKTOP_FATAL_REPORT_LIMIT,
  DESKTOP_FATAL_REPORT_MAX_BYTES,
  DESKTOP_FATAL_REPORT_NAME,
  pruneDesktopFatalReports,
  readDesktopFatalReport,
  writeDesktopFatalReport,
} from '../src/fatal-crash-report.ts'

function input(error: unknown, time = new Date('2026-09-28T01:02:03.004Z')) {
  return {
    source: 'main' as const,
    error,
    version: '0.2.2',
    platform: 'darwin',
    arch: 'arm64',
    processRole: 'electron-main' as const,
    time,
    privatePaths: ['/Users/private/workspace'],
  }
}

describe('structured fatal crash reports', () => {
  it('writes only bounded, sanitized allowlisted fields', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clawclaw-fatal-'))
    const error = Object.assign(new Error('token=secret-value at /Users/private/workspace/file.ts'), {
      requestBody: 'conversation must not be serialized',
    })
    const path = writeDesktopFatalReport(directory, input(error))
    const report = readDesktopFatalReport(path) as Record<string, unknown>
    const text = readFileSync(path, 'utf8')

    expect(report).toMatchObject({ schemaVersion: 1, source: 'main', processRole: 'electron-main' })
    expect(text).toContain('<private-path>/file.ts')
    expect(text).not.toContain('secret-value')
    expect(text).not.toContain('conversation must not be serialized')
    expect(Object.keys(report).sort()).toEqual([
      'arch', 'message', 'pid', 'platform', 'processRole', 'schemaVersion', 'source', 'stack', 'time', 'version',
    ])
  })

  it('retains only the newest bounded report set and ignores foreign files', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clawclaw-fatal-'))
    writeFileSync(join(directory, 'notes.json'), '{}')
    for (let index = 0; index < DESKTOP_FATAL_REPORT_LIMIT + 3; index += 1) {
      writeDesktopFatalReport(directory, input(new Error(String(index)), new Date(Date.UTC(2026, 8, 1, 0, 0, index))))
    }
    const names = readdirSync(directory)
    expect(names.filter(name => name.startsWith('fatal-'))).toHaveLength(DESKTOP_FATAL_REPORT_LIMIT)
    expect(names).toContain('notes.json')
  })

  it('keeps each serialized report within the whole-report byte limit', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clawclaw-fatal-'))
    const path = writeDesktopFatalReport(directory, input(new Error(`secret=${'x'.repeat(DESKTOP_FATAL_REPORT_MAX_BYTES * 2)}`)))

    expect(Buffer.byteLength(readFileSync(path))).toBeLessThanOrEqual(DESKTOP_FATAL_REPORT_MAX_BYTES)
    expect(readDesktopFatalReport(path)).toMatchObject({ schemaVersion: 1, source: 'main' })
  })

  it('creates collision-free complete reports for same-time writes', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clawclaw-fatal-'))
    const paths = Array.from({ length: 8 }, (_, index) => writeDesktopFatalReport(directory, input(new Error(String(index)))))

    expect(new Set(paths)).toHaveLength(paths.length)
    expect(paths.every(path => (readDesktopFatalReport(path) as { schemaVersion?: number }).schemaVersion === 1)).toBe(true)
    expect(readdirSync(directory).some(name => name.endsWith('.tmp'))).toBe(false)
  })

  it('does not traverse a linked directory or prune linked report entries', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawclaw-fatal-links-'))
    const outside = join(root, 'outside')
    const linkedDirectory = join(root, 'linked')
    mkdirSync(outside)
    symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => writeDesktopFatalReport(linkedDirectory, input(new Error('stop')))).toThrow('fatal report directory is invalid')

    const directory = join(root, 'reports')
    mkdirSync(directory)
    const target = join(root, 'target.json')
    writeFileSync(target, 'outside-data')
    const linkedName = `fatal-2026-09-28T01-02-03-004Z-main-00000000-0000-4000-8000-000000000000.json`
    expect(DESKTOP_FATAL_REPORT_NAME.test(linkedName)).toBe(true)
    linkSync(target, join(directory, linkedName))
    pruneDesktopFatalReports(directory, 0, 0)
    expect(readFileSync(target, 'utf8')).toBe('outside-data')
    expect(readFileSync(join(directory, linkedName), 'utf8')).toBe('outside-data')
  })

  it('rotates corrupt recognized reports without parsing them', () => {
    const directory = mkdtempSync(join(tmpdir(), 'clawclaw-fatal-corrupt-'))
    const corruptName = 'fatal-2026-09-01T00-00-00-000Z-main-00000000-0000-4000-8000-000000000000.json'
    writeFileSync(join(directory, corruptName), '{partial')

    expect(() => pruneDesktopFatalReports(directory, 0, 0)).not.toThrow()
    expect(readdirSync(directory)).not.toContain(corruptName)
  })
})
