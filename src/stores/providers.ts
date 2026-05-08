/**
 * Provider State Store
 * Manages AI provider configurations
 */
import { create } from 'zustand';
import type {
  ProviderAccount,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
import { hostApiFetch } from '@/lib/host-api';
import {
  fetchProviderSnapshot,
} from '@/lib/provider-accounts';
import { useRuntimeApplyStore } from './runtime-apply';

// Re-export types for consumers that imported from here
export type {
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
export type { ProviderSnapshot } from '@/lib/provider-accounts';

function ensureProviderMutationSucceeded(
  result: { success: boolean; error?: string },
  fallbackMessage: string,
): void {
  if (!result.success) {
    throw new Error(result.error || fallbackMessage);
  }
}

async function refreshProvidersAfterMutation(refreshProviderSnapshot: () => Promise<void>): Promise<void> {
  await useRuntimeApplyStore.getState().refreshPlan();
  await refreshProviderSnapshot();
}

interface ProviderState {
  statuses: ProviderWithKeyInfo[];
  accounts: ProviderAccount[];
  vendors: ProviderVendorInfo[];
  defaultAccountId: string | null;
  loading: boolean;
  error: string | null;
  
  // Actions
  refreshProviderSnapshot: () => Promise<void>;
  createAccount: (account: ProviderAccount, apiKey?: string) => Promise<void>;
  removeAccount: (accountId: string) => Promise<void>;
  updateAccount: (
    accountId: string,
    updates: Partial<ProviderAccount>,
    apiKey?: string,
  ) => Promise<void>;
  setDefaultAccount: (accountId: string) => Promise<void>;
  validateAccountApiKey: (
    accountId: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
  getAccountApiKey: (accountId: string) => Promise<string | null>;
}

export const useProviderStore = create<ProviderState>((set, get) => ({
  statuses: [],
  accounts: [],
  vendors: [],
  defaultAccountId: null,
  loading: false,
  error: null,
  
  refreshProviderSnapshot: async () => {
    set({ loading: true, error: null });

    try {
      const snapshot = await fetchProviderSnapshot();
      set({ 
        statuses: Array.isArray(snapshot.statuses) ? snapshot.statuses : [],
        accounts: Array.isArray(snapshot.accounts) ? snapshot.accounts : [],
        vendors: Array.isArray(snapshot.vendors) ? snapshot.vendors : [],
        defaultAccountId: snapshot.defaultAccountId ?? null,
        loading: false 
      });
    } catch (error) {
      set({ error: String(error), loading: false });
    }
  },

  createAccount: async (account, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
        method: 'POST',
        body: JSON.stringify({ account, apiKey }),
      });

      ensureProviderMutationSucceeded(result, 'Failed to create provider account');
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to add account:', error);
      throw error;
    }
  },

  updateAccount: async (accountId, updates, apiKey) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'PUT',
        body: JSON.stringify({ updates, apiKey }),
      });

      ensureProviderMutationSucceeded(result, 'Failed to update provider account');
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to update account:', error);
      throw error;
    }
  },

  removeAccount: async (accountId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(`/api/provider-accounts/${encodeURIComponent(accountId)}`, {
        method: 'DELETE',
      });

      ensureProviderMutationSucceeded(result, 'Failed to delete provider account');
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to delete account:', error);
      throw error;
    }
  },

  setDefaultAccount: async (accountId) => {
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts/default', {
        method: 'PUT',
        body: JSON.stringify({ accountId }),
      });

      ensureProviderMutationSucceeded(result, 'Failed to set default provider account');
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to set default account:', error);
      throw error;
    }
  },
  
  validateAccountApiKey: async (providerId, apiKey, options) => {
    try {
      const result = await hostApiFetch<{ valid: boolean; error?: string }>('/api/providers/validate', {
        method: 'POST',
        body: JSON.stringify({ providerId, apiKey, options }),
      });
      return result;
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },
  
  getAccountApiKey: async (providerId) => {
    try {
      const result = await hostApiFetch<{ apiKey: string | null }>(`/api/providers/${encodeURIComponent(providerId)}/api-key`);
      return result.apiKey;
    } catch {
      return null;
    }
  },
}));
