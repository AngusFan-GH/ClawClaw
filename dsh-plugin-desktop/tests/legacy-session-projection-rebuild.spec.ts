import { mkdir, mkdtemp, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { SESSION_FORMAT_VERSION, SessionId, SessionLogOffset } from '@deepseek-ai/dsh-session'
import { describe, expect, it, vi } from 'vitest'
import {
  findLegacyBlankProjectionCandidates,
  rebuildLegacyBlankSessionProjections,
  type CurrentSessionLog,
} from '../src/legacy-session-projection-rebuild.ts'

const ID = 'session-00000000-0000-4000-8000-000000000001'

async function fixtureHome(): Promise<{ home: string; records: string }> {
  const home = await mkdtemp(join(tmpdir(), 'clawclaw-legacy-projection-'))
  const records = join(home, 'storages', 'session_projcache', 'sessions')
  await mkdir(records, { recursive: true })
  return { home, records }
}

function cacheDocument(overrides: {
  formatVersion?: number
  createdAt?: number
  cwd?: string
  isSeeded?: boolean
  blank?: boolean
  title?: unknown
} = {}): object {
  return {
    version: 7,
    record: {
      identity: {
        formatVersion: overrides.formatVersion ?? SESSION_FORMAT_VERSION - 1,
        createdAt: overrides.createdAt ?? 10,
        cwd: overrides.cwd ?? '/work/default',
        isSeeded: overrides.isSeeded ?? false,
        inheritedEventCount: 0,
      },
      rows: {
        sessionListMetadata: { ver: 1, seq: 2, val: { blank: overrides.blank ?? true, lastPromptAt: null } },
        title: { ver: 1, seq: 2, val: overrides.title ?? null },
      },
    },
  }
}

async function writeRecord(records: string, id: string, value: object): Promise<void> {
  await writeFile(join(records, `${id}.json`), JSON.stringify(value))
}

function currentLog(overrides: { createdAt?: number; cwd?: string; isSeeded?: boolean } = {}): CurrentSessionLog {
  return {
    session: {
      version: SESSION_FORMAT_VERSION,
      id: SessionId(ID),
      createdAt: overrides.createdAt ?? 10,
      cwd: overrides.cwd ?? '/work/default',
      isSeeded: overrides.isSeeded ?? false,
      delegationDepth: 0,
    },
    inheritedEventCount: SessionLogOffset(0),
    events: [],
  }
}

describe('legacy Session projection rebuild', () => {
  it('selects only predecessor blank rows without a durable title', async () => {
    const { home, records } = await fixtureHome()
    await writeRecord(records, ID, cacheDocument())
    await writeRecord(records, 'session-00000000-0000-4000-8000-000000000002', cacheDocument({ blank: false }))
    await writeRecord(records, 'session-00000000-0000-4000-8000-000000000003', cacheDocument({ title: 'Named' }))
    await writeRecord(records, 'session-00000000-0000-4000-8000-000000000004', cacheDocument({ formatVersion: SESSION_FORMAT_VERSION }))
    await writeFile(join(records, 'session-00000000-0000-4000-8000-000000000005.json'), '{bad json')
    await symlink(join(records, `${ID}.json`), join(records, 'session-00000000-0000-4000-8000-000000000006.json'))
    const warn = vi.fn()

    await expect(findLegacyBlankProjectionCandidates(home, { warn })).resolves.toEqual([{
      sessionId: ID,
      identity: { formatVersion: SESSION_FORMAT_VERSION - 1, createdAt: 10, cwd: '/work/default', isSeeded: false },
    }])
    expect(warn).toHaveBeenCalledOnce()
  })

  it('rebuilds from the authoritative log and waits for the current cache row', async () => {
    const { home, records } = await fixtureHome()
    await writeRecord(records, ID, cacheDocument())
    const log = currentLog()
    let current = false
    const readSession = vi.fn(async () => log)
    const rebuildProjection = vi.fn(() => { current = true })

    await expect(rebuildLegacyBlankSessionProjections(home, {
      readSession,
      rebuildProjection,
      hasCurrentProjection: () => current,
    }, { sleep: async () => undefined })).resolves.toEqual({
      candidates: 1, rebuilt: 1, alreadyCurrent: 0, mismatched: 0, failed: 0,
    })
    expect(readSession).toHaveBeenCalledWith(SessionId(ID))
    expect(rebuildProjection).toHaveBeenCalledWith(log)
  })

  it('skips lifecycle mismatches and current rows without rewriting either', async () => {
    const { home, records } = await fixtureHome()
    await writeRecord(records, ID, cacheDocument())
    const rebuildProjection = vi.fn()
    const mismatch = await rebuildLegacyBlankSessionProjections(home, {
      readSession: async () => currentLog({ createdAt: 11 }),
      rebuildProjection,
      hasCurrentProjection: () => false,
    })
    expect(mismatch).toEqual({ candidates: 1, rebuilt: 0, alreadyCurrent: 0, mismatched: 1, failed: 0 })

    const current = await rebuildLegacyBlankSessionProjections(home, {
      readSession: async () => currentLog(),
      rebuildProjection,
      hasCurrentProjection: () => true,
    })
    expect(current).toEqual({ candidates: 1, rebuilt: 0, alreadyCurrent: 1, mismatched: 0, failed: 0 })
    expect(rebuildProjection).not.toHaveBeenCalled()
  })

  it('contains per-session read and cache-write failures', async () => {
    const { home, records } = await fixtureHome()
    await writeRecord(records, ID, cacheDocument())
    const warn = vi.fn()

    await expect(rebuildLegacyBlankSessionProjections(home, {
      readSession: async () => { throw new Error('unreadable') },
      rebuildProjection: vi.fn(),
      hasCurrentProjection: () => false,
    }, { warn, settleAttempts: 1, settleDelayMs: 0, sleep: async () => undefined })).resolves.toEqual({
      candidates: 1, rebuilt: 0, alreadyCurrent: 0, mismatched: 0, failed: 1,
    })
    expect(warn).toHaveBeenCalledWith(expect.stringContaining('unreadable'))
  })
})
