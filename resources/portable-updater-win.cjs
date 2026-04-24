#!/usr/bin/env node

const { cpSync, mkdirSync, readdirSync, rmSync } = require('node:fs');
const { join, resolve } = require('node:path');
const { spawn } = require('node:child_process');

function sleep(ms) {
  const start = Date.now();
  while (Date.now() - start < ms) {
    // helper script
  }
}

function parseArgs(argv) {
  const parsed = {};
  for (const arg of argv) {
    const match = arg.match(/^--([^=]+)=(.*)$/);
    if (match) parsed[match[1]] = match[2];
  }
  return parsed;
}

function waitForPidExit(pid) {
  const targetPid = Number(pid);
  if (!Number.isFinite(targetPid) || targetPid <= 0) return;
  for (let attempt = 0; attempt < 120; attempt += 1) {
    try {
      process.kill(targetPid, 0);
      sleep(1000);
    } catch {
      return;
    }
  }
}

function expandArchive(artifactPath, destinationDir) {
  const escapedArtifact = artifactPath.replace(/'/g, "''");
  const escapedDestination = destinationDir.replace(/'/g, "''");
  const { spawnSync } = require('node:child_process');
  const result = spawnSync('powershell.exe', [
    '-NoProfile',
    '-NonInteractive',
    '-ExecutionPolicy',
    'Bypass',
    '-Command',
    `Expand-Archive -LiteralPath '${escapedArtifact}' -DestinationPath '${escapedDestination}' -Force`,
  ], { stdio: 'inherit' });
  if ((result.status || 0) !== 0) {
    throw new Error(`Expand-Archive failed with code ${result.status}`);
  }
}

function resolvePackageRoot(extractedDir) {
  const entries = readdirSync(extractedDir, { withFileTypes: true }).filter((entry) => entry.name !== '__MACOSX');
  if (entries.length === 1 && entries[0].isDirectory()) {
    return join(extractedDir, entries[0].name);
  }
  return extractedDir;
}

function replacePortableRoot(rootDir, packageRoot) {
  const entries = readdirSync(rootDir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.name === 'portable') continue;
    rmSync(join(rootDir, entry.name), { recursive: true, force: true });
  }

  for (const entry of readdirSync(packageRoot, { withFileTypes: true })) {
    if (entry.name === 'portable') continue;
    cpSync(join(packageRoot, entry.name), join(rootDir, entry.name), { recursive: true });
  }
}

function relaunch(target) {
  if (!target) return;
  if (target.toLowerCase().endsWith('.vbs')) {
    spawn('wscript.exe', [target], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
    return;
  }
  spawn(target, [], { detached: true, stdio: 'ignore', windowsHide: true }).unref();
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.pid || !args.artifact || !args.root) {
    throw new Error('Missing required arguments.');
  }

  waitForPidExit(args.pid);

  const rootDir = resolve(args.root);
  const artifactPath = resolve(args.artifact);
  const tempDir = join(rootDir, 'portable', 'cache', 'updates', `apply-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  try {
    const extractedDir = join(tempDir, 'extracted');
    mkdirSync(extractedDir, { recursive: true });
    expandArchive(artifactPath, extractedDir);
    const packageRoot = resolvePackageRoot(extractedDir);
    replacePortableRoot(rootDir, packageRoot);
    relaunch(args.launch);
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }
}

main();
