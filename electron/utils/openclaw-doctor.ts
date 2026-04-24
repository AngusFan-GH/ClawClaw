import { app } from 'electron';
import { spawn } from 'node:child_process';
import { existsSync } from 'fs';
import path from 'path';
import { getManagedPythonHome, getManagedUvCacheDir, getOpenClawDir, getOpenClawEntryPath } from './paths';
import { logger } from './logger';
import { getUvMirrorEnv } from './uv-env';
import { getOpenClawCliSpawnConfig } from './openclaw-cli';
import { buildProxyEnvAsync } from './proxy';
import { getAllSettings } from './store';

const OPENCLAW_DOCTOR_TIMEOUT_MS = 60_000;
export const OPENCLAW_DOCTOR_FIX_TIMEOUT_MS = 120_000;
const MAX_DOCTOR_OUTPUT_BYTES = 10 * 1024 * 1024;
const OPENCLAW_DOCTOR_ARGS = ['doctor'];
const OPENCLAW_DOCTOR_FIX_ARGS = ['doctor', '--fix', '--yes', '--non-interactive'];

export type OpenClawDoctorMode = 'diagnose' | 'fix';
export type OpenClawDoctorStatus = 'success' | 'success_with_warnings' | 'failed';

export interface OpenClawDoctorResult {
  mode: OpenClawDoctorMode;
  status: OpenClawDoctorStatus;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  durationMs: number;
  warnings: string[];
  timedOut?: boolean;
  error?: string;
}

const WARNING_LINE_LIMIT = 8;

function collectWarningLines(stderr: string): string[] {
  if (!stderr.trim()) {
    return [];
  }

  const warnings: string[] = [];
  const seen = new Set<string>();
  for (const rawLine of stderr.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;
    if (seen.has(line)) continue;
    seen.add(line);
    warnings.push(line);
    if (warnings.length >= WARNING_LINE_LIMIT) {
      break;
    }
  }

  return warnings;
}

export function classifyOpenClawDoctorResult(input: {
  exitCode: number | null;
  stderr: string;
  timedOut?: boolean;
  error?: string;
}): { status: OpenClawDoctorStatus; success: boolean; warnings: string[] } {
  if (input.timedOut || input.error || input.exitCode !== 0) {
    return {
      status: 'failed',
      success: false,
      warnings: [],
    };
  }

  const warnings = collectWarningLines(input.stderr);
  if (warnings.length > 0) {
    return {
      status: 'success_with_warnings',
      success: true,
      warnings,
    };
  }

  return {
    status: 'success',
    success: true,
    warnings: [],
  };
}

function appendDoctorOutput(
  current: string,
  currentBytes: number,
  data: Buffer | string,
  stream: 'stdout' | 'stderr',
  alreadyTruncated: boolean,
): { output: string; bytes: number; truncated: boolean } {
  if (alreadyTruncated) {
    return { output: current, bytes: currentBytes, truncated: true };
  }

  const chunk = typeof data === 'string' ? Buffer.from(data) : data;
  if (currentBytes + chunk.length <= MAX_DOCTOR_OUTPUT_BYTES) {
    return {
      output: current + chunk.toString(),
      bytes: currentBytes + chunk.length,
      truncated: false,
    };
  }

  const remaining = Math.max(0, MAX_DOCTOR_OUTPUT_BYTES - currentBytes);
  const appended = remaining > 0 ? chunk.subarray(0, remaining).toString() : '';
  logger.warn(
    `OpenClaw doctor ${stream} exceeded ${MAX_DOCTOR_OUTPUT_BYTES} bytes; truncating additional output`,
  );

  return {
    output: current + appended,
    bytes: MAX_DOCTOR_OUTPUT_BYTES,
    truncated: true,
  };
}

function getBundledBinPath(): string {
  const target = `${process.platform}-${process.arch}`;
  return app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
}

async function runDoctorCommandWithArgs(
  mode: OpenClawDoctorMode,
  args: string[],
  timeoutMs = OPENCLAW_DOCTOR_TIMEOUT_MS,
): Promise<OpenClawDoctorResult> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();
  const command = `openclaw ${args.join(' ')}`;
  const startedAt = Date.now();

  if (!existsSync(entryScript)) {
    const error = `OpenClaw entry script not found at ${entryScript}`;
    logger.error(`Cannot run OpenClaw doctor: ${error}`);
    return {
      mode,
      status: 'failed',
      success: false,
      exitCode: null,
      stdout: '',
      stderr: '',
      command,
      cwd: openclawDir,
      durationMs: Date.now() - startedAt,
      warnings: [],
      error,
    };
  }

  const binPath = getBundledBinPath();
  const binPathExists = existsSync(binPath);
  const finalPath = binPathExists
    ? `${binPath}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH || '';
  const uvEnv = await getUvMirrorEnv();
  const proxyEnv = await buildProxyEnvAsync(await getAllSettings());
  const managedPythonHome = getManagedPythonHome();
  const managedUvCache = getManagedUvCacheDir();

  logger.info(
    `Running OpenClaw doctor (mode=${mode}, entry="${entryScript}", args="${args.join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'})`,
  );

  return await new Promise<OpenClawDoctorResult>((resolve) => {
    const spawnConfig = getOpenClawCliSpawnConfig(args);
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: openclawDir || spawnConfig.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...spawnConfig.env,
        ...process.env,
        ...uvEnv,
        ...proxyEnv,
        PATH: finalPath,
        ...(managedPythonHome ? { UV_PYTHON_INSTALL_DIR: managedPythonHome } : {}),
        ...(managedUvCache ? { UV_CACHE_DIR: managedUvCache } : {}),
        OPENCLAW_NO_RESPAWN: '1',
      } as NodeJS.ProcessEnv,
      windowsHide: true,
    });

    let stdout = '';
    let stderr = '';
    let stdoutBytes = 0;
    let stderrBytes = 0;
    let stdoutTruncated = false;
    let stderrTruncated = false;
    let settled = false;

    const finish = (
      result: Omit<OpenClawDoctorResult, 'durationMs' | 'status' | 'success' | 'warnings'>,
    ) => {
      if (settled) return;
      settled = true;
      const classified = classifyOpenClawDoctorResult(result);
      resolve({
        ...result,
        durationMs: Date.now() - startedAt,
        status: classified.status,
        success: classified.success,
        warnings: classified.warnings,
      });
    };

    const timeout = setTimeout(() => {
      logger.error(`OpenClaw doctor timed out after ${timeoutMs}ms`);
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish({
        mode,
        exitCode: null,
        stdout,
        stderr,
        command,
        cwd: openclawDir,
        timedOut: true,
        error: `Timed out after ${timeoutMs}ms`,
      });
    }, timeoutMs);

    child.stdout?.on('data', (data) => {
      const next = appendDoctorOutput(stdout, stdoutBytes, data, 'stdout', stdoutTruncated);
      stdout = next.output;
      stdoutBytes = next.bytes;
      stdoutTruncated = next.truncated;
    });

    child.stderr?.on('data', (data) => {
      const next = appendDoctorOutput(stderr, stderrBytes, data, 'stderr', stderrTruncated);
      stderr = next.output;
      stderrBytes = next.bytes;
      stderrTruncated = next.truncated;
    });

    child.on('error', (error) => {
      clearTimeout(timeout);
      logger.error('Failed to spawn OpenClaw doctor process:', error);
      finish({
        mode,
        exitCode: null,
        stdout,
        stderr,
        command,
        cwd: openclawDir,
        error: error instanceof Error ? error.message : String(error),
      });
    });

    child.on('exit', (code) => {
      clearTimeout(timeout);
      logger.info(`OpenClaw doctor exited with code ${code ?? 'null'}`);
      finish({
        mode,
        exitCode: code,
        stdout,
        stderr,
        command,
        cwd: openclawDir,
      });
    });
  });
}

export async function runOpenClawDoctor(): Promise<OpenClawDoctorResult> {
  return await runDoctorCommandWithArgs('diagnose', OPENCLAW_DOCTOR_ARGS);
}

export async function runOpenClawDoctorFix(
  options?: { timeoutMs?: number },
): Promise<OpenClawDoctorResult> {
  return await runDoctorCommandWithArgs(
    'fix',
    OPENCLAW_DOCTOR_FIX_ARGS,
    options?.timeoutMs ?? OPENCLAW_DOCTOR_TIMEOUT_MS,
  );
}
