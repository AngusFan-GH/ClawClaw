#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { platform } from 'node:os';

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
  const command = platform() === 'win32' ? `where.exe ${name}` : `command -v ${name}`;

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
  const nextPath = `${pathEntry};${currentPath}`;
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

const killPackagingProcesses = () => {
  tryExec('taskkill /IM ClawClaw.exe /F /T');
  tryExec('taskkill /IM electron.exe /F /T');
  tryExec('taskkill /IM app-builder.exe /F /T');
  tryExec('taskkill /IM makensis.exe /F /T');
  tryExec('taskkill /IM signtool.exe /F /T');
};

const nsisPath = [
  findCommandPath('makensis'),
  process.env['ProgramFiles'] ? `${process.env['ProgramFiles']}\\NSIS\\makensis.exe` : null,
  process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\NSIS\\makensis.exe` : null,
  process.env['ProgramFiles(x86)'] ? `${process.env['ProgramFiles(x86)']}\\NSIS\\Bin\\makensis.exe` : null,
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1-nsis-3.0.4.1\\makensis.exe` : null,
  process.env.LOCALAPPDATA ? `${process.env.LOCALAPPDATA}\\electron-builder\\Cache\\nsis\\nsis-3.0.4.1-nsis-3.0.4.1\\Bin\\makensis.exe` : null,
].find((candidate) => candidate && existsSync(candidate));

if (!nsisPath) {
  console.error('[package:win] NSIS is required for Windows packaging. Please install makensis first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const hasArchArg = args.some((arg) => arg === '--x64' || arg === '--arm64' || arg === '--ia32' || arg.startsWith('--arch'));
const archArgs = hasArchArg ? [] : ['--x64', '--arm64'];
const builderArgs = ['--win', 'nsis', ...archArgs, ...args];

const builderEnv = { ...process.env };
prependPath(builderEnv, dirname(nsisPath));

const pnpmPath = findCommandPath('pnpm');
if (pnpmPath) {
  prependPath(builderEnv, dirname(pnpmPath));
}

const electronBuilderCli = resolve(process.cwd(), 'node_modules', 'electron-builder', 'cli.js');
const electronBuilderBin = resolve(process.cwd(), 'node_modules', '.bin', platform() === 'win32' ? 'electron-builder.cmd' : 'electron-builder');

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

console.log(`[package:win] Found NSIS at ${nsisPath}.`);
console.log(`[package:win] Building NSIS for ${archArgs.length > 0 ? 'x64 and arm64' : 'specified'} architectures.`);

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

process.exit(result.status ?? 0);
