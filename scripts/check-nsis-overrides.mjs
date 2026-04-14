#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { basename, resolve } from 'node:path';

const repoRoot = process.cwd();
const scriptsDir = resolve(repoRoot, 'scripts');
const upstreamDir = resolve(repoRoot, 'node_modules', 'app-builder-lib', 'templates', 'nsis');

const fail = (message) => {
  console.error(`[check:nsis] ${message}`);
  process.exitCode = 1;
};

const requireText = (filePath) => {
  if (!existsSync(filePath)) {
    fail(`Missing required file: ${filePath}`);
    return '';
  }
  return readFileSync(filePath, 'utf8');
};

const expectedShadowFiles = new Set([
  'installer.nsi',
  'installer.nsh',
  'installSection.nsh',
  'installUtil.nsh',
  'uninstaller.nsh',
]);

const localNsisFiles = readdirSync(scriptsDir).filter((name) => /\.(nsi|nsh)$/i.test(name));
for (const name of localNsisFiles) {
  const upstreamCandidate = resolve(upstreamDir, name);
  if (existsSync(upstreamCandidate) && !expectedShadowFiles.has(name)) {
    fail(`Unexpected local shadow file "${name}". Either remove it or add it to the allowlist.`);
  }
}

const installerNsi = requireText(resolve(scriptsDir, 'installer.nsi'));
if (!installerNsi.includes('!include "installSection.nsh"')) {
  fail('scripts/installer.nsi must delegate the install section to installSection.nsh.');
}
if (installerNsi.includes('!insertmacro uninstallOldVersion SHELL_CONTEXT')) {
  fail('scripts/installer.nsi must not inline legacy uninstall logic.');
}
if (installerNsi.includes('!insertmacro installApplicationFiles')) {
  fail('scripts/installer.nsi must not inline file-copy logic.');
}

const installSection = requireText(resolve(scriptsDir, 'installSection.nsh'));
for (const requiredSnippet of [
  '!insertmacro ResolveUpgradeStrategy',
  '!insertmacro RunManagedUpgradeCleanup',
  'skipping the legacy uninstaller',
]) {
  if (!installSection.includes(requiredSnippet)) {
    fail(`scripts/installSection.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}

const installUtil = requireText(resolve(scriptsDir, 'installUtil.nsh'));
for (const requiredSnippet of [
  'Shadowed upstream template: app-builder-lib/templates/nsis/include/installUtil.nsh',
  'run-gateway-cmd.ps1',
  'Silent uninstall could not complete after repeated attempts.',
]) {
  if (!installUtil.includes(requiredSnippet)) {
    fail(`scripts/installUtil.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}

const installerNsh = requireText(resolve(scriptsDir, 'installer.nsh'));
for (const requiredSnippet of [
  '!addincludedir "${PROJECT_DIR}\\scripts"',
  '!macro customCheckAppRunning',
  '$(installFilesLocked)',
  '!macro ResolveUpgradeStrategy',
]) {
  if (!installerNsh.includes(requiredSnippet)) {
    fail(`scripts/installer.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}

const uninstallerNsh = requireText(resolve(scriptsDir, 'uninstaller.nsh'));
for (const requiredSnippet of [
  '!macro DetectInstallDirLocks',
  '!macro KillInstallDirProcesses',
  '!macro customUnInstall',
]) {
  if (!uninstallerNsh.includes(requiredSnippet)) {
    fail(`scripts/uninstaller.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}

const upstreamInstaller = requireText(resolve(upstreamDir, 'installer.nsi'));
if (!upstreamInstaller) {
  fail('Unable to read upstream NSIS installer template.');
}

if (process.exitCode && process.exitCode !== 0) {
  process.exit(process.exitCode);
}

console.log(
  `[check:nsis] OK: verified ${[...expectedShadowFiles].map((name) => basename(name)).join(', ')}`
);
