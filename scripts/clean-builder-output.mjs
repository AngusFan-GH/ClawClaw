#!/usr/bin/env node

import { existsSync, readdirSync, rmSync } from 'node:fs';
import { extname, resolve } from 'node:path';

const TARGETS = [
  'release/.DS_Store',
  'release/mac',
  'release/win-unpacked',
  'release/win-arm64-unpacked',
  'release/win-ia32-unpacked',
  'release/linux-unpacked',
  'release/linux-arm64-unpacked',
  'release/mac-arm64',
  'release/mac-universal',
  'release/github',
];

for (const relativePath of TARGETS) {
  const fullPath = resolve(process.cwd(), relativePath);
  if (!existsSync(fullPath)) continue;
  rmSync(fullPath, { recursive: true, force: true });
  console.log(`[clean-builder-output] removed ${relativePath}`);
}

const releaseDir = resolve(process.cwd(), 'release');
if (existsSync(releaseDir)) {
  for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;

    const isMacDmgBackgroundArtifact = entry.name.startsWith('.background') || entry.name === '.DS_Store';
    const isDebugArtifact = entry.name === 'builder-debug.yml' || entry.name === 'builder-effective-config.yaml';
    const isMacTempArchive = extname(entry.name) === '.tmp';
    const isRootPlatformArtifact =
      /^latest\.yml$/i.test(entry.name) ||
      /^ClawClaw-Setup-v.+\.exe(?:\.blockmap)?$/i.test(entry.name) ||
      /^clawclaw-.+\.nsis\.7z$/i.test(entry.name) ||
      /^ClawClaw-v.+\.(?:zip|dmg|pkg|AppImage|deb|rpm)(?:\.blockmap)?$/i.test(entry.name);

    if (!isMacDmgBackgroundArtifact && !isDebugArtifact && !isMacTempArchive && !isRootPlatformArtifact) {
      continue;
    }

    const relativePath = `release/${entry.name}`;
    rmSync(resolve(process.cwd(), relativePath), { recursive: true, force: true });
    console.log(`[clean-builder-output] removed ${relativePath}`);
  }
}
