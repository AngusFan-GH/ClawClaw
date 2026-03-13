/**
 * Skills State Store
 * Manages skill/plugin state
 */
import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import { AppError, normalizeAppError } from '@/lib/error-model';
import { useGatewayStore } from './gateway';
import type { Skill, MarketplaceSkill } from '../types/skill';

type SkillMetadataResult = {
  slug: string;
  name?: string;
  description?: string;
  skillKey?: string;
  emoji?: string;
  primaryEnv?: string;
  isProjectBundled?: boolean;
  requires?: {
    env?: string[];
    bins?: string[];
    anyBins?: string[];
    config?: string[];
    os?: string[];
  };
};

type GatewaySkillStatus = {
  skillKey: string;
  slug?: string;
  name?: string;
  description?: string;
  disabled?: boolean;
  emoji?: string;
  version?: string;
  author?: string;
  config?: Record<string, unknown>;
  bundled?: boolean;
  always?: boolean;
};

type GatewaySkillsStatusResult = {
  skills?: GatewaySkillStatus[];
};

type ClawHubListResult = {
  slug: string;
  version?: string;
};

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
  searchResults: MarketplaceSkill[];
  loading: boolean;
  searching: boolean;
  searchError: string | null;
  installing: Record<string, boolean>; // slug -> boolean
  error: string | null;

  // Actions
  fetchSkills: () => Promise<void>;
  searchSkills: (query: string) => Promise<void>;
  installSkill: (slug: string, version?: string) => Promise<void>;
  uninstallSkill: (slug: string) => Promise<void>;
  enableSkill: (skillId: string) => Promise<void>;
  disableSkill: (skillId: string) => Promise<void>;
  setSkills: (skills: Skill[]) => void;
  updateSkill: (skillId: string, updates: Partial<Skill>) => void;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [],
  searchResults: [],
  loading: false,
  searching: false,
  searchError: null,
  installing: {},
  error: null,

  fetchSkills: async () => {
    // Only show loading state if we have no skills yet (initial load)
    if (get().skills.length === 0) {
      set({ loading: true, error: null });
    }
    try {
      // Fetch independent sources in parallel to reduce initial load latency.
      const gatewayStatus = useGatewayStore.getState().status;
      const configPromise: Promise<Record<string, { apiKey?: string; env?: Record<string, string> }>> =
        hostApiFetch<Record<string, { apiKey?: string; env?: Record<string, string> }>>(
          '/api/skills/configs'
        ).catch(() => ({} as Record<string, { apiKey?: string; env?: Record<string, string> }>));

      const [clawhubResult, configResult, gatewayData, localInstalledResult] = await Promise.all([
        hostApiFetch<{ success: boolean; results?: ClawHubListResult[]; error?: string }>(
          '/api/clawhub/list'
        ),
        configPromise,
        gatewayStatus.state === 'running'
          ? useGatewayStore
              .getState()
              .rpc<GatewaySkillsStatusResult>('skills.status', undefined, 3000)
              .catch((error) => {
                console.warn(
                  'Failed to fetch skills from gateway, falling back to local installed list:',
                  error
                );
                return null;
              })
          : Promise.resolve(null),
        hostApiFetch<{ success: boolean; results?: string[]; error?: string }>('/api/skills/local-installed')
          .catch(() => ({ success: false as const })),
      ]);

      let combinedSkills: Skill[] = [];
      const currentSkills = get().skills;
      const localInstalledSlugs = localInstalledResult.success ? (localInstalledResult.results ?? []) : [];
      const candidateSlugs = new Set<string>();
      clawhubResult.results?.forEach((skill) => candidateSlugs.add(skill.slug));
      gatewayData?.skills?.forEach((skill) => candidateSlugs.add(skill.slug || skill.skillKey));
      localInstalledSlugs.forEach((slug) => candidateSlugs.add(slug));

      const metadataResult = await hostApiFetch<{
        success: boolean;
        results?: Record<string, SkillMetadataResult>;
        error?: string;
      }>('/api/skills/metadata', {
        method: 'POST',
        body: JSON.stringify({ slugs: Array.from(candidateSlugs) }),
      }).catch(() => ({ success: false as const }));
      const metadataMap = metadataResult.success ? metadataResult.results || {} : {};
      const installedVersionBySlug = new Map(
        (clawhubResult.success && clawhubResult.results ? clawhubResult.results : []).map((skill) => [
          skill.slug,
          skill.version,
        ]),
      );

      // Map gateway skills info
      if (gatewayData?.skills) {
        combinedSkills = gatewayData.skills.map((s: GatewaySkillStatus) => {
          // Merge with direct config if available
          const directConfig = configResult[s.skillKey] || {};
          const skillSlug = s.slug || s.skillKey;
          const previous = currentSkills.find((skill) => skill.id === s.skillKey || skill.slug === skillSlug);
          const metadata = metadataMap[skillSlug] || metadataMap[s.skillKey];
          const version =
            s.version ||
            installedVersionBySlug.get(skillSlug) ||
            previous?.version;
          const isProjectBundled = Boolean(metadata?.isProjectBundled);
          const envConfig = directConfig.env || {};
          const hasEditableConfig = Boolean(
            metadata?.primaryEnv ||
            metadata?.requires?.env?.length ||
            directConfig.apiKey ||
            Object.keys(envConfig).length,
          );

          return {
            id: s.skillKey,
            slug: skillSlug,
            name: s.name || s.skillKey,
            description: s.description || '',
            enabled: !s.disabled,
            runtimeEnabled: !s.disabled,
            installedOnDisk: s.bundled || installedVersionBySlug.has(skillSlug),
            loadedInGateway: true,
            runtimeStatus: 'loaded',
            runtimeReason: undefined,
            icon: normalizeSkillIcon(s.emoji, metadata?.emoji, previous?.icon),
            version: version || '',
            author: s.author,
            config: {
              ...(s.config || {}),
              ...directConfig,
            },
            primaryEnv: metadata?.primaryEnv,
            requirements: metadata?.requires,
            configurable: hasEditableConfig,
            isCore: s.bundled && s.always,
            isBundled: s.bundled && !isProjectBundled,
            isPreinstalled: isProjectBundled,
          };
        });
      } else if (currentSkills.length > 0) {
        combinedSkills = currentSkills.map((skill) => ({
          ...skill,
          enabled: Boolean(skill.runtimeEnabled ?? skill.enabled),
          runtimeEnabled: false,
          loadedInGateway: false,
          runtimeStatus: 'unknown',
          runtimeReason: 'gateway_offline',
        }));
      }

      // Merge with ClawHub results
      if (clawhubResult.success && clawhubResult.results) {
        clawhubResult.results.forEach((cs: ClawHubListResult) => {
          const existing = combinedSkills.find((s) => s.id === cs.slug || s.slug === cs.slug);
          if (!existing) {
            const directConfig = configResult[cs.slug] || {};
            const previous = currentSkills.find((s) => s.id === cs.slug || s.slug === cs.slug);
            const metadata = metadataMap[cs.slug];
            const isProjectBundled = Boolean(metadata?.isProjectBundled);
            const envConfig = directConfig.env || {};
            combinedSkills.push({
              id: cs.slug,
              slug: cs.slug,
              name: previous?.name || cs.slug,
              description: previous?.description || 'Recently installed, initializing...',
              enabled: previous?.enabled || false,
              runtimeEnabled: false,
              installedOnDisk: true,
              loadedInGateway: false,
              runtimeStatus: gatewayData ? 'not_loaded' : 'unknown',
              runtimeReason: gatewayData ? 'not_loaded' : 'gateway_offline',
              runtimeError: undefined,
              icon: normalizeSkillIcon(previous?.icon, metadata?.emoji),
              version: cs.version || previous?.version || '',
              author: previous?.author,
              config: directConfig,
              primaryEnv: metadata?.primaryEnv,
              requirements: metadata?.requires,
              configurable: Boolean(
                metadata?.primaryEnv ||
                metadata?.requires?.env?.length ||
                directConfig.apiKey ||
                Object.keys(envConfig).length,
              ),
              isCore: false,
              isBundled: false,
              isPreinstalled: isProjectBundled,
            });
          }
        });
      }

      if (localInstalledSlugs.length > 0) {
        localInstalledSlugs.forEach((slug) => {
          const existing = combinedSkills.find((s) => s.id === slug || s.slug === slug);
          if (existing) {
            return;
          }

          const directConfig = configResult[slug] || {};
          const previous = currentSkills.find((s) => s.id === slug || s.slug === slug);
          const metadata = metadataMap[slug];
          const envConfig = directConfig.env || {};

          combinedSkills.push({
            id: metadata?.skillKey || slug,
            slug,
            name: metadata?.name || previous?.name || slug,
            description:
              metadata?.description ||
              previous?.description ||
              'Installed locally and awaiting runtime discovery.',
            enabled: previous?.enabled || false,
            runtimeEnabled: false,
            installedOnDisk: true,
            loadedInGateway: false,
            runtimeStatus: gatewayData ? 'not_loaded' : 'unknown',
            runtimeReason: gatewayData ? 'not_loaded' : 'gateway_offline',
            runtimeError: undefined,
            icon: normalizeSkillIcon(previous?.icon, metadata?.emoji),
            version: previous?.version || '',
            author: previous?.author,
            config: directConfig,
            primaryEnv: metadata?.primaryEnv,
            requirements: metadata?.requires,
            configurable: Boolean(
              metadata?.primaryEnv ||
              metadata?.requires?.env?.length ||
              directConfig.apiKey ||
              Object.keys(envConfig).length,
            ),
            isCore: false,
            isBundled: false,
            isPreinstalled: Boolean(metadata?.isProjectBundled),
          });
        });
      }

      set({ skills: combinedSkills, loading: false });
    } catch (error) {
      console.error('Failed to fetch skills:', error);
      const appError = normalizeAppError(error, { module: 'skills', operation: 'fetch' });
      set({
        loading: false,
        error: mapErrorCodeToSkillErrorKey(appError.code, 'fetch') || appError.message,
      });
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
      await get().fetchSkills();
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
      await get().fetchSkills();
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
    const { updateSkill } = get();
    const gatewayStatus = useGatewayStore.getState().status;
    const skill = get().skills.find((s) => s.id === skillId);

    if (gatewayStatus.state !== 'running') {
      throw new Error('Gateway is not running');
    }
    if (!skill?.loadedInGateway) {
      throw new Error('Skill is not loaded in Gateway');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: true });
      updateSkill(skillId, {
        enabled: true,
        runtimeEnabled: true,
        loadedInGateway: true,
        runtimeStatus: 'loaded',
        runtimeReason: undefined,
      });
    } catch (error) {
      console.error('Failed to enable skill:', error);
      throw error;
    }
  },

  disableSkill: async (skillId) => {
    const { updateSkill, skills } = get();
    const gatewayStatus = useGatewayStore.getState().status;

    const skill = skills.find((s) => s.id === skillId);
    if (skill?.isCore) {
      throw new Error('Cannot disable core skill');
    }
    if (gatewayStatus.state !== 'running') {
      throw new Error('Gateway is not running');
    }
    if (!skill?.loadedInGateway) {
      throw new Error('Skill is not loaded in Gateway');
    }

    try {
      await useGatewayStore.getState().rpc('skills.update', { skillKey: skillId, enabled: false });
      updateSkill(skillId, {
        enabled: false,
        runtimeEnabled: false,
        loadedInGateway: true,
        runtimeStatus: 'loaded',
        runtimeReason: undefined,
      });
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
