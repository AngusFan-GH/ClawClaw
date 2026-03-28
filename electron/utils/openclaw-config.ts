import { access, mkdir, readFile, rename, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { randomBytes } from 'crypto';
import { homedir } from 'os';
import { dirname, join } from 'path';
import JSON5 from 'json5';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

let configWriteChain: Promise<unknown> = Promise.resolve();

export interface MalformedOpenClawConfigRecoveryResult {
  outcome: 'none' | 'repaired' | 'reset';
  backupPath: string | null;
  strategy?: 'normalize' | 'trim-root-object' | 'reset';
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path, constants.F_OK);
    return true;
  } catch {
    return false;
  }
}

async function ensureConfigDir(): Promise<void> {
  await mkdir(dirname(OPENCLAW_CONFIG_PATH), { recursive: true });
}

function parseConfigCandidate(raw: string): Record<string, unknown> | null {
  try {
    const parsed = JSON5.parse(raw);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

function normalizeMalformedConfigText(raw: string): string {
  return raw
    .replace(/^\uFEFF/, '')
    .replace(/\0/g, '')
    .replace(/^\s*;+\s*$/gm, '');
}

function trimToRootObject(raw: string): string {
  const firstBrace = raw.indexOf('{');
  const lastBrace = raw.lastIndexOf('}');
  if (firstBrace === -1 || lastBrace === -1 || firstBrace >= lastBrace) {
    return raw;
  }
  return raw.slice(firstBrace, lastBrace + 1);
}

async function backupMalformedOpenClawConfig(suffix: 'repaired' | 'broken'): Promise<string> {
  const backupPath = `${OPENCLAW_CONFIG_PATH}.${suffix}-${Date.now()}.bak`;
  await rename(OPENCLAW_CONFIG_PATH, backupPath);
  return backupPath;
}

export function sanitizeKnownInvalidOpenClawKeys(config: Record<string, unknown>): boolean {
  let modified = false;

  const acp = config.acp;
  if (acp && typeof acp === 'object' && !Array.isArray(acp)) {
    const acpObj = acp as Record<string, unknown>;
    if ('mcpServers' in acpObj) {
      delete acpObj.mcpServers;
      modified = true;
    }
  }

  const skills = config.skills;
  if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
    const skillsObj = skills as Record<string, unknown>;
    for (const key of ['enabled', 'disabled']) {
      if (key in skillsObj) {
        delete skillsObj[key];
        modified = true;
      }
    }
  }

  return modified;
}

async function readOpenClawConfigRecordRaw<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> {
  if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
    return {} as T;
  }

  const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON5.parse(raw);
  } catch (error) {
    throw new Error(`Failed to parse OpenClaw config at ${OPENCLAW_CONFIG_PATH}: ${String(error)}`, {
      cause: error,
    });
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error(`Invalid OpenClaw config root at ${OPENCLAW_CONFIG_PATH}: expected an object`);
  }

  return parsed as T;
}

export async function readOpenClawConfigRecord<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> {
  await configWriteChain.catch(() => undefined);
  return readOpenClawConfigRecordRaw<T>();
}

export async function writeOpenClawConfigRecord(config: Record<string, unknown>): Promise<void> {
  sanitizeKnownInvalidOpenClawKeys(config);
  const nextContent = `${JSON.stringify(config, null, 2)}\n`;
  let lastError: unknown;

  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      await ensureConfigDir();
      const tempPath = `${OPENCLAW_CONFIG_PATH}.tmp-${process.pid}-${Date.now()}-${randomBytes(4).toString('hex')}`;
      await writeFile(tempPath, nextContent, 'utf-8');
      await rename(tempPath, OPENCLAW_CONFIG_PATH);
      return;
    } catch (error) {
      lastError = error;
      const code = (error as NodeJS.ErrnoException | undefined)?.code;
      if (code !== 'ENOENT' && code !== 'EPERM' && code !== 'EBUSY') {
        throw error;
      }
      await new Promise((resolve) => setTimeout(resolve, 25 * (attempt + 1)));
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

export async function resetMalformedOpenClawConfig(): Promise<string | null> {
  if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
    await writeOpenClawConfigRecord({});
    return null;
  }

  const backupPath = await backupMalformedOpenClawConfig('broken');
  await writeOpenClawConfigRecord({});
  return backupPath;
}

export async function recoverMalformedOpenClawConfig(): Promise<MalformedOpenClawConfigRecoveryResult> {
  if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
    return { outcome: 'none', backupPath: null };
  }

  const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
  const normalized = normalizeMalformedConfigText(raw);
  const candidates: Array<{ content: string; strategy: 'normalize' | 'trim-root-object' }> = [];

  if (normalized !== raw) {
    candidates.push({ content: normalized, strategy: 'normalize' });
  }

  const trimmed = trimToRootObject(normalized);
  if (trimmed !== raw && trimmed !== normalized) {
    candidates.push({ content: trimmed, strategy: 'trim-root-object' });
  }

  for (const candidate of candidates) {
    const parsed = parseConfigCandidate(candidate.content);
    if (!parsed) continue;

    const backupPath = await backupMalformedOpenClawConfig('repaired');
    await writeOpenClawConfigRecord(parsed);
    return {
      outcome: 'repaired',
      backupPath,
      strategy: candidate.strategy,
    };
  }

  const backupPath = await resetMalformedOpenClawConfig();
  return {
    outcome: 'reset',
    backupPath,
    strategy: 'reset',
  };
}

export async function updateOpenClawConfigRecord<T>(
  updater: (config: Record<string, unknown>) => Promise<T> | T,
): Promise<T> {
  const run = async (): Promise<T> => {
    // Read the file directly inside the serialized writer to avoid waiting on
    // the very promise chain entry we are currently executing.
    const config = await readOpenClawConfigRecordRaw();
    const result = await updater(config);
    await writeOpenClawConfigRecord(config);
    return result;
  };

  const pending = configWriteChain.catch(() => undefined);
  const next = pending.then(run);
  configWriteChain = next.then(() => undefined, () => undefined);
  return await next;
}

export { OPENCLAW_CONFIG_PATH };
