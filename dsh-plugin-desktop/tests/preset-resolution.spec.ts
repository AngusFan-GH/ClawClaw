import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import { fileURLToPath } from 'node:url'
import { expect, it } from 'vitest'

it('checks preset dependencies through the real Desktop resolver without importing plugins', () => {
  const require = createRequire(import.meta.url)
  const script = `
    import assert from 'node:assert/strict';
    import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { dirname, join } from 'node:path';
    import { createRequire } from 'node:module';
    import { pathToFileURL } from 'node:url';
    const { loadOverlayPatches } = await import(pathToFileURL(process.argv[1]).href);
    const root = mkdtempSync(join(tmpdir(), 'desktop-preset-resolution-'));
    let release;
    try {
      const profile = join(root, 'profile');
      mkdirSync(profile);
      writeFileSync(join(profile, 'package.json'), '{"type":"module"}');
      const base = pathToFileURL(profile + '/').href;
      const localRequire = createRequire(base);
      const { installProfilePackageResolver } = await import(pathToFileURL(process.argv[2]).href);
      release = installProfilePackageResolver(pathToFileURL(join(profile, 'package.json')).href);
      assert.ok(localRequire.resolve('@deepseek-ai/dsh-persona'));
      assert.ok(localRequire.resolve('@deepseek-ai/dsh-tool-subagent-control/list-agents'));
      assert.throws(() => localRequire.resolve('@desktop-regression/nonexistent'));
      assert.throws(() => localRequire.resolve('@deepseek-ai/dsh-persona/nonexistent-export'));
      const presets = join(dirname(process.argv[3]), 'presets');
      const patches = ['standard', 'ptc', 'minimal', 'cordis'].flatMap(id => loadOverlayPatches('spec', join(presets, id + '.patch.yml')));
      const names = [];
      const collect = rows => rows.forEach(row => {
        if (typeof row?.name === 'string' && !row.name.startsWith('cordis:')) names.push(row.name);
        if (row?.group === true && Array.isArray(row.config)) collect(row.config);
        if (Array.isArray(row?.insert)) collect(row.insert);
      });
      collect(patches);
      for (const name of names) assert.ok(localRequire.resolve(name), name);
      // Profile plugins are visible, but discovery must not evaluate their code.
      const override = join(profile, 'node_modules', '@desktop-regression', 'probe');
      mkdirSync(override, { recursive: true });
      writeFileSync(join(override, 'package.json'), '{"name":"@desktop-regression/probe","type":"module","exports":"./index.js"}');
      writeFileSync(join(override, 'index.js'), 'throw new Error("discovery evaluated plugin")');
      assert.ok(localRequire.resolve('@desktop-regression/probe'));
      release();
      release = undefined;
      console.log('preset resolution passed');
    } finally {
      release?.();
      rmSync(root, { recursive: true, force: true });
    }
  `
  const output = execFileSync(process.execPath, [
    '--input-type=module', '-e', script,
    require.resolve('@deepseek-ai/dsh-app-boot'),
    fileURLToPath(new URL('../src/module-resolution.ts', import.meta.url)),
    require.resolve('@deepseek-ai/dsh-web-app/package.json'),
  ], { encoding: 'utf8', timeout: 30_000 })
  expect(output).toContain('preset resolution passed')
})
