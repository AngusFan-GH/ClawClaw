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
