import { mkdir, readFile, writeFile, rm } from 'fs/promises';
import { join } from 'path';
import { describe, expect, it } from 'vitest';
import {
  hasIncompatibleManagedPluginSdkImports,
  repairManagedPluginSdkImports,
} from '@electron/utils/plugin-sdk-compat';

describe('managed plugin sdk compatibility repair', () => {
  it('rewrites moved root plugin-sdk exports onto scoped subpaths', async () => {
    const rootDir = `/tmp/clawclaw-plugin-sdk-compat-${Math.random().toString(36).slice(2)}`;
    try {
      await mkdir(join(rootDir, 'src'), { recursive: true });
      const filePath = join(rootDir, 'src', 'channel.ts');
      await writeFile(
        filePath,
        [
          'import { normalizeAccountId, resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk";',
          'const value = resolvePreferredOpenClawTmpDir();',
          'export { value, normalizeAccountId };',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(hasIncompatibleManagedPluginSdkImports(rootDir)).toBe(true);
      expect(repairManagedPluginSdkImports(rootDir)).toEqual({
        repaired: true,
        changedFiles: [filePath],
      });
      // After rewriting to infra-runtime subpath, the file is now compatible.
      expect(hasIncompatibleManagedPluginSdkImports(rootDir)).toBe(false);

      await expect(readFile(filePath, 'utf8')).resolves.toContain(
        'import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/infra-runtime";',
      );
      await expect(readFile(filePath, 'utf8')).resolves.toContain(
        'import { normalizeAccountId } from "openclaw/plugin-sdk";',
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('rewrites moved compat plugin-sdk exports onto scoped subpaths', async () => {
    const rootDir = `/tmp/clawclaw-plugin-sdk-compat-${Math.random().toString(36).slice(2)}`;
    try {
      await mkdir(join(rootDir, 'src'), { recursive: true });
      const filePath = join(rootDir, 'src', 'channel.ts');
      await writeFile(
        filePath,
        [
          'import { normalizeAccountId, resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/compat";',
          'const value = resolvePreferredOpenClawTmpDir();',
          'export { value, normalizeAccountId };',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(hasIncompatibleManagedPluginSdkImports(rootDir)).toBe(true);
      expect(repairManagedPluginSdkImports(rootDir)).toEqual({
        repaired: true,
        changedFiles: [filePath],
      });
      expect(hasIncompatibleManagedPluginSdkImports(rootDir)).toBe(true);

      await expect(readFile(filePath, 'utf8')).resolves.toContain(
        'import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/infra-runtime";',
      );
      await expect(readFile(filePath, 'utf8')).resolves.toContain(
        'import { normalizeAccountId } from "openclaw/plugin-sdk/compat";',
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });

  it('flags namespace imports that still reach for moved root exports', async () => {
    const rootDir = `/tmp/clawclaw-plugin-sdk-compat-${Math.random().toString(36).slice(2)}`;
    try {
      await mkdir(join(rootDir, 'src'), { recursive: true });
      const filePath = join(rootDir, 'src', 'channel.ts');
      await writeFile(
        filePath,
        [
          'import * as pluginSdk from "openclaw/plugin-sdk";',
          'const value = pluginSdk.resolvePreferredOpenClawTmpDir();',
          'export { value };',
          '',
        ].join('\n'),
        'utf8',
      );

      expect(hasIncompatibleManagedPluginSdkImports(rootDir)).toBe(true);
      expect(repairManagedPluginSdkImports(rootDir)).toEqual({
        repaired: false,
        changedFiles: [],
      });
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
