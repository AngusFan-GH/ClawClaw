import { create } from 'zustand';
import { hostApiFetch } from '@/lib/host-api';
import type { RuntimeApplyPlanSnapshot } from '@/shared/runtime-apply';

interface RuntimeApplyState {
  plan: RuntimeApplyPlanSnapshot;
  loading: boolean;
  applying: boolean;
  error: string | null;
  refreshPlan: () => Promise<void>;
  applyPendingChanges: () => Promise<{ triggered: boolean; accepted: boolean; action: 'none' | 'reload' | 'restart' }>;
  discardPendingChanges: () => Promise<void>;
}

const EMPTY_PLAN: RuntimeApplyPlanSnapshot = {
  pending: [],
  count: 0,
  requires: 'none',
  action: 'none',
};

export const useRuntimeApplyStore = create<RuntimeApplyState>((set) => ({
  plan: EMPTY_PLAN,
  loading: false,
  applying: false,
  error: null,

  refreshPlan: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; plan?: RuntimeApplyPlanSnapshot; error?: string }>(
        '/api/runtime/apply-plan',
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to load pending changes');
      }
      set({ plan: result.plan ?? EMPTY_PLAN, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  applyPendingChanges: async () => {
    set({ applying: true, error: null });
    try {
      const result = await hostApiFetch<{
        success: boolean;
        snapshot?: RuntimeApplyPlanSnapshot;
        applied?: { action: 'none' | 'reload' | 'restart'; triggered: boolean; accepted: boolean };
        error?: string;
      }>('/api/runtime/apply', { method: 'POST' });
      if (!result.success) {
        throw new Error(result.error || 'Failed to apply pending changes');
      }
      const applied = result.applied ?? { action: 'none' as const, triggered: false, accepted: false };
      set({ plan: result.snapshot ?? EMPTY_PLAN, applying: false });
      return applied;
    } catch (error) {
      set({ error: String(error), applying: false });
      throw error;
    }
  },

  discardPendingChanges: async () => {
    set({ loading: true, error: null });
    try {
      const result = await hostApiFetch<{ success: boolean; plan?: RuntimeApplyPlanSnapshot; error?: string }>(
        '/api/runtime/apply-plan',
        { method: 'DELETE' },
      );
      if (!result.success) {
        throw new Error(result.error || 'Failed to discard pending changes');
      }
      set({ plan: result.plan ?? EMPTY_PLAN, loading: false });
    } catch (error) {
      set({ error: String(error), loading: false });
      throw error;
    }
  },
}));
