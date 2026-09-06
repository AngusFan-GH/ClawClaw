import { create } from 'zustand';
import { invokeIpc } from '@/lib/api-client';
import type { MarketplaceSkill, Skill, SkillSourceDir, SkillSourceStat } from '@/types/skill';
interface SkillsState { skills: Skill[]; currentAgentId: string | null; sourceStats: SkillSourceStat[]; sourceDirs: SkillSourceDir[]; searchResults: MarketplaceSkill[]; loading: boolean; searching: boolean; searchError: string | null; installing: Record<string, boolean>; error: string | null; fetchSkills: (agentId?: string, options?: { includeRuntime?: boolean; silent?: boolean }) => Promise<void>; searchSkills: (query: string) => Promise<void>; installSkill: (slug: string, version?: string) => Promise<void>; uninstallSkill: (slug: string) => Promise<void>; enableSkill: (id: string) => Promise<void>; disableSkill: (id: string) => Promise<void>; setSkills: (skills: Skill[]) => void; updateSkill: (id: string, updates: Partial<Skill>) => void; }
const asSkill = (value: Skill) => ({ ...value, runtimeEnabled: value.enabled, loadedInGateway: value.enabled, runtimeStatus: value.enabled ? 'loaded' as const : 'not_loaded' as const });
export const useSkillsStore = create<SkillsState>((set, get) => ({
  skills: [], currentAgentId: null, sourceStats: [], sourceDirs: [], searchResults: [], loading: false, searching: false, searchError: null, installing: {}, error: null,
  fetchSkills: async (agentId, options) => { if (!options?.silent) set({ loading: true }); try { const skills = (await invokeIpc<Skill[]>('skill:list')).map(asSkill); set({ skills, currentAgentId: agentId || null, sourceStats: [{ key: 'local', label: 'Local catalog', count: skills.length }], sourceDirs: [], loading: false, error: null }); } catch (error) { set({ loading: false, error: String(error) }); } },
  searchSkills: async query => { set({ searching: true, searchError: null }); try { const skills = await invokeIpc<Skill[]>('skill:search', query); set({ searchResults: skills.map(x => ({ slug: x.slug || x.id, name: x.name, description: x.description, version: x.version || 'local', icon: x.icon })) }); } catch (error) { set({ searchError: String(error) }); } finally { set({ searching: false }); } },
  installSkill: async slug => { set(s => ({ installing: { ...s.installing, [slug]: true } })); try { await invokeIpc('skill:install', slug); await get().fetchSkills(); } finally { set(s => { const installing = { ...s.installing }; delete installing[slug]; return { installing }; }); } },
  uninstallSkill: async slug => { await invokeIpc('skill:uninstall', slug); await get().fetchSkills(); },
  enableSkill: async id => { await invokeIpc('skill:setEnabled', id, true); await get().fetchSkills(); },
  disableSkill: async id => { await invokeIpc('skill:setEnabled', id, false); await get().fetchSkills(); },
  setSkills: skills => set({ skills }), updateSkill: (id, updates) => set(s => ({ skills: s.skills.map(x => x.id === id ? { ...x, ...updates } : x) })),
}));
