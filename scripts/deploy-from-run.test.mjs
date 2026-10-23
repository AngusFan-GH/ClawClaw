import test from 'node:test'
import assert from 'node:assert/strict'
import { validateRun } from './deploy-from-run.mjs'
const run = { id: 42, status: 'completed', conclusion: 'success', path: '.github/workflows/release.yml', repository: { full_name: 'AngusFan-GH/ClawClaw' }, head_sha: 'a'.repeat(40) }
const info = { repository: run.repository.full_name, commit: run.head_sha, runId: '42' }
test('accepts the exact successful packaging run', () => validateRun(run, info, '42'))
test('rejects failed, incomplete, foreign and nonpackaging runs', () => {
  for (const change of [{ conclusion: 'failure' }, { status: 'in_progress' }, { path: '.github/workflows/ci.yml' }, { repository: { full_name: 'other/repo' } }]) {
    assert.throws(() => validateRun({ ...run, ...change }, info, '42'))
  }
})
test('rejects mixed-run or mixed-commit artifacts', () => {
  for (const change of [{ commit: 'b'.repeat(40) }, { runId: '43' }, { repository: 'other/repo' }]) {
    assert.throws(() => validateRun(run, { ...info, ...change }, '42'))
  }
})

import { parseArguments, listCandidates, choiceId, temporaryDownloadBytes, downloadProgress, runWithProgress } from './deploy-from-run.mjs'
test('supports selection, dry-run, listing and explicit IDs; rejects typo flags', () => {
  assert.equal(parseArguments([]).runId, undefined)
  assert.equal(parseArguments(['--dry-run']).dryRun, true)
  assert.equal(parseArguments(['--list']).list, true)
  assert.equal(parseArguments(['42', '--dry-run']).runId, '42')
  for (const args of [['--dryrun'], ['42', '43'], ['42', '--list'], ['abc']]) assert.throws(() => parseArguments(args))
})
test('filters absent, expired, empty and platform-only assets; reads version from exact commit', () => {
  const runs = [42, 43, 44, 45, 46].map(id => ({ ...run, id }))
  const paths = []
  const candidates = listCandidates(path => {
    paths.push(path)
    if (path.startsWith('actions/workflows/')) return { workflow_runs: runs }
    if (path.startsWith('contents/')) return { content: Buffer.from('{"version":"0.2.12"}').toString('base64') }
    const id = Number(path.split('/')[2])
    return { artifacts: id === 42 ? [] : [{ name: id === 43 ? 'desktop-platform-macos' : 'desktop-release', expired: id === 44, size_in_bytes: id === 45 ? 0 : 100 }] }
  })
  assert.ok(paths[0].endsWith('per_page=10'))
  assert.deepEqual(candidates.map(c => c.runId), ['46'])
  assert.equal(candidates[0].version, '0.2.12')
  assert.ok(paths.includes(`contents/dsh-plugin-desktop/package.json?ref=${run.head_sha}`))
})
test('Enter chooses the latest first candidate; q cancels and invalid numbers fail', () => {
  const candidates = [{ runId: '42' }, { runId: '43' }]
  assert.equal(choiceId('2', candidates), '43')
  assert.equal(choiceId('', candidates), '42')
  assert.equal(choiceId('  ', candidates), '42')
  assert.equal(choiceId('', []), undefined)
  for (const answer of ['q', 'Q']) assert.equal(choiceId(answer, candidates), undefined)
  for (const answer of ['0', '3', '1.5', 'abc', '-1']) assert.throws(() => choiceId(answer, candidates))
})


import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

test('download progress reports real bytes, percentage, speed and extraction state', () => {
  const directory = mkdtempSync(join(tmpdir(), 'clawclaw-progress-'))
  try {
    assert.match(downloadProgress(directory, 2 * 1024 ** 2, 1000), /等待/)
    writeFileSync(join(directory, 'artifact.zip'), Buffer.alloc(1024 ** 2))
    assert.equal(temporaryDownloadBytes(directory), 1024 ** 2)
    assert.match(downloadProgress(directory, 2 * 1024 ** 2, 1000), /50.0%.*1.0 \/ 2.0 MB.*1.0 MB\/s/)
    assert.match(downloadProgress(directory, 1024 ** 2, 1000), /100.0%.*正在解压/)
  } finally { rmSync(directory, { recursive: true, force: true }) }
})

test('silent commands emit heartbeats and a completion message; failed commands stop the phase', async () => {
  const messages = []
  const signals = process.listenerCount('SIGINT')
  await runWithProgress(process.execPath, ['-e', 'setTimeout(() => {}, 120)'], {
    label: 'download', intervalMs: 15, progress: () => '25%', log: message => messages.push(message),
  })
  assert.ok(messages.some(message => /已用.*25%/.test(message)))
  assert.match(messages.at(-1), /完成/)
  assert.equal(process.listenerCount('SIGINT'), signals)
  const failed = []
  await assert.rejects(runWithProgress(process.execPath, ['-e', 'process.exit(2)'], {
    label: 'upload', intervalMs: 15, log: message => failed.push(message),
  }), /upload失败/)
  assert.ok(!failed.some(message => message.includes('完成')))
  assert.equal(process.listenerCount('SIGINT'), signals)
})
