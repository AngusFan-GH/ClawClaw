#!/usr/bin/env node

/**
 * package-mac.mjs — Build ClawClaw macOS portable zip
 *
 * Builds the macOS app via electron-builder, then assembles a portable
 * directory containing:
 *   ClawClaw.app/          (the app bundle, with .portable marker inside)
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
import { resolve } from 'node:path';
import { platform } from 'node:os';

const isMacHost = platform() === 'darwin';

const cwd = resolve(process.cwd());
const releaseDir = resolve(cwd, 'release');
const versionDir = resolve(
  cwd,
  'release',
  `v${JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8')).version}`,
);
const macDir = resolve(versionDir, 'mac');
const buildResourcesDir = resolve(cwd, 'resources');

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function runElectronBuilder(arch) {
  console.log(`[package:mac] Running electron-builder for macOS ${arch}...`);

  const electronBuilderCli = resolve(cwd, 'node_modules', 'electron-builder', 'cli.js');
  const electronBuilderBin = resolve(cwd, 'node_modules', '.bin', 'electron-builder');

  let command = 'electron-builder';
  // electron-builder handles arm64/x64 via the config targets in electron-builder.yml
  const args = ['--mac', 'zip'];

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
  // electron-builder for mac zip outputs to release/mac-{arch}/ClawClaw.app
  const candidates = [
    resolve(releaseDir, `mac-${arch}`, 'ClawClaw.app'),
    resolve(releaseDir, 'mac'),
  ];

  for (const candidate of candidates) {
    if (existsSync(candidate)) {
      const appPath =
        existsSync(resolve(candidate, 'ClawClaw.app')) && candidate.includes('mac')
          ? resolve(candidate, 'ClawClaw.app')
          : candidate.includes('ClawClaw.app')
            ? candidate
            : null;
      if (appPath) return appPath;
    }
  }

  // Fallback: scan release dir for ClawClaw.app
  try {
    const entries = execSync(
      `find "${releaseDir}" -maxdepth 4 -name "ClawClaw.app" -type d 2>/dev/null`,
      { encoding: 'utf8', shell: true },
    )
      .trim()
      .split('\n')
      .filter(Boolean);
    return entries[0] || null;
  } catch {
    return null;
  }
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

  // .portable is created by afterPack inside electron-builder (at appOutDir/).
  // A second injection here (inside Contents/Resources/) is harmless — the app
  // will find the one in Contents/Resources/ first when walking up from app.asar,
  // and the zip root copy handles the portable-root detection.
  const stagingApp = resolve(stagingDir, 'ClawClaw.app');
  const stagingResources = resolve(stagingApp, 'Contents', 'Resources');
  ensureDir(stagingResources);
  execSync(`touch "${resolve(stagingResources, '.portable')}"`, { stdio: 'ignore' });
  console.log('[package:mac] Ensured .portable marker in Contents/Resources/');

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
  runElectronBuilder(archs[0]);
}

// Assemble portable zip(s)
for (const arch of archs) {
  buildPortableForArch(arch);
}

console.log('[package:mac] All done.');
