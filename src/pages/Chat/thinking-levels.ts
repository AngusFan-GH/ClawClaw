import type { ChatModelCatalogEntry } from './chat-model-catalog';

export const DEFAULT_THINKING_LEVELS = ['off', 'minimal', 'low', 'medium', 'high'] as const;

const CLAUDE_46_MODEL_RE = /^claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;
const BEDROCK_CLAUDE_46_MODEL_RE = /claude-(?:opus|sonnet)-4(?:\.|-)6(?:$|[-.])/i;

export type ChatThinkingConfigSnapshot = {
  globalDefault?: string;
  perModelDefaults: Record<string, string>;
};

export type ChatThinkingLevelOption = {
  value: string;
  label?: string;
};

export type ChatThinkingSelectState = {
  currentOverride: string;
  defaultLevel: string;
  effectiveLevel: string;
  options: ChatThinkingLevelOption[];
  canShowThinkingDetails: boolean;
};

export function normalizeThinkingProvider(provider?: string | null): string {
  const key = provider?.trim().toLowerCase() ?? '';
  if (key === 'z.ai' || key === 'z-ai') return 'zai';
  if (key === 'bedrock' || key === 'aws-bedrock') return 'amazon-bedrock';
  if (key === 'minimax' || key === 'minimax-portal-cn') return 'minimax-portal';
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

export function normalizeThinkingOptionValue(raw?: string | null): string {
  return normalizeThinkingLevel(raw) ?? raw?.trim().toLowerCase() ?? '';
}

export function formatThinkingLevelDisplayLabel(value: string): string {
  const raw = value.trim().toLowerCase();
  if (['on', 'enable', 'enabled'].includes(raw)) {
    return 'On';
  }
  const normalized = normalizeThinkingOptionValue(value);
  switch (normalized) {
    case 'adaptive':
      return 'Adaptive';
    case 'minimal':
      return 'Minimal';
    case 'low':
      return 'Low';
    case 'medium':
      return 'Medium';
    case 'high':
      return 'High';
    case 'xhigh':
      return 'Extra high';
    case 'max':
      return 'Maximum';
    case 'off':
      return 'Off';
    default:
      return value.charAt(0).toUpperCase() + value.slice(1);
  }
}

export function formatInheritedThinkingLabel(effectiveLevel?: string | null): string {
  const normalized = effectiveLevel ? normalizeThinkingOptionValue(effectiveLevel) : 'off';
  return `Inherited: ${formatThinkingLevelDisplayLabel(normalized)}`;
}

export function formatThinkingOverrideLabel(value: string, label?: string | null): string {
  const normalized = normalizeThinkingOptionValue(value);
  if (!normalized || normalized === 'off') {
    return 'Off';
  }
  return formatThinkingLevelDisplayLabel(label?.trim() || normalized);
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

function normalizeThinkingModelRef(provider?: string | null, model?: string | null): string {
  const normalizedProvider = normalizeThinkingProvider(provider);
  const normalizedModel = normalizeThinkingModelId(provider, model);
  return normalizedProvider && normalizedModel ? `${normalizedProvider}/${normalizedModel}` : '';
}

function normalizeThinkingModelId(provider?: string | null, model?: string | null): string {
  const trimmed = model?.trim() ?? '';
  if (!trimmed) return '';

  const parsed = parseModelRef(trimmed);
  if (!parsed.model) return trimmed;

  const normalizedProvider = normalizeThinkingProvider(provider);
  const parsedProvider = normalizeThinkingProvider(parsed.provider);
  if (!normalizedProvider || !parsedProvider || normalizedProvider === parsedProvider) {
    return parsed.model.trim();
  }

  return trimmed;
}

function buildThinkingModelKey(provider?: string | null, model?: string | null): string | undefined {
  const normalizedProvider = normalizeThinkingProvider(provider);
  const normalizedModel = normalizeThinkingModelId(provider, model);
  if (!normalizedProvider || !normalizedModel) return undefined;
  return `${normalizedProvider}/${normalizedModel}`;
}

function findThinkingCatalogEntry(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
}): ChatModelCatalogEntry | undefined {
  const provider = normalizeThinkingProvider(params.provider);
  const model = normalizeThinkingModelId(params.provider, params.model).toLowerCase();
  if (!provider || !model) return undefined;
  return params.catalog?.find((entry) => (
    normalizeThinkingProvider(entry.provider) === provider
    && entry.id.trim().toLowerCase() === model
  ));
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

function modelSupportsReasoning(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
}): boolean {
  return findThinkingCatalogEntry(params)?.reasoning === true;
}

function isOffThinkingOption(value?: string | null): boolean {
  return normalizeThinkingOptionValue(value) === 'off';
}

function buildFallbackThinkingOptions(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
  currentLevel?: string | null;
}): ChatThinkingLevelOption[] {
  const levels = listThinkingLevelsForModel(params);
  return levels.map((value) => ({ value }));
}

function hasOffOnlyThinkingOptions(options: ChatThinkingLevelOption[]): boolean {
  return options.length > 0 && options.every((option) => isOffThinkingOption(option.value || option.label));
}

function normalizeSessionThinkingLevels(
  levels?: Array<{ id?: string; label?: string }> | null,
): ChatThinkingLevelOption[] {
  if (!Array.isArray(levels)) return [];
  const seen = new Set<string>();
  const options: ChatThinkingLevelOption[] = [];
  for (const level of levels) {
    const value = normalizeThinkingOptionValue(level.id || level.label);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    options.push({
      value,
      label: level.label?.trim() || undefined,
    });
  }
  return options;
}

function normalizeSessionThinkingOptions(options?: string[] | null): ChatThinkingLevelOption[] {
  if (!Array.isArray(options)) return [];
  const seen = new Set<string>();
  const out: ChatThinkingLevelOption[] = [];
  for (const option of options) {
    const value = normalizeThinkingOptionValue(option);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({ value, label: formatThinkingOverrideLabel(value, option.trim() || undefined) });
  }
  return out;
}

function sessionModelMatchesDefaults(params: {
  sessionProvider?: string | null;
  sessionModel?: string | null;
  defaultsProvider?: string | null;
  defaultsModel?: string | null;
}): boolean {
  const defaultsRef = normalizeThinkingModelRef(params.defaultsProvider, params.defaultsModel);
  if (!defaultsRef) return false;
  const sessionRef = normalizeThinkingModelRef(params.sessionProvider, params.sessionModel);
  return Boolean(sessionRef) && sessionRef === defaultsRef;
}

function dedupeThinkingOptions(
  options: ChatThinkingLevelOption[],
  currentOverride: string,
): ChatThinkingLevelOption[] {
  const seen = new Set<string>();
  const out: ChatThinkingLevelOption[] = [];

  for (const option of options) {
    const value = normalizeThinkingOptionValue(option.value);
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.push({
      value,
      label: formatThinkingOverrideLabel(value, option.label),
    });
  }

  if (currentOverride && !seen.has(currentOverride)) {
    out.push({ value: currentOverride, label: formatThinkingOverrideLabel(currentOverride) });
  }

  return out;
}

export function listThinkingLevelsForModel(params: {
  provider?: string | null;
  model?: string | null;
  catalog?: ChatModelCatalogEntry[];
  currentLevel?: string | null;
}): string[] {
  const levels: string[] = [...DEFAULT_THINKING_LEVELS];
  const current = normalizeThinkingLevel(params.currentLevel) ?? params.currentLevel?.trim();
  if (current && !levels.includes(current)) {
    levels.push(current);
  }
  return levels;
}

export function resolveDefaultThinkingLevel(params: {
  sessionProvider?: string | null;
  sessionModel?: string | null;
  defaultsProvider?: string | null;
  defaultsModel?: string | null;
  catalog?: ChatModelCatalogEntry[];
  config?: ChatThinkingConfigSnapshot | null;
}): string {
  const provider = normalizeThinkingProvider(params.sessionProvider || params.defaultsProvider);
  const model = normalizeThinkingModelId(
    params.sessionProvider || params.defaultsProvider,
    params.sessionModel || params.defaultsModel,
  );
  if (!provider || !model) return 'off';
  const configuredDefault = resolveConfiguredThinkingDefault({
    provider,
    model,
    config: params.config,
  });
  if (configuredDefault) return configuredDefault;
  if (provider === 'anthropic' && CLAUDE_46_MODEL_RE.test(model)) return 'adaptive';
  if (provider === 'amazon-bedrock' && BEDROCK_CLAUDE_46_MODEL_RE.test(model)) return 'adaptive';
  return modelSupportsReasoning({ provider, model, catalog: params.catalog }) ? 'low' : 'off';
}

export function resolveChatThinkingSelectState(params: {
  sessionThinkingLevel?: string | null;
  sessionThinkingLevels?: Array<{ id?: string; label?: string }> | null;
  sessionThinkingOptions?: string[] | null;
  sessionThinkingDefault?: string | null;
  sessionProvider?: string | null;
  sessionModel?: string | null;
  defaultsThinkingLevels?: Array<{ id?: string; label?: string }> | null;
  defaultsThinkingOptions?: string[] | null;
  defaultsThinkingDefault?: string | null;
  defaultsProvider?: string | null;
  defaultsModel?: string | null;
  catalog?: ChatModelCatalogEntry[];
  config?: ChatThinkingConfigSnapshot | null;
}): ChatThinkingSelectState {
  const currentOverride = normalizeThinkingOptionValue(params.sessionThinkingLevel);
  const matchesDefaults = sessionModelMatchesDefaults({
    sessionProvider: params.sessionProvider,
    sessionModel: params.sessionModel,
    defaultsProvider: params.defaultsProvider,
    defaultsModel: params.defaultsModel,
  });
  const defaultLevel =
    normalizeThinkingLevel(params.sessionThinkingDefault)
    || (matchesDefaults ? normalizeThinkingLevel(params.defaultsThinkingDefault) : undefined)
    || resolveDefaultThinkingLevel(params)
    || 'off';

  const sessionLevelOptions = normalizeSessionThinkingLevels(params.sessionThinkingLevels);
  const defaultsLevelOptions = matchesDefaults
    ? normalizeSessionThinkingLevels(params.defaultsThinkingLevels)
    : [];
  const sessionStringOptions = normalizeSessionThinkingOptions(params.sessionThinkingOptions);
  const defaultsStringOptions = matchesDefaults
    ? normalizeSessionThinkingOptions(params.defaultsThinkingOptions)
    : [];
  const catalogEntry = findThinkingCatalogEntry({
    provider: params.sessionProvider || params.defaultsProvider,
    model: params.sessionModel || params.defaultsModel,
    catalog: params.catalog,
  });
  const explicitSessionOptions = sessionLevelOptions.length > 0 || sessionStringOptions.length > 0;
  const explicitDefaultsOptions = defaultsLevelOptions.length > 0 || defaultsStringOptions.length > 0;

  let options = sessionLevelOptions.length > 0
    ? sessionLevelOptions
    : defaultsLevelOptions.length > 0
      ? defaultsLevelOptions
    : sessionStringOptions.length > 0
      ? sessionStringOptions
      : defaultsStringOptions.length > 0
        ? defaultsStringOptions
      : buildFallbackThinkingOptions({
          provider: params.sessionProvider || params.defaultsProvider,
          model: params.sessionModel || params.defaultsModel,
          catalog: params.catalog,
          currentLevel: params.sessionThinkingLevel,
        });

  if (catalogEntry?.reasoning === false) {
    if ((!explicitSessionOptions && !explicitDefaultsOptions) || hasOffOnlyThinkingOptions(options)) {
      options = [];
    }
  }

  const effectiveOverride = options.length === 0 && currentOverride === 'off' ? '' : currentOverride;
  const dedupedOptions = dedupeThinkingOptions(options, effectiveOverride);
  const effectiveLevel = effectiveOverride || defaultLevel || 'off';

  return {
    currentOverride: effectiveOverride,
    defaultLevel,
    effectiveLevel,
    options: dedupedOptions,
    canShowThinkingDetails: effectiveLevel !== 'off',
  };
}
