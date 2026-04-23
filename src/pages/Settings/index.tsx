/**
 * Settings Page
 * Application configuration
 */
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  Copy,
  ExternalLink,
  FileText,
  GripVertical,
  Monitor,
  Moon,
  RefreshCw,
  Search,
  Sun,
  Wrench,
} from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from '@dnd-kit/core';
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
  arrayMove,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { SUPPORTED_LANGUAGES } from '@/i18n';
import { useSettingsStore } from '@/stores/settings';
import { useGatewayStore } from '@/stores/gateway';
import {
  getGatewayWsDiagnosticEnabled,
  invokeIpc,
  setGatewayWsDiagnosticEnabled,
  toUserMessage,
} from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { formatGatewayConnectError } from '@/lib/gateway-connect-error';
import {
  clearUiTelemetry,
  getUiTelemetrySnapshot,
  subscribeUiTelemetry,
  trackUiEvent,
  type UiTelemetryEntry,
} from '@/lib/telemetry';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { RefreshButton } from '@/components/common/RefreshButton';
import { UpdateSettings } from '@/components/settings/UpdateSettings';
import { GatewayPortsSettings } from '@/components/settings/GatewayPortsSettings';
import { BackupRestoreSettings } from '@/components/settings/BackupRestoreSettings';
import type { GatewayStatus } from '@/types/gateway';
import { ALL_MENU_ITEMS, type MenuItemId } from '@/shared/menu-items';

type ControlUiInfo = {
  url: string;
  token: string;
  port: number;
  ready: boolean;
  state?: GatewayStatus['state'];
  error?: string;
};

type OpenClawDoctorResult = {
  mode: 'diagnose' | 'fix';
  status: 'success' | 'success_with_warnings' | 'failed';
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  command: string;
  cwd: string;
  durationMs: number;
  warnings: string[];
  timedOut?: boolean;
  error?: string;
};

type ProxyMode = 'system' | 'custom' | 'direct';

function SectionCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section className="rounded-[10px] border border-black/10 bg-white/65 p-5 dark:border-white/10 dark:bg-white/[0.03] md:p-6">
      <div className="mb-5">
        <h2 className="text-2xl font-semibold tracking-tight text-foreground">{title}</h2>
        {description ? (
          <p className="mt-1.5 max-w-2xl text-[14px] text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {children}
    </section>
  );
}

function SubCard({
  title,
  description,
  action,
  children,
  className,
}: {
  title: string;
  description?: string;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn('rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]', className)}>
      <div className="mb-4 flex flex-col gap-3 md:flex-row md:items-start md:justify-between">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium text-foreground">{title}</h3>
          {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
        {action ? <div className="shrink-0">{action}</div> : null}
      </div>
      {children}
    </div>
  );
}

function SortableMenuItem({
  id,
  icon,
  label,
  checked,
  disabled,
  onToggle,
}: {
  id: string;
  icon: ReactNode;
  label: string;
  checked: boolean;
  disabled: boolean;
  onToggle: (val: boolean) => void;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        'flex items-center justify-between rounded-[10px] border border-black/10 bg-white/75 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.04]',
        isDragging && 'z-50 opacity-50 shadow-lg'
      )}
    >
      <div className="flex items-center gap-2.5">
        <span
          {...attributes}
          {...listeners}
          className={cn(
            'cursor-grab text-muted-foreground active:cursor-grabbing',
            disabled && 'cursor-not-allowed opacity-40'
          )}
        >
          <GripVertical className="h-4 w-4" strokeWidth={2} />
        </span>
        <span className="text-muted-foreground">{icon}</span>
        <span className={cn('text-[13px] font-medium', checked ? 'text-foreground' : 'text-muted-foreground')}>
          {label}
        </span>
      </div>
      <Switch checked={checked} disabled={disabled} onCheckedChange={onToggle} />
    </div>
  );
}

function SettingRow({
  label,
  description,
  control,
  stacked = false,
}: {
  label: string;
  description?: string;
  control: ReactNode;
  stacked?: boolean;
}) {
  return (
    <div
      className={cn(
        'rounded-[10px] border border-black/10 bg-card/80 p-4 dark:border-white/10 dark:bg-card/50',
        stacked ? 'space-y-3' : 'flex flex-col gap-3 md:flex-row md:items-center md:justify-between'
      )}
    >
      <div className="min-w-0">
        <Label className="text-[14px] font-medium text-foreground">{label}</Label>
        {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
      </div>
      <div className={cn('shrink-0', stacked && 'pt-1')}>{control}</div>
    </div>
  );
}

export function Settings() {
  useEffect(() => {
    console.debug('[settings] Settings component mounted');
    return () => console.debug('[settings] Settings component unmounted');
  }, []);
  const { t } = useTranslation(['settings', 'common']);
  const [isPortable, setIsPortable] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );
  const {
    theme,
    setTheme,
    language,
    setLanguage,
    gatewayAutoStart,
    setGatewayAutoStart,
    proxyMode,
    proxyEnabled,
    proxyServer,
    proxyHttpServer,
    proxyHttpsServer,
    proxyAllServer,
    proxyBypassRules,
    setProxyMode,
    setProxyEnabled,
    setProxyServer,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyAllServer,
    setProxyBypassRules,
    devModeUnlocked,
    setDevModeUnlocked,
    shortcutMenuItems,
    setShortcutMenuItems,
    slashCommandHintsEnabled,
    setSlashCommandHintsEnabled,
    sessionMemoryEnabled,
    setSessionMemoryEnabled,
    memorySearchEnabled,
    setMemorySearchEnabled,
    localModelLean,
    setLocalModelLean,
    initialized,
  } = useSettingsStore();

  const {
    status: gatewayStatus,
    isInitialized: gatewayInitialized,
    restart: restartGateway,
    init: initGateway,
  } = useGatewayStore();

  const [showLogs, setShowLogs] = useState(false);
  const [logContent, setLogContent] = useState('');
  const [controlUiInfo, setControlUiInfo] = useState<ControlUiInfo | null>(null);
  const [openclawCliCommand, setOpenclawCliCommand] = useState('');
  const [openclawCliError, setOpenclawCliError] = useState<string | null>(null);
  const [wsDiagnosticEnabled, setWsDiagnosticEnabled] = useState(false);
  const [doctorRunningMode, setDoctorRunningMode] = useState<OpenClawDoctorResult['mode'] | null>(null);
  const [doctorResult, setDoctorResult] = useState<OpenClawDoctorResult | null>(null);
  const [showTelemetryViewer, setShowTelemetryViewer] = useState(false);
  const [telemetryEntries, setTelemetryEntries] = useState<UiTelemetryEntry[]>([]);
  const [showAdvancedProxy, setShowAdvancedProxy] = useState(false);
  const [showCustomProxyForm, setShowCustomProxyForm] = useState(false);
  const [savingProxy, setSavingProxy] = useState(false);
  const [proxySaveError, setProxySaveError] = useState<string | null>(null);
  const [proxySaveDoneAt, setProxySaveDoneAt] = useState<number | null>(null);
  const [proxyModeDraft, setProxyModeDraft] = useState<ProxyMode>('system');
  const [proxyServerDraft, setProxyServerDraft] = useState('');
  const [proxyHttpServerDraft, setProxyHttpServerDraft] = useState('');
  const [proxyHttpsServerDraft, setProxyHttpsServerDraft] = useState('');
  const [proxyAllServerDraft, setProxyAllServerDraft] = useState('');
  const [proxyBypassRulesDraft, setProxyBypassRulesDraft] = useState('');

  const proxyInitRef = useRef(false);
  const proxySaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isWindows = window.electron.platform === 'win32';

  useEffect(() => {
    void initGateway();
  }, [initGateway]);

  useEffect(() => {
    let cancelled = false;

    void invokeIpc<boolean>('app:isPortable')
      .then((value) => {
        if (!cancelled) setIsPortable(Boolean(value));
      })
      .catch(() => {
        if (!cancelled) setIsPortable(false);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    void invokeIpc<{
      success: boolean;
      command?: string;
      error?: string;
    }>('openclaw:getCliCommand')
      .then((result) => {
        if (cancelled) return;
        if (result.success && result.command) {
          setOpenclawCliCommand(result.command);
          setOpenclawCliError(null);
        } else {
          setOpenclawCliCommand('');
          setOpenclawCliError(result.error || t('developer.cmdUnavailable'));
        }
      })
      .catch((error) => {
        if (cancelled) return;
        setOpenclawCliCommand('');
        setOpenclawCliError(String(error));
      });

    return () => {
      cancelled = true;
    };
  }, [t]);

  useEffect(() => {
    setWsDiagnosticEnabled(getGatewayWsDiagnosticEnabled());
  }, []);

  useEffect(() => {
    if (!devModeUnlocked) return;
    setTelemetryEntries(getUiTelemetrySnapshot(200));
    return subscribeUiTelemetry((entry) => {
      setTelemetryEntries((prev) => {
        const next = [...prev, entry];
        if (next.length > 200) {
          next.splice(0, next.length - 200);
        }
        return next;
      });
    });
  }, [devModeUnlocked]);

  useEffect(() => {
    if (!devModeUnlocked) return;
    let cancelled = false;
    void hostApiFetch<{
      success: boolean;
      url?: string;
      token?: string;
      port?: number;
      ready?: boolean;
      state?: GatewayStatus['state'];
      error?: string;
    }>('/api/gateway/control-ui')
      .then((result) => {
        if (
          cancelled ||
          !result.success ||
          !result.url ||
          !result.token ||
          typeof result.port !== 'number'
        ) {
          return;
        }
        setControlUiInfo({
          url: result.url,
          token: result.token,
          port: result.port,
          ready: result.ready === true,
          state: result.state,
          error: result.error,
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [devModeUnlocked, gatewayStatus.state]);

  useEffect(() => {
    setProxyModeDraft(proxyMode || (proxyEnabled ? 'custom' : 'system'));
  }, [proxyMode, proxyEnabled]);

  useEffect(() => {
    setProxyServerDraft(proxyServer);
  }, [proxyServer]);

  useEffect(() => {
    setProxyHttpServerDraft(proxyHttpServer);
  }, [proxyHttpServer]);

  useEffect(() => {
    setProxyHttpsServerDraft(proxyHttpsServer);
  }, [proxyHttpsServer]);

  useEffect(() => {
    setProxyAllServerDraft(proxyAllServer);
  }, [proxyAllServer]);

  useEffect(() => {
    setProxyBypassRulesDraft(proxyBypassRules);
  }, [proxyBypassRules]);

  const persistedProxyState = useMemo(
    () =>
      JSON.stringify({
        proxyMode: proxyMode || (proxyEnabled ? 'custom' : 'system'),
        proxyServer: proxyServer.trim(),
        proxyHttpServer: proxyHttpServer.trim(),
        proxyHttpsServer: proxyHttpsServer.trim(),
        proxyAllServer: proxyAllServer.trim(),
        proxyBypassRules: proxyBypassRules.trim(),
      }),
    [
      proxyAllServer,
      proxyBypassRules,
      proxyEnabled,
      proxyHttpServer,
      proxyHttpsServer,
      proxyMode,
      proxyServer,
    ]
  );

  const draftProxyState = useMemo(
    () =>
      JSON.stringify({
        proxyMode: proxyModeDraft,
        proxyServer: proxyServerDraft.trim(),
        proxyHttpServer: proxyHttpServerDraft.trim(),
        proxyHttpsServer: proxyHttpsServerDraft.trim(),
        proxyAllServer: proxyAllServerDraft.trim(),
        proxyBypassRules: proxyBypassRulesDraft.trim(),
      }),
    [
      proxyAllServerDraft,
      proxyBypassRulesDraft,
      proxyHttpServerDraft,
      proxyHttpsServerDraft,
      proxyModeDraft,
      proxyServerDraft,
    ]
  );

  const telemetryStats = useMemo(() => {
    let errorCount = 0;
    let slowCount = 0;

    for (const entry of telemetryEntries) {
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        errorCount += 1;
      }
      const durationMs =
        typeof entry.payload.durationMs === 'number' ? entry.payload.durationMs : Number.NaN;
      if (Number.isFinite(durationMs) && durationMs >= 800) {
        slowCount += 1;
      }
    }

    return { total: telemetryEntries.length, errorCount, slowCount };
  }, [telemetryEntries]);

  const telemetryByEvent = useMemo(() => {
    const map = new Map<
      string,
      {
        event: string;
        count: number;
        errorCount: number;
        slowCount: number;
        totalDuration: number;
        timedCount: number;
      }
    >();

    for (const entry of telemetryEntries) {
      const current = map.get(entry.event) ?? {
        event: entry.event,
        count: 0,
        errorCount: 0,
        slowCount: 0,
        totalDuration: 0,
        timedCount: 0,
      };

      current.count += 1;
      if (entry.event.endsWith('_error') || entry.event.includes('request_error')) {
        current.errorCount += 1;
      }

      const durationMs =
        typeof entry.payload.durationMs === 'number' ? entry.payload.durationMs : Number.NaN;
      if (Number.isFinite(durationMs)) {
        current.totalDuration += durationMs;
        current.timedCount += 1;
        if (durationMs >= 800) {
          current.slowCount += 1;
        }
      }

      map.set(entry.event, current);
    }

    return [...map.values()].sort((a, b) => b.count - a.count).slice(0, 12);
  }, [telemetryEntries]);

  const gatewayStateLabel = useMemo(() => {
    if (!gatewayInitialized) return t('common:status.loading');
    if (gatewayStatus.state === 'running') return t('common:status.running');
    if (gatewayStatus.state === 'stopped') return t('common:status.stopped');
    if (gatewayStatus.state === 'error') return t('common:status.error');
    if (gatewayStatus.state === 'starting') return t('common:status.loading');
    return gatewayStatus.state;
  }, [gatewayInitialized, gatewayStatus.state, t]);

  const proxyStatusText = proxySaveError
    ? proxySaveError
    : savingProxy
      ? t('common:status.saving')
      : proxySaveDoneAt
        ? t('gateway.proxySaved')
        : t('gateway.proxyRestartNote');

  const hasCustomProxyChanges = useMemo(() => {
    if (proxyModeDraft !== 'custom') return false;
    return draftProxyState !== persistedProxyState;
  }, [draftProxyState, persistedProxyState, proxyModeDraft]);

  const refreshControlUiInfo = async () => {
    try {
      const result = await hostApiFetch<{
        success: boolean;
        url?: string;
        token?: string;
        port?: number;
        ready?: boolean;
        state?: GatewayStatus['state'];
        error?: string;
      }>('/api/gateway/control-ui');
      if (result.success && result.url && result.token && typeof result.port === 'number') {
        setControlUiInfo({
          url: result.url,
          token: result.token,
          port: result.port,
          ready: result.ready === true,
          state: result.state,
          error: result.error,
        });
      }
    } catch {
      // ignore
    }
  };

  const handleShowLogs = async () => {
    try {
      const logs = await hostApiFetch<{ content: string }>('/api/logs?tailLines=100');
      setLogContent(logs.content);
      setShowLogs(true);
    } catch {
      setLogContent('(Failed to load logs)');
      setShowLogs(true);
    }
  };

  const handleOpenLogDir = async () => {
    try {
      const { dir } = await hostApiFetch<{ dir: string | null }>('/api/logs/dir');
      if (dir) {
        await invokeIpc('shell:showItemInFolder', dir);
      }
    } catch {
      // ignore
    }
  };

  const handleCopyGatewayToken = async () => {
    if (!controlUiInfo?.token) return;
    try {
      await navigator.clipboard.writeText(controlUiInfo.token);
      toast.success(t('developer.tokenCopied'));
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const handleOpenControlUi = () => {
    if (!controlUiInfo?.url) return;
    if (!controlUiInfo.ready) {
      const stateLabel = controlUiInfo.state || gatewayStatus.state;
      const detail = controlUiInfo.error
        ? `: ${formatGatewayConnectError({ message: controlUiInfo.error })}`
        : '';
      toast.error(`Gateway not ready (${stateLabel})${detail}`);
      return;
    }
    void invokeIpc('shell:openExternal', controlUiInfo.url);
  };

  const handleCopyCliCommand = async () => {
    if (!openclawCliCommand) return;
    try {
      await navigator.clipboard.writeText(openclawCliCommand);
      toast.success(t('developer.cmdCopied'));
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const handleCopyTelemetry = async () => {
    try {
      await navigator.clipboard.writeText(
        telemetryEntries.map((entry) => JSON.stringify(entry)).join('\n')
      );
      toast.success(t('developer.telemetryCopied'));
    } catch (error) {
      toast.error(toUserMessage(error));
    }
  };

  const handleClearTelemetry = () => {
    clearUiTelemetry();
    setTelemetryEntries([]);
    toast.success(t('developer.telemetryCleared'));
  };

  const handleWsDiagnosticToggle = (enabled: boolean) => {
    setGatewayWsDiagnosticEnabled(enabled);
    setWsDiagnosticEnabled(enabled);
    toast.success(
      enabled ? t('developer.wsDiagnosticEnabled') : t('developer.wsDiagnosticDisabled')
    );
  };

  const handleRunOpenClawDoctor = async (mode: OpenClawDoctorResult['mode']) => {
    setDoctorRunningMode(mode);
    try {
      const result = await hostApiFetch<OpenClawDoctorResult>('/api/app/openclaw-doctor', {
        method: 'POST',
        body: JSON.stringify({ mode }),
      });
      setDoctorResult(result);
      const toastMethod =
        result.status === 'failed'
          ? 'error'
          : result.status === 'success_with_warnings'
            ? 'warning'
            : 'success';
      toast[toastMethod](
        result.status === 'failed'
          ? mode === 'fix'
            ? t('developer.doctorFixFailed')
            : t('developer.doctorFailed')
          : result.status === 'success_with_warnings'
            ? mode === 'fix'
              ? t('developer.doctorFixSucceededWithWarnings')
              : t('developer.doctorSucceededWithWarnings')
            : mode === 'fix'
              ? t('developer.doctorFixSucceeded')
              : t('developer.doctorSucceeded')
      );
    } catch (error) {
      const message = toUserMessage(error);
      toast.error(message);
      setDoctorResult({
        mode,
        status: 'failed',
        success: false,
        exitCode: null,
        stdout: '',
        stderr: '',
        command: `openclaw ${mode === 'fix' ? 'doctor --fix --yes --non-interactive' : 'doctor'}`,
        cwd: '',
        durationMs: 0,
        warnings: [],
        error: message,
      });
    } finally {
      setDoctorRunningMode(null);
    }
  };

  const handleSaveProxySettings = useCallback(async () => {
    setSavingProxy(true);
    setProxySaveError(null);
    setProxySaveDoneAt(null);
    proxySaveTimerRef.current = null;

    try {
      const normalizedProxyMode = proxyModeDraft;
      const normalizedProxyServer = proxyServerDraft.trim();
      const normalizedHttpServer = proxyHttpServerDraft.trim();
      const normalizedHttpsServer = proxyHttpsServerDraft.trim();
      const normalizedAllServer = proxyAllServerDraft.trim();
      const normalizedBypassRules = proxyBypassRulesDraft.trim();

      await hostApiFetch<{ success: boolean }>('/api/settings', {
        method: 'PUT',
        body: JSON.stringify({
          proxyMode: normalizedProxyMode,
          proxyEnabled: normalizedProxyMode === 'custom',
          proxyServer: normalizedProxyServer,
          proxyHttpServer: normalizedHttpServer,
          proxyHttpsServer: normalizedHttpsServer,
          proxyAllServer: normalizedAllServer,
          proxyBypassRules: normalizedBypassRules,
        }),
      });

      setProxyMode(normalizedProxyMode);
      setProxyEnabled(normalizedProxyMode === 'custom');
      setProxyServer(normalizedProxyServer);
      setProxyHttpServer(normalizedHttpServer);
      setProxyHttpsServer(normalizedHttpsServer);
      setProxyAllServer(normalizedAllServer);
      setProxyBypassRules(normalizedBypassRules);
      setProxySaveDoneAt(Date.now());
      if (normalizedProxyMode === 'custom') {
        setShowCustomProxyForm(false);
      }
      trackUiEvent('settings.proxy_saved', { mode: normalizedProxyMode });
    } catch (error) {
      const message = `${t('gateway.proxySaveFailed')}: ${toUserMessage(error)}`;
      setProxySaveError(message);
    } finally {
      setSavingProxy(false);
    }
  }, [
    proxyAllServerDraft,
    proxyBypassRulesDraft,
    proxyHttpServerDraft,
    proxyHttpsServerDraft,
    proxyModeDraft,
    proxyServerDraft,
    setProxyAllServer,
    setProxyBypassRules,
    setProxyEnabled,
    setProxyHttpServer,
    setProxyHttpsServer,
    setProxyMode,
    setProxyServer,
    t,
  ]);

  // Proxy auto-save: persist draft → store when draft differs from current Zustand state.
  // We compare against getState() rather than persistedProxyState (localStorage) because
  // Zustand's persist middleware debounces writes to localStorage (1 s), so
  // persistedProxyState can lag behind the in-memory Zustand state after
  // initSettings() fetches fresh values from the backend.  Comparing against
  // getState() ensures we only save when the user has actually edited the draft.
  useEffect(() => {
    if (!proxyInitRef.current) {
      proxyInitRef.current = true;
      return;
    }
    if (savingProxy) return;
    if (proxyModeDraft === 'custom') return;
    const storeState = useSettingsStore.getState();
    const current = {
      proxyMode: storeState.proxyMode || (storeState.proxyEnabled ? 'custom' : 'system'),
      proxyServer: (storeState.proxyServer ?? '').trim(),
      proxyHttpServer: (storeState.proxyHttpServer ?? '').trim(),
      proxyHttpsServer: (storeState.proxyHttpsServer ?? '').trim(),
      proxyAllServer: (storeState.proxyAllServer ?? '').trim(),
      proxyBypassRules: (storeState.proxyBypassRules ?? '').trim(),
    };
    const draft = {
      proxyMode: proxyModeDraft,
      proxyServer: proxyServerDraft.trim(),
      proxyHttpServer: proxyHttpServerDraft.trim(),
      proxyHttpsServer: proxyHttpsServerDraft.trim(),
      proxyAllServer: proxyAllServerDraft.trim(),
      proxyBypassRules: proxyBypassRulesDraft.trim(),
    };
    if (
      current.proxyMode === draft.proxyMode &&
      current.proxyServer === draft.proxyServer &&
      current.proxyHttpServer === draft.proxyHttpServer &&
      current.proxyHttpsServer === draft.proxyHttpsServer &&
      current.proxyAllServer === draft.proxyAllServer &&
      current.proxyBypassRules === draft.proxyBypassRules
    ) {
      return;
    }
    console.debug('[settings:proxy] auto-save triggered: draft differs from store state, calling handleSaveProxySettings');
    void handleSaveProxySettings();
  }, [
    draftProxyState,
    handleSaveProxySettings,
    persistedProxyState,
    proxyAllServerDraft,
    proxyBypassRulesDraft,
    proxyHttpServerDraft,
    proxyHttpsServerDraft,
    proxyModeDraft,
    proxyServerDraft,
    savingProxy,
  ]);

  useEffect(() => {
    if (!proxySaveDoneAt) return;
    const timer = window.setTimeout(() => setProxySaveDoneAt(null), 1800);
    return () => window.clearTimeout(timer);
  }, [proxySaveDoneAt]);

  useEffect(
    () => () => {
      if (proxySaveTimerRef.current) {
        clearTimeout(proxySaveTimerRef.current);
      }
    },
    []
  );

  return (
    <div className="-m-6 flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden dark:bg-background">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-8 md:px-10 md:py-10">
        <PageHeader
          title={t('title')}
          subtitle={t('subtitle')}
          actions={
            !initialized ? (
              <div className="inline-flex h-9 items-center gap-2 rounded-xl border border-border/70 bg-card/85 px-3.5 text-[12px] font-medium text-muted-foreground">
                <LoadingIcon className="h-3.5 w-3.5" />
                <span>{t('common:status.loading')}</span>
              </div>
            ) : undefined
          }
        />

        <div className="-mr-2 min-h-0 flex-1 space-y-6 overflow-y-auto pr-2 pb-8">
          <SectionCard title={t('appearance.title')} description={t('appearance.description')}>
            <div className="grid gap-4 lg:grid-cols-2">
              <SubCard title={t('appearance.theme')}>
                <div className="flex flex-wrap gap-2">
                  {[
                    { key: 'light', icon: Sun, label: t('appearance.light') },
                    { key: 'dark', icon: Moon, label: t('appearance.dark') },
                    { key: 'system', icon: Monitor, label: t('appearance.system') },
                  ].map((item) => {
                    const Icon = item.icon;
                    const active = theme === item.key;
                    return (
                      <Button
                        key={item.key}
                        variant={active ? 'secondary' : 'outline'}
                        className={cn(
                          'h-10 rounded-[10px] border-black/10 px-4 dark:border-white/10',
                          active
                            ? 'bg-black/5 text-foreground dark:bg-white/10'
                            : 'bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                        )}
                        onClick={() => setTheme(item.key as 'light' | 'dark' | 'system')}
                      >
                        <Icon className="mr-2 h-4 w-4" />
                        {item.label}
                      </Button>
                    );
                  })}
                </div>
              </SubCard>

              <SubCard title={t('appearance.language')}>
                <div className="flex flex-wrap gap-2">
                  {SUPPORTED_LANGUAGES.map((lang) => {
                    const active = language === lang.code;
                    return (
                      <Button
                        key={lang.code}
                        variant={active ? 'secondary' : 'outline'}
                        className={cn(
                          'h-10 rounded-[10px] border-black/10 px-4 dark:border-white/10',
                          active
                            ? 'bg-black/5 text-foreground dark:bg-white/10'
                            : 'bg-transparent text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                        )}
                        onClick={() => setLanguage(lang.code)}
                      >
                        {lang.label}
                      </Button>
                    );
                  })}
                </div>
              </SubCard>
            </div>

            <SubCard
              title={t('appearance.shortcutMenu.title')}
              description={t('appearance.shortcutMenu.description')}
              className="mt-4"
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <Badge variant="secondary" className="rounded-[10px] px-3 py-1 text-[12px]">
                  {t('appearance.shortcutMenu.selectedCount', { count: shortcutMenuItems.length })}
                </Badge>
              </div>
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={(event: DragEndEvent) => {
                  const { active, over } = event;
                  if (over && active.id !== over.id) {
                    const oldIndex = shortcutMenuItems.indexOf(active.id as MenuItemId);
                    const newIndex = shortcutMenuItems.indexOf(over.id as MenuItemId);
                    setShortcutMenuItems(arrayMove(shortcutMenuItems, oldIndex, newIndex));
                  }
                }}
              >
                <SortableContext items={shortcutMenuItems} strategy={verticalListSortingStrategy}>
                  <div className="grid w-full grid-cols-1 gap-2">
                    {shortcutMenuItems.map((id) => {
                      const item = ALL_MENU_ITEMS.find((m) => m.id === id)!;
                      return (
                        <SortableMenuItem
                          key={item.id}
                          id={item.id}
                          icon={item.icon}
                          label={t(`common:sidebar.${item.i18nKey}`)}
                          checked={true}
                          disabled={false}
                          onToggle={() => setShortcutMenuItems(shortcutMenuItems.filter((i) => i !== item.id))}
                        />
                      );
                    })}
                  </div>
                </SortableContext>
              </DndContext>

              {ALL_MENU_ITEMS.filter((item) => !shortcutMenuItems.includes(item.id)).length > 0 && (
                <>
                  <div className="mb-2 mt-3 flex items-center gap-2">
                    <div className="h-px flex-1 border-t border-black/10 dark:border-white/10" />
                  </div>
                  <div className="grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
                    {ALL_MENU_ITEMS.filter((item) => !shortcutMenuItems.includes(item.id)).map((item) => (
                      <div
                        key={item.id}
                        className="flex items-center justify-between rounded-[10px] border border-black/10 bg-white/75 px-3 py-2.5 dark:border-white/10 dark:bg-white/[0.04]"
                      >
                        <div className="flex items-center gap-2.5">
                          <span className="text-muted-foreground">{item.icon}</span>
                          <span className="text-[13px] font-medium text-muted-foreground">
                            {t(`common:sidebar.${item.i18nKey}`)}
                          </span>
                        </div>
                        <Switch
                          checked={false}
                          disabled={shortcutMenuItems.length >= 3}
                          onCheckedChange={() => setShortcutMenuItems([...shortcutMenuItems, item.id])}
                        />
                      </div>
                    ))}
                  </div>
                </>
              )}
            </SubCard>
          </SectionCard>

          <SectionCard title={t('gateway.title')} description={t('gateway.description')}>
            <div className="space-y-4">
              <SubCard
                title={t('gateway.status')}
              >
                <div className="space-y-4">
                  <div className="rounded-[10px] border border-black/10 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                    <div className="space-y-4">
                      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-[minmax(0,1.1fr)_minmax(0,0.9fr)_minmax(0,1fr)]">
                        <div className="rounded-[10px] border border-black/10 bg-black/[0.03] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {t('gateway.status')}
                          </div>
                          <div className="mt-2 flex flex-wrap items-center gap-3">
                            <Badge
                              variant="secondary"
                              className={cn(
                                'rounded-[10px] border px-3 py-1 text-[12px]',
                                gatewayStatus.state === 'running'
                                  ? 'border-green-500/20 bg-green-500/10 text-green-600 dark:text-green-500'
                                  : gatewayStatus.state === 'error'
                                    ? 'border-red-500/20 bg-red-500/10 text-red-600 dark:text-red-500'
                                    : 'border-black/10 bg-white/80 text-muted-foreground dark:border-white/10 dark:bg-white/[0.06]'
                              )}
                            >
                              {gatewayStateLabel}
                            </Badge>
                            <span className="text-[13px] text-muted-foreground">
                              {t('gateway.port')}: {gatewayStatus.port || 18789}
                            </span>
                            {gatewayStatus.pid ? (
                              <span className="text-[13px] text-muted-foreground">
                                PID: {gatewayStatus.pid}
                              </span>
                            ) : null}
                          </div>
                        </div>

                        <div className="rounded-[10px] border border-black/10 bg-black/[0.03] px-4 py-3 dark:border-white/10 dark:bg-white/[0.03]">
                          <div className="text-[11px] uppercase tracking-[0.16em] text-muted-foreground">
                            {t('gateway.autoStart')}
                          </div>
                          <div className="mt-2 flex items-center justify-between gap-3">
                            <span className="text-[13px] text-muted-foreground">
                              {gatewayAutoStart
                                ? t('common:status.enabled')
                                : t('common:status.disabled')}
                            </span>
                            <Switch
                              checked={gatewayAutoStart}
                              onCheckedChange={setGatewayAutoStart}
                            />
                          </div>
                        </div>

                        <div className="flex flex-col gap-2 sm:flex-row lg:justify-end">
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                            onClick={restartGateway}
                          >
                            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
                            {t('common:actions.restart')}
                          </Button>
                          <Button
                            variant="outline"
                            size="sm"
                            className="h-9 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                            onClick={handleShowLogs}
                          >
                            <FileText className="mr-1.5 h-3.5 w-3.5" />
                            {t('gateway.logs')}
                          </Button>
                        </div>
                      </div>

                      {gatewayStatus.error ? (
                        <p className="rounded-[10px] border border-red-500/20 bg-red-500/10 px-3 py-2 text-[13px] text-red-500">
                          {gatewayStatus.error}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-4">
                    {showLogs ? (
                      <div className="rounded-[10px] border border-black/10 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                        <div className="mb-3 flex items-center justify-between gap-3">
                          <p className="text-[14px] font-medium text-foreground">
                            {t('gateway.appLogs')}
                          </p>
                          <div className="flex flex-wrap gap-2">
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 rounded-[10px] px-3"
                              onClick={handleOpenLogDir}
                            >
                              <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                              {t('gateway.openFolder')}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-8 rounded-[10px] px-3"
                              onClick={() => setShowLogs(false)}
                            >
                              {t('common:actions.close')}
                            </Button>
                          </div>
                        </div>
                        <pre className="max-h-64 overflow-auto whitespace-pre-wrap rounded-[10px] border border-black/10 bg-black/[0.03] p-3 font-mono text-[12px] text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                          {logContent || t('common:status.loading')}
                        </pre>
                      </div>
                    ) : null}
                  </div>
                </div>
              </SubCard>

              <SubCard title={t('gateway.proxyTitle')} description={t('gateway.proxyDesc')}>
                <div className="space-y-4">
                  <div className="grid gap-2 md:grid-cols-3">
                    {(['system', 'custom', 'direct'] as const).map((mode) => {
                      const active = proxyModeDraft === mode;
                      const label =
                        mode === 'system'
                          ? t('gateway.proxyModeSystem')
                          : mode === 'custom'
                            ? t('gateway.proxyModeCustom')
                            : t('gateway.proxyModeDirect');
                      const help =
                        mode === 'system'
                          ? t('gateway.proxyModeSystemHelp')
                          : mode === 'custom'
                            ? t('gateway.proxyModeCustomHelp')
                            : t('gateway.proxyModeDirectHelp');

                      return (
                        <button
                          key={mode}
                          type="button"
                          onClick={() => {
                            setProxyModeDraft(mode);
                            setProxySaveError(null);
                            setProxySaveDoneAt(null);
                            if (mode === 'custom') {
                              setShowCustomProxyForm(true);
                            }
                          }}
                          className={cn(
                            'rounded-[10px] border px-4 py-4 text-left transition-colors',
                            active
                              ? 'border-black/20 bg-white text-foreground dark:border-white/20 dark:bg-white/[0.08]'
                              : 'border-black/10 bg-black/[0.03] text-muted-foreground hover:bg-black/[0.05] dark:border-white/10 dark:bg-white/[0.03] dark:hover:bg-white/[0.05]'
                          )}
                        >
                          <div className="text-[14px] font-medium">{label}</div>
                          <p className="mt-2 text-[12px] leading-5">{help}</p>
                        </button>
                      );
                    })}
                  </div>

                  {proxyModeDraft === 'custom' ? (
                    <div className="space-y-4 rounded-[10px] border border-black/10 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                        <div>
                          <p className="text-[14px] font-medium text-foreground">
                            {t('gateway.proxyModeCustom')}
                          </p>
                          <p className="mt-1 text-[12px] text-muted-foreground">
                            {t('gateway.proxyModeCustomHelp')}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant={showCustomProxyForm ? 'default' : 'outline'}
                            size="sm"
                            className={cn(
                              'h-9 rounded-[10px] px-4',
                              showCustomProxyForm
                                ? ''
                                : 'border-black/10 bg-transparent dark:border-white/10 dark:hover:bg-white/5'
                            )}
                            onClick={() => {
                              if (showCustomProxyForm) {
                                void handleSaveProxySettings();
                                return;
                              }
                              setShowCustomProxyForm(true);
                            }}
                            disabled={showCustomProxyForm ? savingProxy || !hasCustomProxyChanges : false}
                          >
                            {showCustomProxyForm ? t('common:actions.save') : t('gateway.configureProxy')}
                          </Button>
                        </div>
                      </div>

                      {showCustomProxyForm ? (
                        <>
                          <div className="space-y-2">
                            <Label htmlFor="proxy-server" className="text-[13px] text-foreground/85">
                              {t('gateway.proxyServer')}
                            </Label>
                            <Input
                              id="proxy-server"
                              value={proxyServerDraft}
                              onChange={(event) => setProxyServerDraft(event.target.value)}
                              placeholder="http://127.0.0.1:7890"
                              className="h-10 rounded-[10px] border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]"
                            />
                            <p className="text-[12px] text-muted-foreground">{t('gateway.proxyServerHelp')}</p>
                          </div>

                          <div className="space-y-2">
                            <div className="flex items-center justify-between gap-3">
                              <Label className="text-[13px] text-foreground/85">
                                {t('gateway.proxyBypass')}
                              </Label>
                              <Button
                                type="button"
                                variant="ghost"
                                size="sm"
                                className="h-8 rounded-[10px] px-3 text-[12px]"
                                onClick={() => setShowAdvancedProxy((prev) => !prev)}
                              >
                                {showAdvancedProxy
                                  ? t('gateway.hideAdvancedProxy')
                                  : t('gateway.showAdvancedProxy')}
                              </Button>
                            </div>
                            <Input
                              value={proxyBypassRulesDraft}
                              onChange={(event) => setProxyBypassRulesDraft(event.target.value)}
                              placeholder="<local>;localhost;127.0.0.1;::1"
                              className="h-10 rounded-[10px] border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]"
                            />
                            <p className="text-[12px] text-muted-foreground">{t('gateway.proxyBypassHelp')}</p>
                          </div>

                          {showAdvancedProxy ? (
                            <div className="grid gap-4 md:grid-cols-3">
                              <div className="space-y-2">
                                <Label className="text-[13px] text-foreground/85">
                                  {t('gateway.proxyHttpServer')}
                                </Label>
                                <Input
                                  value={proxyHttpServerDraft}
                                  onChange={(event) => setProxyHttpServerDraft(event.target.value)}
                                  placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                                  className="h-10 rounded-[10px] border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]"
                                />
                                <p className="text-[12px] text-muted-foreground">
                                  {t('gateway.proxyHttpServerHelp')}
                                </p>
                              </div>

                              <div className="space-y-2">
                                <Label className="text-[13px] text-foreground/85">
                                  {t('gateway.proxyHttpsServer')}
                                </Label>
                                <Input
                                  value={proxyHttpsServerDraft}
                                  onChange={(event) => setProxyHttpsServerDraft(event.target.value)}
                                  placeholder={proxyServerDraft || 'http://127.0.0.1:7890'}
                                  className="h-10 rounded-[10px] border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]"
                                />
                                <p className="text-[12px] text-muted-foreground">
                                  {t('gateway.proxyHttpsServerHelp')}
                                </p>
                              </div>

                              <div className="space-y-2">
                                <Label className="text-[13px] text-foreground/85">
                                  {t('gateway.proxyAllServer')}
                                </Label>
                                <Input
                                  value={proxyAllServerDraft}
                                  onChange={(event) => setProxyAllServerDraft(event.target.value)}
                                  placeholder={proxyServerDraft || 'socks5://127.0.0.1:7891'}
                                  className="h-10 rounded-[10px] border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]"
                                />
                                <p className="text-[12px] text-muted-foreground">
                                  {t('gateway.proxyAllServerHelp')}
                                </p>
                              </div>
                            </div>
                          ) : null}
                        </>
                      ) : null}
                    </div>
                  ) : null}

                  <div
                    className={cn(
                      'flex items-center gap-2 text-[12px]',
                      proxySaveError ? 'text-red-500' : 'text-muted-foreground'
                    )}
                  >
                    {savingProxy ? <LoadingIcon className="h-3.5 w-3.5" /> : null}
                    <span>{proxyStatusText}</span>
                  </div>
                </div>
              </SubCard>

              <SubCard
                title={t('gatewayPorts.title')}
                description={t('gatewayPorts.description')}
              >
                <GatewayPortsSettings
                  currentPort={gatewayStatus.port}
                  currentPid={gatewayStatus.pid}
                />
              </SubCard>
            </div>
          </SectionCard>

          <SectionCard title={t('memory.title')} description={t('memory.description')}>
            <div className="space-y-4">
              <SettingRow
                label={t('memory.sessionMemory')}
                description={t('memory.sessionMemoryDesc')}
                control={
                  <Switch
                    checked={sessionMemoryEnabled}
                    onCheckedChange={setSessionMemoryEnabled}
                  />
                }
              />
              <SettingRow
                label={t('memory.search')}
                description={t('memory.searchDesc')}
                control={
                  <Switch
                    checked={memorySearchEnabled}
                    onCheckedChange={setMemorySearchEnabled}
                  />
                }
              />
              <SettingRow
                label={t('memory.localModelLean')}
                description={t('memory.localModelLeanDesc')}
                control={
                  <Switch
                    checked={localModelLean}
                    onCheckedChange={setLocalModelLean}
                  />
                }
              />
            </div>
          </SectionCard>

          <SectionCard
            title={t('dataManagement.title')}
            description={t('dataManagement.description')}
          >
            <BackupRestoreSettings />
          </SectionCard>

          <SectionCard
            title={isPortable ? t('about.title') : t('updates.title')}
            description={isPortable ? undefined : t('updates.description')}
          >
            <UpdateSettings versionOnly={isPortable} />
          </SectionCard>

          <SectionCard title={t('advanced.title')} description={t('advanced.description')}>
            <div className="space-y-4">
              <SettingRow
                label={t('advanced.slashCommandHints')}
                description={t('advanced.slashCommandHintsDesc')}
                control={
                  <Switch
                    checked={slashCommandHintsEnabled}
                    onCheckedChange={setSlashCommandHintsEnabled}
                  />
                }
              />
              <SettingRow
                label={t('advanced.devMode')}
                description={t('advanced.devModeDesc')}
                control={<Switch checked={devModeUnlocked} onCheckedChange={setDevModeUnlocked} />}
              />
            </div>
          </SectionCard>

          {devModeUnlocked ? (
            <SectionCard title={t('developer.title')} description={t('developer.description')}>
              <div className="space-y-4">
                <SubCard
                  title={t('developer.console')}
                  description={t('developer.consoleDesc')}
                >
                  <div className="space-y-4">
                    <div className="rounded-[10px] border border-black/10 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                      <div className="space-y-1">
                        <p className="text-[14px] font-medium text-foreground">
                          {t('developer.gatewayToken')}
                        </p>
                        <p className="text-[13px] text-muted-foreground">
                          {t('developer.gatewayTokenDesc')}
                        </p>
                      </div>

                      <div className="mt-4 flex flex-col gap-3 lg:flex-row">
                        <Input
                          readOnly
                          value={controlUiInfo?.token || ''}
                          placeholder={t('developer.tokenUnavailable')}
                          className="h-10 flex-1 rounded-[10px] border-black/10 bg-white font-mono text-[13px] dark:border-white/10 dark:bg-white/[0.03]"
                        />

                        <div className="flex flex-wrap gap-2">
                          <RefreshButton
                            type="button"
                            label={t('common:actions.refresh')}
                            onClick={refreshControlUiInfo}
                            className="h-10 rounded-[10px] px-4"
                          />
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={handleCopyGatewayToken}
                            disabled={!controlUiInfo?.token}
                            className="h-10 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            {t('common:actions.copy')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            disabled={!controlUiInfo?.url}
                            className="h-10 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                            onClick={handleOpenControlUi}
                          >
                            <ExternalLink className="mr-1.5 h-3.5 w-3.5" />
                            {t('developer.openConsole')}
                          </Button>
                        </div>
                      </div>
                    </div>
                  </div>
                </SubCard>

                <SubCard title={t('developer.cli')} description={t('developer.cliDesc')}>
                  <div className="space-y-3">
                    {isWindows ? (
                      <p className="text-[12px] text-muted-foreground">{t('developer.cliPowershell')}</p>
                    ) : null}
                    <div className="flex flex-col gap-3 md:flex-row">
                      <Input
                        readOnly
                        value={openclawCliCommand}
                        placeholder={openclawCliError || t('developer.cmdUnavailable')}
                        className="h-10 flex-1 rounded-[10px] border-black/10 bg-white font-mono text-[13px] dark:border-white/10 dark:bg-white/[0.03]"
                      />
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                        onClick={handleCopyCliCommand}
                        disabled={!openclawCliCommand}
                      >
                        <Copy className="mr-1.5 h-3.5 w-3.5" />
                        {t('common:actions.copy')}
                      </Button>
                    </div>
                  </div>
                </SubCard>

                <SubCard title={t('developer.wsDiagnostic')} description={t('developer.wsDiagnosticDesc')}>
                  <SettingRow
                    label={t('developer.wsDiagnostic')}
                    description={t('developer.wsDiagnosticDesc')}
                    control={
                      <Switch
                        checked={wsDiagnosticEnabled}
                        onCheckedChange={handleWsDiagnosticToggle}
                      />
                    }
                  />
                </SubCard>

                <SubCard title={t('developer.doctor')} description={t('developer.doctorDesc')}>
                  <div className="space-y-4">
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                        disabled={doctorRunningMode !== null}
                        onClick={() => void handleRunOpenClawDoctor('diagnose')}
                      >
                        {doctorRunningMode === 'diagnose' ? (
                          <LoadingIcon className="mr-1.5 h-3.5 w-3.5" />
                        ) : (
                          <Search className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {t('developer.runDoctor')}
                      </Button>
                      <Button
                        type="button"
                        variant="outline"
                        className="h-10 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                        disabled={doctorRunningMode !== null}
                        onClick={() => void handleRunOpenClawDoctor('fix')}
                      >
                        {doctorRunningMode === 'fix' ? (
                          <LoadingIcon className="mr-1.5 h-3.5 w-3.5" />
                        ) : (
                          <Wrench className="mr-1.5 h-3.5 w-3.5" />
                        )}
                        {t('developer.runDoctorFix')}
                      </Button>
                    </div>

                    {doctorResult ? (
                      <div className="space-y-3 rounded-[10px] border border-black/10 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                        <div className="flex flex-wrap items-center gap-2">
                          <Badge variant="secondary" className="rounded-[10px] px-3 py-1">
                            {doctorResult.mode === 'fix'
                              ? t('developer.doctorFixLabel')
                              : t('developer.doctorLabel')}
                          </Badge>
                          <Badge
                            variant="secondary"
                            className={cn(
                              'rounded-[10px] px-3 py-1',
                              doctorResult.status === 'success'
                                ? 'bg-green-500/10 text-green-600 dark:text-green-500'
                                : doctorResult.status === 'success_with_warnings'
                                  ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
                                : 'bg-red-500/10 text-red-600 dark:text-red-500'
                            )}
                          >
                            {doctorResult.status === 'success'
                              ? t('developer.doctorStatusSuccess')
                              : doctorResult.status === 'success_with_warnings'
                                ? t('developer.doctorStatusWarning')
                              : t('developer.doctorStatusFailed')}
                          </Badge>
                          <span className="text-[12px] text-muted-foreground">
                            {t('developer.doctorExitCode', { code: doctorResult.exitCode ?? 'null' })}
                          </span>
                          <span className="text-[12px] text-muted-foreground">
                            {t('developer.doctorDuration', { ms: doctorResult.durationMs })}
                          </span>
                        </div>

                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                            <p className="mb-2 text-[12px] font-semibold text-muted-foreground">
                              {t('developer.doctorCommand')}
                            </p>
                            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                              {doctorResult.command}
                            </pre>
                          </div>
                          <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                            <p className="mb-2 text-[12px] font-semibold text-muted-foreground">
                              {t('developer.doctorWorkingDir')}
                            </p>
                            <pre className="overflow-x-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                              {doctorResult.cwd || '-'}
                            </pre>
                          </div>
                        </div>

                        {doctorResult.error ? (
                          <div className="rounded-[10px] border border-red-500/20 bg-red-500/10 p-3 text-[12px] text-red-600 dark:text-red-400">
                            {doctorResult.error}
                          </div>
                        ) : null}

                        {doctorResult.warnings.length > 0 ? (
                          <div className="rounded-[10px] border border-amber-500/20 bg-amber-500/10 p-3 text-[12px] text-amber-700 dark:text-amber-300">
                            <p className="mb-2 font-semibold">
                              {t('developer.doctorWarnings', { count: doctorResult.warnings.length })}
                            </p>
                            <ul className="space-y-1">
                              {doctorResult.warnings.map((warning) => (
                                <li key={warning}>{warning}</li>
                              ))}
                            </ul>
                          </div>
                        ) : null}

                        <div className="grid gap-3 lg:grid-cols-2">
                          <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                            <p className="mb-2 text-[12px] font-semibold text-muted-foreground">
                              STDOUT
                            </p>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                              {doctorResult.stdout || '-'}
                            </pre>
                          </div>
                          <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]">
                            <p className="mb-2 text-[12px] font-semibold text-muted-foreground">
                              STDERR
                            </p>
                            <pre className="max-h-64 overflow-auto whitespace-pre-wrap font-mono text-[11px] text-muted-foreground">
                              {doctorResult.stderr || '-'}
                            </pre>
                          </div>
                        </div>
                      </div>
                    ) : null}
                  </div>
                </SubCard>

                <SubCard
                  title={t('developer.telemetryViewer')}
                  description={t('developer.telemetryViewerDesc')}
                  action={
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="h-9 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                      onClick={() => setShowTelemetryViewer((prev) => !prev)}
                    >
                      {showTelemetryViewer ? t('common:actions.hide') : t('common:actions.show')}
                    </Button>
                  }
                >
                  {showTelemetryViewer ? (
                    <div className="space-y-4">
                      <div className="flex flex-wrap items-center gap-2">
                        <Badge variant="secondary" className="rounded-[10px] px-3 py-1">
                          {t('developer.telemetryTotal')}: {telemetryStats.total}
                        </Badge>
                        <Badge variant="secondary" className="rounded-[10px] px-3 py-1">
                          {t('developer.telemetryErrors')}: {telemetryStats.errorCount}
                        </Badge>
                        <Badge variant="secondary" className="rounded-[10px] px-3 py-1">
                          {t('developer.telemetrySlow')}: {telemetryStats.slowCount}
                        </Badge>
                        <div className="ml-auto flex flex-wrap gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                            onClick={handleCopyTelemetry}
                          >
                            <Copy className="mr-1.5 h-3.5 w-3.5" />
                            {t('common:actions.copy')}
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            className="h-8 rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                            onClick={handleClearTelemetry}
                          >
                            {t('common:actions.clear')}
                          </Button>
                        </div>
                      </div>

                      <div className="grid gap-4 xl:grid-cols-[320px_minmax(0,1fr)]">
                        <div className="rounded-[10px] border border-black/10 bg-white/75 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                          <p className="mb-3 text-[12px] font-semibold text-muted-foreground">
                            {t('developer.telemetryAggregated')}
                          </p>
                          <div className="space-y-2">
                            {telemetryByEvent.length === 0 ? (
                              <div className="text-[12px] text-muted-foreground">
                                {t('developer.telemetryEmpty')}
                              </div>
                            ) : (
                              telemetryByEvent.map((item) => (
                                <div
                                  key={item.event}
                                  className="rounded-[10px] border border-black/10 bg-black/[0.03] px-3 py-2 text-[12px] dark:border-white/10 dark:bg-white/[0.03]"
                                >
                                  <div className="truncate font-medium text-foreground" title={item.event}>
                                    {item.event}
                                  </div>
                                  <div className="mt-1 text-muted-foreground">
                                    n={item.count} · avg=
                                    {item.timedCount > 0
                                      ? Math.round(item.totalDuration / item.timedCount)
                                      : 0}
                                    ms · slow={item.slowCount} · err={item.errorCount}
                                  </div>
                                </div>
                              ))
                            )}
                          </div>
                        </div>

                        <div className="max-h-80 overflow-auto rounded-[10px] border border-black/10 bg-white/75 p-3 dark:border-white/10 dark:bg-white/[0.04]">
                          {telemetryEntries.length === 0 ? (
                            <div className="py-6 text-center text-[12px] text-muted-foreground">
                              {t('developer.telemetryEmpty')}
                            </div>
                          ) : (
                            <div className="space-y-2 font-mono text-[12px]">
                              {telemetryEntries
                                .slice()
                                .reverse()
                                .map((entry) => (
                                  <div
                                    key={entry.id}
                                    className="rounded-[10px] border border-black/10 bg-black/[0.03] p-3 dark:border-white/10 dark:bg-white/[0.03]"
                                  >
                                    <div className="mb-2 flex items-center justify-between gap-3">
                                      <span className="font-semibold text-foreground">{entry.event}</span>
                                      <span className="text-[11px] text-muted-foreground">{entry.ts}</span>
                                    </div>
                                    <pre className="overflow-x-auto whitespace-pre-wrap text-[11px] text-muted-foreground">
                                      {JSON.stringify(
                                        { count: entry.count, ...entry.payload },
                                        null,
                                        2
                                      )}
                                    </pre>
                                  </div>
                                ))}
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : null}
                </SubCard>
              </div>
            </SectionCard>
          ) : null}

        </div>
      </div>
    </div>
  );
}

export default Settings;
