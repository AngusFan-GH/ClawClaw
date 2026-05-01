#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, rmSync } from 'node:fs';
import { delimiter, dirname, join, resolve } from 'node:path';
import { platform } from 'node:os';

const hostPlatform = platform();
const isWindowsHost = hostPlatform === 'win32';

const sleep = (ms) => {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // short-lived helper script
  }
};

const tryExec = (command) => {
  try {
    execSync(command, { stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
};

const findCommandPath = (name) => {
  const command = isWindowsHost ? `where.exe ${name}` : `command -v ${name}`;

  try {
    const output = execSync(command, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    const first = output.split(/\r?\n/).find((line) => line.trim());
    return first ? first.trim() : null;
  } catch {
    return null;
  }
};

const prependPath = (env, pathEntry) => {
  if (!pathEntry) return;
  const currentPath = env.PATH || env.Path || '';
  const nextPath = currentPath ? `${pathEntry}${delimiter}${currentPath}` : pathEntry;
  env.PATH = nextPath;
  env.Path = nextPath;
};

const removeDirIfExists = (dirPath) => {
  try {
    rmSync(dirPath, { recursive: true, force: true });
  } catch {
    // best effort cleanup
  }
};

const cleanBuildDirs = () => {
  removeDirIfExists(resolve(process.cwd(), 'release', 'win-unpacked'));
  removeDirIfExists(resolve(process.cwd(), 'release', 'win-arm64-unpacked'));
  removeDirIfExists(resolve(process.cwd(), 'release', 'win-ia32-unpacked'));
};

const getUnpackedDirForArch = (arch) => {
  if (arch === 'arm64') return resolve(process.cwd(), 'release', 'win-arm64-unpacked');
  if (arch === 'ia32') return resolve(process.cwd(), 'release', 'win-ia32-unpacked');
  return resolve(process.cwd(), 'release', 'win-unpacked');
};

const createPortableDataLayout = (portableDir) => {
  for (const subDir of ['.openclaw', 'cache', 'python', 'logs', 'exports']) {
    mkdirSync(join(portableDir, subDir), { recursive: true });
  }
};

const validatePortableSupportFiles = (unpackedDir, arch) => {
  const requiredPaths = [
    join(unpackedDir, 'resources', 'resources', 'portable-updater-win.cjs'),
    join(unpackedDir, 'resources', 'bin', 'node.exe'),
  ];

  for (const requiredPath of requiredPaths) {
    if (!existsSync(requiredPath)) {
      throw new Error(
        `[package:win] Portable updater support file missing for ${arch}: ${requiredPath}`,
      );
    }
  }
};

const stagePortableLaunchers = (archs) => {
  const resourcesDir = resolve(process.cwd(), 'resources');
  const portableLaunchers = ['Start ClawClaw.bat', 'Start ClawClaw.vbs', 'README Portable.txt'];

  for (const arch of archs) {
    const unpackedDir = getUnpackedDirForArch(arch);
    if (!existsSync(unpackedDir)) {
      console.warn(`[package:win] Expected unpacked output missing for ${arch}: ${unpackedDir}`);
      continue;
    }

    const portableDir = join(unpackedDir, 'portable');
    createPortableDataLayout(portableDir);
    validatePortableSupportFiles(unpackedDir, arch);

    for (const launcher of portableLaunchers) {
      const source = join(resourcesDir, launcher);
      const destination = join(unpackedDir, launcher);
      if (!existsSync(source)) continue;
      copyFileSync(source, destination);
    }

    console.log(`[package:win] Portable layout prepared for ${arch} at ${unpackedDir}`);
  }
};

const resolveWinArchTargets = (argv) => {
  const hasExplicitArch = argv.some(
    (arg) => arg === '--x64' || arg === '--arm64' || arg === '--ia32' || arg.startsWith('--arch')
  );

  if (!hasExplicitArch) {
    return ['x64', 'arm64'];
  }

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

const hasBundledUvForArch = (arch) => {
  if (arch === 'ia32') return true;
  const uvPath = resolve(process.cwd(), 'resources', 'bin', `win32-${arch}`, 'uv.exe');
  return existsSync(uvPath);
};

const hasBundledNodeForArch = (arch) => {
  if (arch === 'ia32') return true;
  const nodePath = resolve(process.cwd(), 'resources', 'bin', `win32-${arch}`, 'node.exe');
  return existsSync(nodePath);
};

const hasBundledPythonForArch = (arch) => {
  if (arch === 'ia32') return true;
  const pythonPath = resolve(process.cwd(), 'resources', 'python', `win32-${arch}`, 'python.exe');
  return existsSync(pythonPath);
};

const ensureBundledRuntimeForWin = ({
  archs,
  env,
  hasRuntime,
  label,
  downloadScript,
  downloadMessage,
  startErrorMessage,
}) => {
  const missingArchs = archs.filter((arch) => !hasRuntime(arch));
  if (missingArchs.length === 0) {
    return;
  }

  console.log(`[package:win] Missing bundled ${label} for ${missingArchs.join(', ')}. ${downloadMessage}`);

  const pnpmCmd = isWindowsHost ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpmCmd, ['run', downloadScript], {
    stdio: 'inherit',
    env,
  });

  if (result.error) {
    console.error(`[package:win] ${startErrorMessage}:`, result.error.message);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    console.error(`[package:win] ${downloadScript} failed.`);
    process.exit(result.status ?? 1);
  }

  const stillMissing = missingArchs.filter((arch) => !hasRuntime(arch));
  if (stillMissing.length > 0) {
    console.error(`[package:win] Bundled ${label} is still missing after download for: ${stillMissing.join(', ')}`);
    process.exit(1);
  }
};

const ensureBundledUvForWin = (archs, env) => {
  ensureBundledRuntimeForWin({
    archs,
    env,
    hasRuntime: hasBundledUvForArch,
    label: 'uv',
    downloadScript: 'uv:download:win',
    downloadMessage: 'Downloading Windows uv binaries...',
    startErrorMessage: 'Failed to start uv download',
  });
};

const ensureBundledNodeForWin = (archs, env) => {
  ensureBundledRuntimeForWin({
    archs,
    env,
    hasRuntime: hasBundledNodeForArch,
    label: 'node.exe',
    downloadScript: 'node:download:win',
    downloadMessage: 'Downloading Windows Node.js binaries...',
    startErrorMessage: 'Failed to start node download',
  });
};

const ensureBundledPythonForWin = (archs, env) => {
  ensureBundledRuntimeForWin({
    archs,
    env,
    hasRuntime: hasBundledPythonForArch,
    label: 'Python runtime',
    downloadScript: 'python:download:win',
    downloadMessage: 'Downloading Windows Python runtimes...',
    startErrorMessage: 'Failed to start Python runtime download',
  });
};

const killPackagingProcesses = () => {
  if (!isWindowsHost) return;
  tryExec('taskkill /IM ClawClaw.exe /F /T');
  tryExec('taskkill /IM electron.exe /F /T');
  tryExec('taskkill /IM app-builder.exe /F /T');
  tryExec('taskkill /IM makensis.exe /F /T');
  tryExec('taskkill /IM signtool.exe /F /T');
};

const nsisPath = isWindowsHost
  ? [
      findCommandPath('makensis'),
      process.env['ProgramFiles'] ? `${process.env['ProgramFiles']}\\NSIS\\makensis.exe` : null,
      process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\NSIS\\makensis.exe` : null,
      process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\NSIS\\Bin\\makensis.exe` : null,
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1-nsis-3.0.4.1\\makensis.exe` : null,
      process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1-nsis-3.0.4.1\\Bin\\makensis.exe` : null,
    ].find((candidate) => candidate && existsSync(candidate))
  : null;

const args = process.argv.slice(2);
const hasDirTarget = args.includes('--dir');
const hasArchArg = args.some((arg) => arg === '--x64' || arg === '--arm64' || arg === '--ia32' || arg.startsWith('--arch'));
const archArgs = hasArchArg ? [] : ['--x64', '--arm64'];

// Only require NSIS for non-dir builds on Windows
if (!hasDirTarget && isWindowsHost && !nsisPath) {
  console.error('[package:win] NSIS is required for Windows packaging. Please install makensis first.');
  process.exit(1);
}

// --dir produces portable directory only (no NSIS/Wine required on macOS)
const builderArgs = hasDirTarget
  ? [
      '--win',
      'dir',
      '-c.win.signAndEditExecutable=false',
      ...archArgs,
      ...args.filter((a) => a !== '--dir'),
    ]
  : ['--win', 'nsis', ...archArgs, ...args];

const builderEnv = { ...process.env };
if (nsisPath) {
  prependPath(builderEnv, dirname(nsisPath));
}

const pnpmPath = findCommandPath('pnpm');
if (pnpmPath) {
  prependPath(builderEnv, dirname(pnpmPath));
}

const winArchTargets = resolveWinArchTargets(args);
ensureBundledUvForWin(winArchTargets, builderEnv);
ensureBundledNodeForWin(winArchTargets, builderEnv);
ensureBundledPythonForWin(winArchTargets, builderEnv);

const electronBuilderCli = resolve(process.cwd(), 'node_modules', 'electron-builder', 'cli.js');
const electronBuilderBin = resolve(process.cwd(), 'node_modules', '.bin', isWindowsHost ? 'electron-builder.cmd' : 'electron-builder');

let command = 'electron-builder';
let commandArgs = builderArgs;

if (existsSync(electronBuilderCli)) {
  command = process.execPath;
  commandArgs = [electronBuilderCli, ...builderArgs];
} else if (existsSync(electronBuilderBin)) {
  command = electronBuilderBin;
}

const runBuild = () => {
  const result = spawnSync(command, commandArgs, {
    stdio: 'pipe',
    encoding: 'utf8',
    env: builderEnv,
    shell: false,
  });

  if (result.stdout) process.stdout.write(result.stdout);
  if (result.stderr) process.stderr.write(result.stderr);
  return result;
};

if (hasDirTarget) {
  console.log('[package:win] Building portable directory (dir target, no NSIS required).');
} else if (isWindowsHost) {
  console.log(`[package:win] Found NSIS at ${nsisPath}.`);
} else {
  console.log('[package:win] Running cross-platform Windows NSIS build.');
}
console.log(`[package:win] Building ${hasDirTarget ? 'dir' : 'NSIS'} for ${archArgs.length > 0 ? 'x64 and arm64' : 'specified'} architectures.`);

killPackagingProcesses();
cleanBuildDirs();

let result = runBuild();

if (result.status !== 0) {
  const output = `${result.stdout ?? ''}\n${result.stderr ?? ''}`;
  const isLockedFile = output.includes('Access is denied') || output.includes('being used by another process');

  if (isLockedFile) {
    console.log('[package:win] Detected locked release files, cleaning up and retrying once...');
    killPackagingProcesses();
    cleanBuildDirs();
    sleep(1500);
    result = runBuild();
  }
}

if (result.error) {
  console.error('[package:win] Failed to start electron-builder:', result.error.message);
  process.exit(1);
}

if ((result.status ?? 1) === 0 && hasDirTarget) {
  stagePortableLaunchers(winArchTargets);
}

process.exit(result.status ?? 0);
