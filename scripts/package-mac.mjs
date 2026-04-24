#!/usr/bin/env node

/**
 * package-mac.mjs — Build ClawClaw macOS portable zip
 *
 * Builds the macOS app via electron-builder, then assembles a portable
 * directory containing:
 *   ClawClaw.app/          (the app bundle, with portable/ data dir inside)
 *   Start ClawClaw.command  (launcher + quarantine-clear script)
 *   README Portable.txt      (usage instructions)
 *
 * Usage:
 *   node scripts/package-mac.mjs [--build] [--arm64] [--x64]
 *   --build  Run electron-builder first (otherwise just packages existing build)
 *   --arm64  Build arm64 only
 *   --x64    Build x64 only
 *   (default: both architectures)
 *
 * Outputs:
 *   release/v{version}/mac/ClawClaw-v{version}-mac-{arch}-portable.zip
 */

import { execSync, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
  cpSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { platform } from 'node:os';

const isMacHost = platform() === 'darwin';

const cwd = resolve(process.cwd());
const releaseDir = resolve(cwd, 'release');
const macDir = releaseDir;
const buildResourcesDir = resolve(cwd, 'resources');

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function runElectronBuilder(archs) {
  console.log(`[package:mac] Running electron-builder for macOS ${archs.join(', ')}...`);

  const electronBuilderCli = resolve(cwd, 'node_modules', 'electron-builder', 'cli.js');
  const electronBuilderBin = resolve(cwd, 'node_modules', '.bin', 'electron-builder');

  let command = 'electron-builder';
  const args = ['--mac', 'zip'];
  if (archs.length === 1) {
    args.push(archs[0] === 'arm64' ? '--arm64' : '--x64');
  }

  if (existsSync(electronBuilderCli)) {
    command = process.execPath;
    args.unshift(electronBuilderCli);
  } else if (existsSync(electronBuilderBin)) {
    command = electronBuilderBin;
  }

  const result = spawnSync(command, args, {
    stdio: 'inherit',
    env: { ...process.env },
    shell: false,
  });

  if ((result.status ?? 1) !== 0) {
    console.error(`[package:mac] electron-builder failed for ${arch}`);
    process.exit(result.status ?? 1);
  }
}

function findBuiltApp(arch) {
  const candidates = arch === 'arm64'
    ? [resolve(releaseDir, 'mac-arm64', 'ClawClaw.app')]
    : [
        resolve(releaseDir, 'mac', 'ClawClaw.app'),
        resolve(releaseDir, 'mac-x64', 'ClawClaw.app'),
      ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }

  // Fallback: only accept a single matching app bundle for this run.
  try {
    const entries = execSync(
      `find "${releaseDir}" -maxdepth 4 -name "ClawClaw.app" -type d 2>/dev/null`,
      { encoding: 'utf8', shell: true },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    if (entries.length === 1) return entries[0];
  } catch {
    // best effort
  }
  return null;
}

function createPortableDataLayout(portableDir) {
  for (const subDir of ['.openclaw', 'cache', 'python', 'logs', 'exports']) {
    mkdirSync(join(portableDir, subDir), { recursive: true });
  }
}

function validatePortableSupportFiles(stagingApp, arch) {
  const helperPath = resolve(stagingApp, 'Contents', 'Resources', 'resources', 'portable-updater-mac.sh');
  if (!existsSync(helperPath)) {
    throw new Error(`[package:mac] Portable updater helper missing for ${arch}: ${helperPath}`);
  }
  execSync(`chmod +x "${helperPath}"`, { stdio: 'ignore' });
}

function buildPortableForArch(arch) {
  ensureDir(macDir);

  const appPath = findBuiltApp(arch);
  if (!appPath || !existsSync(appPath)) {
    console.error(
      `[package:mac] ClawClaw.app not found for arch=${arch}. Run with --build first.`,
    );
    console.error('[package:mac] Hint: electron-builder outputs to release/mac-{arch}/ClawClaw.app');
    return;
  }

  const stagingDir = resolve(macDir, `__staging__-${arch}`);
  const portableDir = resolve(macDir, `ClawClaw-portable-mac-${arch}`);

  // Clean
  rmSync(stagingDir, { recursive: true, force: true });
  rmSync(portableDir, { recursive: true, force: true });
  ensureDir(stagingDir);

  // Copy app bundle
  console.log(`[package:mac] Copying ClawClaw.app to portable staging...`);
  cpSync(appPath, resolve(stagingDir, 'ClawClaw.app'), { recursive: true });

  // Copy launcher script and README
  const launcherScript = resolve(buildResourcesDir, 'Start ClawClaw.command');
  const portableReadme = resolve(buildResourcesDir, 'README Portable.txt');

  if (existsSync(launcherScript)) {
    const destScript = resolve(stagingDir, 'Start ClawClaw.command');
    cpSync(launcherScript, destScript);
    execSync(`chmod +x "${destScript}"`, { stdio: 'ignore' });
    console.log('[package:mac] Copied Start ClawClaw.command');
  }

  if (existsSync(portableReadme)) {
    cpSync(portableReadme, resolve(stagingDir, 'README Portable.txt'));
    console.log('[package:mac] Copied README Portable.txt');
  }

  const stagingApp = resolve(stagingDir, 'ClawClaw.app');
  const stagingResources = resolve(stagingApp, 'Contents', 'Resources');
  createPortableDataLayout(resolve(stagingResources, 'portable'));
  validatePortableSupportFiles(stagingApp, arch);
  console.log('[package:mac] Prepared portable data directory inside app bundle');

  // Stage → portable dir
  renameSync(stagingDir, portableDir);

  // Zip it
  const version = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')).version;
  const zipName = `ClawClaw-v${version}-mac-${arch}-portable.zip`;
  const zipPath = resolve(macDir, zipName);
  rmSync(zipPath, { force: true });

  console.log(`[package:mac] Zipping...`);
  if (isMacHost) {
    execSync(`cd "${macDir}" && zip -qr "${zipName}" "$(basename "${portableDir}")"`, {
      stdio: 'inherit',
      shell: true,
    });
  } else {
    // Cross-platform fallback: tar.gz
    const tarName = zipName.replace('.zip', '.tar.gz');
    execSync(
      `tar -czf "${resolve(macDir, tarName)}" -C "${macDir}" "$(basename "${portableDir}")"`,
      { stdio: 'pipe' },
    );
    console.log(`[package:mac] Created ${tarName} (native zip not available on this platform)`);
  }

  rmSync(portableDir, { recursive: true, force: true });
  console.log(`[package:mac] Done: ${zipName}`);
}

const args = process.argv.slice(2);
const archs = args.includes('--arm64')
  ? ['arm64']
  : args.includes('--x64')
    ? ['x64']
    : ['arm64', 'x64'];

// --build flag: run electron-builder first
if (args.includes('--build')) {
  runElectronBuilder(archs);
}

// Assemble portable zip(s)
for (const arch of archs) {
  buildPortableForArch(arch);
}

console.log('[package:mac] All done.');
