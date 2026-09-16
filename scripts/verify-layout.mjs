import { execFileSync } from 'node:child_process'
import { existsSync, lstatSync, readFileSync, readlinkSync } from 'node:fs'
import { resolve } from 'node:path'

const root = resolve(import.meta.dirname, '..')
const readJson = path => JSON.parse(readFileSync(resolve(root, path), 'utf8'))
const run = (command, args, cwd = root) => execFileSync(command, args, {
  cwd,
  encoding: 'utf8',
  stdio: ['ignore', 'pipe', 'pipe'],
}).trim()
const fail = message => { throw new Error(`verify-layout: ${message}`) }

const workspace = readJson('package.json')
const upstream = readJson('upstream.json')
const stablePlugin = readJson('dsh-plugin-desktop/package.json')
const betaPlugin = readJson('dsh-plugin-desktop-beta/package.json')
const imPlugin = readJson('channels/dsh-im/package.json')
const fabric = readJson('dsh-community-fabric/package.json')
const upstreamPackage = readJson('deepseek-harness/package.json')

if (stablePlugin.name !== 'dsh-plugin-desktop') fail('the stable Desktop workspace must retain dsh-plugin-desktop')
if (betaPlugin.name !== 'dsh-plugin-desktop-beta') fail('the Beta Desktop workspace must publish as dsh-plugin-desktop-beta')
if (!['stable', 'beta'].includes(upstream.activeChannel)) fail('the pinned upstream checkout must follow a declared release channel')
const activeUpstream = upstream.channels?.[upstream.activeChannel]
if (activeUpstream === undefined) fail('the active upstream channel is missing')

if (workspace.packageManager !== 'pnpm@11.8.0') {
  fail('the product workspace must pin pnpm@11.8.0')
}
const workspaceDefinition = readFileSync(resolve(root, 'pnpm-workspace.yaml'), 'utf8')
for (const packagePath of ['dsh-plugin-desktop', 'dsh-plugin-desktop-beta', 'dsh-community-fabric', 'channels/dsh-im']) {
  if (!workspaceDefinition.includes(`  - ${packagePath}`)) {
    fail(`the root pnpm workspace is missing ${packagePath}`)
  }
}
if (workspaceDefinition.includes('yarn')) {
  fail('the root pnpm workspace must not retain Yarn configuration')
}
if (workspace.workspaces !== undefined) {
  fail('the root pnpm workspace must contain the desktop, community-fabric, and IM packages')
}
for (const [name, manifest] of [
  ['dsh-plugin-desktop', stablePlugin],
  ['dsh-plugin-desktop-beta', betaPlugin],
  ['@clawclaw/dsh-im', imPlugin],
  ['dsh-community-fabric', fabric],
]) {
  if (manifest.packageManager !== undefined) fail(`${name} must inherit the root pnpm release`)
}
if (fabric.name !== 'dsh-community-fabric') fail('the Fabric workspace must own dsh-community-fabric')
if (imPlugin.name !== '@clawclaw/dsh-im') fail('the channels workspace must own @clawclaw/dsh-im')
const claudePath = resolve(root, 'CLAUDE.md')
const claudeStat = lstatSync(claudePath)
// Windows checkouts materialize the symlink as a regular file holding the
// target name; accept both forms so the pointer stays verified on every host.
const claudeTarget = claudeStat.isSymbolicLink()
  ? readlinkSync(claudePath)
  : readFileSync(claudePath, 'utf8').trim()
if (claudeTarget !== 'AGENTS.md') {
  fail('CLAUDE.md must link to the outer repository AGENTS.md')
}
for (const legacyFile of [
  'yarn.lock',
  '.yarnrc.yml',
  'dsh-plugin-desktop/pnpm-lock.yaml',
  'dsh-plugin-desktop/pnpm-workspace.yaml',
  'dsh-plugin-desktop-beta/pnpm-lock.yaml',
  'dsh-plugin-desktop-beta/pnpm-workspace.yaml',
  'dsh-community-fabric/pnpm-lock.yaml',
  'dsh-community-fabric/pnpm-workspace.yaml',
]) {
  if (existsSync(resolve(root, legacyFile))) fail(`${legacyFile} must not exist`)
}
if (run('git', ['config', '-f', '.gitmodules', '--get', 'submodule.deepseek-harness.path']) !== 'deepseek-harness') {
  fail('the upstream submodule path must be deepseek-harness')
}
if (run('git', ['config', '-f', '.gitmodules', '--get', 'submodule.deepseek-harness.url']) !== upstream.repository) {
  fail('the upstream submodule URL differs from upstream.json')
}
if (typeof upstreamPackage.packageManager !== 'string' || !upstreamPackage.packageManager.startsWith('pnpm@')) {
  fail('the upstream checkout must retain its pnpm package manager')
}

for (const [owner, manifest] of [
  ['root', workspace],
  ['stable desktop', stablePlugin],
  ['beta desktop', betaPlugin],
  ['fabric', fabric],
]) {
  for (const field of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
    for (const [name, range] of Object.entries(manifest[field] ?? {})) {
      if (typeof range !== 'string') continue
      const ownedWorkspaceDependency = name === '@clawclaw/dsh-im' && range === 'workspace:*'
      if (!ownedWorkspaceDependency && (/^(?:workspace|portal|link):/u.test(range)
        || (range.startsWith('file:') && range.includes('deepseek-harness')))) {
        fail(`${owner} ${field}.${name} bypasses the published DSH package boundary`)
      }
    }
  }
}

const [mode, object] = run('git', ['ls-files', '--stage', '--', 'deepseek-harness']).split(/\s+/u)
if (mode !== '160000') fail('deepseek-harness must be tracked as a Git submodule')
if (object !== activeUpstream.commit) fail(`submodule index is ${object}, expected ${activeUpstream.commit}`)

const upstreamDir = resolve(root, 'deepseek-harness')
if (run('git', ['rev-parse', 'HEAD'], upstreamDir) !== activeUpstream.commit) {
  fail('checked-out upstream commit differs from upstream.json')
}
if (run('git', ['status', '--porcelain'], upstreamDir) !== '') {
  fail('deepseek-harness contains local changes')
}
if (run('git', ['remote', 'get-url', 'origin'], upstreamDir) !== upstream.repository) {
  fail('deepseek-harness origin differs from upstream.json')
}
if (upstreamPackage.version !== activeUpstream.sourceVersion) {
  fail('deepseek-harness package version differs from upstream.json')
}
for (const [channel, plugin] of [['stable', stablePlugin], ['beta', betaPlugin]]) {
  const metadata = upstream.channels?.[channel]
  if (metadata?.package !== plugin.name) fail(`${channel} upstream metadata points at the wrong package`)
  for (const name of Object.keys(plugin.dependencies).filter(name => name === '@deepseek-ai/dsh' || name.startsWith('@deepseek-ai/dsh-'))) {
    if (plugin.dependencies[name] !== metadata.runtimePackageVersion) {
      fail(`${plugin.name} ${name} must use the recorded ${channel} DSH runtime package family`)
    }
  }
}

process.stdout.write(`verify-layout: dual Desktop workspaces and upstream ${activeUpstream.commit.slice(0, 10)} are consistent\n`)
