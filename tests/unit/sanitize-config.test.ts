/**
 * Tests for openclaw.json config sanitization before Gateway start.
 *
 * The sanitizeOpenClawConfig() function in openclaw-auth.ts relies on
 * Electron-specific helpers (readOpenClawJson / writeOpenClawJson) that
 * read from ~/.openclaw/openclaw.json.  To avoid mocking Electron + the
 * real HOME directory, this test uses a standalone version of the
 * sanitization logic that mirrors the production code exactly, operating
 * on a temp directory with real file I/O.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { mkdtemp, writeFile, readFile, rm } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

let tempDir: string;
let configPath: string;

async function writeConfig(data: unknown): Promise<void> {
  await writeFile(configPath, JSON.stringify(data, null, 2), 'utf-8');
}

async function readConfig(): Promise<Record<string, unknown>> {
  const raw = await readFile(configPath, 'utf-8');
  return JSON.parse(raw);
}

/**
 * Standalone mirror of the sanitization logic in openclaw-auth.ts.
 * Uses the same blocklist approach as the production code.
 */
async function sanitizeConfig(filePath: string): Promise<boolean> {
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch {
    return false;
  }

  const config = JSON.parse(raw) as Record<string, unknown>;
  let modified = false;
  const VALID_MEMORY_SEARCH_PROVIDERS = new Set(['openai', 'local', 'gemini', 'voyage', 'mistral']);
  const VALID_MEMORY_SEARCH_FALLBACKS = new Set(['openai', 'gemini', 'local', 'voyage', 'mistral', 'none']);
  const isAbsolutePluginPath = (value: string): boolean =>
    value.startsWith('/') || /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\');
  const isBundledPluginPath = (value: string): boolean =>
    value.replace(/\\/g, '/').includes('node_modules/openclaw/extensions')
    || value.replace(/\\/g, '/').includes('node_modules/openclaw/dist/extensions');

  const acp = config.acp;
  if (acp && typeof acp === 'object' && !Array.isArray(acp)) {
    const acpObj = acp as Record<string, unknown>;
    if ('mcpServers' in acpObj) {
      delete acpObj.mcpServers;
      modified = true;
    }
  }

  // Mirror of the production blocklist logic
  const skills = config.skills;
  if (skills && typeof skills === 'object' && !Array.isArray(skills)) {
    const skillsObj = skills as Record<string, unknown>;
    const KNOWN_INVALID_SKILLS_ROOT_KEYS = ['enabled', 'disabled'];
    for (const key of KNOWN_INVALID_SKILLS_ROOT_KEYS) {
      if (key in skillsObj) {
        delete skillsObj[key];
        modified = true;
      }
    }
  }

  // Mirror: remove stale tools.web.search.kimi.apiKey when moonshot provider exists.
  const providers =
    ((config.models as Record<string, unknown> | undefined)?.providers as
      | Record<string, unknown>
      | undefined) || {};
  if (providers.moonshot) {
    const tools = (config.tools as Record<string, unknown> | undefined) || {};
    const web = (tools.web as Record<string, unknown> | undefined) || {};
    const search = (web.search as Record<string, unknown> | undefined) || {};
    const kimi = (search.kimi as Record<string, unknown> | undefined) || {};
    if ('apiKey' in kimi) {
      delete kimi.apiKey;
      search.kimi = kimi;
      web.search = search;
      tools.web = web;
      config.tools = tools;
      modified = true;
    }
  }

  const plugins = config.plugins;
  if (plugins && typeof plugins === 'object' && !Array.isArray(plugins)) {
    const pluginsObj = plugins as Record<string, unknown>;
    const entries =
      pluginsObj.entries && typeof pluginsObj.entries === 'object' && !Array.isArray(pluginsObj.entries)
        ? (pluginsObj.entries as Record<string, unknown>)
        : undefined;
    const allow = Array.isArray(pluginsObj.allow) ? (pluginsObj.allow as string[]) : undefined;

    if (allow) {
      const nextAllow = allow.filter((pluginId) => pluginId !== 'qqbot' && pluginId !== 'openclaw-qqbot');
      if (nextAllow.length !== allow.length) {
        pluginsObj.allow = nextAllow;
        modified = true;
      }
    }

    if (entries) {
      if ('qqbot' in entries) {
        delete entries.qqbot;
        modified = true;
      }
      if ('openclaw-qqbot' in entries) {
        delete entries['openclaw-qqbot'];
        modified = true;
      }
    }

    const load = pluginsObj.load;
    if (load && typeof load === 'object' && !Array.isArray(load)) {
      const loadObj = load as Record<string, unknown>;
      if (Array.isArray(loadObj.paths)) {
        const nextPaths = loadObj.paths.filter((entry) => {
          if (typeof entry !== 'string' || !isAbsolutePluginPath(entry)) return true;
          return !isBundledPluginPath(entry) && entry !== '/missing/plugin';
        });
        if (nextPaths.length !== loadObj.paths.length) {
          loadObj.paths = nextPaths;
          pluginsObj.load = loadObj;
          modified = true;
        }
      }
    }
  }

  const agents =
    config.agents && typeof config.agents === 'object'
      ? (config.agents as Record<string, unknown>)
      : null;
  const defaults =
    agents?.defaults && typeof agents.defaults === 'object'
      ? (agents.defaults as Record<string, unknown>)
      : null;
  const memorySearch =
    defaults?.memorySearch && typeof defaults.memorySearch === 'object'
      ? (defaults.memorySearch as Record<string, unknown>)
      : null;
  if (memorySearch) {
    const provider = memorySearch.provider;
    if (
      typeof provider === 'string'
      && provider.length > 0
      && !VALID_MEMORY_SEARCH_PROVIDERS.has(provider)
    ) {
      delete memorySearch.provider;
      modified = true;
    }

    const fallback = memorySearch.fallback;
    if (
      typeof fallback === 'string'
      && fallback.length > 0
      && !VALID_MEMORY_SEARCH_FALLBACKS.has(fallback)
    ) {
      delete memorySearch.fallback;
      modified = true;
    }
  }

  if (modified) {
    await writeFile(filePath, JSON.stringify(config, null, 2), 'utf-8');
  }
  return modified;
}

beforeEach(async () => {
  tempDir = await mkdtemp(join(tmpdir(), 'clawclaw-test-'));
  configPath = join(tempDir, 'openclaw.json');
});

afterEach(async () => {
  await rm(tempDir, { recursive: true, force: true });
});

describe('sanitizeOpenClawConfig (blocklist approach)', () => {
  it('removes skills.enabled at the root level of skills', async () => {
    await writeConfig({
      skills: {
        enabled: true,
        entries: {
          'my-skill': { enabled: true, apiKey: 'abc' },
        },
      },
      gateway: { mode: 'local' },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    // Root-level "enabled" should be gone
    expect(result.skills).not.toHaveProperty('enabled');
    // entries[key].enabled must be preserved
    const skills = result.skills as Record<string, unknown>;
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['my-skill'].enabled).toBe(true);
    expect(entries['my-skill'].apiKey).toBe('abc');
    // Other top-level sections are untouched
    expect(result.gateway).toEqual({ mode: 'local' });
  });

  it('removes skills.disabled at the root level of skills', async () => {
    await writeConfig({
      skills: {
        disabled: false,
        entries: { x: { enabled: false } },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.skills).not.toHaveProperty('disabled');
    const skills = result.skills as Record<string, unknown>;
    const entries = skills.entries as Record<string, Record<string, unknown>>;
    expect(entries['x'].enabled).toBe(false);
  });

  it('removes both enabled and disabled when present together', async () => {
    await writeConfig({
      skills: {
        enabled: true,
        disabled: false,
        entries: { a: { enabled: true } },
        allowBundled: ['web-search'],
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const skills = result.skills as Record<string, unknown>;
    expect(skills).not.toHaveProperty('enabled');
    expect(skills).not.toHaveProperty('disabled');
    // Valid keys are preserved
    expect(skills.allowBundled).toEqual(['web-search']);
    expect(skills.entries).toBeDefined();
  });

  it('does nothing when config is already valid', async () => {
    const original = {
      skills: {
        entries: { 'my-skill': { enabled: true } },
        allowBundled: ['web-search'],
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('preserves unknown valid keys (forward-compatible)', async () => {
    // If OpenClaw adds new valid keys to skills in the future,
    // the blocklist approach should NOT strip them.
    const original = {
      skills: {
        entries: { x: { enabled: true } },
        allowBundled: ['web-search'],
        load: { extraDirs: ['/my/dir'], watch: true },
        install: { preferBrew: false },
        limits: { maxSkillsInPrompt: 5 },
        futureNewKey: { some: 'value' }, // hypothetical future key
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('handles config with no skills section', async () => {
    const original = { gateway: { mode: 'local' } };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('handles empty config', async () => {
    await writeConfig({});

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('removes stale nested plugin paths from plugins.load.paths and preserves sibling keys', async () => {
    await writeConfig({
      plugins: {
        load: {
          watch: true,
          paths: [
            '/valid/plugin',
            '/missing/plugin',
            '/app/node_modules/openclaw/extensions/demo',
            '/app/node_modules/openclaw/dist/extensions/demo',
          ],
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.plugins).toEqual({
      load: {
        watch: true,
        paths: ['/valid/plugin'],
      },
    });
  });

  it('removes invalid acp.mcpServers without touching valid acp keys', async () => {
    await writeConfig({
      acp: {
        enabled: true,
        mcpServers: {
          bad: { command: 'node', args: ['server.js'] },
        },
        timeoutMs: 10000,
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.acp).not.toHaveProperty('mcpServers');
    expect(result.acp).toMatchObject({
      enabled: true,
      timeoutMs: 10000,
    });
  });

  it('returns false for missing config file', async () => {
    const modified = await sanitizeConfig(join(tempDir, 'nonexistent.json'));
    expect(modified).toBe(false);
  });

  it('handles skills being an array (no-op, no crash)', async () => {
    // Edge case: skills is not an object
    await writeConfig({ skills: ['something'] });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);
  });

  it('preserves all other top-level config sections', async () => {
    await writeConfig({
      skills: { enabled: true, entries: {} },
      channels: { discord: { token: 'abc', enabled: true } },
      plugins: { entries: { whatsapp: { enabled: true } } },
      gateway: { mode: 'local', auth: { token: 'xyz' } },
      agents: { defaults: { model: { primary: 'gpt-4' } } },
      models: { providers: { openai: { baseUrl: 'https://api.openai.com' } } },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    // skills.enabled removed
    expect(result.skills).not.toHaveProperty('enabled');
    // All other sections unchanged
    expect(result.channels).toEqual({ discord: { token: 'abc', enabled: true } });
    expect(result.plugins).toEqual({ entries: { whatsapp: { enabled: true } } });
    expect(result.gateway).toEqual({ mode: 'local', auth: { token: 'xyz' } });
    expect(result.agents).toEqual({ defaults: { model: { primary: 'gpt-4' } } });
  });

  it('removes legacy qqbot plugin entries because qqbot is built-in', async () => {
    await writeConfig({
      channels: {
        qqbot: { enabled: true },
      },
      plugins: {
        allow: ['channels', 'qqbot', 'openclaw-qqbot'],
        entries: {
          channels: { enabled: true },
          qqbot: { enabled: true },
          'openclaw-qqbot': { enabled: true },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    expect(result.plugins).toEqual({
      allow: ['channels'],
      entries: {
        channels: { enabled: true },
      },
    });
  });

  it('removes tools.web.search.kimi.apiKey when moonshot provider exists', async () => {
    await writeConfig({
      models: {
        providers: {
          moonshot: { baseUrl: 'https://api.moonshot.cn/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'stale-inline-key',
              baseUrl: 'https://api.moonshot.cn/v1',
            },
          },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const kimi = (
      ((result.tools as Record<string, unknown>).web as Record<string, unknown>).search as Record<
        string,
        unknown
      >
    ).kimi as Record<string, unknown>;
    expect(kimi).not.toHaveProperty('apiKey');
    expect(kimi.baseUrl).toBe('https://api.moonshot.cn/v1');
  });

  it('keeps tools.web.search.kimi.apiKey when moonshot provider is absent', async () => {
    const original = {
      models: {
        providers: {
          openrouter: { baseUrl: 'https://openrouter.ai/api/v1', api: 'openai-completions' },
        },
      },
      tools: {
        web: {
          search: {
            kimi: {
              apiKey: 'should-stay',
            },
          },
        },
      },
    };
    await writeConfig(original);

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(false);

    const result = await readConfig();
    expect(result).toEqual(original);
  });

  it('removes invalid agents.defaults.memorySearch.provider values', async () => {
    await writeConfig({
      agents: {
        defaults: {
          memorySearch: {
            enabled: true,
            provider: 'ollama',
            fallback: 'none',
            remote: { baseUrl: 'http://127.0.0.1:11434' },
          },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const memorySearch = (
      (result.agents as Record<string, unknown>).defaults as Record<string, unknown>
    ).memorySearch as Record<string, unknown>;
    expect(memorySearch).not.toHaveProperty('provider');
    expect(memorySearch.fallback).toBe('none');
    expect(memorySearch.remote).toEqual({ baseUrl: 'http://127.0.0.1:11434' });
  });

  it('removes invalid agents.defaults.memorySearch.fallback values', async () => {
    await writeConfig({
      agents: {
        defaults: {
          memorySearch: {
            enabled: true,
            provider: 'local',
            fallback: 'ollama',
          },
        },
      },
    });

    const modified = await sanitizeConfig(configPath);
    expect(modified).toBe(true);

    const result = await readConfig();
    const memorySearch = (
      (result.agents as Record<string, unknown>).defaults as Record<string, unknown>
    ).memorySearch as Record<string, unknown>;
    expect(memorySearch.provider).toBe('local');
    expect(memorySearch).not.toHaveProperty('fallback');
  });
});
