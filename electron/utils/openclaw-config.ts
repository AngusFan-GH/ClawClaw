import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { constants } from 'fs';
import { homedir } from 'os';
import { dirname, join } from 'path';

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

export async function readOpenClawConfigRecord<T extends Record<string, unknown> = Record<string, unknown>>(): Promise<T> {
  await configWriteChain.catch(() => undefined);

  if (!(await fileExists(OPENCLAW_CONFIG_PATH))) {
    return {} as T;
  }

  try {
    const raw = await readFile(OPENCLAW_CONFIG_PATH, 'utf-8');
    return JSON.parse(raw) as T;
  } catch {
    return {} as T;
  }
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
    const config = await readOpenClawConfigRecord();
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
