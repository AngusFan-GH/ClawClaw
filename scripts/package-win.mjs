#!/usr/bin/env node

import { execSync, spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, existsSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { delimiter, dirname, resolve } from 'node:path';
import { platform } from 'node:os';

const hostPlatform = platform();
const isWindowsHost = hostPlatform === 'win32';
const packageJson = JSON.parse(readFileSync(resolve(process.cwd(), 'package.json'), 'utf8'));
const appVersion = packageJson.version;

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
  removeDirIfExists(resolve(process.cwd(), 'release', 'windows-installer'));
  removeDirIfExists(resolve(process.cwd(), 'release', `v${appVersion}`, 'windows', 'windows-installer'));
  removeDirIfExists(resolve(process.cwd(), 'release', `v${appVersion}`, 'windows', `ClawClaw-Setup-v${appVersion}.exe`));
  removeDirIfExists(resolve(process.cwd(), 'release', `v${appVersion}`, 'windows', `ClawClaw-Setup-v${appVersion}-x64.exe`));
  removeDirIfExists(resolve(process.cwd(), 'release', `v${appVersion}`, 'windows', `ClawClaw-Setup-v${appVersion}-arm64.exe`));
  removeDirIfExists(resolve(process.cwd(), 'release', `v${appVersion}`, 'windows', 'latest.yml'));
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

const ensureBundledUvForWin = (archs, env) => {
  const missingArchs = archs.filter((arch) => !hasBundledUvForArch(arch));
  if (missingArchs.length === 0) {
    return;
  }

  console.log(`[package:win] Missing bundled uv for ${missingArchs.join(', ')}. Downloading Windows uv binaries...`);

  const pnpmCmd = isWindowsHost ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpmCmd, ['run', 'uv:download:win'], {
    stdio: 'inherit',
    env,
    shell: isWindowsHost,
  });

  if (result.error) {
    console.error('[package:win] Failed to start uv download:', result.error.message);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    console.error('[package:win] uv:download:win failed.');
    process.exit(result.status ?? 1);
  }

  const stillMissing = missingArchs.filter((arch) => !hasBundledUvForArch(arch));
  if (stillMissing.length > 0) {
    console.error(`[package:win] Bundled uv is still missing after download for: ${stillMissing.join(', ')}`);
    process.exit(1);
  }
};

const ensureBundledPythonForWin = (archs, env) => {
  const missingArchs = archs.filter((arch) => !hasBundledPythonForArch(arch));
  if (missingArchs.length === 0) {
    return;
  }

  console.log(
    `[package:win] Missing bundled Python runtime for ${missingArchs.join(', ')}. Downloading Windows Python runtime...`
  );

  const pnpmCmd = isWindowsHost ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpmCmd, ['run', 'python:download:win'], {
    stdio: 'inherit',
    env,
    shell: isWindowsHost,
  });

  if (result.error) {
    console.error('[package:win] Failed to start Python download:', result.error.message);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    console.error('[package:win] python:download:win failed.');
    process.exit(result.status ?? 1);
  }

  const stillMissing = missingArchs.filter((arch) => !hasBundledPythonForArch(arch));
  if (stillMissing.length > 0) {
    console.error(
      `[package:win] Bundled Python runtime is still missing after download for: ${stillMissing.join(', ')}`
    );
    process.exit(1);
  }
};

const ensureBundledNodeForWin = (archs, env) => {
  const missingArchs = archs.filter((arch) => !hasBundledNodeForArch(arch));
  if (missingArchs.length === 0) {
    return;
  }

  console.log(
    `[package:win] Missing bundled node.exe for ${missingArchs.join(', ')}. Downloading Windows Node.js binaries...`
  );

  const pnpmCmd = isWindowsHost ? 'pnpm.cmd' : 'pnpm';
  const result = spawnSync(pnpmCmd, ['run', 'node:download:win'], {
    stdio: 'inherit',
    env,
    shell: isWindowsHost,
  });

  if (result.error) {
    console.error('[package:win] Failed to start node download:', result.error.message);
    process.exit(1);
  }

  if ((result.status ?? 1) !== 0) {
    console.error('[package:win] node:download:win failed.');
    process.exit(result.status ?? 1);
  }

  const stillMissing = missingArchs.filter((arch) => !hasBundledNodeForArch(arch));
  if (stillMissing.length > 0) {
    console.error(
      `[package:win] Bundled node.exe is still missing after download for: ${stillMissing.join(', ')}`
    );
    process.exit(1);
  }
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

if (isWindowsHost && !nsisPath) {
  console.error('[package:win] NSIS is required for Windows packaging. Please install makensis first.');
  process.exit(1);
}

const args = process.argv.slice(2);
const hasArchArg = args.some((arg) => arg === '--x64' || arg === '--arm64' || arg === '--ia32' || arg.startsWith('--arch'));
const archArgs = hasArchArg ? [] : ['--x64', '--arm64'];
const builderArgs = ['--win', 'nsis', ...archArgs, ...args];

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
const nsisTemplateDir = resolve(process.cwd(), 'node_modules', 'app-builder-lib', 'templates', 'nsis');

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

const assertIncludes = (value, needle, label) => {
  if (!value.includes(needle)) {
    throw new Error(`[package:win] ${label} does not contain expected marker: ${needle}`);
  }
};

const assertExcludes = (value, needle, label) => {
  if (value.includes(needle)) {
    throw new Error(`[package:win] ${label} still contains forbidden marker: ${needle}`);
  }
};

const patchNsisTemplate = (templateName, sourcePath, options = {}) => {
  const templatePath = resolve(nsisTemplateDir, templateName);
  if (!existsSync(templatePath)) {
    throw new Error(`[package:win] electron-builder NSIS template not found: ${templatePath}`);
  }
  if (!existsSync(sourcePath)) {
    throw new Error(`[package:win] ClawClaw NSIS template override not found: ${sourcePath}`);
  }

  const original = readFileSync(templatePath, 'utf8');
  const replacement = readFileSync(sourcePath, 'utf8');
  for (const marker of options.originalMustContain ?? []) {
    assertIncludes(original, marker, templatePath);
  }
  for (const marker of options.replacementMustContain ?? []) {
    assertIncludes(replacement, marker, sourcePath);
  }
  for (const marker of options.replacementMustNotContain ?? []) {
    assertExcludes(replacement, marker, sourcePath);
  }

  writeFileSync(templatePath, replacement);

  return () => {
    writeFileSync(templatePath, original);
  };
};

const withPatchedNsisTemplates = (fn) => {
  const restores = [];
  try {
    restores.push(
      patchNsisTemplate('assistedInstaller.nsh', resolve(process.cwd(), 'scripts', 'assistedInstaller.nsh'), {
        originalMustContain: ['PAGE_INSTALL_MODE'],
        replacementMustContain: ['!insertmacro setInstallModePerUser'],
        replacementMustNotContain: ['PAGE_INSTALL_MODE'],
      })
    );
    restores.push(
      patchNsisTemplate('installSection.nsh', resolve(process.cwd(), 'scripts', 'installSection.nsh'), {
        originalMustContain: ['SetDetailsPrint none'],
        replacementMustContain: ['SetDetailsPrint both'],
        replacementMustNotContain: ['SetDetailsPrint none'],
      })
    );
    restores.push(
      patchNsisTemplate('include/installUtil.nsh', resolve(process.cwd(), 'scripts', 'installUtil.nsh'), {
        originalMustContain: ['MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)"'],
        replacementMustContain: ['Preparing previous ClawClaw installation for upgrade'],
        replacementMustNotContain: ['MessageBox MB_RETRYCANCEL|MB_ICONEXCLAMATION "$(appCannotBeClosed)"'],
      })
    );
    console.log('[package:win] Patched electron-builder NSIS templates for ClawClaw per-user assisted upgrade flow.');
    return fn();
  } finally {
    for (const restore of restores.reverse()) {
      restore();
    }
    if (restores.length > 0) {
      console.log('[package:win] Restored electron-builder NSIS templates.');
    }
  }
};

if (isWindowsHost) {
  console.log(`[package:win] Found NSIS at ${nsisPath}.`);
} else {
  console.log('[package:win] Running cross-platform Windows NSIS build.');
}
console.log(`[package:win] Building NSIS for ${archArgs.length > 0 ? 'x64 and arm64' : 'specified'} architectures.`);

killPackagingProcesses();
cleanBuildDirs();

let result = withPatchedNsisTemplates(() => {
  let buildResult = runBuild();

  if (buildResult.status !== 0) {
    const output = `${buildResult.stdout ?? ''}\n${buildResult.stderr ?? ''}`;
    const isLockedFile = output.includes('Access is denied') || output.includes('being used by another process');

    if (isLockedFile) {
      console.log('[package:win] Detected locked release files, cleaning up and retrying once...');
      killPackagingProcesses();
      cleanBuildDirs();
      sleep(1500);
      buildResult = runBuild();
    }
  }

  return buildResult;
});

if (result.error) {
  console.error('[package:win] Failed to start electron-builder:', result.error.message);
  process.exit(1);
}

if ((result.status ?? 0) !== 0) {
  process.exit(result.status ?? 1);
}

const sha512Base64 = (filePath) => {
  const hash = createHash('sha512');
  hash.update(readFileSync(filePath));
  return hash.digest('base64');
};

const writeStableUpdaterArtifacts = () => {
  const releaseDir = resolve(process.cwd(), 'release');
  const staged = [];
  for (const arch of winArchTargets) {
    const fileName = `ClawClaw-Setup-v${appVersion}-${arch}.exe`;
    const filePath = resolve(releaseDir, fileName);
    if (!existsSync(filePath)) continue;
    staged.push({
      arch,
      fileName,
      filePath,
      size: statSync(filePath).size,
      sha512: sha512Base64(filePath),
    });
  }

  const x64Artifact = staged.find((artifact) => artifact.arch === 'x64');
  if (x64Artifact) {
    const fileName = `ClawClaw-Setup-v${appVersion}.exe`;
    const filePath = resolve(releaseDir, fileName);
    cpSync(x64Artifact.filePath, filePath);
    const sourceBlockmap = `${x64Artifact.filePath}.blockmap`;
    if (existsSync(sourceBlockmap)) {
      cpSync(sourceBlockmap, `${filePath}.blockmap`);
    }
    staged.push({
      arch: 'x64',
      fileName,
      filePath,
      size: statSync(filePath).size,
      sha512: sha512Base64(filePath),
    });
    console.log(`[package:win] Staged stable installer alias: release/${fileName}`);
  }

  const primary = staged.find((artifact) => artifact.fileName === `ClawClaw-Setup-v${appVersion}.exe`) ??
    staged.find((artifact) => artifact.arch === process.arch) ??
    x64Artifact ??
    staged[0];
  if (!primary) {
    throw new Error('[package:win] No Windows installer was generated.');
  }

  const latestYml = [
    `version: ${appVersion}`,
    'files:',
    ...staged.flatMap((artifact) => [
      `  - url: ${artifact.fileName}`,
      `    sha512: ${artifact.sha512}`,
      `    size: ${artifact.size}`,
    ]),
    `path: ${primary.fileName}`,
    `sha512: ${primary.sha512}`,
    `releaseDate: '${new Date().toISOString()}'`,
    '',
  ].join('\n');
  writeFileSync(resolve(releaseDir, 'latest.yml'), latestYml);
  console.log('[package:win] Wrote updater metadata: release/latest.yml');
};

writeStableUpdaterArtifacts();
