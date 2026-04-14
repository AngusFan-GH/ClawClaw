#!/usr/bin/env node

import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, rmSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const cwd = process.cwd();
const releaseDir = resolve(cwd, 'release');
const packageJson = JSON.parse(readFileSync(resolve(cwd, 'package.json'), 'utf8'));
const versionDir = resolve(releaseDir, `v${packageJson.version}`);

const GROUPS = [
  {
    name: 'windows',
    dirMatchers: [/^win(?:-.+)?-unpacked$/i, /^github$/i],
    fileMatchers: [
      /^latest\.yml$/i,
      /^ClawClaw-Setup-v.+\.exe(?:\.blockmap)?$/i,
      /^clawclaw-.+\.nsis\.7z$/i,
    ],
  },
  {
    name: 'mac',
    dirMatchers: [/^mac(?:-.+)?$/i],
    fileMatchers: [
      /^ClawClaw-v.+\.(?:zip|dmg|pkg)$/i,
      /^ClawClaw-v.+\.(?:zip|dmg|pkg)\.blockmap$/i,
    ],
  },
  {
    name: 'linux',
    dirMatchers: [/^linux(?:-.+)?$/i],
    fileMatchers: [
      /^ClawClaw-v.+\.(?:AppImage|deb|rpm)$/i,
      /^ClawClaw-v.+\.(?:AppImage|deb|rpm)\.blockmap$/i,
    ],
  },
  {
    name: 'metadata',
    dirMatchers: [],
    fileMatchers: [/^builder-debug\.yml$/i, /^builder-effective-config\.yaml$/i],
  },
];

function ensureDir(dirPath) {
  mkdirSync(dirPath, { recursive: true });
}

function mergeDirectoryContents(sourceDir, targetDir, label) {
  ensureDir(targetDir);

  for (const child of readdirSync(sourceDir)) {
    const sourcePath = resolve(sourceDir, child);
    const targetPath = resolve(targetDir, child);

    if (existsSync(targetPath)) {
      rmSync(targetPath, { recursive: true, force: true });
    }

    renameSync(sourcePath, targetPath);
    console.log(`[release-organize] moved ${label}/${child} -> ${basename(targetDir)}/${child}`);
  }

  rmSync(sourceDir, { recursive: true, force: true });
}

function moveIntoGroup(entryName, groupName) {
  const sourcePath = resolve(releaseDir, entryName);
  const targetDir = resolve(versionDir, groupName);
  const isLegacyGroupDir = entryName === groupName;

  if (isLegacyGroupDir) {
    mergeDirectoryContents(sourcePath, targetDir, entryName);
    return;
  }

  const targetPath = resolve(targetDir, basename(entryName));
  ensureDir(targetDir);
  if (existsSync(targetPath)) {
    rmSync(targetPath, { recursive: true, force: true });
  }

  renameSync(sourcePath, targetPath);
  console.log(`[release-organize] moved ${entryName} -> ${groupName}/${basename(entryName)}`);
}

if (!existsSync(releaseDir)) {
  process.exit(0);
}

const reservedNames = new Set(['current', 'archive', `v${packageJson.version}`]);
for (const entry of readdirSync(releaseDir, { withFileTypes: true })) {
  if (reservedNames.has(entry.name)) continue;
  if (entry.name === '.DS_Store') continue;

  const group = GROUPS.find((candidate) => {
    if (entry.isDirectory()) {
      return candidate.dirMatchers.some((pattern) => pattern.test(entry.name));
    }
    if (entry.isFile()) {
      return candidate.fileMatchers.some((pattern) => pattern.test(entry.name));
    }
    return false;
  });

  if (!group) continue;
  moveIntoGroup(entry.name, group.name);
}
