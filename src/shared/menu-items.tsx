import type { ReactNode } from 'react';
import {
  Bot,
  Bell,
  Clock,
  Copy,
  MessageCircleMore,
  Moon,
  Puzzle,
  Settings as SettingsIcon,
  Shield,
} from 'lucide-react';

/** IDs of all customizable menu items (everything except the "New Chat" button). */
export type MenuItemId =
  | 'models'
  | 'agents'
  | 'channels'
  | 'skills'
  | 'cron'
  | 'security'
  | 'reminders'
  | 'dreams'
  | 'settings';

export interface MenuItemConfig {
  id: MenuItemId;
  /** Used for i18n key: `sidebar.${i18nKey}` */
  i18nKey: string;
  /** Icon element — rendered via Lucide SVG in the sidebar. */
  icon: ReactNode;
  to: string;
  devOnly?: boolean;
}

/** All customizable menu items with their i18n keys (ordered for display). */
export const ALL_MENU_ITEMS: MenuItemConfig[] = [
  { id: 'skills', i18nKey: 'skills', icon: <Puzzle className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/skills' },
  { id: 'cron', i18nKey: 'cronTasks', icon: <Clock className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/cron' },
  { id: 'models', i18nKey: 'models', icon: <Bot className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/models' },
  { id: 'agents', i18nKey: 'agents', icon: <Copy className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/agents' },
  { id: 'channels', i18nKey: 'channels', icon: <MessageCircleMore className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/channels' },
  { id: 'security', i18nKey: 'security', icon: <Shield className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/security' },
  { id: 'reminders', i18nKey: 'reminders', icon: <Bell className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/reminders' },
  { id: 'dreams', i18nKey: 'openClawDreams', icon: <Moon className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/dreams', devOnly: true },
  { id: 'settings', i18nKey: 'settings', icon: <SettingsIcon className="h-[16px] w-[16px]" strokeWidth={2} />, to: '/settings' },
];

/** IDs of all customizable menu items. */
export const ALL_MENU_IDS: MenuItemId[] = ALL_MENU_ITEMS.map((item) => item.id);

/** IDs of menu items shown as shortcuts by default (only skills and cron). */
export const DEFAULT_SHORTCUT_MENU_IDS: MenuItemId[] = ['skills', 'cron'];
