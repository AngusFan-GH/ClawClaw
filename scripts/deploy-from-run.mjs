#!/usr/bin/env node
/** Explicit local deployment of one successful GitHub packaging run. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPOSITORY = 'AngusFan-GH/ClawClaw'
export function validateRun(run, info, runId) {
  if (run.status !== 'completed' || run.conclusion !== 'success'
    || run.path !== '.github/workflows/release.yml' || String(run.id) !== runId
    || run.repository?.full_name !== REPOSITORY || !/^[a-f0-9]{40}$/.test(run.head_sha ?? '')) {
    throw new Error('Choose a successful Release ClawClaw Desktop run from the official repository')
  }
  if (info.repository !== REPOSITORY || info.commit !== run.head_sha || info.runId !== runId) {
    throw new Error('Downloaded release provenance differs from the selected packaging run')
  }
}

function main() {
  const runId = process.argv[2]
  if (!/^[1-9][0-9]*$/.test(runId ?? '')) throw new Error('Usage: pnpm deploy:run <GitHub-run-id> [--dry-run]')
  const directory = mkdtempSync(join(tmpdir(), 'clawclaw-deploy-'))
  const script = name => fileURLToPath(new URL(name, import.meta.url))
  try {
    const run = JSON.parse(execFileSync('gh', ['api', `repos/${REPOSITORY}/actions/runs/${runId}`], { encoding: 'utf8' }))
    // Reject incomplete/foreign runs before downloading large files.
    validateRun(run, { repository: REPOSITORY, commit: run.head_sha, runId }, runId)
    execFileSync('gh', ['run', 'download', runId, '--repo', REPOSITORY, '--name', 'desktop-release', '--dir', directory], { stdio: 'inherit' })
    const info = JSON.parse(readFileSync(join(directory, 'build-info.json'), 'utf8'))
    validateRun(run, info, runId)
    const env = { ...process.env, GITHUB_SHA: run.head_sha }
    const args = [script('upload-update.mjs'), '--directory', directory, '--channel', 'stable', '--formal']
    if (process.argv.includes('--dry-run')) args.push('--dry-run')
    execFileSync(process.execPath, args, { env, stdio: 'inherit' })
    if (!process.argv.includes('--dry-run')) {
      execFileSync(process.execPath, [script('wait-for-update.mjs'), directory], { env, stdio: 'inherit' })
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main()
