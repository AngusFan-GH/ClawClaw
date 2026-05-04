#!/usr/bin/env node

import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { createInstallPlan, createUninstallPlan } from '../core/plan.js';
import { parseInstallerManifest } from '../core/manifest.js';
import { executeInstallerPlan } from '../core/executor.js';
import type { ExistingInstallState, InstallerMode } from '../core/types.js';

interface RunnerArgs {
  mode: InstallerMode;
  manifestPath: string;
  installDir: string;
  arch: string;
  legacyVersion?: string;
  removeClawClawData: boolean;
  removeOpenClawData: boolean;
  removeLogsAndCache: boolean;
  execute: boolean;
}

function readArgs(argv: string[]): RunnerArgs {
  const getValue = (name: string, fallback?: string): string | undefined => {
    const prefix = `--${name}=`;
    const inline = argv.find((arg) => arg.startsWith(prefix));
    if (inline) return inline.slice(prefix.length);
    const index = argv.indexOf(`--${name}`);
    if (index !== -1) return argv[index + 1] ?? fallback;
    return fallback;
  };

  const has = (name: string): boolean => argv.includes(`--${name}`);
  const mode = (getValue('mode', 'install') ?? 'install') as InstallerMode;
  if (mode !== 'install' && mode !== 'upgrade' && mode !== 'uninstall') {
    throw new Error(`Unsupported mode: ${mode}`);
  }

  return {
    mode,
    manifestPath: getValue('manifest', 'release/windows-installer/manifest.json')!,
    installDir: getValue('install-dir', '%LOCALAPPDATA%\\Programs\\ClawClaw')!,
    arch: getValue('arch', process.arch === 'arm64' ? 'arm64' : 'x64')!,
    legacyVersion: getValue('legacy-version'),
    removeClawClawData: has('remove-clawclaw-data'),
    removeOpenClawData: has('remove-openclaw-data'),
    removeLogsAndCache: has('remove-logs-cache'),
    execute: has('execute'),
  };
}

async function main(): Promise<void> {
  const args = readArgs(process.argv.slice(2));
  const manifestPath = resolve(process.cwd(), args.manifestPath);
  if (!existsSync(manifestPath)) {
    throw new Error(`Installer manifest not found: ${manifestPath}`);
  }

  const manifest = parseInstallerManifest(JSON.parse(readFileSync(manifestPath, 'utf8')));
  const payload = manifest.payloads.find((candidate) => candidate.arch === args.arch);
  if (!payload) {
    throw new Error(`No payload for arch ${args.arch}. Available: ${manifest.payloads.map((item) => item.arch).join(', ')}`);
  }

  const existingInstall: ExistingInstallState = {
    detected: args.mode !== 'install',
    version: args.legacyVersion,
    installDir: args.mode === 'install' ? undefined : args.installDir,
    source: args.mode === 'install' ? 'none' : 'legacy-nsis',
    requiresLegacyRuntimeCleanup: Boolean(args.legacyVersion && compareLegacyVersion(args.legacyVersion, '0.1.15') <= 0),
  };

  const plan = args.mode === 'uninstall'
    ? createUninstallPlan({
      mode: 'uninstall',
      existingInstall,
      removeClawClawData: args.removeClawClawData,
      removeOpenClawData: args.removeOpenClawData,
      removeLogsAndCache: args.removeLogsAndCache,
    })
    : createInstallPlan({
      mode: args.mode,
      installDir: args.installDir,
      createDesktopShortcut: true,
      launchAtStartup: false,
      installCliPath: true,
      existingInstall,
    });

  console.log(`${manifest.displayName} ${manifest.version}`);
  console.log(`Mode: ${plan.mode}`);
  console.log(`Payload: ${payload.unpackedDir}`);
  console.log(`Install directory: ${args.installDir}`);
  console.log('');
  for (const [index, step] of plan.steps.entries()) {
    const marker = step.destructive ? '!' : '-';
    console.log(`${String(index + 1).padStart(2, '0')} ${marker} ${step.title}`);
    console.log(`   ${step.description}`);
  }

  if (args.execute) {
    console.log('');
    await executeInstallerPlan(plan, {
      execute: true,
      installDir: args.installDir,
      manifestPath,
      manifest,
      payload,
      removeClawClawData: args.removeClawClawData,
      removeOpenClawData: args.removeOpenClawData,
      removeLogsAndCache: args.removeLogsAndCache,
      createDesktopShortcut: true,
      launchAtStartup: false,
      installCliPath: true,
      onEvent: (event) => {
        if (event.type === 'step:start') console.log(`> ${event.title}`);
        if (event.type === 'step:done') console.log(`✓ ${event.title}`);
        if (event.type === 'step:error') console.error(`✗ ${event.title}: ${event.message}`);
      },
    });
  }
}

function compareLegacyVersion(left: string, right: string): number {
  const parse = (value: string) => value.split('.').map((part) => Number.parseInt(part, 10) || 0);
  const a = parse(left);
  const b = parse(right);
  const length = Math.max(a.length, b.length);
  for (let index = 0; index < length; index += 1) {
    const diff = (a[index] ?? 0) - (b[index] ?? 0);
    if (diff !== 0) return diff;
  }
  return 0;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
