#!/usr/bin/env node
/** Explicit local deployment of one successful GitHub packaging run. */
import { execFileSync } from 'node:child_process'
import { mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline/promises'

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

function githubApi(path) {
  return JSON.parse(execFileSync('gh', ['api', `repos/${REPOSITORY}/${path}`], { encoding: 'utf8' }))
}

export function parseArguments(args) {
  const ids = args.filter(arg => !arg.startsWith('--'))
  if (args.some(arg => arg.startsWith('--') && !['--dry-run', '--list'].includes(arg))
    || ids.length > 1 || (ids.length && !/^[1-9][0-9]*$/.test(ids[0]))) {
    throw new Error('Usage: pnpm deploy:run [GitHub-run-id] [--dry-run] [--list]')
  }
  if (ids.length && args.includes('--list')) throw new Error('--list cannot be combined with a run ID')
  return { runId: ids[0], dryRun: args.includes('--dry-run'), list: args.includes('--list') }
}

export function listCandidates(api = githubApi) {
  const runs = api('actions/workflows/release.yml/runs?status=success&per_page=30').workflow_runs
  const candidates = []
  for (const run of runs) {
    const runId = String(run.id)
    validateRun(run, { repository: REPOSITORY, commit: run.head_sha, runId }, runId)
    const assets = api(`actions/runs/${runId}/artifacts?per_page=100`).artifacts
    if (!assets.some(a => a.name === 'desktop-release' && !a.expired && a.size_in_bytes > 0)) continue
    let version = 'unknown'
    try {
      const file = api(`contents/dsh-plugin-desktop/package.json?ref=${run.head_sha}`)
      const value = JSON.parse(Buffer.from(file.content, 'base64').toString('utf8')).version
      if (/^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)$/.test(value)) version = value
    } catch { /* Version is a display hint; downloaded provenance is validated separately. */ }
    candidates.push({ runId, version, createdAt: run.created_at, commit: run.head_sha, ref: run.head_branch })
  }
  return candidates
}

export function choiceId(answer, candidates) {
  const value = answer.trim()
  if (!value || value.toLowerCase() === 'q') return undefined
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > candidates.length) {
    throw new Error('请输入列表中的序号，或输入 q 取消。')
  }
  return candidates[Number(value) - 1].runId
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  let runId = options.runId
  if (!runId) {
    if (!options.list && !process.stdin.isTTY) {
      throw new Error('交互选择需要终端。请用 --list 查看可用运行，或显式指定运行 ID。')
    }
    console.log('正在查找最近 30 次成功打包中仍可下载的完整产物…')
    const candidates = listCandidates()
    if (!candidates.length) throw new Error('没有找到可下载的 desktop-release；请先完成一次新的打包。')
    console.table(candidates.map((run, index) => ({
      序号: index + 1, 版本: run.version,
      构建时间: new Date(run.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
      分支或标签: run.ref, 提交: run.commit.slice(0, 10), 运行ID: run.runId,
    })))
    if (options.list) return
    console.log(options.dryRun ? '仅下载校验，不上传、不切换清单。' : '选中后将部署到正式目录并切换线上 stable 更新清单。')
    const input = createInterface({ input: process.stdin, output: process.stdout })
    try {
      for (;;) {
        const answer = await input.question('请选择序号（回车或 q 取消）：')
        try { runId = choiceId(answer, candidates); break } catch (error) { console.error(error.message) }
      }
    } finally { input.close() }
    if (!runId) { console.log('已取消，未下载或部署。'); return }
  }
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
    if (options.dryRun) args.push('--dry-run')
    execFileSync(process.execPath, args, { env, stdio: 'inherit' })
    if (!options.dryRun) {
      execFileSync(process.execPath, [script('wait-for-update.mjs'), directory], { env, stdio: 'inherit' })
    }
  } finally {
    rmSync(directory, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
