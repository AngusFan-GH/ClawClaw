/** Read-only post-migration audit. Never print prompts, credentials, or conversation content. */
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync, existsSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import YAML from 'yaml'

const hash = value => createHash('sha256').update(value).digest('hex')
const canonical = value => Array.isArray(value) ? value.map(canonical)
  : value !== null && typeof value === 'object'
    ? Object.fromEntries(Object.keys(value).sort().filter(key => value[key] !== undefined).map(key => [key, canonical(value[key])])) : value
const signature = value => JSON.stringify(canonical(value))

export function verifyMigrationData(dataDir, backupDir, profileName = 'desktop') {
  dataDir = resolve(dataDir); backupDir = resolve(backupDir)
  const profileDir = join(dataDir, 'profiles', profileName)
  const scope = hash(profileDir).slice(0, 20)
  const registryPath = join(dataDir, 'storages', `desktop_schedule_registry_${scope}.json`)
  const corePath = join(dataDir, 'storages', `desktop_schedule_core_${scope}.json`)
  const registry = JSON.parse(readFileSync(registryPath, 'utf8')).global
  const core = JSON.parse(readFileSync(corePath, 'utf8')).tables.tasks
  assert.equal(registry.version, 1)
  assert.equal(registry.migrated, true)
  const snapshotPath = join(profileDir, 'migration-backups', `desktop-schedule-v1-${registry.sourceHash}.json`)
  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8'))
  assert.equal(hash(JSON.stringify(snapshot.originalJobs)), registry.sourceHash, 'migration snapshot checksum differs')
  assert.equal(signature(snapshot.originalJobs), signature(registry.originalJobs), 'immutable legacy snapshot differs')
  const oldRows = YAML.parse(readFileSync(join(backupDir, 'data', 'profiles', profileName, 'cordis.patch.yml'), 'utf8'), { logLevel: 'silent' })
  const oldJobs = oldRows.filter(row => row.id === 'desktop-cron-tasks' && Array.isArray(row.config?.jobs)).at(-1)?.config.jobs ?? []
  assert.equal(oldJobs.length, registry.originalJobs.length, 'legacy task count differs from the stopped-app backup')
  assert.equal(new Set(registry.jobs.map(job => job.id)).size, registry.jobs.length, 'duplicate task ids')
  assert.equal(Object.keys(core).length, registry.jobs.length, 'official core catalog differs')
  const tasks = oldJobs.map(old => {
    const task = registry.jobs.find(job => job.id === old.id)
    assert.ok(task, `missing original task ${old.id}`)
    for (const key of ['name', 'prompt', 'expression', 'timeZone', 'oneTimeAt']) {
      assert.equal(task[key], old[key], `original task ${old.id}: ${key} changed`)
    }
    if (old.activeSessionId !== undefined) assert.equal(task.activeSessionId, old.activeSessionId, 'original Session changed')
    if (old.activeSessionWorkspaceId !== undefined) assert.equal(task.activeSessionWorkspaceId, old.activeSessionWorkspaceId, 'Workspace binding changed')
    if (old.oneTimeAt === undefined) assert.equal(task.enabled, old.enabled, 'recurring enabled state changed')
    const signatures = new Set(task.history.map(signature))
    for (const run of old.history) assert.ok(signatures.has(signature(run)), `task ${old.id}: a saved execution record was lost`)
    assert.equal(core[old.id].sessionId, task.activeSessionId)
    assert.equal(core[old.id].status, task.enabled && task.nextRunAt !== null ? 'active' : 'inactive')
    if (task.enabled) assert.ok(Date.parse(task.nextRunAt) > Date.now(), 'an overdue target could backfill')
    return { id: task.id, name: task.name, timeZone: task.timeZone, expression: task.expression, enabled: task.enabled,
      originalSessionId: old.activeSessionId, sessionId: task.activeSessionId, originalHistory: old.history.length,
      retainedHistory: task.history.length, originalHistoryPreserved: true, nextRunAt: task.nextRunAt,
      pendingRunAt: task.pendingRunAt, lastClaimedAt: task.lastClaimedAt ?? null }
  })
  const manifest = JSON.parse(readFileSync(join(backupDir, 'manifest.json'), 'utf8'))
  const logs = manifest.files.filter(file => file.path.startsWith('data/sessions/')
    && (file.path.endsWith('.jsonl.zstd') || file.path.endsWith('.jsonl')))
  for (const file of logs) {
    const path = join(dataDir, file.path.slice('data/'.length))
    assert.ok(existsSync(path), 'an original Session log is missing')
    assert.equal(hash(readFileSync(path)), file.sha256, 'an original Session log changed during migration')
  }
  return { version: 1, auditedAt: new Date().toISOString(), backupDir, registryPath, corePath, snapshotPath,
    sourceHash: registry.sourceHash, taskCount: tasks.length, coreTaskCount: Object.keys(core).length,
    originalHistoryRecords: tasks.reduce((sum, task) => sum + task.originalHistory, 0),
    sessionLogsVerifiedUnchanged: logs.length, archivedTasks: registry.archivedJobs.length, tasks }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const [dataDir, backupDir, profileName] = process.argv.slice(2)
  if (!dataDir || !backupDir) throw new Error('Usage: node verify-schedule-migration-data.mjs <data-dir> <backup-dir> [profile]')
  process.stdout.write(JSON.stringify(verifyMigrationData(dataDir, backupDir, profileName), null, 2) + '\n')
}
