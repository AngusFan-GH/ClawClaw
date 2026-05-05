#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { platform } from 'node:os';

const root = process.cwd();
const hostPlatform = platform();
const isWindowsHost = hostPlatform === 'win32';
const args = process.argv.slice(2);
const rootPackage = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const appVersion = rootPackage.version;

const sleep = (ms) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // short-lived packaging retry helper
  }
};

const findCommandPath = (name) => {
  const command = isWindowsHost ? `where.exe ${name}` : `command -v ${name}`;
  const shell = isWindowsHost ? 'cmd.exe' : '/bin/sh';
  const shellArgs = isWindowsHost ? ['/d', '/s', '/c', command] : ['-lc', command];
  const result = spawnSync(shell, shellArgs, {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'ignore'],
  });
  if ((result.status ?? 1) !== 0) return null;
  return result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? null;
};

const prependPath = (env, pathEntry) => {
  if (!pathEntry) return;
  const currentPath = env.PATH || env.Path || '';
  const nextPath = currentPath ? `${pathEntry}${delimiter}${currentPath}` : pathEntry;
  env.PATH = nextPath;
  env.Path = nextPath;
};

const removeDirIfExists = (dirPath) => {
  rmSync(dirPath, { recursive: true, force: true });
};

const cleanBuildDirs = () => {
  for (const dir of [
    'release/win-unpacked',
    'release/win-arm64-unpacked',
    'release/win-ia32-unpacked',
    'release/windows-installer',
  ]) {
    removeDirIfExists(resolve(root, dir));
  }

  const releaseDir = resolve(root, 'release');
  if (!existsSync(releaseDir)) return;
  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (/^latest\.yml$/i.test(entry.name) || /^ClawClaw-Setup-v.+\.exe(?:\.blockmap)?$/i.test(entry.name)) {
      removeDirIfExists(resolve(releaseDir, entry.name));
    }
  }

  const versionedWindowsDir = resolve(releaseDir, `v${appVersion}`, 'windows');
  if (!existsSync(versionedWindowsDir)) return;
  for (const entry of readdirSync(versionedWindowsDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    if (/^latest\.yml$/i.test(entry.name) || /^ClawClaw-Setup-v.+\.exe(?:\.blockmap)?$/i.test(entry.name)) {
      removeDirIfExists(resolve(versionedWindowsDir, entry.name));
    }
  }
};

const resolveWinArchTargets = (argv) => {
  const hasExplicitArch = argv.some(
    (arg) => arg === '--x64' || arg === '--arm64' || arg === '--ia32' || arg.startsWith('--arch='),
  );
  if (!hasExplicitArch) return ['x64', 'arm64'];

  const targets = new Set();
  for (const arg of argv) {
    if (arg === '--x64') targets.add('x64');
    else if (arg === '--arm64') targets.add('arm64');
    else if (arg === '--ia32') targets.add('ia32');
    else if (arg.startsWith('--arch=')) {
      const value = arg.slice('--arch='.length).trim();
      if (value) targets.add(value);
    }
  }
  return [...targets];
};

const winArchTargets = resolveWinArchTargets(args);
const archArgs = args.some((arg) => arg === '--x64' || arg === '--arm64' || arg === '--ia32' || arg.startsWith('--arch='))
  ? args.filter((arg) => arg === '--x64' || arg === '--arm64' || arg === '--ia32' || arg.startsWith('--arch='))
  : ['--x64', '--arm64'];

const hasBundledUvForArch = (arch) => {
  if (arch === 'ia32') return true;
  return existsSync(resolve(root, 'resources', 'bin', `win32-${arch}`, 'uv.exe'));
};

const hasBundledNodeForArch = (arch) => {
  if (arch === 'ia32') return true;
  return existsSync(resolve(root, 'resources', 'bin', `win32-${arch}`, 'node.exe'));
};

const hasBundledPythonForArch = (arch) => {
  if (arch === 'ia32') return true;
  return existsSync(resolve(root, 'resources', 'python', `win32-${arch}`, 'python.exe'));
};

const run = (command, commandArgs, options = {}) => {
  const result = spawnSync(command, commandArgs, {
    stdio: options.capture ? 'pipe' : 'inherit',
    encoding: options.capture ? 'utf8' : undefined,
    env: options.env,
    shell: false,
  });
  if (result.error) {
    throw new Error(`Failed to start ${command}: ${result.error.message}`);
  }
  if ((result.status ?? 1) !== 0) {
    const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`.trim();
    const error = new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status ?? 1}`);
    error.output = output;
    error.status = result.status ?? 1;
    throw error;
  }
  return result;
};

const ensureBundledRuntimeForWin = ({ archs, env, hasRuntime, label, downloadScript }) => {
  const missingArchs = archs.filter((arch) => !hasRuntime(arch));
  if (missingArchs.length === 0) return;

  console.log(`[package:win] Missing bundled ${label} for ${missingArchs.join(', ')}. Downloading...`);
  run(isWindowsHost ? 'pnpm.cmd' : 'pnpm', ['run', downloadScript], { env });

  const stillMissing = missingArchs.filter((arch) => !hasRuntime(arch));
  if (stillMissing.length > 0) {
    throw new Error(`[package:win] Bundled ${label} is still missing for: ${stillMissing.join(', ')}`);
  }
};

const buildInstallerUi = (env) => {
  run(isWindowsHost ? 'pnpm.cmd' : 'pnpm', ['run', 'installer:win:prepare'], { env });
};

const writeInstallerManifest = () => {
  const outputDir = resolve(root, 'release', 'windows-installer');
  mkdirSync(outputDir, { recursive: true });
  const manifest = {
    manifestVersion: 1,
    productName: rootPackage.name,
    displayName: 'ClawClaw',
    version: appVersion,
    backend: 'clawclaw-installer-core',
    payloads: winArchTargets.map((arch) => ({
      arch,
      unpackedDir: arch === 'x64' ? 'win-unpacked' : `win-${arch}-unpacked`,
    })),
  };
  writeFileSync(join(outputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`);
};

const sha512Base64 = (filePath) => {
  const hash = createHash('sha512');
  hash.update(readFileSync(filePath));
  return hash.digest('base64');
};

const findInstallerShellExe = (arch) => {
  const shellDir = resolve(root, 'release', 'windows-installer', 'shell');
  const expected = `ClawClaw-Setup-v${appVersion}-${arch}.exe`;
  const direct = resolve(shellDir, expected);
  if (existsSync(direct)) return direct;

  const candidates = [];
  const walk = (dir) => {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const entryPath = resolve(dir, entry.name);
      if (entry.isDirectory()) {
        walk(entryPath);
      } else if (entry.isFile() && entry.name.endsWith('.exe') && entry.name.includes(`-${arch}.`)) {
        candidates.push(entryPath);
      }
    }
  };
  walk(shellDir);

  if (candidates.length === 0) {
    throw new Error(`[package:win] Installer shell exe missing for ${arch} in ${shellDir}`);
  }
  return candidates[0];
};

const stageInstallerUpdateArtifacts = () => {
  const staged = [];
  for (const arch of winArchTargets) {
    const source = findInstallerShellExe(arch);
    const fileName = `ClawClaw-Setup-v${appVersion}-${arch}.exe`;
    const target = resolve(root, 'release', fileName);
    cpSync(source, target);
    staged.push({
      arch,
      fileName,
      path: target,
      size: statSync(target).size,
      sha512: sha512Base64(target),
    });
    console.log(`[package:win] Staged updater-compatible installer: release/${fileName}`);
  }

  const x64Artifact = staged.find((artifact) => artifact.arch === 'x64');
  if (x64Artifact) {
    const fileName = `ClawClaw-Setup-v${appVersion}.exe`;
    const target = resolve(root, 'release', fileName);
    cpSync(x64Artifact.path, target);
    staged.push({
      arch: 'x64',
      fileName,
      path: target,
      size: statSync(target).size,
      sha512: sha512Base64(target),
    });
    console.log(`[package:win] Staged stable installer alias: release/${fileName}`);
  }

  const primary = staged.find((artifact) => artifact.fileName === `ClawClaw-Setup-v${appVersion}.exe`) ??
    staged.find((artifact) => artifact.arch === process.arch) ??
    staged.find((artifact) => artifact.arch === 'x64') ??
    staged[0];
  if (!primary) {
    throw new Error('[package:win] No installer exe was staged for latest.yml');
  }

  const latestYml = [
    `version: ${appVersion}`,
    'files:',
    ...staged.flatMap((artifact) => [
      `  - url: ${artifact.fileName}`,
      `    sha512: ${artifact.sha512}`,
      `    size: ${artifact.size}`,
    ]),
    `path: ${primary.fileName}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  writeFileSync(resolve(root, 'release', 'latest.yml'), latestYml);
  console.log('[package:win] Wrote updater metadata: release/latest.yml');
};

const stageInstallerUi = () => {
  const source = resolve(root, 'packages', 'windows-installer', 'dist');
  const target = resolve(root, 'release', 'windows-installer', 'ui');
  const runnerSource = resolve(root, 'packages', 'windows-installer', 'dist-runner');
  const runnerTarget = resolve(root, 'release', 'windows-installer', 'runner');
  const shellSource = resolve(root, 'packages', 'windows-installer', 'dist-electron');
  const shellTarget = resolve(root, 'release', 'windows-installer', 'electron');
  if (!existsSync(source)) {
    throw new Error(`[package:win] Windows installer UI build missing: ${source}`);
  }
  if (!existsSync(runnerSource)) {
    throw new Error(`[package:win] Windows installer runner build missing: ${runnerSource}`);
  }
  if (!existsSync(shellSource)) {
    throw new Error(`[package:win] Windows installer electron shell build missing: ${shellSource}`);
  }
  removeDirIfExists(target);
  removeDirIfExists(runnerTarget);
  removeDirIfExists(shellTarget);
  mkdirSync(dirname(target), { recursive: true });
  cpSync(source, target, { recursive: true });
  cpSync(runnerSource, runnerTarget, { recursive: true });
  cpSync(shellSource, shellTarget, { recursive: true });
};

const killPackagingProcesses = () => {
  if (!isWindowsHost) return;
  for (const image of ['ClawClaw.exe', 'electron.exe', 'app-builder.exe']) {
    spawnSync('taskkill', ['/IM', image, '/F', '/T'], { stdio: 'ignore' });
  }
};

const builderEnv = { ...process.env };
const pnpmPath = findCommandPath('pnpm');
if (pnpmPath) prependPath(builderEnv, dirname(pnpmPath));

ensureBundledRuntimeForWin({
  archs: winArchTargets,
  env: builderEnv,
  hasRuntime: hasBundledUvForArch,
  label: 'uv',
  downloadScript: 'uv:download:win',
});
ensureBundledRuntimeForWin({
  archs: winArchTargets,
  env: builderEnv,
  hasRuntime: hasBundledNodeForArch,
  label: 'node.exe',
  downloadScript: 'node:download:win',
});
ensureBundledRuntimeForWin({
  archs: winArchTargets,
  env: builderEnv,
  hasRuntime: hasBundledPythonForArch,
  label: 'Python runtime',
  downloadScript: 'python:download:win',
});

const electronBuilderCli = resolve(root, 'node_modules', 'electron-builder', 'cli.js');
const electronBuilderBin = resolve(root, 'node_modules', '.bin', isWindowsHost ? 'electron-builder.cmd' : 'electron-builder');
const command = existsSync(electronBuilderCli)
  ? process.execPath
  : electronBuilderBin;
const commandArgs = existsSync(electronBuilderCli)
  ? [electronBuilderCli, '--win', 'dir', ...archArgs]
  : ['--win', 'dir', ...archArgs];

console.log(`[package:win] Building Windows unpacked payload for ${winArchTargets.join(', ')}.`);
cleanBuildDirs();
killPackagingProcesses();

try {
  run(command, commandArgs, { env: builderEnv, capture: true });
} catch (error) {
  const output = error.output || '';
  if (output.includes('Access is denied') || output.includes('being used by another process')) {
    console.log('[package:win] Detected locked release files, cleaning up and retrying once...');
    killPackagingProcesses();
    cleanBuildDirs();
    sleep(1500);
    run(command, commandArgs, { env: builderEnv });
  } else {
    if (output) process.stderr.write(`${output}\n`);
    throw error;
  }
}

buildInstallerUi(builderEnv);
stageInstallerUi();
writeInstallerManifest();
run(isWindowsHost ? 'pnpm.cmd' : 'pnpm', ['run', 'installer:win:shell:pack'], {
  env: {
    ...builderEnv,
    CLAWCLAW_WIN_ARCHS: winArchTargets.join(','),
  },
});
stageInstallerUpdateArtifacts();
console.log('[package:win] Windows installer assets staged at release/windows-installer.');
