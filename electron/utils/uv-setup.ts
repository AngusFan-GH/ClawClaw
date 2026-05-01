import { app } from 'electron';
import { execSync, spawn } from 'child_process';
import { existsSync, rmSync } from 'fs';
import { join } from 'path';
import { UV_MIRROR_ENV, getUvMirrorEnv } from './uv-env';
import { logger } from './logger';
import { buildProxyEnvAsync } from './proxy';
import { getAllSettings } from './store';
import {
  quoteForCmd,
  needsWinShell,
  getBundledPythonExecutable,
  getManagedPythonEnv,
  getManagedPythonHome,
  getManagedUvCacheDir,
} from './paths';

/**
 * Get the path to the bundled uv binary
 */
function getBundledUvPath(): string {
  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binName = platform === 'win32' ? 'uv.exe' : 'uv';

  if (app.isPackaged) {
    return join(process.resourcesPath, 'bin', binName);
  } else {
    return join(process.cwd(), 'resources', 'bin', target, binName);
  }
}

/**
 * Resolve the best uv binary to use.
 *
 * In packaged mode we always prefer the bundled binary so we never accidentally
 * pick up a system-wide uv that may be a different (possibly broken) version.
 * In dev we fall through to the system PATH for convenience.
 */
function resolveUvBin(): { bin: string; source: 'bundled' | 'path' | 'bundled-fallback' } {
  const bundled = getBundledUvPath();

  if (app.isPackaged) {
    if (existsSync(bundled)) {
      return { bin: bundled, source: 'bundled' };
    }
    logger.warn(`Bundled uv binary not found at ${bundled}, falling back to system PATH`);
  }

  // Dev mode or missing bundled binary — check system PATH
  const found = findUvInPathSync();
  if (found) return { bin: 'uv', source: 'path' };

  if (existsSync(bundled)) {
    return { bin: bundled, source: 'bundled-fallback' };
  }

  return { bin: 'uv', source: 'path' };
}

function findUvInPathSync(): boolean {
  try {
    const cmd = process.platform === 'win32' ? 'where.exe uv' : 'which uv';
    execSync(cmd, { stdio: 'ignore', timeout: 5000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
}

/**
 * Check if uv is available (either bundled or in system PATH)
 */
export async function checkUvInstalled(): Promise<boolean> {
  const { bin, source } = resolveUvBin();
  if (source === 'bundled' || source === 'bundled-fallback') {
    return existsSync(bin);
  }
  return findUvInPathSync();
}

/**
 * "Install" uv - now just verifies that uv is available somewhere.
 * Kept for API compatibility with frontend.
 */
export async function installUv(): Promise<void> {
  const isAvailable = await checkUvInstalled();
  if (!isAvailable) {
    const bin = getBundledUvPath();
    throw new Error(`uv not found in system PATH and bundled binary missing at ${bin}`);
  }
  logger.info('uv is available and ready to use');
}

/**
 * Check if a managed Python 3.12 is ready and accessible
 */
export async function isPythonReady(): Promise<boolean> {
  const bundledPython = getBundledPythonExecutable();
  if (bundledPython) {
    return await verifyBundledPython(bundledPython);
  }

  const { bin: uvBin } = resolveUvBin();
  const useShell = needsWinShell(uvBin);
  const uvEnv = await getUvMirrorEnv();
  const pythonEnv = getManagedPythonEnv();

  const env: Record<string, string | undefined> = {
    ...process.env,
    ...uvEnv,
    ...pythonEnv,
  };

  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(useShell ? quoteForCmd(uvBin) : uvBin, ['python', 'find', '3.12'], {
        shell: useShell,
        env,
        windowsHide: true,
      });
      child.on('close', (code) => resolve(code === 0));
      child.on('error', () => resolve(false));
    } catch {
      resolve(false);
    }
  });
}

async function verifyBundledPython(pythonExe: string): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    try {
      const child = spawn(pythonExe, ['--version'], {
        env: { ...process.env },
        windowsHide: true,
      });
      let output = '';
      child.stdout?.on('data', (data) => { output += data.toString(); });
      child.stderr?.on('data', (data) => { output += data.toString(); });
      child.on('close', (code) => {
        const ok = code === 0 && output.includes('Python 3.12');
        if (!ok) {
          logger.warn(`Bundled Python validation failed (code=${code}, output=${output.trim() || '<empty>'})`);
        }
        resolve(ok);
      });
      child.on('error', (error) => {
        logger.warn(`Bundled Python spawn failed: ${error.message}`);
        resolve(false);
      });
    } catch (error) {
      logger.warn('Bundled Python validation threw:', error);
      resolve(false);
    }
  });
}

/**
 * Run `uv python install 3.12` once with the given environment.
 * Returns on success, throws with captured stderr on failure.
 */
async function runPythonInstall(
  uvBin: string,
  env: Record<string, string | undefined>,
  label: string,
): Promise<void> {
  const useShell = needsWinShell(uvBin);
  return new Promise<void>((resolve, reject) => {
    const stderrChunks: string[] = [];
    const stdoutChunks: string[] = [];
    const args = ['python', 'install', '3.12', '--native-tls'];

    const child = spawn(useShell ? quoteForCmd(uvBin) : uvBin, args, {
      shell: useShell,
      env,
      windowsHide: true,
    });

    child.stdout?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        stdoutChunks.push(line);
        logger.debug(`[python-setup:${label}] stdout: ${line}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const line = data.toString().trim();
      if (line) {
        stderrChunks.push(line);
        logger.info(`[python-setup:${label}] stderr: ${line}`);
      }
    });

    child.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        const stderr = stderrChunks.join('\n');
        const stdout = stdoutChunks.join('\n');
        const detail = stderr || stdout || '(no output captured)';
        reject(new Error(
          `Python installation failed with code ${code} [${label}]\n` +
          `  uv binary: ${uvBin}\n` +
          `  platform: ${process.platform}/${process.arch}\n` +
          `  source: ${env.UV_PYTHON_INSTALL_MIRROR ? env.UV_PYTHON_INSTALL_MIRROR : 'official'}\n` +
          `  output: ${detail}`
        ));
      }
    });

    child.on('error', (err) => {
      reject(new Error(
        `Python installation spawn error [${label}]: ${err.message}\n` +
        `  uv binary: ${uvBin}\n` +
        `  platform: ${process.platform}/${process.arch}`
      ));
    });
  });
}

async function runPythonInstallWithRecovery(
  uvBin: string,
  env: Record<string, string | undefined>,
  label: string,
): Promise<void> {
  try {
    await runPythonInstall(uvBin, env, label);
    return;
  } catch (firstError) {
    logger.warn(`Python install attempt failed [${label}]:`, firstError);

    if (shouldRepairWindowsPythonLinkError(firstError)) {
      logger.warn('Detected corrupted Windows uv Python link state, repairing managed directories and retrying...');
      repairManagedPythonState(env);
      try {
        await runPythonInstall(uvBin, env, `${label}-repair`);
        return;
      } catch (repairError) {
        logger.warn(`Python install retry after managed-state repair failed [${label}]:`, repairError);
      }
    }

    if (hasConfiguredProxy(env) && isProxyTunnelError(firstError)) {
      logger.warn(`Detected proxy tunnel failure during Python install [${label}], retrying without proxy...`);
      try {
        await runPythonInstall(uvBin, clearProxyEnv(env), `${label}-direct`);
        return;
      } catch (directError) {
        logger.warn(`Python install retry without proxy failed [${label}]:`, directError);
      }
    }

    throw firstError;
  }
}

function clearProxyEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...env,
    HTTP_PROXY: '',
    HTTPS_PROXY: '',
    ALL_PROXY: '',
    http_proxy: '',
    https_proxy: '',
    all_proxy: '',
    NO_PROXY: env.NO_PROXY || env.no_proxy || '',
    no_proxy: env.no_proxy || env.NO_PROXY || '',
  };
}

function clearPythonInstallMirrorEnv(env: Record<string, string | undefined>): Record<string, string | undefined> {
  return {
    ...env,
    UV_PYTHON_INSTALL_MIRROR: '',
  };
}

function hasConfiguredProxy(env: Record<string, string | undefined>): boolean {
  return Boolean(
    env.HTTP_PROXY
    || env.HTTPS_PROXY
    || env.ALL_PROXY
    || env.http_proxy
    || env.https_proxy
    || env.all_proxy
  );
}

function isProxyTunnelError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('tunnel error')
    || message.includes('failed to create underlying connection')
    || message.includes('tcp connect error')
    || message.includes('os error 10061')
    || message.includes('由于目标计算机积极拒绝，无法连接');
}

function shouldRepairWindowsPythonLinkError(error: unknown): boolean {
  if (process.platform !== 'win32') return false;
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('os error 4390')
    || message.includes('not a reparse point')
    || message.includes('此文件或目录不是一个重分析点');
}

function repairManagedPythonState(env: Record<string, string | undefined>): void {
  const pythonHome = env.UV_PYTHON_INSTALL_DIR;
  const cacheDir = env.UV_CACHE_DIR;
  if (!pythonHome && !cacheDir) {
    return;
  }

  for (const target of [pythonHome, cacheDir]) {
    if (!target) continue;
    try {
      rmSync(target, { recursive: true, force: true });
      logger.warn(`[python-setup] Removed corrupted managed uv state at ${target}`);
    } catch (error) {
      logger.warn(`[python-setup] Failed to remove managed uv state at ${target}:`, error);
    }
  }
}

/**
 * Use bundled uv to install a managed Python version (default 3.12).
 *
 * In portable mode, Python and cache are redirected to the USB drive so nothing
 * is written to the host computer.
 *
 * Tries with mirror env first (for CN region), then retries without mirror
 * if the first attempt fails, to rule out mirror-specific issues.
 */
export async function setupManagedPython(): Promise<void> {
  const bundledPython = getBundledPythonExecutable();
  if (bundledPython) {
    const ok = await verifyBundledPython(bundledPython);
    if (!ok) {
      throw new Error(`Bundled Python runtime is invalid: ${bundledPython}`);
    }
    logger.info(`Bundled Python runtime is ready: ${bundledPython}`);
    return;
  }

  const { bin: uvBin, source } = resolveUvBin();
  const uvEnv = await getUvMirrorEnv();
  const hasMirror = Object.keys(uvEnv).length > 0;
  const settings = await getAllSettings();
  const proxyEnv = await buildProxyEnvAsync(settings);

  // Fallback path for development or recovery builds that do not ship bundled
  // Python. Packaged Windows releases should return early above.
  const managedPythonHome = getManagedPythonHome();
  const managedUvCache = getManagedUvCacheDir();

  logger.info(
    `Setting up managed Python 3.12 ` +
    `(uv=${uvBin}, source=${source}, arch=${process.arch}, mirror=${hasMirror}` +
    `, proxy=${hasConfiguredProxy(proxyEnv) ? 'configured' : 'direct'}` +
    (managedPythonHome ? `, pythonHome=${managedPythonHome}` : '') +
    (managedUvCache ? `, cache=${managedUvCache}` : '') +
    `)`
  );

  const baseEnv: Record<string, string | undefined> = {
    ...process.env,
    ...proxyEnv,
    UV_NATIVE_TLS: 'true',
    UV_NO_PROGRESS: 'true',
  };
  if (managedPythonHome) baseEnv.UV_PYTHON_INSTALL_DIR = managedPythonHome;
  if (managedUvCache) baseEnv.UV_CACHE_DIR = managedUvCache;

  const officialEnv = clearPythonInstallMirrorEnv(baseEnv);
  const installRoutes = hasMirror
    ? [
        { label: 'mirror', env: { ...baseEnv, ...uvEnv } },
        { label: 'official-fallback', env: officialEnv },
      ]
    : [
        { label: 'official', env: officialEnv },
        { label: 'mirror-fallback', env: { ...baseEnv, ...UV_MIRROR_ENV } },
      ];

  let installError: unknown = null;
  for (const route of installRoutes) {
    try {
      await runPythonInstallWithRecovery(uvBin, route.env, route.label);
      installError = null;
      break;
    } catch (error) {
      installError = error;
      logger.warn(`Python install route failed [${route.label}], trying next route if available:`, error);
    }
  }

  if (installError) {
    logger.error('All Python install routes failed:', installError);
    throw installError;
  }

  // After installation, verify and log the Python path
  const verifyShell = needsWinShell(uvBin);
  const verifyEnv: Record<string, string | undefined> = {
    ...process.env,
    ...uvEnv,
    ...getManagedPythonEnv(),
  };
  try {
    const findPath = await new Promise<string>((resolve) => {
      const child = spawn(verifyShell ? quoteForCmd(uvBin) : uvBin, ['python', 'find', '3.12'], {
        shell: verifyShell,
        env: verifyEnv,
        windowsHide: true,
      });
      let output = '';
      child.stdout?.on('data', (data) => { output += data; });
      child.on('close', () => resolve(output.trim()));
    });

    if (findPath) {
      logger.info(`Managed Python 3.12 installed at: ${findPath}`);
    }
  } catch (err) {
    logger.warn('Could not determine Python path after install:', err);
  }
}
