import { spawn } from 'node:child_process';
import { join, dirname } from 'node:path';
import { app } from 'electron';
import { existsSync } from 'node:fs';
import { getOpenClawDir, getResourcesDir } from './paths';

function getNodeExecForValidation(): string {
  if (process.platform === 'win32' && app.isPackaged) {
    const bundledNodePath = join(process.resourcesPath, 'bin', 'node.exe');
    if (existsSync(bundledNodePath)) return bundledNodePath;
  }
  if (process.platform === 'darwin' && app.isPackaged) {
    const appName = app.getName();
    const helperName = `${appName} Helper`;
    const helperPath = join(
      dirname(process.execPath),
      '../Frameworks',
      `${helperName}.app`,
      'Contents/MacOS',
      helperName,
    );
    if (existsSync(helperPath)) return helperPath;
  }
  return process.execPath;
}

function getValidationScriptPath(): string {
  if (app.isPackaged) {
    return join(getResourcesDir(), 'scripts', 'validate-openclaw-runtime.cjs');
  }
  return join(__dirname, '../../resources/scripts/validate-openclaw-runtime.cjs');
}

export async function validateBundledOpenClawRuntime(): Promise<void> {
  const scriptPath = getValidationScriptPath();
  const openclawDir = getOpenClawDir();
  const nodeExec = getNodeExecForValidation();

  await new Promise<void>((resolve, reject) => {
    const child = spawn(nodeExec, [scriptPath, openclawDir], {
      cwd: openclawDir,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: '1',
        OPENCLAW_NO_RESPAWN: '1',
        OPENCLAW_EMBEDDED_IN: 'ClawClaw',
      },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });

    let stderr = '';
    let stdout = '';
    child.stdout.on('data', (chunk) => {
      stdout += String(chunk);
    });
    child.stderr.on('data', (chunk) => {
      stderr += String(chunk);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) {
        resolve();
        return;
      }
      const detail = (stderr || stdout).trim();
      reject(new Error(`Bundled OpenClaw runtime validation failed${detail ? `: ${detail}` : ''}`));
    });
  });
}
