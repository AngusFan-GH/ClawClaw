/**
 * Skills State Store
 * Manages skill/plugin state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { useGatewayStore } from './gateway';
import type { Skill, MarketplaceSkill, SkillSourceDir, SkillSourceStat } from '../types/skill';

function hasLikelyEmoji(value: string): boolean {
  return Array.from(value).some((char) => {
    const codePoint = char.codePointAt(0) ?? 0;
    return codePoint >= 0x2600;
  });
}

function normalizeSkillIcon(...candidates: Array<string | undefined>): string {
  for (const candidate of candidates) {
    const icon = (candidate || '').trim();
    if (!icon) continue;
    if (icon.includes('\uFFFD')) continue;
    const hasCjk = /[\u3400-\u9FFF]/.test(icon);
    const looksEmoji = hasLikelyEmoji(icon);
    if (hasCjk && !looksEmoji) continue;
    if (!looksEmoji && icon.length > 2) continue;
    return icon;
  }
  return '\uD83D\uDCE6';
}

function mapErrorCodeToSkillErrorKey(
  code: AppError['code'],
  operation: 'fetch' | 'search' | 'install',
): string {
  if (code === 'TIMEOUT') {
    return operation === 'search'
      ? 'searchTimeoutError'
      : operation === 'install'
        ? 'installTimeoutError'
        : 'fetchTimeoutError';
  }
  if (code === 'RATE_LIMIT') {
    return operation === 'search'
      ? 'searchRateLimitError'
      : operation === 'install'
        ? 'installRateLimitError'
        : 'fetchRateLimitError';
  }
  return '';
}

interface SkillsState {
  skills: Skill[];
  currentAgentId: string | null;
  sourceStats: SkillSourceStat[];
  sourceDirs: SkillSourceDir[];
  searchResults: MarketplaceSkill[];
  loading: boolean;
  searching: boolean;
  searchError: string | null;
  installing: Record<string, boolean>; // slug -> boolean
  error: string | null;

  // Actions
  fetchSkills: (agentId?: string, options?: { includeRuntime?: boolean; silent?: boolean }) => Promise<void>;
  searchSkills: (query: string) => Promise<void>;
  installSkill: (slug: string, version?: string) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;
}

const fetchSkillsInFlight = new Map<string, Promise<void>>();

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  currentAgentId: null,
  sourceStats: [],
  sourceDirs: [],
  searchResults: [],
  loading: false,
  searching: false,
  searchError: null,
  installing: {},
  error: null,

  fetchSkills: async (agentId, options) => {
    const shouldShowLoading = !options?.silent && get().skills.length === 0;
    if (shouldShowLoading) {
      set({ loading: true, error: null });
    }
    const resolvedAgentId = agentId ?? get().currentAgentId ?? undefined;
    const requestPath = resolvedAgentId
      ? `/api/skills/list?agentId=${encodeURIComponent(resolvedAgentId)}`
      : '/api/skills/list';
    const includeRuntime = options?.includeRuntime !== false;
    const inFlightKey = `${resolvedAgentId ?? ''}:${includeRuntime ? 'runtime' : 'snapshot'}`;
    const existing = fetchSkillsInFlight.get(inFlightKey);
    if (existing) {
      await existing;
      return;
    }

    const request = (async () => {
      const result = await hostApiFetch<{
        success: boolean;
        results?: Skill[];
        sourceStats?: SkillSourceStat[];
        sourceDirs?: SkillSourceDir[];
        error?: string;
      }>(
        requestPath
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to load skills');
      }
      set({
        skills: result.results || [],
        currentAgentId: resolvedAgentId ?? null,
        sourceStats: result.sourceStats || [],
        sourceDirs: result.sourceDirs || [],
        loading: false,
        error: null,
      });

      if (
        includeRuntime
        && useGatewayStore.getState().status.state === 'running'
      ) {
        const runtimePath = resolvedAgentId
          ? `/api/skills/runtime?agentId=${encodeURIComponent(resolvedAgentId)}`
          : '/api/skills/runtime';
        try {
          const runtimeResult = await hostApiFetch<{
            success: boolean;
            results?: Skill[];
            sourceStats?: SkillSourceStat[];
            sourceDirs?: SkillSourceDir[];
            error?: string;
          }>(runtimePath);
          if (runtimeResult.success) {
            set((state) => ({
              skills: runtimeResult.results || state.skills,
              currentAgentId: resolvedAgentId ?? state.currentAgentId,
              sourceStats: runtimeResult.sourceStats || state.sourceStats,
              sourceDirs: runtimeResult.sourceDirs || state.sourceDirs,
              loading: false,
            }));
          }
        } catch {
          // Keep snapshot data when runtime enrichment is unavailable.
        }
      }
    })();
    fetchSkillsInFlight.set(inFlightKey, request);
    try {
      await request;
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      set({
        loading: false,
        error: mapErrorCodeToSkillErrorKey(appError.code, 'fetch') || appError.message,
      });
    } finally {
      if (fetchSkillsInFlight.get(inFlightKey) === request) {
        fetchSkillsInFlight.delete(inFlightKey);
      }
    }
  },

  searchSkills: async (query: string) => {
    set({ searching: true, searchError: null });
    try {
      const result = await hostApiFetch<{ success: boolean; results?: MarketplaceSkill[]; error?: string }>('/api/clawhub/search', {
        method: 'POST',
        body: JSON.stringify({ query }),
      });
      if (result.success) {
        const mappedResults = (result.results || []).map((skill) => ({
          ...skill,
          icon: normalizeSkillIcon(
            (skill as MarketplaceSkill & { icon?: string; emoji?: string }).icon,
            (skill as MarketplaceSkill & { icon?: string; emoji?: string }).emoji
          ),
        }));
        set({ searchResults: mappedResults });
      } else {
        throw normalizeAppError(new Error(result.error || 'Search failed'), {
          module: 'skills',
          operation: 'search',
        });
      }
    } catch (error) {
      const appError = normalizeAppError(error, { module: 'skills', operation: 'search' });
      set({ searchError: mapErrorCodeToSkillErrorKey(appError.code, 'search') || appError.message });
    } finally {
      set({ searching: false });
    }
  },

  installSkill: async (slug: string, version?: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/install', {
        method: 'POST',
        body: JSON.stringify({ slug, version }),
      });
      if (!result.success) {
        const appError = normalizeAppError(new Error(result.error || 'Install failed'), {
          module: 'skills',
          operation: 'install',
        });
        const mappedErrorKey = mapErrorCodeToSkillErrorKey(appError.code, 'install');
        if (mappedErrorKey) {
          throw new Error(mappedErrorKey);
        }
        throw new Error(result.error || appError.message || 'Install failed');
      }
      // Refresh skills after install
      await get().fetchSkills(undefined, { includeRuntime: true });
    } catch (error) {
      console.error('Install error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  uninstallSkill: async (slug: string) => {
    set((state) => ({ installing: { ...state.installing, [slug]: true } }));
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/clawhub/uninstall', {
        method: 'POST',
        body: JSON.stringify({ slug }),
      });
      if (!result.success) {
        throw new Error(result.error || 'Uninstall failed');
      }
      // Refresh skills after uninstall
      await get().fetchSkills(undefined, { includeRuntime: true });
    } catch (error) {
      console.error('Uninstall error:', error);
      throw error;
    } finally {
      set((state) => {
        const newInstalling = { ...state.installing };
        delete newInstalling[slug];
        return { installing: newInstalling };
      });
    }
  },

  enableSkill: async (skillId) => {
    const gatewayStatus = useGatewayStore.getState().status;

    if (gatewayStatus.state !== 'running') {
      throw new Error('Gateway is not running');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: true });
      await get().fetchSkills(get().currentAgentId ?? undefined, { includeRuntime: true });
    } catch (error) {
      console.error('Failed to enable skill:', error);
      throw error;
    }
  },

  disableSkill: async (skillId) => {
    const { skills } = get();
    const gatewayStatus = useGatewayStore.getState().status;

    const skill = skills.find((s) => s.id === skillId);
    if (skill?.isCore) {
      throw new Error('Cannot disable core skill');
    }
    if (gatewayStatus.state !== 'running') {
      throw new Error('Gateway is not running');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: false });
      await get().fetchSkills(get().currentAgentId ?? undefined, { includeRuntime: true });
    } catch (error) {
      console.error('Failed to disable skill:', error);
      throw error;
    }
  },

  setSkills: (skills) => set({ skills }),

  updateSkill: (skillId, updates) => {
    set((state) => ({
      skills: state.skills.map((skill) =>
        skill.id === skillId ? { ...skill, ...updates } : skill
      ),
    }));
  },
}));
