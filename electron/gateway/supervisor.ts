import { app } from 'electron';
import { spawn, type ChildProcess } from 'node:child_process';
import path from 'path';
import { existsSync } from 'fs';
import WebSocket from 'ws';
import { getOpenClawDir, getOpenClawEntryPath, getPortableBase } from '../utils/paths';
import { getOpenClawCliSpawnConfig } from '../utils/openclaw-cli';
import { getUvMirrorEnv } from '../utils/uv-env';
import { isPythonReady, setupManagedPython } from '../utils/uv-setup';
import { logger } from '../utils/logger';

export function warmupManagedPythonReadiness(): void {
  void isPythonReady().then((pythonReady) => {
    if (!pythonReady) {
      logger.info('Python environment missing or incomplete, attempting background repair...');
      void setupManagedPython().catch((err) => {
        logger.error('Background Python repair failed:', err);
      });
    }
  }).catch((err) => {
    logger.error('Failed to check Python environment:', err);
  });
}

export async function terminateOwnedGatewayProcess(
  child: ChildProcess,
  gracefulTimeoutMs = 2000,
): Promise<void> {
  let exited = false;

  await new Promise<void>((resolve) => {
    child.once('exit', () => {
      exited = true;
      resolve();
    });

    const pid = child.pid;
    logger.info(`Sending kill to Gateway process (pid=${pid ?? 'unknown'})`);
    try {
      child.kill();
    } catch {
      // ignore if already exited
    }

    const timeout = setTimeout(() => {
      if (!exited) {
        logger.warn(`Gateway did not exit in time, force-killing (pid=${pid ?? 'unknown'})`);
        if (pid) {
          try {
            process.kill(pid, 'SIGKILL');
          } catch {
            // ignore
          }
        }
      }
      resolve();
    }, gracefulTimeoutMs);

    child.once('exit', () => {
      clearTimeout(timeout);
    });
  });
}

export async function unloadLaunchctlGatewayService(): Promise<void> {
  if (process.platform !== 'darwin') return;
  // Portable builds should not modify host LaunchAgents.
  if (getPortableBase()) return;

  try {
    const uid = process.getuid?.();
    if (uid === undefined) return;

    const launchdLabel = 'ai.openclaw.gateway';
    const serviceTarget = `gui/${uid}/${launchdLabel}`;
    const cp = await import('child_process');
    const fsPromises = await import('fs/promises');
    const os = await import('os');

    const loaded = await new Promise<boolean>((resolve) => {
      cp.exec(`launchctl print ${serviceTarget}`, { timeout: 5000 }, (err) => {
        resolve(!err);
      });
    });

    if (!loaded) return;

    logger.info(`Unloading launchctl service ${serviceTarget} to prevent auto-respawn`);
    await new Promise<void>((resolve) => {
      cp.exec(`launchctl bootout ${serviceTarget}`, { timeout: 10000 }, (err) => {
        if (err) {
          logger.warn(`Failed to bootout launchctl service: ${err.message}`);
        } else {
          logger.info('Successfully unloaded launchctl gateway service');
        }
        resolve();
      });
    });

    await new Promise((resolve) => setTimeout(resolve, 2000));

    try {
      const plistPath = path.join(os.homedir(), 'Library', 'LaunchAgents', `${launchdLabel}.plist`);
      await fsPromises.access(plistPath);
      await fsPromises.unlink(plistPath);
      logger.info(`Removed legacy launchd plist to prevent reload on next login: ${plistPath}`);
    } catch {
      // File doesn't exist or can't be removed -- not fatal
    }
  } catch (err) {
    logger.warn('Error while unloading launchctl gateway service:', err);
  }
}

export async function waitForPortFree(port: number, timeoutMs = 8000): Promise<void> {
  const net = await import('net');
  const start = Date.now();
  const pollInterval = 500;
  let logged = false;

  while (Date.now() - start < timeoutMs) {
    const available = await new Promise<boolean>((resolve) => {
      const server = net.createServer();
      server.once('error', () => resolve(false));
      server.once('listening', () => {
        server.close(() => resolve(true));
      });
      server.listen(port, '127.0.0.1');
    });

    if (available) {
      const elapsed = Date.now() - start;
      if (elapsed > pollInterval) {
        logger.info(`Port ${port} became available after ${elapsed}ms`);
      }
      return;
    }

    if (!logged) {
      logger.info(`Waiting for port ${port} to become available (Windows TCP TIME_WAIT)...`);
      logged = true;
    }
    await new Promise((resolve) => setTimeout(resolve, pollInterval));
  }

  logger.warn(`Port ${port} still occupied after ${timeoutMs}ms, proceeding anyway`);
}

async function getListeningProcessIds(port: number): Promise<string[]> {
  const cmd = process.platform === 'win32'
    ? `netstat -ano | findstr :${port}`
    : `lsof -i :${port} -sTCP:LISTEN -t`;

  const cp = await import('child_process');
  const { stdout } = await new Promise<{ stdout: string }>((resolve) => {
    cp.exec(cmd, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      if (err) {
        resolve({ stdout: '' });
      } else {
        resolve({ stdout });
      }
    });
  });

  if (!stdout.trim()) {
    return [];
  }

  if (process.platform === 'win32') {
    const pids: string[] = [];
    for (const line of stdout.trim().split(/\r?\n/)) {
      const parts = line.trim().split(/\s+/);
      if (parts.length >= 5 && parts[3] === 'LISTENING') {
        pids.push(parts[4]);
      }
    }
    return [...new Set(pids)];
  }

  return [...new Set(stdout.trim().split(/\r?\n/).map((value) => value.trim()).filter(Boolean))];
}

async function terminateOrphanedProcessIds(port: number, pids: string[]): Promise<void> {
  logger.info(`Found orphaned process listening on port ${port} (PIDs: ${pids.join(', ')}), attempting to kill...`);

  if (process.platform === 'darwin') {
    await unloadLaunchctlGatewayService();
  }

  for (const pid of pids) {
    try {
      if (process.platform === 'win32') {
        const cp = await import('child_process');
        await new Promise<void>((resolve) => {
          cp.exec(
            `taskkill /F /PID ${pid} /T`,
            { timeout: 5000, windowsHide: true },
            () => resolve(),
          );
        });
      } else {
        process.kill(parseInt(pid, 10), 'SIGTERM');
      }
    } catch {
      // Ignore processes that have already exited.
    }
  }

  await new Promise((resolve) => setTimeout(resolve, process.platform === 'win32' ? 2000 : 3000));

  if (process.platform !== 'win32') {
    for (const pid of pids) {
      try {
        process.kill(parseInt(pid, 10), 0);
        process.kill(parseInt(pid, 10), 'SIGKILL');
      } catch {
        // Already exited.
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
}

export async function findExistingGatewayProcess(options: {
  port: number;
  ownedPid?: number;
  /** When true, terminate any process occupying the port that is not owned by us. */
  terminateUnexpected?: boolean;
}): Promise<{ port: number; externalToken?: string } | null> {
  const { port, ownedPid, terminateUnexpected = true } = options;

  try {
    const probeExistingGateway = async (): Promise<{ port: number; externalToken?: string } | null> => {
      return await new Promise<{ port: number; externalToken?: string } | null>((resolve) => {
        const testWs = new WebSocket(`ws://localhost:${port}/ws`);
        const timeout = setTimeout(() => {
          try {
            testWs.close();
          } catch {
            // ignore
          }
          resolve(null);
        }, 500);

        testWs.on('message', (data) => {
          try {
            const message = JSON.parse(data.toString()) as { type?: string; event?: string };
            if (message.type === 'event' && message.event === 'connect.challenge') {
              clearTimeout(timeout);
              try {
                testWs.close();
              } catch {
                // ignore
              }
              resolve({ port });
            }
          } catch {
            // ignore malformed probe payloads
          }
        });

        testWs.on('error', () => {
          clearTimeout(timeout);
          resolve(null);
        });

        testWs.on('close', () => {
          clearTimeout(timeout);
          resolve(null);
        });
      });
    };

    try {
      const pids = await getListeningProcessIds(port);
      if (pids.length > 0) {
        // Probe with WebSocket first — if a real Gateway is running on this port,
        // return it immediately instead of terminating it.
        const existingGateway = await probeExistingGateway();
        if (existingGateway) {
          return existingGateway;
        }

        if (terminateUnexpected && (!ownedPid || !pids.includes(String(ownedPid)))) {
          await terminateOrphanedProcessIds(port, pids);
          return null;
        }
      }
    } catch (err) {
      logger.warn('Error checking for existing process on port:', err);
    }

    return await probeExistingGateway();
  } catch {
    return null;
  }
}

// ── Port Scanner ────────────────────────────────────────────────

export interface DetectedGateway {
  port: number;
  pids: number[];
}

/**
 * Probe a single port — returns true if an OpenClaw Gateway is listening.
 */
async function probeGateway(port: number): Promise<boolean> {
  return await new Promise<boolean>((resolve) => {
    const testWs = new WebSocket(`ws://localhost:${port}/ws`);
    const timeout = setTimeout(() => {
      try { testWs.close(); } catch { /* ignore */ }
      resolve(false);
    }, 500);

    testWs.on('message', (data) => {
      try {
        const message = JSON.parse(data.toString()) as { type?: string; event?: string };
        if (message.type === 'event' && message.event === 'connect.challenge') {
          clearTimeout(timeout);
          try { testWs.close(); } catch { /* ignore */ }
          resolve(true);
        }
      } catch { /* ignore malformed */ }
    });
    testWs.on('error', () => { clearTimeout(timeout); resolve(false); });
    testWs.on('close', () => { clearTimeout(timeout); resolve(false); });
  });
}

/**
 * Scan ports 18789–18799 for all OpenClaw Gateway instances.
 * Returns a list of detected gateways with their port and PIDs.
 * Does NOT kill anything — use killGatewayOnPort() for that.
 */
export async function scanGatewayPorts(): Promise<DetectedGateway[]> {
  const BASE_PORT = 18789;
  const MAX_PORT = 18799;
  const results: DetectedGateway[] = [];

  for (let port = BASE_PORT; port <= MAX_PORT; port++) {
    const pids = await getListeningProcessIds(port);
    if (pids.length === 0) continue;

    const isGateway = await probeGateway(port);
    if (!isGateway) continue;

    results.push({
      port,
      pids: [...new Set(pids.map((p) => parseInt(p, 10)))],
    });
  }

  return results;
}

/**
 * Kill all processes listening on a specific port.
 * After killing, resets the restart governor so the local ClawClaw instance
 * can cleanly restart its own gateway without suppression.
 */
export async function killGatewayOnPort(
  port: number,
  gatewayManager: import('./manager').GatewayManager,
): Promise<{ success: boolean; error?: string }> {
  try {
    const pids = await getListeningProcessIds(port);
    if (pids.length === 0) {
      return { success: false, error: `No process found on port ${port}` };
    }

    await terminateOrphanedProcessIds(port, pids);

    // Reset the restart governor so the local instance can restart without
    // being suppressed after killing an external gateway on the same port.
    gatewayManager.resetGovernor();

    return { success: true };
  } catch (error) {
    return { success: false, error: String(error) };
  }
}

export async function runOpenClawDoctorRepair(): Promise<boolean> {
  const openclawDir = getOpenClawDir();
  const entryScript = getOpenClawEntryPath();
  if (!existsSync(entryScript)) {
    logger.error(`Cannot run OpenClaw doctor repair: entry script not found at ${entryScript}`);
    return false;
  }

  const platform = process.platform;
  const arch = process.arch;
  const target = `${platform}-${arch}`;
  const binPath = app.isPackaged
    ? path.join(process.resourcesPath, 'bin')
    : path.join(process.cwd(), 'resources', 'bin', target);
  const binPathExists = existsSync(binPath);
  const finalPath = binPathExists
    ? `${binPath}${path.delimiter}${process.env.PATH || ''}`
    : process.env.PATH || '';

  const uvEnv = await getUvMirrorEnv();
  const doctorArgs = ['doctor', '--fix', '--yes', '--non-interactive'];
  logger.info(
    `Running OpenClaw doctor repair (entry="${entryScript}", args="${doctorArgs.join(' ')}", cwd="${openclawDir}", bundledBin=${binPathExists ? 'yes' : 'no'})`,
  );

  return await new Promise<boolean>((resolve) => {
    const forkEnv: Record<string, string | undefined> = {
      ...process.env,
      PATH: finalPath,
      ...uvEnv,
      OPENCLAW_NO_RESPAWN: '1',
    };

    const spawnConfig = getOpenClawCliSpawnConfig(doctorArgs);
    const child = spawn(spawnConfig.command, spawnConfig.args, {
      cwd: openclawDir || spawnConfig.cwd,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...spawnConfig.env,
        ...forkEnv,
      } as NodeJS.ProcessEnv,
      windowsHide: true,
    });

    let settled = false;
    const finish = (ok: boolean) => {
      if (settled) return;
      settled = true;
      resolve(ok);
    };

    const timeout = setTimeout(() => {
      logger.error('OpenClaw doctor repair timed out after 120000ms');
      try {
        child.kill();
      } catch {
        // ignore
      }
      finish(false);
    }, 120000);

    child.on('error', (err) => {
      clearTimeout(timeout);
      logger.error('Failed to spawn OpenClaw doctor repair process:', err);
      finish(false);
    });

    child.stdout?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        logger.debug(`[Gateway doctor stdout] ${normalized}`);
      }
    });

    child.stderr?.on('data', (data) => {
      const raw = data.toString();
      for (const line of raw.split(/\r?\n/)) {
        const normalized = line.trim();
        if (!normalized) continue;
        logger.warn(`[Gateway doctor stderr] ${normalized}`);
      }
    });

    child.on('exit', (code: number) => {
      clearTimeout(timeout);
      if (code === 0) {
        logger.info('OpenClaw doctor repair completed successfully');
        finish(true);
        return;
      }
      logger.warn(`OpenClaw doctor repair exited (code=${code})`);
      finish(false);
    });
  });
}
