import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HostApiContext } from '../../api/context';
import { resolveOpenClawDir } from '../../utils/paths';
import { logger } from '../../utils/logger';
import { getOpenClawCliSpawnConfig } from '../../utils/openclaw-cli';
import { prepareWinSpawn } from '../../utils/win-shell';
import { shouldDeferRuntimeModelQueries } from './provider-runtime-resolver';

type OpenClawModelListResponse = {
  count?: number;
  models?: Array<{
    key?: string;
    name?: string;
    input?: string;
    contextWindow?: number | null;
    tags?: string[];
    category?: string;
    local?: boolean | null;
    available?: boolean;
  }>;
};

export type OpenClawModelScope = 'catalog' | 'runtime';
export type ProviderModelOptionsSource = 'runtime' | 'models_json_fallback' | 'direct';
export type OpenClawModelEntry = NonNullable<OpenClawModelListResponse['models']>[number];

type OpenClawModelCacheEntry = {
  expiresAt: number;
  promise?: Promise<OpenClawModelEntry[]>;
  value?: OpenClawModelEntry[];
};

type ProviderModelOption = {
  id: string;
  name: string;
  input?: string;
  contextWindow?: number | null;
  tags?: string[];
  category?: string;
};

const OPENCLAW_MODEL_LIST_CACHE_TTL_MS = 10_000;
const OPENCLAW_MODEL_LIST_TIMEOUT_MS = 12_000;
const WINDOWS_MODELS_JSON_RENAME_RETRY_DELAYS_MS = [120, 250, 500];
const OPENAI_OAUTH_RUNTIME_PROVIDER = 'openai-codex';
const OPENAI_OAUTH_PREFERRED_MODELS = ['gpt-5.4-pro', 'gpt-5.4'] as const;

const openClawModelListCache = new Map<OpenClawModelScope, OpenClawModelCacheEntry>();
let openClawModelListQueue: Promise<void> = Promise.resolve();

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function isWindowsModelsJsonRenameError(error: unknown): boolean {
  const text = String(error);
  return (
    process.platform === 'win32'
    && text.includes('EPERM:')
    && text.includes('models.json')
    && text.includes('.tmp')
  );
}

function extractJsonObjectFromMixedOutput(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < trimmed.length; index += 1) {
    const char = trimmed[index];

    if (start === -1) {
      if (char === '{') {
        start = index;
        depth = 1;
      }
      continue;
    }

    if (inString) {
      if (escaped) {
        escaped = false;
      } else if (char === '\\') {
        escaped = true;
      } else if (char === '"') {
        inString = false;
      }
      continue;
    }

    if (char === '"') {
      inString = true;
      continue;
    }

    if (char === '{') {
      depth += 1;
      continue;
    }

    if (char === '}') {
      depth -= 1;
      if (depth === 0) {
        return trimmed.slice(start, index + 1);
      }
    }
  }

  return null;
}

function parseOpenClawModelListOutput(raw: string): OpenClawModelListResponse {
  const trimmed = raw.trim();
  if (!trimmed) {
    throw new Error('openclaw models list returned empty output');
  }

  try {
    return JSON.parse(trimmed) as OpenClawModelListResponse;
  } catch {
    const jsonSlice = extractJsonObjectFromMixedOutput(trimmed);
    if (!jsonSlice) {
      throw new Error(`openclaw models list did not contain a JSON object. Output preview: ${trimmed.slice(0, 240)}`);
    }
    return JSON.parse(jsonSlice) as OpenClawModelListResponse;
  }
}

async function runSerializedOpenClawModelList<T>(task: () => Promise<T>): Promise<T> {
  const previous = openClawModelListQueue;
  let release!: () => void;
  openClawModelListQueue = new Promise((resolve) => {
    release = resolve;
  });

  await previous.catch(() => {});
  try {
    return await task();
  } finally {
    release();
  }
}

async function fetchOpenClawModelListOnce(scope: OpenClawModelScope): Promise<OpenClawModelEntry[]> {
  const cliArgs = scope === 'runtime'
    ? ['models', 'list', '--json']
    : ['models', 'list', '--all', '--json'];
  const { command, args, env, cwd } = getOpenClawCliSpawnConfig(cliArgs);
  const prepared = prepareWinSpawn(command, args);

  return await new Promise((resolve, reject) => {
    const child = spawn(prepared.command, prepared.args, {
      cwd,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: prepared.shell,
    });

    let stdout = '';
    let stderr = '';

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString();
    });

    child.on('error', (error) => reject(error));
    child.on('close', (code) => {
      if (code !== 0) {
        reject(new Error(stderr.trim() || `openclaw models list exited with code ${code}`));
        return;
      }
      try {
        const parsed = parseOpenClawModelListOutput(stdout);
        resolve(parsed.models ?? []);
      } catch (error) {
        reject(error);
      }
    });
  });
}

async function fetchOpenClawModelList(scope: OpenClawModelScope): Promise<OpenClawModelEntry[]> {
  let attempt = 0;
  for (;;) {
    try {
      return await runSerializedOpenClawModelList(() => fetchOpenClawModelListOnce(scope));
    } catch (error) {
      if (
        !isWindowsModelsJsonRenameError(error)
        || attempt >= WINDOWS_MODELS_JSON_RENAME_RETRY_DELAYS_MS.length
      ) {
        throw error;
      }

      const delayMs = WINDOWS_MODELS_JSON_RENAME_RETRY_DELAYS_MS[attempt];
      attempt += 1;
      logger.warn(
        `[providers] openclaw models list hit Windows models.json rename lock; retrying in ${delayMs}ms (attempt ${attempt})`,
      );
      await sleep(delayMs);
    }
  }
}

async function getOpenClawModelListWithTimeout(scope: OpenClawModelScope): Promise<OpenClawModelEntry[]> {
  let timeout: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race<OpenClawModelEntry[]>([
      getOpenClawModelList(scope),
      new Promise<OpenClawModelEntry[]>((_, reject) => {
        timeout = setTimeout(() => {
          reject(new Error(`openclaw models list timed out after ${OPENCLAW_MODEL_LIST_TIMEOUT_MS}ms`));
        }, OPENCLAW_MODEL_LIST_TIMEOUT_MS);
      }),
    ]);
  } finally {
    if (timeout) {
      clearTimeout(timeout);
    }
  }
}

async function getOpenClawModelList(scope: OpenClawModelScope): Promise<OpenClawModelEntry[]> {
  const now = Date.now();
  const cached = openClawModelListCache.get(scope);
  if (cached?.value && cached.expiresAt > now) {
    return cached.value;
  }
  if (cached?.promise) {
    return await cached.promise;
  }

  const promise = fetchOpenClawModelList(scope)
    .then((models) => {
      openClawModelListCache.set(scope, {
        value: models,
        expiresAt: Date.now() + OPENCLAW_MODEL_LIST_CACHE_TTL_MS,
      });
      return models;
    })
    .catch((error) => {
      openClawModelListCache.delete(scope);
      throw error;
    });

  openClawModelListCache.set(scope, {
    promise,
    expiresAt: now + OPENCLAW_MODEL_LIST_CACHE_TTL_MS,
  });

  return await promise;
}

async function readMainAgentModelsJsonEntries(): Promise<OpenClawModelEntry[]> {
  const modelsPath = join(resolveOpenClawDir(), 'agents', 'main', 'agent', 'models.json');
  try {
    const raw = await readFile(modelsPath, 'utf8');
    const parsed = JSON.parse(raw) as {
      providers?: Record<string, { models?: Array<{ id?: string; name?: string }> }>;
    };
    const providers = parsed?.providers ?? {};
    const entries: OpenClawModelEntry[] = [];
    for (const [providerKey, provider] of Object.entries(providers)) {
      for (const model of provider?.models ?? []) {
        if (!model?.id) continue;
        entries.push({
          key: `${providerKey}/${model.id}`,
          name: model.name || model.id,
          available: true,
        });
      }
    }
    return entries;
  } catch {
    return [];
  }
}

function getStaleCachedOpenClawModelList(scope: OpenClawModelScope): OpenClawModelEntry[] {
  const cached = openClawModelListCache.get(scope)?.value;
  return Array.isArray(cached) ? cached : [];
}

export function invalidateOpenClawModelListCache(): void {
  openClawModelListCache.clear();
}

async function getOpenClawModelListWithFallback(scope: OpenClawModelScope): Promise<{
  models: OpenClawModelEntry[];
  source: ProviderModelOptionsSource;
}> {
  const staleCachedModels = getStaleCachedOpenClawModelList(scope);

  try {
    const models = await getOpenClawModelListWithTimeout(scope);
    return { models, source: 'runtime' };
  } catch (error) {
    logger.warn(`[providers] openclaw models list (${scope}) unavailable; falling back`, error);

    if (Array.isArray(staleCachedModels) && staleCachedModels.length > 0) {
      logger.info(`[providers] Serving stale cached model list for ${scope} scope`);
      return { models: staleCachedModels, source: 'runtime' };
    }

    const fallbackModels = await readMainAgentModelsJsonEntries();
    if (fallbackModels.length > 0) {
      logger.info(`[providers] Serving models.json fallback for ${scope} scope`);
      return { models: fallbackModels, source: 'models_json_fallback' };
    }

    throw error;
  }
}

async function getStaticOpenClawModelListFallback(scope: OpenClawModelScope): Promise<{
  models: OpenClawModelEntry[];
  source: ProviderModelOptionsSource;
}> {
  const staleCachedModels = getStaleCachedOpenClawModelList(scope);
  if (staleCachedModels.length > 0) {
    logger.info(`[providers] Serving stale cached model list for ${scope} scope without runtime refresh`);
    return { models: staleCachedModels, source: 'runtime' };
  }

  const fallbackModels = await readMainAgentModelsJsonEntries();
  if (fallbackModels.length > 0) {
    logger.info(`[providers] Serving models.json fallback for ${scope} scope without runtime refresh`);
    return { models: fallbackModels, source: 'models_json_fallback' };
  }

  return { models: [], source: 'models_json_fallback' };
}

function normalizeProviderModelId(runtimeProviderId: string, modelId: string): string {
  if (
    runtimeProviderId === OPENAI_OAUTH_RUNTIME_PROVIDER
    && (modelId === 'gpt-5.2' || modelId === 'gpt-5.3-codex')
  ) {
    return OPENAI_OAUTH_PREFERRED_MODELS[1];
  }
  return modelId;
}

function compareProviderModelOptions(
  runtimeProviderId: string,
  left: ProviderModelOption,
  right: ProviderModelOption,
): number {
  if (runtimeProviderId === OPENAI_OAUTH_RUNTIME_PROVIDER) {
    const leftRank = OPENAI_OAUTH_PREFERRED_MODELS.indexOf(left.id as (typeof OPENAI_OAUTH_PREFERRED_MODELS)[number]);
    const rightRank = OPENAI_OAUTH_PREFERRED_MODELS.indexOf(right.id as (typeof OPENAI_OAUTH_PREFERRED_MODELS)[number]);
    if (leftRank !== -1 || rightRank !== -1) {
      if (leftRank === -1) return 1;
      if (rightRank === -1) return -1;
      if (leftRank !== rightRank) return leftRank - rightRank;
    }
  }

  return left.name.localeCompare(right.name, 'en', { sensitivity: 'base' });
}

export async function listRuntimeModelRefs(ctx: HostApiContext): Promise<string[]> {
  let models: OpenClawModelEntry[] = [];

  if (shouldDeferRuntimeModelQueries(ctx)) {
    models = getStaleCachedOpenClawModelList('runtime');
  } else {
    try {
      models = await getOpenClawModelListWithTimeout('runtime');
    } catch (error) {
      const staleCachedModels = getStaleCachedOpenClawModelList('runtime');
      if (staleCachedModels.length > 0) {
        logger.info('[providers] Serving stale cached runtime model refs after runtime query failure');
        models = staleCachedModels;
      } else {
        logger.info('[providers] Runtime model refs unavailable; returning an empty runtime-only list', error);
        models = [];
      }
    }
  }

  const refs = models
    .filter((model) => model.available !== false)
    .map((model) => (typeof model.key === 'string' ? model.key : ''))
    .filter((value): value is string => Boolean(value));
  return Array.from(new Set(refs));
}

export async function listProviderModelOptions(
  runtimeProviderId: string,
  scope: OpenClawModelScope = 'catalog',
  ctx?: HostApiContext,
  options?: { allowModelsJsonFallback?: boolean },
): Promise<{ models: ProviderModelOption[]; source: ProviderModelOptionsSource }> {
  let parsedModels: OpenClawModelEntry[];
  let source: ProviderModelOptionsSource = 'runtime';

  if (scope === 'runtime') {
    const result = ctx && shouldDeferRuntimeModelQueries(ctx)
      ? await getStaticOpenClawModelListFallback(scope)
      : await getOpenClawModelListWithFallback(scope);
    parsedModels = result.models;
    source = result.source;
  } else {
    try {
      parsedModels = await getOpenClawModelList(scope);
    } catch (error) {
      const allowModelsJsonFallback = options?.allowModelsJsonFallback;
      if (!allowModelsJsonFallback) {
        throw error;
      }

      logger.warn(
        `[providers] Falling back to main agent models.json for ${runtimeProviderId} after OpenClaw model listing failed:`,
        error,
      );
      parsedModels = await readMainAgentModelsJsonEntries();
      source = 'models_json_fallback';
    }
  }

  const models = parsedModels
    .filter((model) => typeof model.key === 'string' && model.key.startsWith(`${runtimeProviderId}/`))
    .filter((model) => model.available !== false)
    .map((model) => ({
      id: normalizeProviderModelId(
        runtimeProviderId,
        String(model.key).slice(runtimeProviderId.length + 1),
      ),
      name: normalizeProviderModelId(
        runtimeProviderId,
        model.name || String(model.key).slice(runtimeProviderId.length + 1),
      ),
      input: typeof model.input === 'string' ? model.input : undefined,
      contextWindow: typeof model.contextWindow === 'number' ? model.contextWindow : undefined,
      tags: Array.isArray(model.tags)
        ? model.tags.filter((tag): tag is string => typeof tag === 'string' && tag.trim().length > 0)
        : undefined,
      category: typeof model.category === 'string' && model.category.trim().length > 0
        ? model.category.trim()
        : undefined,
    }));

  return {
    models: Array.from(new Map(models.map((model) => [model.id, model])).values())
      .sort((left, right) => compareProviderModelOptions(runtimeProviderId, left, right)),
    source,
  };
}

export async function listProviderModelOptionsWithRuntimeFallback(
  runtimeProviderId: string,
  scope: OpenClawModelScope,
  ctx?: HostApiContext,
  options?: { allowModelsJsonFallback?: boolean },
): Promise<{ models: ProviderModelOption[]; source: ProviderModelOptionsSource }> {
  const primary = await listProviderModelOptions(runtimeProviderId, scope, ctx, options);
  if (scope !== 'catalog' || primary.models.length > 0) {
    return primary;
  }

  return await listProviderModelOptions(runtimeProviderId, 'runtime', ctx, {
    allowModelsJsonFallback: false,
  });
}
