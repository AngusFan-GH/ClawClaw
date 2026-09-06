import { mkdir, readFile, writeFile } from 'fs/promises';
import path from 'path';
import { getDataDir } from './paths';

export type DeviceAuthEntry = {
  token: string;
  role: string;
  scopes: string[];
  updatedAtMs: number;
};

type DeviceAuthStore = {
  version: 1;
  deviceId: string;
  tokens: Record<string, DeviceAuthEntry>;
};

function getStorePath(): string {
  return path.join(getDataDir(), 'clawclaw-device-auth.json');
}

function normalizeRole(role: string): string {
  return role.trim();
}

function normalizeScopes(scopes: string[] | undefined): string[] {
  if (!Array.isArray(scopes)) return [];
  const out = new Set<string>();
  for (const scope of scopes) {
    const trimmed = scope.trim();
    if (trimmed) out.add(trimmed);
  }
  if (out.has('operator.admin')) {
    out.add('operator.read');
    out.add('operator.write');
    out.add('operator.approvals');
    out.add('operator.pairing');
  } else if (out.has('operator.write')) {
    out.add('operator.read');
  }
  return [...out].sort();
}

async function readStore(): Promise<DeviceAuthStore | null> {
  try {
    const raw = await readFile(getStorePath(), 'utf8');
    const parsed = JSON.parse(raw) as DeviceAuthStore;
    if (!parsed || parsed.version !== 1 || typeof parsed.deviceId !== 'string' || !parsed.tokens || typeof parsed.tokens !== 'object') {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

async function writeStore(store: DeviceAuthStore): Promise<void> {
  const filePath = getStorePath();
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
}

export async function loadDeviceAuthToken(params: {
  deviceId: string;
  role: string;
}): Promise<DeviceAuthEntry | null> {
  const store = await readStore();
  if (!store || store.deviceId !== params.deviceId) {
    return null;
  }
  const role = normalizeRole(params.role);
  const entry = store.tokens[role];
  if (!entry || typeof entry.token !== 'string') {
    return null;
  }
  return entry;
}

export async function storeDeviceAuthToken(params: {
  deviceId: string;
  role: string;
  token: string;
  scopes?: string[];
}): Promise<DeviceAuthEntry> {
  const role = normalizeRole(params.role);
  const existing = await readStore();
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: params.deviceId,
    tokens:
      existing && existing.deviceId === params.deviceId && existing.tokens
        ? { ...existing.tokens }
        : {},
  };
  const entry: DeviceAuthEntry = {
    token: params.token,
    role,
    scopes: normalizeScopes(params.scopes),
    updatedAtMs: Date.now(),
  };
  next.tokens[role] = entry;
  await writeStore(next);
  return entry;
}

export async function clearDeviceAuthToken(params: {
  deviceId: string;
  role: string;
}): Promise<void> {
  const store = await readStore();
  if (!store || store.deviceId !== params.deviceId) {
    return;
  }
  const role = normalizeRole(params.role);
  if (!store.tokens[role]) {
    return;
  }
  const next: DeviceAuthStore = {
    version: 1,
    deviceId: store.deviceId,
    tokens: { ...store.tokens },
  };
  delete next.tokens[role];
  await writeStore(next);
}
