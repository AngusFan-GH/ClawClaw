/**
 * Settings State Store
 * Manages application settings
 */
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import i18n from '@/i18n';
import { hostApiFetch } from '@/lib/host-api';
import type { ReminderItem } from '@/shared/reminders';
import { normalizeReminders } from '@/shared/reminders';
import { DEFAULT_SHORTCUT_MENU_IDS, type MenuItemId } from '@/shared/menu-items';

type Theme = 'light' | 'dark' | 'system';
type UpdateChannel = 'stable';
type ProxyMode = 'system' | 'custom' | 'direct';

interface SettingsState {
  // General
  theme: Theme;
  language: string;
  startMinimized: boolean;
  launchAtStartup: boolean;

  // Gateway
  gatewayAutoStart: boolean;
  gatewayPort: number;
  proxyMode: ProxyMode;
  proxyEnabled: boolean;
  proxyServer: string;
  proxyHttpServer: string;
  proxyHttpsServer: string;
  proxyAllServer: string;
  proxyBypassRules: string;

  // Update
  updateChannel: UpdateChannel;
  autoCheckUpdate: boolean;
  autoDownloadUpdate: boolean;

  // UI State
  sidebarCollapsed: boolean;
  shortcutMenuItems: MenuItemId[];
  devModeUnlocked: boolean;
  slashCommandHintsEnabled: boolean;
  reminders: ReminderItem[];

  // Memory
  sessionMemoryEnabled: boolean;
  memorySearchEnabled: boolean;

  // Setup
  initialized: boolean;
  setupComplete: boolean;

  // Actions
  init: () => Promise<void>;
  setTheme: (theme: Theme) => void;
  setLanguage: (language: string) => void;
  setStartMinimized: (value: boolean) => void;
  setLaunchAtStartup: (value: boolean) => void;
  setGatewayAutoStart: (value: boolean) => void;
  setGatewayPort: (port: number) => void;
  setProxyMode: (value: ProxyMode) => void;
  setProxyEnabled: (value: boolean) => void;
  setProxyServer: (value: string) => void;
  setProxyHttpServer: (value: string) => void;
  setProxyHttpsServer: (value: string) => void;
  setProxyAllServer: (value: string) => void;
  setProxyBypassRules: (value: string) => void;
  setUpdateChannel: (channel: UpdateChannel) => void;
  setAutoCheckUpdate: (value: boolean) => void;
  setAutoDownloadUpdate: (value: boolean) => void;
  setSidebarCollapsed: (value: boolean) => void;
  setShortcutMenuItems: (value: MenuItemId[]) => void;
  setDevModeUnlocked: (value: boolean) => void;
  setSlashCommandHintsEnabled: (value: boolean) => void;
  setReminders: (value: ReminderItem[]) => void;
  setSessionMemoryEnabled: (value: boolean) => void;
  setMemorySearchEnabled: (value: boolean) => void;
  markSetupComplete: () => void;
  resetSettings: () => void;
}

const defaultSettings = {
  theme: 'system' as Theme,
  language: 'zh',
  startMinimized: false,
  launchAtStartup: false,
  gatewayAutoStart: true,
  gatewayPort: 18789,
  proxyMode: 'system' as ProxyMode,
  proxyEnabled: false,
  proxyServer: '',
  proxyHttpServer: '',
  proxyHttpsServer: '',
  proxyAllServer: '',
  proxyBypassRules: '<local>;localhost;127.0.0.1;::1',
  updateChannel: 'stable' as UpdateChannel,
  autoCheckUpdate: true,
  autoDownloadUpdate: false,
  sidebarCollapsed: false,
  shortcutMenuItems: DEFAULT_SHORTCUT_MENU_IDS,
  devModeUnlocked: false,
  slashCommandHintsEnabled: false,
  reminders: [] as ReminderItem[],
  sessionMemoryEnabled: true,
  memorySearchEnabled: true,
  setupComplete: false,
  initialized: false,
};

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set) => {
      const syncFromMain = async (): Promise<void> => {
        const settings = await hostApiFetch<Partial<typeof defaultSettings>>('/api/settings');
        const normalizedProxyMode =
          settings.proxyMode
          || (settings.proxyEnabled ? 'custom' : 'system');
        set((state) => ({
          ...state,
          ...settings,
          reminders: normalizeReminders(settings.reminders),
          proxyMode: normalizedProxyMode,
          proxyEnabled: normalizedProxyMode === 'custom',
          initialized: true,
        }));
        if (settings.language) {
          i18n.changeLanguage(settings.language);
        }
      };

      const persistMainSettings = async (patch: Partial<typeof defaultSettings>): Promise<void> => {
        await hostApiFetch<{ success: boolean }>('/api/settings', {
          method: 'PUT',
          body: JSON.stringify(patch),
        });
        await syncFromMain();
      };

      const persistReminders = async (reminders: ReminderItem[]): Promise<void> => {
        await hostApiFetch<{ success: boolean }>('/api/security/reminders', {
          method: 'PUT',
          body: JSON.stringify({ reminders }),
        });
        await syncFromMain();
      };

      return ({
      ...defaultSettings,

      init: async () => {
        try {
          await syncFromMain();
        } catch {
          // Keep renderer-persisted settings as a fallback when the main
          // process store is not reachable.
          set({ initialized: true });
        }
      },

      setTheme: (theme) => {
        set({ theme });
        void persistMainSettings({ theme }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setLanguage: (language) => {
        i18n.changeLanguage(language);
        set({ language });
        void persistMainSettings({ language }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setStartMinimized: (startMinimized) => {
        set({ startMinimized });
        void persistMainSettings({ startMinimized }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setLaunchAtStartup: (launchAtStartup) => {
        set({ launchAtStartup });
        void persistMainSettings({ launchAtStartup }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setGatewayAutoStart: (gatewayAutoStart) => {
        set({ gatewayAutoStart });
        void persistMainSettings({ gatewayAutoStart }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setGatewayPort: (gatewayPort) => {
        set({ gatewayPort });
        void persistMainSettings({ gatewayPort }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setProxyMode: (proxyMode) => set({ proxyMode, proxyEnabled: proxyMode === 'custom' }),
      setProxyEnabled: (proxyEnabled) => set({ proxyEnabled, proxyMode: proxyEnabled ? 'custom' : 'system' }),
      setProxyServer: (proxyServer) => set({ proxyServer }),
      setProxyHttpServer: (proxyHttpServer) => set({ proxyHttpServer }),
      setProxyHttpsServer: (proxyHttpsServer) => set({ proxyHttpsServer }),
      setProxyAllServer: (proxyAllServer) => set({ proxyAllServer }),
      setProxyBypassRules: (proxyBypassRules) => set({ proxyBypassRules }),
      setUpdateChannel: (updateChannel) => {
        set({ updateChannel });
        void persistMainSettings({ updateChannel }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setAutoCheckUpdate: (autoCheckUpdate) => {
        set({ autoCheckUpdate });
        void persistMainSettings({ autoCheckUpdate }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setAutoDownloadUpdate: (autoDownloadUpdate) => {
        set({ autoDownloadUpdate });
        void persistMainSettings({ autoDownloadUpdate }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setSidebarCollapsed: (sidebarCollapsed) => {
        set({ sidebarCollapsed });
        void persistMainSettings({ sidebarCollapsed }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setShortcutMenuItems: (shortcutMenuItems) => {
        set({ shortcutMenuItems });
        void persistMainSettings({ shortcutMenuItems }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setDevModeUnlocked: (devModeUnlocked) => {
        set({ devModeUnlocked });
        void persistMainSettings({ devModeUnlocked }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setSlashCommandHintsEnabled: (slashCommandHintsEnabled) => {
        set({ slashCommandHintsEnabled });
        void persistMainSettings({ slashCommandHintsEnabled }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setReminders: (reminders) => {
        const nextReminders = normalizeReminders(reminders);
        set({ reminders: nextReminders });
        void persistReminders(nextReminders).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setSessionMemoryEnabled: (sessionMemoryEnabled) => {
        set({ sessionMemoryEnabled });
        void persistMainSettings({ sessionMemoryEnabled }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      setMemorySearchEnabled: (memorySearchEnabled) => {
        set({ memorySearchEnabled });
        void persistMainSettings({ memorySearchEnabled }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      markSetupComplete: () => {
        set({ setupComplete: true });
        void persistMainSettings({ setupComplete: true }).catch(() => {
          void syncFromMain().catch(() => {});
        });
      },
      resetSettings: () => set(defaultSettings),
    });
    },
    {
      name: 'clawclaw-settings',
      partialize: (state) => {
        const { initialized: _initialized, ...persisted } = state;
        return persisted;
      },
    }
  )
);
