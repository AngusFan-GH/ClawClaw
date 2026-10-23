#!/usr/bin/env node
/** Explicit local deployment of one successful GitHub packaging run. */
import { execFileSync, spawn } from 'node:child_process'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync } from 'node:fs'
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
  const runs = api('actions/workflows/release.yml/runs?status=success&per_page=10').workflow_runs
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
  if (value.toLowerCase() === 'q') return undefined
  if (!value) return candidates[0]?.runId
  if (!/^[1-9][0-9]*$/.test(value) || Number(value) > candidates.length) {
    throw new Error('请输入列表中的序号，或输入 q 取消。')
  }
  return candidates[Number(value) - 1].runId
}

export function temporaryDownloadBytes(directory) {
  let size = 0
  for (const name of readdirSync(directory)) {
    try {
      const file = statSync(join(directory, name))
      if (file.isFile()) size += file.size
    } catch (error) { if (error.code !== 'ENOENT') throw error }
  }
  return size
}

export function downloadProgress(directory, total, elapsedMs) {
  const received = temporaryDownloadBytes(directory)
  const mb = value => (value / 1024 ** 2).toFixed(1)
  if (!received) return '等待下载响应或解压中'
  const percent = total > 0 ? `${Math.min(100, received / total * 100).toFixed(1)}% · ` : ''
  const rate = elapsedMs > 0 ? `${mb(received / (elapsedMs / 1000))} MB/s` : '等待测速'
  return `${percent}${mb(received)} / ${mb(total)} MB · 平均 ${rate}${received >= total ? ' · 下载已满，正在解压' : ''}`
}

/** Async child process so slow, silent CLI operations still produce visible progress. */
export async function runWithProgress(command, args, { label, env = process.env, progress, log = console.log, intervalMs = 5000 } = {}) {
  const start = Date.now()
  log(`${label}…`)
  const child = spawn(command, args, { env, stdio: ['ignore', 'inherit', 'inherit'] })
  let cancelled = false
  const cancel = () => { cancelled = true; child.kill('SIGINT') }
  process.once('SIGINT', cancel)
  const timer = setInterval(() => {
    const elapsed = Date.now() - start
    let detail = ''
    try { detail = progress?.(elapsed) ?? '' } catch { detail = '正在处理' }
    log(`${label} · 已用 ${Math.floor(elapsed / 1000)} 秒${detail ? ' · ' + detail : ''}`)
  }, intervalMs)
  try {
    await new Promise((resolve, reject) => {
      child.once('error', reject)
      child.once('close', (code, signal) => {
        if (code === 0 && !cancelled) resolve()
        else reject(new Error(cancelled ? '操作已取消' : `${label}失败（${signal ?? code}）`))
      })
    })
    log(`${label}完成（${((Date.now() - start) / 1000).toFixed(1)} 秒）`)
  } finally {
    clearInterval(timer)
    process.removeListener('SIGINT', cancel)
  }
}

async function main() {
  const options = parseArguments(process.argv.slice(2))
  options.dryRun ||= process.env.UPDATE_DRY_RUN === '1'
  let runId = options.runId
  if (!runId) {
    if (!options.list && !process.stdin.isTTY) {
      throw new Error('交互选择需要终端。请用 --list 查看可用运行，或显式指定运行 ID。')
    }
    console.log('正在查找最近 10 次成功打包中仍可下载的完整产物…')
    const candidates = listCandidates()
    if (!candidates.length) throw new Error('没有找到可下载的 desktop-release；请先完成一次新的打包。')
    console.table(candidates.map((run, index) => ({
      序号: index + 1, 默认: index === 0 ? '最新 · 默认' : '', 版本: run.version,
      构建时间: new Date(run.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false }),
      分支或标签: run.ref, 提交: run.commit.slice(0, 10), 运行ID: run.runId,
    })))
    if (options.list) return
    console.log(options.dryRun ? '仅下载校验，不上传、不切换清单。' : '选中后将部署到正式目录并切换线上 stable 更新清单。')
    const input = createInterface({ input: process.stdin, output: process.stdout })
    try {
      for (;;) {
        const answer = await input.question('请选择序号 [1 最新]（回车选择 1，q 取消）：')
        try { runId = choiceId(answer, candidates); break } catch (error) { console.error(error.message) }
      }
    } finally { input.close() }
    if (!runId) { console.log('已取消，未下载或部署。'); return }
  }
  const directory = mkdtempSync(join(tmpdir(), 'clawclaw-deploy-'))
  const script = name => fileURLToPath(new URL(name, import.meta.url))
  try {
    console.log(`[1/5] 获取并核对运行 ${runId} 的信息…`)
    const run = githubApi(`actions/runs/${runId}`)
    validateRun(run, { repository: REPOSITORY, commit: run.head_sha, runId }, runId)
    const assets = githubApi(`actions/runs/${runId}/artifacts?per_page=100`).artifacts
    const asset = assets.find(item => item.name === 'desktop-release' && !item.expired && item.size_in_bytes > 0)
    if (!asset) throw new Error('该运行已没有可下载的 desktop-release，请重新选择或重新打包。')
    console.log(`已选择 ${runId} · ${run.head_branch} · ${run.head_sha.slice(0, 10)}`)
    const downloadTemporary = join(directory, 'download-tmp')
    const bundle = join(directory, 'release')
    mkdirSync(downloadTemporary)
    mkdirSync(bundle)
    await runWithProgress('gh', ['run', 'download', runId, '--repo', REPOSITORY, '--name', 'desktop-release', '--dir', bundle], {
      label: '[2/5] 下载并解压双平台产物',
      // gh buffers its artifact ZIP in the OS temp directory before extracting it.
      // Give this child its own temp directory so unrelated downloads are never counted.
      env: { ...process.env, TMPDIR: downloadTemporary, TEMP: downloadTemporary, TMP: downloadTemporary, GH_SPINNER_DISABLED: '1' },
      progress: elapsed => downloadProgress(downloadTemporary, asset.size_in_bytes, elapsed),
    })
    const info = JSON.parse(readFileSync(join(bundle, 'build-info.json'), 'utf8'))
    validateRun(run, info, runId)
    console.log(`目标版本 ${info.version} · ${options.dryRun ? '仅校验' : '正式部署'}`)
    const env = { ...process.env, GITHUB_SHA: run.head_sha }
    const args = [script('upload-update.mjs'), '--directory', bundle, '--channel', 'stable', '--formal']
    await runWithProgress(process.execPath, [...args, '--dry-run'], { env, label: '[3/5] 校验来源、正式路径、大小和 SHA-512' })
    if (options.dryRun) {
      console.log('Dry-run 通过：未上传文件，未切换线上更新清单。')
    } else {
      await runWithProgress(process.execPath, args, { env, label: '[4/5] 压缩、上传安装包并切换正式清单' })
      await runWithProgress(process.execPath, [script('wait-for-update.mjs'), bundle], { env, label: '[5/5] 验证公网清单、完整下载和 Range 支持' })
      console.log(`部署 ${info.version} 完成。`)
    }
  } finally {
    console.log('清理本地临时下载…')
    rmSync(directory, { recursive: true, force: true })
  }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error(error.message); process.exitCode = 1 })
}
