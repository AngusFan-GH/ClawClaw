import type { ChatModelCatalogEntry } from './chat-model-catalog';

export const DEFAULT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'adaptive'] as const;

const CLAUDE_46_MODEL_RE = /^claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const BEDROCK_CLAUDE_46_MODEL_RE = /claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const XHIGH_TAG_RE = /(?:^|[./:_-])xhigh(?:$|[./:_-])/i;

export type ChatThinkingConfigSnapshot = {
  globalDefault?: string;
  perModelDefaults: Record<string, string>;
};

export function normalizeThinkingProvider(provider?: string | null): string {
  const key = provider?.trim().toLowerCase() ?? '';
  if (key === 'z.ai' || key === 'z-ai') return 'zai';
  if (key === 'bedrock' || key === 'aws-bedrock') return 'amazon-bedrock';
  return key;
}

export function normalizeThinkingLevel(raw?: string | null): string | undefined {
  const key = raw?.trim().toLowerCase();
  if (!key) return undefined;
  const collapsed = key.replace(/[\s_-]+/g, '');
  if (collapsed === 'adaptive' || collapsed === 'auto') return 'adaptive';
  if (collapsed === 'xhigh' || collapsed === 'extrahigh') return 'xhigh';
  if (key === 'off') return 'off';
  if (['on', 'enable', 'enabled'].includes(key)) return 'low';
  if (['min', 'minimal'].includes(key)) return 'minimal';
  if (['low', 'thinkhard', 'think-hard', 'think_hard'].includes(key)) return 'low';
  if (['mid', 'med', 'medium', 'thinkharder', 'think-harder', 'harder'].includes(key)) return 'medium';
  if (['high', 'ultra', 'ultrathink', 'thinkhardest', 'highest', 'max'].includes(key)) return 'high';
  if (key === 'think') return 'minimal';
  return undefined;
}

export function parseModelRef(ref?: string | null): { provider?: string; model?: string } {
  const trimmed = ref?.trim();
  if (!trimmed) return {};
  const slashIndex = trimmed.indexOf('/');
  if (slashIndex <= 0) return { model: trimmed };
  return {
    provider: trimmed.slice(0, slashIndex),
    model: trimmed.slice(slashIndex + 1),
  };
}

function buildThinkingModelKey(provider?: string | null, model?: string | null): string | undefined {
  const normalizedProvider = normalizeThinkingProvider(provider);
  const normalizedModel = model?.trim();
  if (!normalizedProvider || !normalizedModel) return undefined;
  return `${normalizedProvider}/${normalizedModel}`;
}

function supportsXHighThinking(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
}): boolean {
  const provider = normalizeThinkingProvider(params.provider);
  const model = params.model?.trim().toLowerCase() ?? '';
  if (!provider || !model) return false;
  return params.catalog?.some((entry) => {
    if (normalizeThinkingProvider(entry.provider) !== provider) return false;
    if (entry.id.trim().toLowerCase() !== model) return false;
    if (entry.xhigh === true) return true;
    return entry.alias?.trim() ? XHIGH_TAG_RE.test(entry.alias) : false;
  }) === true;
}

function resolveConfiguredThinkingDefault(params: {
  provider?: string | null;
  model?: string | null;
  config?: ChatThinkingConfigSnapshot | null;
}): string | undefined {
  const normalizedConfig = params.config;
  const modelKey = buildThinkingModelKey(params.provider, params.model);
  const perModel = modelKey ? normalizeThinkingLevel(normalizedConfig?.perModelDefaults[modelKey]) : undefined;
  if (perModel) return perModel;
  return normalizeThinkingLevel(normalizedConfig?.globalDefault);
}

export function listThinkingLevelsForModel(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
  currentLevel?: string | null;
}): string[] {
  const levels: string[] = [...DEFAULT_THINKING_LEVELS];
  if (supportsXHighThinking(params)) {
    levels.splice(levels.length - 1, 0, 'xhigh');
  }

  const current = normalizeThinkingLevel(params.currentLevel) ?? params.currentLevel?.trim();
  if (current && !levels.includes(current)) {
    levels.push(current);
  }
  return levels;
}

export function resolveDefaultThinkingLevel(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
  config?: ChatThinkingConfigSnapshot | null;
}): string {
  const provider = normalizeThinkingProvider(params.provider);
  const model = params.model?.trim() ?? '';
  if (!provider || !model) return 'off';
  const configuredDefault = resolveConfiguredThinkingDefault(params);
  if (configuredDefault) return configuredDefault;
  if (provider === 'anthropic' && CLAUDE_46_MODEL_RE.test(model)) return 'adaptive';
  if (provider === 'amazon-bedrock' && BEDROCK_CLAUDE_46_MODEL_RE.test(model)) return 'adaptive';
  const normalizedModel = model.toLowerCase();
  const isReasoningModel = params.catalog?.some((entry) => (
    normalizeThinkingProvider(entry.provider) === provider
    && entry.id.trim().toLowerCase() === normalizedModel
    && entry.reasoning === true
  )) === true;
  return isReasoningModel ? 'low' : 'off';
}
