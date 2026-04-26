import type { ChatModelCatalogEntry } from './chat-model-catalog';

export const DEFAULT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high', 'adaptive'] as const;

const CLAUDE_46_MODEL_RE = /^claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const BEDROCK_CLAUDE_46_MODEL_RE = /claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;

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

export function listThinkingLevelsForModel(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
  currentLevel?: string | null;
}): string[] {
  const provider = normalizeThinkingProvider(params.provider);
  const model = params.model?.trim() ?? '';
  const levels = provider === 'zai'
    ? ['off', 'low']
    : [...DEFAULT_THINKING_LEVELS];

  const supportsXHigh = params.catalog?.some((entry) => (
    normalizeThinkingProvider(entry.provider) === provider
    && entry.id.trim().toLowerCase() === model.toLowerCase()
    && Array.isArray(entry.input)
    && entry.input.includes('text')
    && (entry as ChatModelCatalogEntry & { xhigh?: boolean }).xhigh === true
  )) === true;
  if (supportsXHigh) {
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
}): string {
  const provider = normalizeThinkingProvider(params.provider);
  const model = params.model?.trim() ?? '';
  if (!provider || !model) return 'off';
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
