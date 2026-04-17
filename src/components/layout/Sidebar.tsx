/**
 * Sidebar Component
 * Navigation sidebar with menu items.
 * No longer fixed - sits inside the flex layout below the title bar.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { NavLink, useLocation, useNavigate } from 'react-router-dom';
import {
  MessageCircleMore,
  Puzzle,
  Clock,
  Settings as SettingsIcon,
  Shield,
  PanelLeftClose,
  PanelLeft,
  SquarePen,
  Trash2,
  Bot,
  Bell,
  ChevronUp,
  ChevronDown,
  ChevronRight,
  Copy,
  Menu,
  CornerUpLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useSettingsStore } from '@/stores/settings';
import { DEFAULT_SESSION_KEY, isBackgroundSession, useChatStore } from '@/stores/chat';
import { useAgentsStore } from '@/stores/agents';
import { useGatewayStore } from '@/stores/gateway';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import { useTranslation } from 'react-i18next';
import logoFullSvg from '@/assets/logo-full.svg';
import { type MenuItemConfig, type MenuItemId } from '@/shared/menu-items';

/** Menu items with icons attached. Defined here so icons (lucide) are imported in one place. */
const SIDEBAR_MENU_ITEMS: MenuItemConfig[] = [
  {
    id: 'skills',
    i18nKey: 'skills',
    icon: <Puzzle className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/skills',
  },
  {
    id: 'cron',
    i18nKey: 'cronTasks',
    icon: <Clock className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/cron',
  },
  {
    id: 'models',
    i18nKey: 'models',
    icon: <Bot className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/models',
  },
  {
    id: 'agents',
    i18nKey: 'agents',
    icon: <Copy className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/agents',
  },
  {
    id: 'channels',
    i18nKey: 'channels',
    icon: <MessageCircleMore className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/channels',
  },
  {
    id: 'security',
    i18nKey: 'security',
    icon: <Shield className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/security',
  },
  {
    id: 'reminders',
    i18nKey: 'reminders',
    icon: <Bell className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/reminders',
  },
  {
    id: 'settings',
    i18nKey: 'settings',
    icon: <SettingsIcon className="h-[18px] w-[18px]" strokeWidth={2} />,
    to: '/settings',
  },
];

type SessionBucketKey =
  | 'today'
  | 'yesterday'
  | 'withinWeek'
  | 'withinTwoWeeks'
  | 'withinMonth'
  | 'older';

interface NavItemProps {
  to: string;
  icon: React.ReactNode;
  label: string;
  badge?: string;
  collapsed?: boolean;
  onClick?: () => void;
}

function NavItem({ to, icon, label, badge, collapsed, onClick }: NavItemProps) {
  return (
    <NavLink
      to={to}
      onClick={onClick}
      className={({ isActive }) =>
        cn(
          'flex items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14px] font-medium transition-colors',
          'hover:bg-black/5 dark:hover:bg-white/10 text-foreground/80',
          isActive ? 'bg-accent/70 text-foreground shadow-sm' : '',
          collapsed && 'justify-center px-0'
        )
      }
    >
      {({ isActive }) => (
        <>
          <div
            className={cn(
              'flex shrink-0 items-center justify-center',
              isActive ? 'text-foreground' : 'text-muted-foreground'
            )}
          >
            {icon}
          </div>
          {!collapsed && (
            <>
              <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                {label}
              </span>
              {badge && (
                <Badge variant="secondary" className="ml-auto shrink-0">
                  {badge}
                </Badge>
              )}
            </>
          )}
        </>
      )}
    </NavLink>
  );
}

function getBackgroundSessionKindLabel(session: {
  key: string;
  kind?: string;
  spawnedBy?: string;
  parentSessionKey?: string;
  forkedFromParent?: boolean;
  subagentRole?: string;
}, translate: (key: string, fallback: string) => string): string {
  const kind = (session.kind || '').toLowerCase();
  if (kind === 'cron' || session.key.includes(':cron:')) {
    return translate('chat:history.backgroundKindCron', 'Cron');
  }
  if (
    kind === 'subagent'
    || session.key.includes(':subagent:')
    || session.key.includes(':acp:')
    || Boolean(session.spawnedBy)
    || session.forkedFromParent === true
    || Boolean(session.subagentRole)
  ) {
    return translate('chat:history.backgroundKindSubagent', 'Subagent');
  }
  return translate('chat:history.backgroundKindTask', 'Task');
}

function getSessionBucket(activityMs: number, nowMs: number): SessionBucketKey {
  if (!activityMs || activityMs <= 0) return 'older';

  const now = new Date(nowMs);
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  const startOfYesterday = startOfToday - 24 * 60 * 60 * 1000;

  if (activityMs >= startOfToday) return 'today';
  if (activityMs >= startOfYesterday) return 'yesterday';

  const daysAgo = (startOfToday - activityMs) / (24 * 60 * 60 * 1000);
  if (daysAgo <= 7) return 'withinWeek';
  if (daysAgo <= 14) return 'withinTwoWeeks';
  if (daysAgo <= 30) return 'withinMonth';
  return 'older';
}

function isMainSessionKey(key: string): boolean {
  return key.endsWith(':main');
}

function resolveAgentDisplayName(agent: { gateway: { id: string; name?: string; identity?: { name?: string } } }): string {
  return agent.gateway.name?.trim() || agent.gateway.identity?.name?.trim() || agent.gateway.id;
}

export function Sidebar() {
  const sidebarCollapsed = useSettingsStore((state) => state.sidebarCollapsed);
  const setSidebarCollapsed = useSettingsStore((state) => state.setSidebarCollapsed);
  const shortcutMenuItems = useSettingsStore((state) => state.shortcutMenuItems);

  const sessions = useChatStore((s) => s.sessions);
  const sessionsLoading = useChatStore((s) => s.sessionsLoading);
  const sessionsHydrated = useChatStore((s) => s.sessionsHydrated);
  const currentSessionKey = useChatStore((s) => s.currentSessionKey);
  const messages = useChatStore((s) => s.messages);
  const sessionLabels = useChatStore((s) => s.sessionLabels);
  const sessionLastActivity = useChatStore((s) => s.sessionLastActivity);
  const pendingLocalSessionKeys = useChatStore((s) => s.pendingLocalSessionKeys);
  const switchSession = useChatStore((s) => s.switchSession);
  const newSession = useChatStore((s) => s.newSession);
  const deleteSession = useChatStore((s) => s.deleteSession);
  const agents = useAgentsStore((s) => s.agents);
  const fetchAgents = useAgentsStore((s) => s.fetchAgents);
  const gatewayStatus = useGatewayStore((s) => s.status);
  const gatewayInitialized = useGatewayStore((s) => s.isInitialized);
  const displayGatewayState = gatewayInitialized ? gatewayStatus.state : 'starting';
  const isGatewayRunning = displayGatewayState === 'running';
  const { t } = useTranslation(['common', 'chat']);

  const navigate = useNavigate();
  const location = useLocation();
  const isOnChat = location.pathname === '/';

  const openSession = (sessionKey: string) => {
    if (isOnChat) {
      if (currentSessionKey !== sessionKey) {
        switchSession(sessionKey);
      }
      return;
    }
    navigate('/', { state: { forceSessionKey: sessionKey } });
  };

  const openNewChat = (agentId?: string) => {
    if (isOnChat) {
      newSession(agentId);
      return;
    }
    navigate('/', { state: { createNewSession: true, agentId } });
  };

  const getSessionLabel = (
    key: string,
    displayName?: string,
    label?: string,
    derivedTitle?: string,
    subagentRole?: string,
  ) => {
    const derivedLabel = sessionLabels[key] ?? derivedTitle ?? label;
    if (derivedLabel) return derivedLabel;
    const normalizedDisplayName = displayName?.trim();
    const agentLabel = getSessionAgentLabel(key).trim();
    if (
      normalizedDisplayName
      && normalizedDisplayName !== key
      && normalizedDisplayName !== agentLabel
    ) {
      return normalizedDisplayName;
    }
    const normalizedRole = subagentRole?.trim();
    if (normalizedRole) return normalizedRole;
    if (pendingLocalSessionKeys[key]) return t('common:sidebar.newChat');
    if (key === DEFAULT_SESSION_KEY) return t('common:sidebar.newChat');
    if (key.includes(':subagent:') || key.includes(':acp:')) {
      return t('chat:history.backgroundKindSubagent', 'Subagent');
    }
    return key;
  };

  const [sessionToDelete, setSessionToDelete] = useState<{ key: string; label: string } | null>(
    null
  );
  const [nowMs, setNowMs] = useState(() => Date.now()); // lazy init: computed at mount time, not module-load time
  const [settingsMenuOpen, setSettingsMenuOpen] = useState(false);
  const [backgroundExpanded, setBackgroundExpanded] = useState(false);
  const [showCronBackground, setShowCronBackground] = useState(false);
  const [expandedTaskParents, setExpandedTaskParents] = useState<Record<string, boolean>>({});
  const settingsMenuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    void fetchAgents();
  }, [fetchAgents]);

  const agentNameMap = useMemo(
    () => new Map((agents ?? []).map((agent) => [agent.gateway.id, resolveAgentDisplayName(agent)])),
    [agents]
  );
  const sessionByKey = useMemo(
    () => new Map((sessions ?? []).map((session) => [session.key, session])),
    [sessions]
  );

  const getSessionAgentLabel = (key: string) => {
    const parts = key.split(':');
    const agentId = parts[1] || 'main';
    return agentNameMap.get(agentId) || agentId;
  };

  const handleDeleteSessionClick = async (key: string, label: string) => {
    const isBlankPendingSession =
      Boolean(pendingLocalSessionKeys[key]) && (currentSessionKey !== key || messages.length === 0);

    if (isBlankPendingSession) {
      await deleteSession(key);
      if (currentSessionKey === key) navigate('/');
      return;
    }

    setSessionToDelete({ key, label });
  };

  useEffect(() => {
    const timer = window.setInterval(() => {
      setNowMs(Date.now());
    }, 60 * 1000);
    return () => window.clearInterval(timer);
  }, []);

  useEffect(() => {
    if (!settingsMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (!settingsMenuRef.current?.contains(event.target as Node)) {
        setSettingsMenuOpen(false);
      }
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setSettingsMenuOpen(false);
      }
    };

    window.addEventListener('mousedown', handlePointerDown);
    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.removeEventListener('mousedown', handlePointerDown);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [settingsMenuOpen]);

  const visibleSessions = useMemo(() => {
    return sessions.filter((session) => {
      const isDefaultPlaceholder =
        session.key === DEFAULT_SESSION_KEY
        && !sessionLabels[session.key]
        && (!session.displayName || session.displayName === DEFAULT_SESSION_KEY)
        && !pendingLocalSessionKeys[session.key];

      return !isDefaultPlaceholder;
    });
  }, [pendingLocalSessionKeys, sessionLabels, sessions]);

  const conversationSessions = useMemo(
    () => visibleSessions.filter((session) => !isBackgroundSession(session)),
    [visibleSessions],
  );
  const backgroundSessions = useMemo(
    () => visibleSessions.filter((session) => isBackgroundSession(session)),
    [visibleSessions],
  );
  const nonCronBackgroundSessions = useMemo(
    () => backgroundSessions.filter((session) => !(session.kind === 'cron' || session.key.includes(':cron:'))),
    [backgroundSessions]
  );
  const cronBackgroundSessions = useMemo(
    () => backgroundSessions.filter((session) => session.kind === 'cron' || session.key.includes(':cron:')),
    [backgroundSessions]
  );

  const sessionBuckets: Array<{ key: SessionBucketKey; label: string; sessions: typeof sessions }> =
    [
      { key: 'today', label: t('chat:historyBuckets.today'), sessions: [] },
      { key: 'yesterday', label: t('chat:historyBuckets.yesterday'), sessions: [] },
      { key: 'withinWeek', label: t('chat:historyBuckets.withinWeek'), sessions: [] },
      { key: 'withinTwoWeeks', label: t('chat:historyBuckets.withinTwoWeeks'), sessions: [] },
      { key: 'withinMonth', label: t('chat:historyBuckets.withinMonth'), sessions: [] },
      { key: 'older', label: t('chat:historyBuckets.older'), sessions: [] },
    ];
  const sessionBucketMap = Object.fromEntries(
    sessionBuckets.map((bucket) => [bucket.key, bucket])
  ) as Record<SessionBucketKey, (typeof sessionBuckets)[number]>;

  for (const session of [...conversationSessions].sort(
    (a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
  )) {
    const bucketKey = getSessionBucket(sessionLastActivity[session.key] ?? 0, nowMs);
    sessionBucketMap[bucketKey].sessions.push(session);
  }

  const getParentSessionKey = (session: { spawnedBy?: string; parentSessionKey?: string }) =>
    session.spawnedBy?.trim() || session.parentSessionKey?.trim() || '';

  const getParentSessionLabel = (session: { spawnedBy?: string; parentSessionKey?: string }) => {
    const parentKey = getParentSessionKey(session);
    if (!parentKey) return '';
    const parent = sessionByKey.get(parentKey);
    if (parent) {
      return getSessionLabel(parent.key, parent.displayName, parent.label, parent.derivedTitle, parent.subagentRole);
    }
    return parentKey;
  };

  const conversationSessionKeys = useMemo(
    () => new Set(conversationSessions.map((session) => session.key)),
    [conversationSessions]
  );

  const resolveConversationParentKey = (session: { key: string; spawnedBy?: string; parentSessionKey?: string }) => {
    const seen = new Set<string>();
    let currentParentKey = getParentSessionKey(session);

    while (currentParentKey && !seen.has(currentParentKey)) {
      seen.add(currentParentKey);
      if (conversationSessionKeys.has(currentParentKey)) {
        return currentParentKey;
      }

      const parentSession = sessionByKey.get(currentParentKey);
      if (!parentSession) break;
      currentParentKey = getParentSessionKey(parentSession);
    }

    return '';
  };

  const nestedBackgroundSessions = useMemo(
    () => nonCronBackgroundSessions.filter((session) => Boolean(resolveConversationParentKey(session))),
    [nonCronBackgroundSessions, conversationSessionKeys, sessionByKey]
  );

  const nestedBackgroundSessionMap = useMemo(() => {
    const groups = new Map<string, typeof nestedBackgroundSessions>();

    for (const session of nestedBackgroundSessions) {
      const parentKey = resolveConversationParentKey(session);
      if (!parentKey) continue;
      const existing = groups.get(parentKey);
      if (existing) {
        existing.push(session);
      } else {
        groups.set(parentKey, [session]);
      }
    }

    for (const sessions of groups.values()) {
      sessions.sort((a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0));
    }

    return groups;
  }, [nestedBackgroundSessions, sessionLastActivity, conversationSessionKeys, sessionByKey]);

  const sortedBackgroundSessions = [
    ...nonCronBackgroundSessions.filter((session) => !resolveConversationParentKey(session)),
    ...(showCronBackground ? cronBackgroundSessions : []),
  ].sort(
    (a, b) => (sessionLastActivity[b.key] ?? 0) - (sessionLastActivity[a.key] ?? 0)
  );

  const backgroundSessionGroups = useMemo(() => {
    const groups = new Map<string, {
      id: string;
      parentSessionKey?: string;
      label: string;
      sessions: typeof sortedBackgroundSessions;
      latestActivity: number;
    }>();

    for (const session of sortedBackgroundSessions) {
      const parentSessionKey = getParentSessionKey(session);
      const groupId = parentSessionKey ? `parent:${parentSessionKey}` : 'standalone';
      const existing = groups.get(groupId);
      const activity = sessionLastActivity[session.key] ?? 0;

      if (existing) {
        existing.sessions.push(session);
        existing.latestActivity = Math.max(existing.latestActivity, activity);
        continue;
      }

      groups.set(groupId, {
        id: groupId,
        parentSessionKey: parentSessionKey || undefined,
        label: parentSessionKey
          ? getParentSessionLabel(session)
          : t('chat:history.backgroundGroupStandalone', 'Other background tasks'),
        sessions: [session],
        latestActivity: activity,
      });
    }

    return [...groups.values()].sort((a, b) => b.latestActivity - a.latestActivity);
  }, [getParentSessionLabel, sessionLastActivity, sortedBackgroundSessions, t]);

  const shortcutIds = new Set<MenuItemId>(shortcutMenuItems);
  const shortcutItems = shortcutMenuItems
    .map((id) => SIDEBAR_MENU_ITEMS.find((item) => item.id === id)!)
    .filter(Boolean);
  const popupItems = SIDEBAR_MENU_ITEMS.filter((item) => !shortcutIds.has(item.id));

  const settingsActive = shortcutItems.some((item) => location.pathname.startsWith(item.to)) || popupItems.some((item) => location.pathname.startsWith(item.to));
  const gatewayBadgeLabel = displayGatewayState === 'running'
    ? t('chat:toolbar.gatewayRunning')
    : displayGatewayState === 'error'
      ? t('chat:toolbar.gatewayError')
      : displayGatewayState === 'starting'
        ? t('chat:toolbar.gatewayStarting')
        : displayGatewayState === 'reconnecting'
          ? t('chat:toolbar.gatewayReconnecting')
          : t('chat:toolbar.gatewayStopped');
  const canRestartGateway = gatewayInitialized && (displayGatewayState === 'stopped' || displayGatewayState === 'error');

  return (
    <aside
      className={cn(
        'relative flex shrink-0 flex-col rounded-[16px] border border-black/10 bg-[#eceff3] shadow-[0_12px_30px_rgba(15,23,42,0.08)] transition-all duration-300 dark:border-white/10 dark:bg-[#16181c]',
        sidebarCollapsed ? 'w-16' : 'w-64'
      )}
    >
      {/* Top Header Toggle */}
      <div
        className={cn(
          'flex items-center p-2 h-12',
          sidebarCollapsed ? 'justify-center' : 'justify-between'
        )}
      >
        {!sidebarCollapsed && (
          <div className="flex items-center px-2 overflow-hidden">
            <img src={logoFullSvg} alt="ClawClaw" className="h-7 w-auto shrink-0" />
          </div>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="h-8 w-8 shrink-0 rounded-full text-muted-foreground hover:bg-black/5 dark:hover:bg-white/10"
          onClick={() => setSidebarCollapsed(!sidebarCollapsed)}
        >
          {sidebarCollapsed ? (
            <PanelLeft className="h-[18px] w-[18px]" />
          ) : (
            <PanelLeftClose className="h-[18px] w-[18px]" />
          )}
        </Button>
      </div>

      {/* Navigation */}
      <nav className="flex flex-col px-2 gap-0.5">
        <button
          onClick={() => {
            openNewChat();
          }}
          className={cn(
            'flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2 text-[14px] font-medium transition-colors mb-2',
            'bg-primary text-primary-foreground shadow-sm border border-transparent',
            sidebarCollapsed && 'justify-center px-0'
          )}
        >
          <div className="flex shrink-0 items-center justify-center text-inherit">
            <SquarePen className="h-[18px] w-[18px]" strokeWidth={2} />
          </div>
          {!sidebarCollapsed && (
            <span className="flex-1 text-left overflow-hidden text-ellipsis whitespace-nowrap">
              {t('sidebar.newChat')}
            </span>
          )}
        </button>

        {shortcutItems.map((item) => (
          <NavItem
            key={item.id}
            to={item.to}
            icon={item.icon}
            label={t(`sidebar.${item.i18nKey}`)}
            collapsed={sidebarCollapsed}
          />
        ))}
      </nav>

      {/* Session list 鈥?below Settings, only when expanded */}
      {!sidebarCollapsed && (sessionsLoading || !sessionsHydrated || visibleSessions.length > 0) && (
        <div className="mt-5 mb-20 min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-2 pb-3 pr-1">
          <div className="px-2.5 pb-2 text-[11px] font-semibold uppercase tracking-[0.16em] text-muted-foreground/55">
            {t('chat:history.title')}
          </div>
          {sessionsLoading || !sessionsHydrated ? (
            <div className="px-2.5 pt-2">
              <div className="rounded-[14px] border border-black/6 bg-white/55 px-3 py-3 text-[13px] text-muted-foreground shadow-[0_6px_16px_rgba(15,23,42,0.04)] dark:border-white/10 dark:bg-white/[0.04]">
                {isGatewayRunning
                  ? t('chat:history.loading', '正在恢复最近对话…')
                  : displayGatewayState === 'starting' || displayGatewayState === 'reconnecting'
                    ? t('chat:history.connectingGateway', '网关正在恢复连接')
                    : t('chat:history.waitingForGateway', '网关未连接，请启动或重启网关后再试')}
              </div>
            </div>
          ) : (
            <>
              {sessionBuckets.map((bucket) =>
                bucket.sessions.length > 0 ? (
                  <div key={bucket.key} className="pt-3 first:pt-1">
                    <div className="flex items-center gap-2 px-2.5 pb-2">
                      <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground/70">
                        {bucket.label}
                      </span>
                      <div className="h-px flex-1 bg-black/6 dark:bg-white/10" />
                    </div>
                    <div className="space-y-1">
                      {bucket.sessions.map((s) => {
                        const canDeleteSession = !isMainSessionKey(s.key);
                        const childSessions = nestedBackgroundSessionMap.get(s.key) ?? [];
                        const childTasksVisible = isOnChat
                          && (currentSessionKey === s.key
                            || childSessions.some((session) => session.key === currentSessionKey));
                        const childTasksExpanded = expandedTaskParents[s.key] === true;
                        return (
                          <div
                            key={s.key}
                            className={cn(
                              'group relative overflow-hidden rounded-[18px] border transition-all',
                              isOnChat && currentSessionKey === s.key
                                ? 'border-black/8 bg-white/90 shadow-[0_10px_22px_rgba(15,23,42,0.06)] dark:border-white/12 dark:bg-white/[0.08]'
                                : 'border-transparent bg-black/[0.025] dark:bg-white/[0.02]'
                            )}
                          >
                            <div className="relative flex items-center">
                              <button
                                onClick={() => {
                                  openSession(s.key);
                                }}
                                className={cn(
                                  'w-full text-left px-3 py-2.5 pr-8 transition-all',
                                  'hover:bg-white/55 dark:hover:bg-white/[0.06]',
                                  isOnChat && currentSessionKey === s.key
                                    ? 'text-foreground font-semibold'
                                    : 'text-foreground/78'
                                )}
                              >
                                <div className="flex min-w-0 items-center gap-2.5">
                                  <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                                    {getSessionLabel(s.key, s.displayName, s.label, s.derivedTitle, s.subagentRole)}
                                  </span>
                                  <span
                                    title={getSessionAgentLabel(s.key)}
                                    className={cn(
                                      'ml-auto max-w-[104px] shrink-0 truncate rounded-[10px] px-2 py-0.5 text-[10px] font-medium',
                                      isOnChat && currentSessionKey === s.key
                                        ? 'bg-slate-100 text-foreground/72 dark:bg-white/10 dark:text-foreground/80'
                                        : 'bg-black/[0.035] text-muted-foreground dark:bg-white/8'
                                    )}
                                  >
                                    {getSessionAgentLabel(s.key)}
                                  </span>
                                </div>
                              </button>
                              {canDeleteSession && (
                                <button
                                  aria-label={t('common:actions.delete')}
                                  onClick={async (e) => {
                                    e.stopPropagation();
                                    await handleDeleteSessionClick(
                                      s.key,
                                      getSessionLabel(s.key, s.displayName, s.label, s.derivedTitle, s.subagentRole)
                                    );
                                  }}
                                  className={cn(
                                    'absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-[10px] border border-transparent transition-opacity',
                                    'opacity-0 group-hover:opacity-100',
                                    'text-muted-foreground hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive'
                                  )}
                                >
                                  <Trash2 className="h-3.5 w-3.5" />
                                </button>
                              )}
                            </div>
                            {childSessions.length > 0 && childTasksVisible && (
                              <div className="border-t border-black/6 bg-black/[0.018] dark:border-white/8 dark:bg-white/[0.018]">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setExpandedTaskParents((current) => ({
                                      ...current,
                                      [s.key]: !childTasksExpanded,
                                    }));
                                  }}
                                  className="flex w-full items-center gap-2 px-3 py-2 text-left text-[11px] font-medium text-muted-foreground transition-colors hover:bg-white/35 hover:text-foreground dark:hover:bg-white/[0.04]"
                                >
                                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-white/70 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] dark:bg-white/[0.08] dark:shadow-none">
                                    {childTasksExpanded ? (
                                      <ChevronDown className="h-3 w-3 shrink-0" />
                                    ) : (
                                      <ChevronRight className="h-3 w-3 shrink-0" />
                                    )}
                                  </span>
                                  <span className="truncate tracking-[0.01em]">
                                    {t('chat:history.childTasks', {
                                      defaultValue: '子任务',
                                    })}
                                  </span>
                                  <span className="ml-auto shrink-0 rounded-full bg-white/70 px-2 py-0.5 text-[10px] font-semibold text-muted-foreground shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] dark:bg-white/[0.08] dark:shadow-none">
                                    {childSessions.length}
                                  </span>
                                </button>
                                {childTasksExpanded && (
                                  <div className="px-2.5 pb-2.5">
                                    <div className="space-y-1.5 rounded-[14px] bg-white/52 p-2 shadow-[inset_0_0_0_1px_rgba(15,23,42,0.05)] dark:bg-white/[0.035] dark:shadow-[inset_0_0_0_1px_rgba(255,255,255,0.05)]">
                                      {childSessions.map((child) => {
                                        const canDeleteChildSession = !child.key.endsWith(':main');
                                        const childAgentLabel = getSessionAgentLabel(child.key);
                                        const parentAgentLabel = getSessionAgentLabel(s.key);
                                        const showChildAgentLabel = childAgentLabel !== parentAgentLabel;
                                        return (
                                          <div key={child.key} className="group relative flex items-center">
                                            <div
                                              className={cn(
                                                'w-full rounded-[12px] border px-3 py-2.5 pr-8 transition-all',
                                                'hover:border-black/6 hover:bg-white/78 dark:hover:border-white/10 dark:hover:bg-white/[0.06]',
                                                isOnChat && currentSessionKey === child.key
                                                  ? 'border-black/8 bg-white/95 text-foreground font-semibold shadow-[0_8px_16px_rgba(15,23,42,0.05)] dark:border-white/12 dark:bg-white/[0.08]'
                                                  : 'border-transparent bg-black/[0.02] text-foreground/76 dark:bg-white/[0.02]'
                                              )}
                                            >
                                              <button
                                                type="button"
                                                onClick={() => {
                                                  openSession(child.key);
                                                }}
                                                className="w-full text-left"
                                              >
                                                <div className="flex min-w-0 items-center gap-2">
                                                  <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-slate-400/70 dark:bg-slate-500/80" />
                                                  <span className="min-w-0 flex-1 truncate text-[12px] leading-5">
                                                    {getSessionLabel(child.key, child.displayName, child.label, child.derivedTitle, child.subagentRole)}
                                                  </span>
                                                  {showChildAgentLabel && (
                                                    <span
                                                      title={childAgentLabel}
                                                      className="max-w-[88px] shrink-0 truncate rounded-[10px] bg-black/[0.035] px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/8"
                                                    >
                                                      {childAgentLabel}
                                                    </span>
                                                  )}
                                                </div>
                                              </button>
                                            </div>
                                            {canDeleteChildSession && (
                                              <button
                                                aria-label={t('common:actions.delete')}
                                                onClick={async (e) => {
                                                  e.stopPropagation();
                                                  await handleDeleteSessionClick(
                                                    child.key,
                                                    getSessionLabel(child.key, child.displayName, child.label, child.derivedTitle, child.subagentRole)
                                                  );
                                                }}
                                                className={cn(
                                                  'absolute right-1 flex h-6 w-6 items-center justify-center rounded-[10px] border border-transparent transition-opacity',
                                                  'opacity-0 group-hover:opacity-100',
                                                  'text-muted-foreground hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive'
                                                )}
                                              >
                                                <Trash2 className="h-3 w-3" />
                                              </button>
                                            )}
                                          </div>
                                        );
                                      })}
                                    </div>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ) : null
              )}
              {sortedBackgroundSessions.length > 0 && (
                <div className="pt-4">
                  <div className="flex items-center gap-2 px-2.5 pb-2">
                    <button
                      type="button"
                      onClick={() => setBackgroundExpanded((value) => !value)}
                      className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    >
                      <span className="text-[11px] font-semibold tracking-[0.08em] text-muted-foreground/70">
                        {t('chat:history.backgroundSessions', '后台任务')}
                      </span>
                      <Badge
                        variant="secondary"
                        className="rounded-full px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                      >
                        {sortedBackgroundSessions.length}
                      </Badge>
                      <div className="h-px flex-1 bg-black/6 dark:bg-white/10" />
                      {backgroundExpanded ? (
                        <ChevronUp className="h-3.5 w-3.5 text-muted-foreground" />
                      ) : (
                        <ChevronDown className="h-3.5 w-3.5 text-muted-foreground" />
                      )}
                    </button>
                    {cronBackgroundSessions.length > 0 && !showCronBackground && (
                      <button
                        type="button"
                        onClick={() => setShowCronBackground(true)}
                        className="shrink-0 rounded-full bg-black/[0.035] px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-black/8 dark:bg-white/8 dark:hover:bg-white/12"
                      >
                        {t('chat:history.showCronSessionsHidden', {
                          count: cronBackgroundSessions.length,
                          defaultValue: `显示 Cron (${cronBackgroundSessions.length})`,
                        })}
                      </button>
                    )}
                  </div>
                  {backgroundExpanded && (
                    <div className="space-y-3">
                      {backgroundSessionGroups.map((group) => (
                        <div key={group.id} className="space-y-1">
                          <div className="flex items-center gap-2 px-2.5 pb-1">
                            <span className="truncate text-[11px] font-semibold tracking-[0.06em] text-muted-foreground/70">
                              {group.label}
                            </span>
                            <Badge
                              variant="secondary"
                              className="rounded-full px-1.5 py-0 text-[10px] font-medium text-muted-foreground"
                            >
                              {group.sessions.length}
                            </Badge>
                            <div className="h-px flex-1 bg-black/6 dark:bg-white/10" />
                            {group.parentSessionKey && (
                              <button
                                type="button"
                                onClick={() => {
                                  openSession(group.parentSessionKey!);
                                }}
                                className="shrink-0 rounded-full bg-black/[0.035] px-2 py-0.5 text-[10px] font-medium text-muted-foreground transition-colors hover:bg-black/8 hover:text-foreground dark:bg-white/8 dark:hover:bg-white/12"
                              >
                                {t('chat:history.openParentSession', 'Open')}
                              </button>
                            )}
                          </div>
                          <div className="space-y-1">
                            {group.sessions.map((s) => {
                              const canDeleteSession = !s.key.endsWith(':main');
                              const parentSessionLabel = getParentSessionLabel(s);
                              const parentSessionKey = getParentSessionKey(s);
                              return (
                                <div key={s.key} className="group relative flex items-center">
                                  <div
                                    className={cn(
                                      'w-full rounded-[14px] border px-3 py-2.5 pr-8 transition-all',
                                      'hover:border-black/6 hover:bg-white/55 dark:hover:border-white/10 dark:hover:bg-white/[0.06]',
                                      isOnChat && currentSessionKey === s.key
                                        ? 'border-black/8 bg-white/90 text-foreground font-semibold shadow-[0_8px_18px_rgba(15,23,42,0.06)] dark:border-white/12 dark:bg-white/[0.08]'
                                        : 'border-transparent bg-black/[0.025] text-foreground/78 dark:bg-white/[0.02]'
                                    )}
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        openSession(s.key);
                                      }}
                                      className="w-full text-left"
                                    >
                                      <div className="flex min-w-0 items-center gap-2.5">
                                        <span className="min-w-0 flex-1 truncate text-[13px] leading-5">
                                          {getSessionLabel(s.key, s.displayName, s.label, s.derivedTitle, s.subagentRole)}
                                        </span>
                                        <span className="shrink-0 rounded-[10px] bg-black/[0.035] px-2 py-0.5 text-[10px] font-medium text-muted-foreground dark:bg-white/8">
                                          {getBackgroundSessionKindLabel(s, (key, fallback) => t(key, fallback))}
                                        </span>
                                        <span
                                          title={getSessionAgentLabel(s.key)}
                                          className={cn(
                                            'max-w-[104px] shrink-0 truncate rounded-[10px] px-2 py-0.5 text-[10px] font-medium',
                                            isOnChat && currentSessionKey === s.key
                                              ? 'bg-slate-100 text-foreground/72 dark:bg-white/10 dark:text-foreground/80'
                                              : 'bg-black/[0.035] text-muted-foreground dark:bg-white/8'
                                          )}
                                        >
                                          {getSessionAgentLabel(s.key)}
                                        </span>
                                      </div>
                                    </button>
                                    {parentSessionKey && group.parentSessionKey !== parentSessionKey && (
                                      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground/80">
                                        <CornerUpLeft className="h-3 w-3 shrink-0" />
                                        <button
                                          type="button"
                                          onClick={() => {
                                            openSession(parentSessionKey);
                                          }}
                                          className="truncate text-left hover:text-foreground"
                                          title={parentSessionLabel}
                                        >
                                          {t('chat:history.parentSession', {
                                            label: parentSessionLabel,
                                            defaultValue: `来源：${parentSessionLabel}`,
                                          })}
                                        </button>
                                      </div>
                                    )}
                                  </div>
                                  {canDeleteSession && (
                                    <button
                                      aria-label={t('common:actions.delete')}
                                      onClick={async (e) => {
                                        e.stopPropagation();
                                        await handleDeleteSessionClick(
                                          s.key,
                                          getSessionLabel(s.key, s.displayName, s.label, s.derivedTitle, s.subagentRole)
                                        );
                                      }}
                                      className={cn(
                                        'absolute right-1.5 flex h-7 w-7 items-center justify-center rounded-[10px] border border-transparent transition-opacity',
                                        'opacity-0 group-hover:opacity-100',
                                        'text-muted-foreground hover:border-destructive/20 hover:bg-destructive/10 hover:text-destructive'
                                      )}
                                    >
                                      <Trash2 className="h-3.5 w-3.5" />
                                    </button>
                                  )}
                                </div>
                              );
                            })}
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>
      )}

      {/* Footer */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 z-20 p-2',
          sidebarCollapsed ? '' : 'pointer-events-none'
        )}
      >
        <div
          ref={settingsMenuRef}
          className={cn(
            'relative',
            sidebarCollapsed ? '' : 'pointer-events-auto'
          )}
        >
          {settingsMenuOpen && (
            <div
              className={cn(
                'absolute bottom-[calc(100%+8px)] z-30 overflow-hidden rounded-2xl border border-border/70 bg-card/95 p-1.5 shadow-[0_14px_34px_rgba(0,0,0,0.14)] backdrop-blur-xl',
                sidebarCollapsed ? 'left-0 w-56' : 'inset-x-0'
              )}
            >
              <div className="space-y-1">
                {popupItems.map((item) => (
                  <NavLink
                    key={item.id}
                    to={item.to}
                    onClick={() => setSettingsMenuOpen(false)}
                    className={({ isActive }) =>
                      cn(
                        'flex items-center gap-2.5 rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors',
                        'hover:bg-black/5 dark:hover:bg-white/10 text-foreground/80',
                        isActive && 'bg-accent/70 text-foreground shadow-sm'
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <div
                          className={cn(
                            'flex shrink-0 items-center justify-center',
                            isActive ? 'text-foreground' : 'text-muted-foreground'
                          )}
                        >
                          {item.icon}
                        </div>
                        <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap">
                          {t(`sidebar.${item.i18nKey}`)}
                        </span>
                      </>
                    )}
                  </NavLink>
                ))}
              </div>
            </div>
          )}
          {sidebarCollapsed ? (
            <button
              type="button"
              className={cn(
                'flex w-full items-center justify-center rounded-lg px-2.5 py-2 text-[14px] font-medium transition-colors',
                'hover:bg-black/5 dark:hover:bg-white/10 text-foreground/80',
                settingsActive && 'bg-accent/70 text-foreground shadow-sm'
              )}
              aria-haspopup="menu"
              aria-expanded={settingsMenuOpen}
              onClick={() => setSettingsMenuOpen((open) => !open)}
            >
                <div
                  className={cn(
                    'flex shrink-0 items-center justify-center',
                    settingsActive ? 'text-foreground' : 'text-muted-foreground'
                  )}
                >
                <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
              </div>
            </button>
          ) : (
            <div className="overflow-hidden rounded-[16px] border border-black/6 bg-white/72 p-1.5 shadow-[0_8px_20px_rgba(15,23,42,0.06)] backdrop-blur-md transition-[box-shadow] duration-300 dark:border-white/10 dark:bg-white/[0.05]">
              <div className="space-y-1 pb-1">
                <button
                  type="button"
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-[12px] px-3 py-2.5 text-[14px] font-medium transition-colors',
                    'hover:bg-black/[0.04] dark:hover:bg-white/8 text-foreground/78',
                    settingsActive && 'bg-white/70 text-foreground shadow-[inset_0_0_0_1px_rgba(15,23,42,0.04)] dark:bg-white/[0.07]'
                  )}
                  aria-haspopup="menu"
                  aria-expanded={settingsMenuOpen}
                  onClick={() => setSettingsMenuOpen((open) => !open)}
                >
                  <div
                    className={cn(
                      'flex shrink-0 items-center justify-center',
                      settingsActive ? 'text-foreground' : 'text-muted-foreground'
                    )}
                  >
                    <Menu className="h-[18px] w-[18px]" strokeWidth={2} />
                  </div>
                  <span className="flex-1 overflow-hidden text-ellipsis whitespace-nowrap text-left">
                    {t('sidebar.menu')}
                  </span>
                  <span
                    role={canRestartGateway ? 'button' : undefined}
                    tabIndex={canRestartGateway ? 0 : undefined}
                    onClick={(event) => {
                      if (!canRestartGateway) return;
                      event.stopPropagation();
                      void useGatewayStore.getState().restart();
                    }}
                    onKeyDown={(event) => {
                      if (!canRestartGateway) return;
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        event.stopPropagation();
                        void useGatewayStore.getState().restart();
                      }
                    }}
                    title={gatewayBadgeLabel}
                    className={cn(
                      'inline-flex shrink-0 items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium transition-colors',
                      displayGatewayState === 'running'
                        ? 'border-emerald-500/25 bg-emerald-500/12 text-emerald-700 dark:text-emerald-400'
                        : displayGatewayState === 'error'
                          ? 'border-red-500/25 bg-red-500/10 text-red-600 dark:text-red-400'
                          : displayGatewayState === 'starting' || displayGatewayState === 'reconnecting'
                            ? 'border-sky-500/25 bg-sky-500/10 text-sky-700 dark:text-sky-400'
                            : 'border-black/8 bg-black/[0.03] text-muted-foreground dark:border-white/10 dark:bg-white/[0.04]',
                      canRestartGateway && 'cursor-pointer hover:border-primary/25 hover:bg-primary/8 hover:text-foreground',
                      !canRestartGateway && 'cursor-default'
                    )}
                  >
                    <span
                      className={cn(
                        'h-2 w-2 rounded-full',
                        displayGatewayState === 'running'
                          ? 'bg-emerald-500'
                          : displayGatewayState === 'error'
                            ? 'bg-red-500'
                            : displayGatewayState === 'starting' || displayGatewayState === 'reconnecting'
                              ? 'bg-sky-500 animate-pulse'
                              : 'bg-muted-foreground/55'
                      )}
                    />
                    <span className="max-w-[72px] truncate">{gatewayBadgeLabel}</span>
                  </span>
                  <ChevronUp
                    className={cn(
                      'h-4 w-4 shrink-0 text-muted-foreground transition-transform',
                      !settingsMenuOpen && 'rotate-180'
                    )}
                  />
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      <ConfirmDialog
        open={!!sessionToDelete}
        title={t('common:sidebar.deleteSessionTitle', { defaultValue: t('common:actions.confirm') })}
        message={t('common:sidebar.deleteSessionConfirm', { label: sessionToDelete?.label })}
        confirmLabel={t('common:actions.delete')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        size="sm"
        onConfirm={async () => {
          if (!sessionToDelete) return;
          await deleteSession(sessionToDelete.key);
          if (currentSessionKey === sessionToDelete.key) navigate('/');
          setSessionToDelete(null);
        }}
        onCancel={() => setSessionToDelete(null)}
      />
    </aside>
  );
}
