import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdir, writeFile, rm } from 'node:fs/promises';

const testHome = vi.hoisted(() => `/tmp/clawclaw-export-home-${Math.random().toString(36).slice(2)}`);
const testUserData = vi.hoisted(() => `/tmp/clawclaw-export-user-data-${Math.random().toString(36).slice(2)}`);
const testPortableBase = vi.hoisted(() => `/tmp/clawclaw-export-portable-${Math.random().toString(36).slice(2)}`);

const mockElectronApp = vi.hoisted(() => ({
  isPackaged: false,
  getPath: () => testUserData,
  getAppPath: () => process.cwd(),
}));

vi.mock('electron', () => ({
  app: mockElectronApp,
}));

vi.mock('os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('node:os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

describe('portable export paths', () => {
  beforeEach(() => {
    vi.resetModules();
    mockElectronApp.isPackaged = false;
    mockElectronApp.getAppPath = () => process.cwd();
  });

  it('defaults general exports to ~/Downloads outside portable mode', async () => {
    const { getDefaultExportDir } = await import('@electron/utils/paths');

    expect(getDefaultExportDir()).toBe(`${testHome}/Downloads`);
    expect(getDefaultExportDir('images')).toBe(`${testHome}/Downloads`);
    expect(getDefaultExportDir('settings')).toBe(`${testHome}/Downloads`);
  });

  it('defaults exports to categorized portable directories in portable mode', async () => {
    mockElectronApp.isPackaged = true;
    mockElectronApp.getAppPath = () => `${testPortableBase}/resources/app.asar`;

    await mkdir(testPortableBase, { recursive: true });
    await writeFile(`${testPortableBase}/.portable`, '', 'utf8');

    const { getDefaultExportDir } = await import('@electron/utils/paths');
    expect(getDefaultExportDir()).toBe(`${testPortableBase}/portable/exports/general`);
    expect(getDefaultExportDir('images')).toBe(`${testPortableBase}/portable/exports/images`);
    expect(getDefaultExportDir('settings')).toBe(`${testPortableBase}/portable/exports/settings`);
    await rm(testPortableBase, { recursive: true, force: true });
  });
});
