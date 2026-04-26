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
  'allowOnlyOneInstallerInstance.nsh',
  'extractAppPackage.nsh',
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
if (
  !installerNsi.includes('!include "installSection.nsh"') &&
  !installerNsi.includes('!include "${PROJECT_DIR}\\scripts\\installSection.nsh"')
) {
  fail('scripts/installer.nsi must delegate the install section to installSection.nsh.');
}
if (installerNsi.includes('!insertmacro uninstallOldVersion SHELL_CONTEXT')) {
  fail('scripts/installer.nsi must not inline legacy uninstall logic.');
}
if (installerNsi.includes('!insertmacro installApplicationFiles')) {
  fail('scripts/installer.nsi must not inline file-copy logic.');
}

const builderConfig = requireText(resolve(repoRoot, 'electron-builder.yml'));
if (!builderConfig.includes('include: scripts/installer.nsh')) {
  fail('electron-builder.yml must use nsis.include: scripts/installer.nsh so electron-builder can pre-build the Windows uninstaller.');
}
if (!builderConfig.includes('allowElevation: false')) {
  fail('electron-builder.yml must keep nsis.allowElevation disabled so assisted installs cannot enter the unsupported all-users path.');
}
if (builderConfig.includes('script: scripts/installer.nsi')) {
  fail('electron-builder.yml must not use nsis.script: scripts/installer.nsi because that bypasses electron-builder uninstaller generation/signing.');
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

const allowOnlyOneInstallerInstance = requireText(resolve(scriptsDir, 'allowOnlyOneInstallerInstance.nsh'));
for (const requiredSnippet of [
  'Shadowed upstream template: app-builder-lib/templates/nsis/include/allowOnlyOneInstallerInstance.nsh',
  '!insertmacro customCheckAppRunning',
]) {
  if (!allowOnlyOneInstallerInstance.includes(requiredSnippet)) {
    fail(`scripts/allowOnlyOneInstallerInstance.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}

const extractAppPackage = requireText(resolve(scriptsDir, 'extractAppPackage.nsh'));
for (const requiredSnippet of [
  'Shadowed upstream template: app-builder-lib/templates/nsis/include/extractAppPackage.nsh',
  '!insertmacro RunManagedUpgradeCleanup',
  '$(installFilesLocked)',
]) {
  if (!extractAppPackage.includes(requiredSnippet)) {
    fail(`scripts/extractAppPackage.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}

const installerNsh = requireText(resolve(scriptsDir, 'installer.nsh'));
for (const requiredSnippet of [
  '!addincludedir "${PROJECT_DIR}/scripts"',
  '!macro customInstallMode',
  'StrCpy $isForceCurrentInstall "1"',
  '$(installRuntimeValidationFailed)',
  '$(installLogRuntimeValidationLaunchFailed)',
  '$(installLogRuntimeValidationTimedOut)',
  '$(installLogUninstallShortcutSkipped)',
  '!macro customCheckAppRunning',
  '$(installFilesLocked)',
  '!macro ResolveUpgradeStrategy',
]) {
  if (!installerNsh.includes(requiredSnippet)) {
    fail(`scripts/installer.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}
if (installerNsh.includes('$(installRuntimeValidationWarning)')) {
  fail('scripts/installer.nsh must not downgrade OpenClaw runtime validation failures to warnings.');
}

for (const requiredSnippet of [
  '!ifmacrodef customUnInstallSection',
  '!insertmacro MUI_UNPAGE_COMPONENTS',
]) {
  if (!installerNsi.includes(requiredSnippet)) {
    fail(`scripts/installer.nsi is missing expected uninstall component page snippet: ${requiredSnippet}`);
  }
}

const runtimeValidation = requireText(resolve(scriptsDir, 'run-runtime-validation.ps1'));
for (const requiredSnippet of [
  '[OpenClaw validation] Install directory:',
  '[OpenClaw validation] ERROR:',
  '[OpenClaw validation] Dependency probe failed',
  'System.Diagnostics.ProcessStartInfo',
  "RedirectStandardError = $true",
]) {
  if (!runtimeValidation.includes(requiredSnippet)) {
    fail(`scripts/run-runtime-validation.ps1 is missing expected snippet: ${requiredSnippet}`);
  }
}
if (runtimeValidation.includes('-ArgumentList')) {
  fail('scripts/run-runtime-validation.ps1 must invoke bundled node.exe directly so paths with spaces are preserved.');
}
if (runtimeValidation.includes('& $nodeExe')) {
  fail('scripts/run-runtime-validation.ps1 must use ProcessStartInfo so Windows PowerShell does not reinterpret validation arguments.');
}

const uninstallerNsh = requireText(resolve(scriptsDir, 'uninstaller.nsh'));
if (uninstallerNsh.includes('!insertmacro MUI_UNPAGE_COMPONENTS')) {
  fail('scripts/uninstaller.nsh must not insert the uninstall components page from customUnWelcomePage; installer.nsi owns that page order.');
}
for (const requiredSnippet of [
  '!macro DetectInstallDirLocks',
  '!macro KillInstallDirProcesses',
  '!macro customUnInstall',
]) {
  if (!uninstallerNsh.includes(requiredSnippet)) {
    fail(`scripts/uninstaller.nsh is missing expected snippet: ${requiredSnippet}`);
  }
}

const killInstallDirProcesses = requireText(resolve(scriptsDir, 'kill-install-dir-processes.ps1'));
for (const requiredSnippet of [
  "$processName -like 'Uninstall*.exe'",
  'return $false',
]) {
  if (!killInstallDirProcesses.includes(requiredSnippet)) {
    fail(`scripts/kill-install-dir-processes.ps1 is missing expected self-uninstaller protection: ${requiredSnippet}`);
  }
}
if (killInstallDirProcesses.includes("'Uninstall ClawClaw.exe'")) {
  fail('scripts/kill-install-dir-processes.ps1 must not target the running uninstaller by process name.');
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
