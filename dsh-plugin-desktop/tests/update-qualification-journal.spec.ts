import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import {
  clearDesktopUpdateQualificationJournals,
  DESKTOP_UPDATE_JOURNAL_FILE_BYTES,
  DESKTOP_UPDATE_JOURNAL_FILE_LIMIT,
  DesktopUpdateQualificationJournal,
  DesktopUpdateQualificationJournalManager,
} from '../src/update-qualification-journal.ts'

describe('update qualification journal', () => {
  it('is disabled by default and writes only explicitly allowlisted fields after opt-in', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawclaw-update-journal-'))
    const directory = join(root, 'journal')
    const manager = new DesktopUpdateQualificationJournalManager(directory, '2.0.0')
    manager.record({ phase: 'check-requested' })
    expect(existsSync(directory)).toBe(false)

    manager.setEnabled(true)
    manager.record({
      phase: 'operation-failed',
      targetVersion: '2.1.0',
      errorCategory: 'download-failed',
      durationMs: 42,
      url: 'https://user:password@example.test/file?token=secret',
      message: 'private error',
    } as never)
    const files = readdirSync(directory)
    expect(files).toHaveLength(1)
    const text = readFileSync(join(directory, files[0]!), 'utf8')
    const value = JSON.parse(text) as { schemaVersion: number, events: Array<Record<string, unknown>> }
    expect(value.schemaVersion).toBe(1)
    expect(value.events.map(event => event.phase)).toEqual(['launch-ready', 'operation-failed'])
    expect(value.events[1]).toMatchObject({
      targetVersion: '2.1.0', errorCategory: 'download-failed', durationMs: 42,
    })
    expect(text).not.toContain('example.test')
    expect(text).not.toContain('private error')
  })

  it('atomically bounds a snapshot and rotates the journal directory', () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'clawclaw-update-journal-')), 'journal')
    const bounded = new DesktopUpdateQualificationJournal(directory, '1.9.0')
    for (let event = 0; event < 140; event += 1) {
      bounded.record({ phase: 'check-completed', targetVersion: '2.1.0', outcome: 'available', durationMs: event })
    }
    for (let index = 0; index < DESKTOP_UPDATE_JOURNAL_FILE_LIMIT + 3; index += 1) {
      const journal = new DesktopUpdateQualificationJournal(directory, `2.0.${String(index)}`)
      journal.record({ phase: 'check-completed', targetVersion: '2.1.0', outcome: 'available', durationMs: index })
    }
    const files = readdirSync(directory)
    expect(files.filter(name => name.startsWith('update-journal-'))).toHaveLength(DESKTOP_UPDATE_JOURNAL_FILE_LIMIT)
    expect(files.some(name => name.endsWith('.tmp'))).toBe(false)
    for (const name of files) {
      expect(Buffer.byteLength(readFileSync(join(directory, name)))).toBeLessThanOrEqual(DESKTOP_UPDATE_JOURNAL_FILE_BYTES)
    }
  })

  it('clears recognized evidence without following directory or file links', () => {
    const root = mkdtempSync(join(tmpdir(), 'clawclaw-update-journal-links-'))
    const outside = join(root, 'outside')
    mkdirSync(outside)
    const linkedDirectory = join(root, 'linked')
    symlinkSync(outside, linkedDirectory, process.platform === 'win32' ? 'junction' : 'dir')
    expect(() => clearDesktopUpdateQualificationJournals(linkedDirectory)).toThrow('directory is invalid')

    const directory = join(root, 'journal')
    mkdirSync(directory)
    const target = join(root, 'target.json')
    writeFileSync(target, 'outside-data')
    const linkedName = 'update-journal-2026-09-28T00-00-00-000Z-00000000-0000-4000-8000-000000000000.json'
    linkSync(target, join(directory, linkedName))
    clearDesktopUpdateQualificationJournals(directory)
    expect(readFileSync(target, 'utf8')).toBe('outside-data')
    expect(readFileSync(join(directory, linkedName), 'utf8')).toBe('outside-data')
  })

  it('clears active evidence without resurrecting previous events', () => {
    const directory = join(mkdtempSync(join(tmpdir(), 'clawclaw-update-journal-clear-')), 'journal')
    const manager = new DesktopUpdateQualificationJournalManager(directory, '2.0.0')
    manager.setEnabled(true)
    manager.record({ phase: 'check-requested' })
    manager.clear()
    expect(readdirSync(directory)).toEqual([])
    manager.record({ phase: 'check-completed', outcome: 'up-to-date' })
    const text = readFileSync(join(directory, readdirSync(directory)[0]!), 'utf8')
    expect(text).toContain('check-completed')
    expect(text).not.toContain('check-requested')
    expect(text).not.toContain('launch-ready')
  })
})
