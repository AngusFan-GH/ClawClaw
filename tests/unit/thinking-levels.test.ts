import { describe, expect, it } from 'vitest';
import {
  listThinkingLevelsForModel,
  normalizeThinkingLevel,
  resolveDefaultThinkingLevel,
  type ChatThinkingConfigSnapshot,
} from '@/pages/Chat/thinking-levels';

describe('thinking levels alignment', () => {
  it('normalizes openclaw-compatible aliases', () => {
    expect(normalizeThinkingLevel('auto')).toBe('adaptive');
    expect(normalizeThinkingLevel('xhigh')).toBe('xhigh');
    expect(normalizeThinkingLevel('enable')).toBe('low');
    expect(normalizeThinkingLevel('think-hard')).toBe('low');
  });

  it('uses configured per-model thinking default before catalog heuristics', () => {
    const config: ChatThinkingConfigSnapshot = {
      globalDefault: 'medium',
      perModelDefaults: {
        'openai/gpt-5.5': 'high',
      },
    };
    expect(resolveDefaultThinkingLevel({
      provider: 'openai',
      model: 'gpt-5.5',
      catalog: [{ id: 'gpt-5.5', provider: 'openai', name: 'gpt-5.5', reasoning: true }],
      config,
    })).toBe('high');
  });

  it('falls back to configured global thinking default before catalog heuristics', () => {
    const config: ChatThinkingConfigSnapshot = {
      globalDefault: 'medium',
      perModelDefaults: {},
    };
    expect(resolveDefaultThinkingLevel({
      provider: 'openai',
      model: 'gpt-5.5',
      catalog: [{ id: 'gpt-5.5', provider: 'openai', name: 'gpt-5.5', reasoning: true }],
      config,
    })).toBe('medium');
  });

  it('includes xhigh when the catalog advertises it', () => {
    expect(listThinkingLevelsForModel({
      provider: 'openai',
      model: 'gpt-5.5',
      catalog: [{ id: 'gpt-5.5', provider: 'openai', name: 'gpt-5.5', xhigh: true }],
    })).toEqual(['off', 'minimal', 'low', 'medium', 'high', 'xhigh', 'adaptive']);
  });
});
