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
import { invokeIpc } from '@/lib/api-client';
import {
  fetchProviderSnapshot,
} from '@/lib/provider-accounts';

// Re-export types for consumers that imported from here
export type {
  ProviderAccount,
  ProviderConfig,
  ProviderVendorInfo,
  ProviderWithKeyInfo,
} from '@/lib/providers';
export type { ProviderSnapshot } from '@/lib/provider-accounts';

async function refreshProvidersAfterMutation(refreshProviderSnapshot: () => Promise<void>): Promise<void> {
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
      await invokeIpc('provider:save', account);
      if (apiKey) await invokeIpc('provider:setApiKey', account.id, apiKey);
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to add account:', error);
      throw error;
    }
  },

  updateAccount: async (accountId, updates, apiKey) => {
    try {
      const existing = get().accounts.find((candidate) => candidate.id === accountId);
      if (!existing) throw new Error('Provider account not found');
      await invokeIpc('provider:updateWithKey', { ...existing, ...updates, id: accountId }, apiKey);
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to update account:', error);
      throw error;
    }
  },

  removeAccount: async (accountId) => {
    try {
      await invokeIpc('provider:delete', accountId);
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to delete account:', error);
      throw error;
    }
  },

  setDefaultAccount: async (accountId) => {
    try {
      await invokeIpc('provider:setDefault', accountId);
      await refreshProvidersAfterMutation(get().refreshProviderSnapshot);
    } catch (error) {
      console.error('Failed to set default account:', error);
      throw error;
    }
  },
  
  validateAccountApiKey: async (providerId, apiKey, options) => {
    try {
      void providerId; void options;
      return apiKey.trim() ? { valid: true } : { valid: false, error: 'API key is required' };
    } catch (error) {
      return { valid: false, error: String(error) };
    }
  },
  
  getAccountApiKey: async (providerId) => {
    void providerId;
    // Secrets are write-only from the renderer; editing a provider leaves the field blank.
    return null;
  },
}));
