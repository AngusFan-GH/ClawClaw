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
      expect(hasIncompatibleManagedPluginSdkImports(rootDir)).toBe(false);

      await expect(readFile(filePath, 'utf8')).resolves.toContain(
        'import { resolvePreferredOpenClawTmpDir } from "openclaw/plugin-sdk/temp-path";',
      );
      await expect(readFile(filePath, 'utf8')).resolves.toContain(
        'import { normalizeAccountId } from "openclaw/plugin-sdk";',
      );
    } finally {
      await rm(rootDir, { recursive: true, force: true });
    }
  });
});
