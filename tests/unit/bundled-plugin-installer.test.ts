import { mkdir, readFile, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { testHome, testAppPath } = vi.hoisted(() => {
  const suffix = Math.random().toString(36).slice(2);
  return {
    testHome: `/tmp/clawclaw-plugin-installer-home-${suffix}`,
    testAppPath: `/tmp/clawclaw-plugin-installer-app-${suffix}`,
  };
});

vi.mock('node:os', () => {
  const mocked = { homedir: () => testHome };
  return { ...mocked, default: mocked };
});

vi.mock('electron', () => ({
  app: {
    isPackaged: false,
    getAppPath: () => testAppPath,
  },
}));

async function writePlugin(dir: string, pluginId: string, version: string, options?: { withNodeModules?: boolean }) {
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'openclaw.plugin.json'), JSON.stringify({ id: pluginId, name: pluginId }, null, 2), 'utf8');
  await writeFile(join(dir, 'package.json'), JSON.stringify({ name: pluginId, version }, null, 2), 'utf8');
  await writeFile(join(dir, 'index.js'), 'module.exports = {};', 'utf8');
  if (options?.withNodeModules) {
    await mkdir(join(dir, 'node_modules', 'dep'), { recursive: true });
    await writeFile(join(dir, 'node_modules', 'dep', 'package.json'), JSON.stringify({ name: 'dep', version: '1.0.0' }, null, 2), 'utf8');
  }
}

describe('ensureBundledPluginInstalled', () => {
  beforeEach(async () => {
    vi.resetModules();
    await rm(testHome, { recursive: true, force: true });
    await rm(testAppPath, { recursive: true, force: true });
    await rm(join(process.cwd(), 'build', 'openclaw-plugins', 'test-plugin-runtime-deps'), { recursive: true, force: true });
    await rm(join(process.cwd(), 'build', 'openclaw-plugins', 'test-plugin-manifest-id'), { recursive: true, force: true });
  });

  it('reinstalls a plugin mirror when target version matches but runtime deps are missing', async () => {
    const pluginId = 'test-plugin-runtime-deps';
    const sourceDir = join(process.cwd(), 'build', 'openclaw-plugins', pluginId);
    const targetDir = join(testHome, '.openclaw', 'extensions', pluginId);
    await writePlugin(sourceDir, pluginId, '1.2.3', { withNodeModules: true });
    await writePlugin(targetDir, pluginId, '1.2.3');

    const { ensureBundledPluginInstalled } = await import('@electron/utils/bundled-plugin-installer');
    const result = ensureBundledPluginInstalled(pluginId, 'Test Plugin');

    expect(result.installed).toBe(true);
    const targetDepPkg = await readFile(join(targetDir, 'node_modules', 'dep', 'package.json'), 'utf8');
    expect(JSON.parse(targetDepPkg)).toMatchObject({ name: 'dep', version: '1.0.0' });
  });

  it('reinstalls a plugin mirror when target manifest id is invalid', async () => {
    const pluginId = 'test-plugin-manifest-id';
    const sourceDir = join(process.cwd(), 'build', 'openclaw-plugins', pluginId);
    const targetDir = join(testHome, '.openclaw', 'extensions', pluginId);
    await writePlugin(sourceDir, pluginId, '1.0.0', { withNodeModules: true });
    await writePlugin(targetDir, 'wrong-plugin-id', '1.0.0', { withNodeModules: true });

    const { ensureBundledPluginInstalled } = await import('@electron/utils/bundled-plugin-installer');
    const result = ensureBundledPluginInstalled(pluginId, 'Test Plugin');

    expect(result.installed).toBe(true);
    const manifest = await readFile(join(targetDir, 'openclaw.plugin.json'), 'utf8');
    expect(JSON.parse(manifest)).toMatchObject({ id: pluginId });
  });
});
