import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';
import JSON5 from 'json5';

const OPENCLAW_CONFIG_PATH = join(homedir(), '.openclaw', 'openclaw.json');

let configWriteChain: Promise<unknown> = Promise.resolve();

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
  await ensureConfigDir();
  await writeFile(OPENCLAW_CONFIG_PATH, `${JSON.stringify(config, null, 2)}\n`, 'utf-8');
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
