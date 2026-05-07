/**
 * Setup Wizard Page
 * First-time setup experience for new users
 */
import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  AlertCircle,
  Eye,
  EyeOff,
  CheckCircle2,
  XCircle,
  ExternalLink,
  Copy,
  Check,
  ChevronDown,
} from 'lucide-react';
import { TitleBar } from '@/components/layout/TitleBar';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { cn } from '@/lib/utils';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { RefreshButton } from '@/components/common/RefreshButton';
import { useGatewayStore } from '@/stores/gateway';
import { useProviderStore } from '@/stores/providers';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';

const STEP = {
  RUNTIME: 0,
  INSTALLING: 1,
  MODEL_CONFIG: 2,
  COMPLETE: 3,
} as const;

// Actual runtime dependencies installed during setup
interface SetupDependency {
  id: string;
  name: string;
  description: string;
}

type SetupProviderModelOption = {
  id: string;
  name: string;
  category?: string;
  typeLabel?: string;
  input?: string;
  contextWindow?: number | null;
  tags?: string[];
};

function isPrimarySetupModelOption(option: SetupProviderModelOption): boolean {
  const value = option.category?.trim().toLowerCase();
  if (!value) {
    return true;
  }
  return value === 'chat' || value === 'reasoning' || value === 'code' || value === 'vision';
}

type ResolvedProviderModelResponse = {
  runtimeProviderId?: string;
  models: SetupProviderModelOption[];
  resolved?: boolean;
  source?: string;
  error?: string;
};

const PROVIDER_MODEL_OPTIONS_TIMEOUT_MS = 60_000;

const getSetupDependencies = (t: TFunction): SetupDependency[] => [
  {
    id: 'uv',
    name: t('dependencies.uv.name'),
    description: t('dependencies.uv.description'),
  },
  {
    id: 'managed-python',
    name: t('dependencies.managedPython.name'),
    description: t('dependencies.managedPython.description'),
  },
];

function isLocalModelProviderAccount(account: ProviderAccount): boolean {
  return account.vendorId === 'local-model' && account.metadata?.localModelProvider === true;
}

async function resolveLocalProviderModels(payload: {
  accountId: string;
  baseUrl?: string;
  apiProtocol?: ProviderAccount['apiProtocol'];
  apiKey?: string | null;
}): Promise<ResolvedProviderModelResponse> {
  return hostApiFetch<ResolvedProviderModelResponse>('/api/provider-model-options/resolve', {
    method: 'POST',
    timeoutMs: PROVIDER_MODEL_OPTIONS_TIMEOUT_MS,
    body: JSON.stringify({
      vendorId: 'local-model',
      authMode: 'api_key',
      accountId: payload.accountId,
      baseUrl: payload.baseUrl,
      apiProtocol: payload.apiProtocol,
      apiKey: payload.apiKey ?? undefined,
    }),
  });
}

async function syncOAuthRuntimeAccount(accountId: string): Promise<void> {
  const result = await hostApiFetch<{ success: boolean; error?: string }>(
    `/api/provider-accounts/${encodeURIComponent(accountId)}`,
    {
      method: 'PUT',
      body: JSON.stringify({ updates: {} }),
    },
  );
  if (!result.success) {
    throw new Error(result.error || 'Failed to sync OAuth runtime account');
  }
}

import {
  SETUP_PROVIDERS,
  type ProviderAccount,
  type ProviderType,
  type ProviderTypeInfo,
  getProviderIconUrl,
  isSelfHostedProviderType,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  fetchProviderSnapshot,
  hasConfiguredCredentials,
  pickPreferredAccount,
} from '@/lib/provider-accounts';
import clawclawLogoFull from '@/assets/logo-full.svg';

// NOTE: Channel types moved to Settings > Channels page
// NOTE: Skill bundles moved to Settings > Skills page - auto-install essential skills during setup

export function Setup() {
  const { t } = useTranslation(['setup', 'channels']);
  const navigate = useNavigate();
  const location = useLocation();
  const [currentStep, setCurrentStep] = useState<number>(STEP.RUNTIME);
  // Runtime check status
  const [runtimeChecksPassed, setRuntimeChecksPassed] = useState(false);
  const [hasConfiguredModels, setHasConfiguredModels] = useState(false);

  const safeStepIndex = Number.isInteger(currentStep)
    ? Math.min(Math.max(currentStep, STEP.RUNTIME), STEP.COMPLETE)
    : STEP.RUNTIME;
  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);
  const completingRef = useRef(false);

  const refreshConfiguredModelStatus = useCallback(async () => {
    try {
      const snapshot = await fetchProviderSnapshot();
      const nextHasConfiguredModels = snapshot.accounts.some((account) => (
        account.enabled
        && !account.metadata?.localModelProvider
        && Boolean(account.model?.trim())
      ));
      setHasConfiguredModels(nextHasConfiguredModels);
      return nextHasConfiguredModels;
    } catch {
      setHasConfiguredModels(false);
      return false;
    }
  }, []);

  useEffect(() => {
    if (safeStepIndex !== STEP.RUNTIME || !runtimeChecksPassed) return;
    const timer = setTimeout(() => {
      setCurrentStep(STEP.INSTALLING);
    }, 900);
    return () => clearTimeout(timer);
  }, [runtimeChecksPassed, safeStepIndex]);

  useEffect(() => {
    const search = new URLSearchParams(location.search);
    if (search.get('step') === 'complete') {
      queueMicrotask(() => {
        setCurrentStep(STEP.COMPLETE);
      });
    }
  }, [location.search]);

  useEffect(() => {
    queueMicrotask(() => {
      void refreshConfiguredModelStatus();
    });
  }, [refreshConfiguredModelStatus, location.key]);

  useEffect(() => {
    if (safeStepIndex !== STEP.MODEL_CONFIG || !hasConfiguredModels) return;
    queueMicrotask(() => {
      setCurrentStep(STEP.COMPLETE);
    });
  }, [hasConfiguredModels, safeStepIndex]);

  useEffect(() => {
    if (safeStepIndex !== STEP.COMPLETE || completingRef.current) return;
    completingRef.current = true;
    const timer = window.setTimeout(() => {
      markSetupComplete();
      navigate('/');
    }, 900);
    return () => {
      window.clearTimeout(timer);
    };
  }, [markSetupComplete, navigate, safeStepIndex]);

  const handleInstallationComplete = useCallback((_skills: string[]) => {
    setCurrentStep(STEP.MODEL_CONFIG);
  }, []);

  const progressPercent =
    safeStepIndex === STEP.RUNTIME ? 28 :
      safeStepIndex === STEP.INSTALLING ? 62 :
        safeStepIndex === STEP.MODEL_CONFIG ? 86 : 100;

  const currentStepTitle =
    safeStepIndex === STEP.RUNTIME
      ? t('steps.runtime.title')
      : safeStepIndex === STEP.INSTALLING
        ? t('steps.installing.title')
        : safeStepIndex === STEP.MODEL_CONFIG
          ? t('steps.modelConfig.title')
          : t('steps.complete.title');

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex flex-1 items-center justify-center overflow-auto px-6 py-8 md:px-8 md:py-10">
        <div className="flex w-full max-w-3xl flex-col justify-center">
          <div className="mb-6 text-center">
            <div className="mb-6 flex justify-center">
              <img src={clawclawLogoFull} alt="ClawClaw" className="h-16 w-auto" />
            </div>
            <h1 className="text-4xl font-semibold tracking-tight">{t('welcome.title')}</h1>
          </div>

          <div className="rounded-3xl border border-border/70 bg-card/90 p-6 text-card-foreground shadow-sm md:p-8">
            <div className="mb-5">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {currentStepTitle}
                </span>
                <span className="text-muted-foreground">{progressPercent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-secondary">
                <motion.div
                  className="h-full bg-primary"
                  initial={{ width: 0 }}
                  animate={{ width: `${progressPercent}%` }}
                  transition={{ duration: 0.35 }}
                />
              </div>
            </div>

            {safeStepIndex === STEP.RUNTIME && (
              <RuntimeContent onStatusChange={setRuntimeChecksPassed} />
            )}
            {safeStepIndex === STEP.INSTALLING && (
              <InstallingContent
                dependencies={getSetupDependencies(t)}
                onComplete={handleInstallationComplete}
              />
            )}
          {safeStepIndex === STEP.MODEL_CONFIG && (
              <ModelSetupContent
                hasConfiguredModels={hasConfiguredModels}
                onRefreshConfigured={refreshConfiguredModelStatus}
                onSkip={() => queueMicrotask(() => setCurrentStep(STEP.COMPLETE))}
              />
            )}
            {safeStepIndex === STEP.COMPLETE && (
              <CompleteContent
                modelConfigured={hasConfiguredModels}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

interface RuntimeContentProps {
  onStatusChange: (canProceed: boolean) => void;
}

function RuntimeContent({ onStatusChange }: RuntimeContentProps) {
  const { t } = useTranslation('setup');
  const gatewayStatus = useGatewayStore((state) => state.status);
  const startGateway = useGatewayStore((state) => state.start);
  const gatewayStartAttemptedRef = useRef(false);
  const [showGatewayErrorDetails, setShowGatewayErrorDetails] = useState(false);

  const [checks, setChecks] = useState({
    nodejs: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    openclaw: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
    gateway: { status: 'checking' as 'checking' | 'success' | 'error', message: '' },
  });
  const gatewayTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const runChecks = useCallback(async () => {
    // Reset checks
    setChecks({
      nodejs: { status: 'checking', message: '' },
      openclaw: { status: 'checking', message: '' },
      gateway: { status: 'checking', message: '' },
    });

    // Check Node.js - always available in Electron
    setChecks((prev) => ({
      ...prev,
      nodejs: { status: 'success', message: t('runtime.status.success') },
    }));

    // Check OpenClaw package status
    try {
      const openclawStatus = (await invokeIpc('openclaw:status')) as {
        packageExists: boolean;
        isBuilt: boolean;
        dir: string;
        version?: string;
      };

      if (!openclawStatus.packageExists) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: t('runtime.status.error'),
          },
        }));
      } else if (!openclawStatus.isBuilt) {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'error',
            message: t('runtime.status.error'),
          },
        }));
      } else {
        setChecks((prev) => ({
          ...prev,
          openclaw: {
            status: 'success',
            message: t('runtime.status.packageReady'),
          },
        }));
      }
    } catch {
      setChecks((prev) => ({
        ...prev,
        openclaw: { status: 'error', message: t('runtime.status.error') },
      }));
    }

    // Check Gateway - read directly from store to avoid stale closure
    // Don't immediately report error; gateway may still be initializing
    const currentGateway = useGatewayStore.getState().status;
    if (currentGateway.state === 'running') {
      setChecks((prev) => ({
        ...prev,
        gateway: {
          status: 'success',
          message: t('runtime.status.gatewayRunning', { port: currentGateway.port }),
        },
      }));
    } else if (currentGateway.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: currentGateway.error ?? t('runtime.status.error') },
      }));
    } else {
      // Gateway is 'stopped', 'starting', or 'reconnecting'
      // Keep as 'checking' - the dedicated effect will update when status changes
      setChecks((prev) => ({
        ...prev,
        gateway: {
          status: 'checking',
          message:
            currentGateway.state === 'starting'
              ? t('runtime.status.checking')
              : t('runtime.status.checking'),
        },
      }));
    }
  }, [t]);

  useEffect(() => {
    queueMicrotask(() => {
      void runChecks();
    });
  }, [runChecks]);

  useEffect(() => {
    if (checks.openclaw.status !== 'success') {
      gatewayStartAttemptedRef.current = false;
      return;
    }

    if (gatewayStatus.state !== 'stopped' || gatewayStartAttemptedRef.current) {
      return;
    }

    gatewayStartAttemptedRef.current = true;
    queueMicrotask(() => {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: t('runtime.status.checking') },
      }));
    });
    void startGateway();
  }, [checks.openclaw.status, gatewayStatus.state, startGateway, t]);

  // Update canProceed when gateway status changes
  useEffect(() => {
    const allPassed =
      checks.nodejs.status === 'success' &&
      checks.openclaw.status === 'success' &&
      (checks.gateway.status === 'success' || gatewayStatus.state === 'running');
    onStatusChange(allPassed);
  }, [checks, gatewayStatus, onStatusChange]);

  // Update gateway check when gateway status changes
  useEffect(() => {
    if (gatewayStatus.state === 'running') {
      queueMicrotask(() => {
        setChecks((prev) => ({
          ...prev,
          gateway: {
            status: 'success',
            message: t('runtime.status.gatewayRunning', { port: gatewayStatus.port || 18789 }),
          },
        }));
      });
    } else if (gatewayStatus.state === 'error') {
      queueMicrotask(() => {
        setChecks((prev) => ({
          ...prev,
          gateway: { status: 'error', message: gatewayStatus.error ?? t('runtime.status.error') },
        }));
      });
    } else if (gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting') {
      queueMicrotask(() => {
        setChecks((prev) => ({
          ...prev,
          gateway: { status: 'checking', message: t('runtime.status.checking') },
        }));
      });
    } else if (gatewayStatus.state === 'stopped' && gatewayStartAttemptedRef.current) {
      queueMicrotask(() => {
        setChecks((prev) => ({
          ...prev,
          gateway: { status: 'error', message: gatewayStatus.error ?? t('runtime.status.error') },
        }));
      });
    }
  }, [gatewayStatus, t]);

  // Gateway startup timeout - show error after a reasonable wait.
  useEffect(() => {
    if (gatewayTimeoutRef.current) {
      clearTimeout(gatewayTimeoutRef.current);
      gatewayTimeoutRef.current = null;
    }

    // If gateway is already in a terminal state, no timeout needed
    if (gatewayStatus.state === 'running' || gatewayStatus.state === 'error') {
      return;
    }

    // Set timeout for non-terminal states (stopped, starting, reconnecting)
    gatewayTimeoutRef.current = setTimeout(() => {
      setChecks((prev) => {
        if (prev.gateway.status === 'checking') {
          return {
            ...prev,
            gateway: {
              status: 'error',
              message: gatewayStatus.error ?? t('runtime.status.error'),
            },
          };
        }
        return prev;
      });
    }, 45 * 1000);

    return () => {
      if (gatewayTimeoutRef.current) {
        clearTimeout(gatewayTimeoutRef.current);
        gatewayTimeoutRef.current = null;
      }
    };
  }, [gatewayStatus.error, gatewayStatus.state, t]);

  const handleStartGateway = async () => {
    gatewayStartAttemptedRef.current = true;
    setShowGatewayErrorDetails(false);
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: t('runtime.status.checking') },
    }));
    await startGateway();
  };

  const summarizeGatewayError = useCallback((message: string) => {
    if (!message) return t('runtime.status.error');

    if (/brace-expansion/i.test(message)) {
      return t('runtime.gatewayIssues.braceExpansion');
    }

    if (/LRUCache is not a constructor/i.test(message)) {
      return t('runtime.gatewayIssues.nestedDependency');
    }

    if (/Bundled OpenClaw runtime validation failed/i.test(message)) {
      return t('runtime.gatewayIssues.runtimeValidation');
    }

    const firstLine = message
      .split('|')[0]
      ?.split('\n')[0]
      ?.trim();

    return firstLine || t('runtime.status.error');
  }, [t]);

  const renderStatus = (status: 'checking' | 'success' | 'error', message: string) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-2 text-yellow-400 whitespace-nowrap">
          <LoadingIcon className="h-5 w-5 flex-shrink-0" />
          {message || 'Checking'}
        </span>
      );
    }
    if (status === 'success') {
      return (
        <span className="flex items-center gap-2 text-green-400 whitespace-nowrap">
          <CheckCircle2 className="h-5 w-5 flex-shrink-0" />
          {message}
        </span>
      );
    }

    return (
      <span className="flex items-center gap-2 text-red-400">
        <XCircle className="h-5 w-5 flex-shrink-0" />
        <span className="min-w-0 break-words">{summarizeGatewayError(message)}</span>
      </span>
    );
  };

  return (
    <div className="space-y-4">
      <div className="space-y-3">
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <span className="text-left">{t('runtime.nodejs')}</span>
          <div className="flex justify-end">
            {renderStatus(checks.nodejs.status, checks.nodejs.message)}
          </div>
        </div>
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <div className="text-left min-w-0">
            <span>{t('runtime.openclaw')}</span>
          </div>
          <div className="flex justify-end">
            {renderStatus(checks.openclaw.status, checks.openclaw.message)}
          </div>
        </div>
        <div className="rounded-lg bg-muted/50 p-3">
          <div className="flex items-start justify-between gap-4">
            <div className="flex min-w-0 items-start gap-2 text-left">
              <span>{t('runtime.gateway')}</span>
            </div>
            <div className="flex justify-end">
              {renderStatus(checks.gateway.status, checks.gateway.message)}
            </div>
          </div>
          {checks.gateway.status === 'error' && (
            <div className="mt-3 space-y-3 rounded-xl border border-border/70 bg-background/80 p-3">
              <div className="flex flex-wrap items-center gap-2">
                <Button variant="outline" size="sm" onClick={handleStartGateway}>
                  {t('runtime.startGateway')}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="gap-1 px-2 text-muted-foreground"
                  onClick={() => setShowGatewayErrorDetails((prev) => !prev)}
                >
                  <ChevronDown
                    className={cn('h-4 w-4 transition-transform', showGatewayErrorDetails && 'rotate-180')}
                  />
                  {showGatewayErrorDetails ? t('runtime.hideDetails') : t('runtime.showDetails')}
                </Button>
              </div>
              {showGatewayErrorDetails && (
                <pre className="max-h-48 overflow-auto rounded-lg bg-muted px-3 py-2 text-xs leading-6 text-muted-foreground whitespace-pre-wrap break-words">
                  {checks.gateway.message}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

interface ProviderContentProps {
  providers: ProviderTypeInfo[];
  selectedProvider: string | null;
  onSelectProvider: (id: string | null) => void;
  apiKey: string;
  onApiKeyChange: (key: string) => void;
  onConfiguredChange: (configured: boolean) => void;
}

export function AutoConfiguredLocalModelContent({
  configured,
  modelNames,
}: {
  configured: boolean;
  modelNames: string[];
}) {
  const { t } = useTranslation('setup');

  return (
    <div className="space-y-5">
      <div className="rounded-xl border border-border bg-muted/40 p-4">
        <div className="flex items-start gap-3">
          <div
            className={cn(
              'mt-0.5 flex h-9 w-9 items-center justify-center rounded-full',
              configured ? 'bg-green-500/15 text-green-500' : 'bg-amber-500/15 text-amber-500',
            )}
          >
            {configured ? <CheckCircle2 className="h-5 w-5" /> : <LoadingIcon className="h-5 w-5" />}
          </div>
          <div className="space-y-1.5">
            <p className="font-medium text-foreground">
              {configured ? t('localModel.autoConfiguredTitle') : t('localModel.waitingTitle')}
            </p>
            <p className="text-sm text-muted-foreground">
              {configured ? t('localModel.autoConfiguredDesc') : t('localModel.waitingDesc')}
            </p>
          </div>
        </div>
      </div>

      {modelNames.length > 0 && (
        <div className="space-y-2">
          <p className="text-sm font-medium text-foreground">{t('localModel.modelsTitle')}</p>
          <div className="flex flex-wrap gap-2">
            {modelNames.map((name, index) => (
              <span
                key={name}
                className={cn(
                  'rounded-full px-3 py-1 text-xs font-medium',
                  index === 0
                    ? 'bg-blue-500/12 text-blue-700 dark:bg-blue-400/12 dark:text-blue-200'
                    : 'bg-muted text-muted-foreground',
                )}
              >
                {name}
                {index === 0 ? ` * ${t('localModel.defaultBadge')}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      <p className="text-sm text-muted-foreground">{t('localModel.autoConfiguredHelp')}</p>
    </div>
  );
}

const OPENAI_OAUTH_PREFERRED_MODEL_IDS = ['gpt-5.4-pro', 'gpt-5.4'] as const;

function normalizeOAuthSelectedModel(vendorId: string, modelId?: string | null): string {
  const normalized = modelId?.trim() || '';
  if (!normalized) {
    return '';
  }
  if (vendorId === 'openai' && (normalized === 'gpt-5.2' || normalized === 'gpt-5.3-codex')) {
    return OPENAI_OAUTH_PREFERRED_MODEL_IDS[1];
  }
  return normalized;
}

function pickOAuthModelSelection(
  vendorId: string,
  options: SetupProviderModelOption[],
  preferred?: string | null,
  fallback?: string | null,
): string {
  const normalizedPreferred = normalizeOAuthSelectedModel(vendorId, preferred);
  if (normalizedPreferred && options.some((option) => option.id === normalizedPreferred)) {
    return normalizedPreferred;
  }

  const normalizedFallback = normalizeOAuthSelectedModel(vendorId, fallback);
  if (normalizedFallback && options.some((option) => option.id === normalizedFallback)) {
    return normalizedFallback;
  }

  if (vendorId === 'openai') {
    for (const preferredId of OPENAI_OAUTH_PREFERRED_MODEL_IDS) {
      if (options.some((option) => option.id === preferredId)) {
        return preferredId;
      }
    }
  }

  return options[0]?.id || normalizedFallback || normalizedPreferred || '';
}

export function ProviderContent({
  providers,
  selectedProvider,
  onSelectProvider,
  apiKey,
  onApiKeyChange,
  onConfiguredChange,
}: ProviderContentProps) {
  const { t } = useTranslation(['setup', 'settings']);
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const [showKey, setShowKey] = useState(false);
  const [validating, setValidating] = useState(false);
  const [keyValid, setKeyValid] = useState<boolean | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [providerMenuOpen, setProviderMenuOpen] = useState(false);
  const providerMenuRef = useRef<HTMLDivElement | null>(null);

  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('oauth');

  // OAuth Flow State
  const [oauthFlowing, setOauthFlowing] = useState(false);
  const [oauthData, setOauthData] = useState<{
    verificationUri: string;
    userCode?: string;
    expiresIn: number;
    mode?: 'device' | 'browser';
    manualInputRequired?: boolean;
    promptMessage?: string;
    placeholder?: string;
  } | null>(null);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const [oauthManualInput, setOauthManualInput] = useState('');
  const pendingOAuthRef = useRef<{ accountId: string; label: string } | null>(null);
  const [oauthAuthedAccountId, setOauthAuthedAccountId] = useState<string | null>(null);
  const [oauthModelOptions, setOauthModelOptions] = useState<SetupProviderModelOption[]>([]);
  const [loadingOAuthModels, setLoadingOAuthModels] = useState(false);

  const loadOAuthModelOptions = useCallback(async (
    vendorId: string,
    authModeValue: 'oauth_browser' | 'oauth_device',
    accountId?: string,
  ) => {
    const response = await hostApiFetch<{ models: SetupProviderModelOption[] }>(
      `/api/provider-model-options?vendorId=${encodeURIComponent(vendorId)}&authMode=${encodeURIComponent(authModeValue)}${accountId ? `&accountId=${encodeURIComponent(accountId)}` : ''}`,
      { timeoutMs: PROVIDER_MODEL_OPTIONS_TIMEOUT_MS },
    );
    return response.models ?? [];
  }, []);

  // Manage OAuth events
  useEffect(() => {
    const handleCode = (data: unknown) => {
      setOauthData(data as {
        verificationUri: string;
        userCode?: string;
        expiresIn: number;
        mode?: 'device' | 'browser';
        manualInputRequired?: boolean;
        promptMessage?: string;
        placeholder?: string;
      });
      setOauthError(null);
    };

    const handleSuccess = async (data: unknown) => {
      setOauthFlowing(false);
      setOauthData(null);
      setKeyValid(true);

      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;

      if (accountId) {
        try {
          setSelectedAccountId(accountId);
          if (selectedProvider === 'openai') {
            await syncOAuthRuntimeAccount(accountId);
            setOauthAuthedAccountId(accountId);
            setLoadingOAuthModels(true);
            const models = await loadOAuthModelOptions('openai', 'oauth_browser', accountId);
            setOauthModelOptions(models);
            setModelId((current) => pickOAuthModelSelection('openai', models, current, modelId));
            setLoadingOAuthModels(false);
            pendingOAuthRef.current = null;
            onConfiguredChange(false);
            toast.success(t('settings:aiProviders.oauth.authSucceeded'));
            return;
          }

          await hostApiFetch('/api/provider-accounts/default', {
            method: 'PUT',
            body: JSON.stringify({ accountId }),
          });
        } catch (error) {
          console.error('Failed to set default provider account:', error);
          setLoadingOAuthModels(false);
        }
      }

      pendingOAuthRef.current = null;
      onConfiguredChange(true);
      toast.success(t('provider.valid'));
    };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      setOauthAuthedAccountId(null);
      setOauthModelOptions([]);
      setLoadingOAuthModels(false);
      pendingOAuthRef.current = null;
    };

    const offCode = subscribeHostEvent('oauth:code', handleCode);
    const offSuccess = subscribeHostEvent('oauth:success', handleSuccess);
    const offError = subscribeHostEvent('oauth:error', handleError);

    return () => {
      offCode();
      offSuccess();
      offError();
    };
  }, [loadOAuthModelOptions, modelId, onConfiguredChange, selectedProvider, t]);

  const handleStartOAuth = async () => {
    if (!selectedProvider) return;

    try {
      const snapshot = await fetchProviderSnapshot();
      const existingVendorIds = new Set(snapshot.accounts.map((account) => account.vendorId));
      if (selectedProvider === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return;
      }
      if (selectedProvider === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return;
      }
    } catch {
      // ignore check failure
    }

    setOauthFlowing(true);
    setOauthData(null);
    setOauthError(null);
    setOauthManualInput('');
    setOauthAuthedAccountId(null);
    setOauthModelOptions([]);
    setLoadingOAuthModels(false);

    try {
      const snapshot = await fetchProviderSnapshot();
      const accountId = buildProviderAccountId(
        selectedProvider as ProviderType,
        selectedAccountId,
        snapshot.vendors
      );
      const label = selectedProviderData?.name || selectedProvider;
      pendingOAuthRef.current = { accountId, label };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({
          provider: selectedProvider,
          accountId,
          label,
          model: selectedProvider === 'openai'
            ? undefined
            : resolveProviderModelForSave(selectedProviderData, modelId, devModeUnlocked),
        }),
      });
    } catch (e) {
      setOauthError(String(e));
      setOauthFlowing(false);
      pendingOAuthRef.current = null;
    }
  };

  const handleCancelOAuth = async () => {
    setOauthFlowing(false);
    setOauthData(null);
    setOauthError(null);
    setOauthManualInput('');
    setOauthAuthedAccountId(null);
    setOauthModelOptions([]);
    setLoadingOAuthModels(false);
    pendingOAuthRef.current = null;
    await hostApiFetch('/api/providers/oauth/cancel', { method: 'POST' });
  };

  const handleSubmitOAuthManualInput = async () => {
    const input = oauthManualInput.trim();
    if (!input) return;
    try {
      await hostApiFetch('/api/providers/oauth/respond', {
        method: 'POST',
        body: JSON.stringify({ input }),
      });
    } catch (error) {
      setOauthError(String(error));
    }
  };

  // On mount, try to restore previously configured provider
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const snapshot = await fetchProviderSnapshot();
        const statusMap = new Map(snapshot.statuses.map((status) => [status.id, status]));
        const setupProviderTypes = new Set<string>(providers.map((p) => p.id));
        const setupCandidates = snapshot.accounts.filter((account) =>
          setupProviderTypes.has(account.vendorId)
        );
        const preferred =
          (snapshot.defaultAccountId &&
            setupCandidates.find((account) => account.id === snapshot.defaultAccountId)) ||
          setupCandidates.find((account) =>
            hasConfiguredCredentials(account, statusMap.get(account.id))
          ) ||
          setupCandidates[0];
        if (preferred && !cancelled) {
          onSelectProvider(preferred.vendorId);
          setSelectedAccountId(preferred.id);
          const typeInfo = providers.find((p) => p.id === preferred.vendorId);
          const requiresKey = typeInfo?.requiresApiKey ?? false;
          onConfiguredChange(
            !requiresKey || hasConfiguredCredentials(preferred, statusMap.get(preferred.id))
          );
          const storedKey = (
            await hostApiFetch<{ apiKey: string | null }>(
              `/api/providers/${encodeURIComponent(preferred.id)}/api-key`
            )
          ).apiKey;
          onApiKeyChange(storedKey || '');
        } else if (!cancelled) {
          onConfiguredChange(false);
          onApiKeyChange('');
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider list:', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onApiKeyChange, onConfiguredChange, onSelectProvider, providers]);

  // When provider changes, load stored key + reset base URL
  useEffect(() => {
    let cancelled = false;
    (async () => {
      if (!selectedProvider) return;
      try {
        const snapshot = await fetchProviderSnapshot();
        const statusMap = new Map(snapshot.statuses.map((status) => [status.id, status]));
        const preferredAccount = pickPreferredAccount(
          snapshot.accounts,
          snapshot.defaultAccountId,
          selectedProvider,
          statusMap
        );
        const accountIdForLoad = preferredAccount?.id || selectedProvider;
        setSelectedAccountId(preferredAccount?.id || null);

        const savedProvider = await hostApiFetch<{ baseUrl?: string; model?: string } | null>(
          `/api/providers/${encodeURIComponent(accountIdForLoad)}`
        );
        const storedKey = (
          await hostApiFetch<{ apiKey: string | null }>(
            `/api/providers/${encodeURIComponent(accountIdForLoad)}/api-key`
          )
        ).apiKey;
        if (!cancelled) {
          onApiKeyChange(storedKey || '');

          const info = providers.find((p) => p.id === selectedProvider);
          setBaseUrl(savedProvider?.baseUrl || info?.defaultBaseUrl || '');
          setModelId(
            normalizeOAuthSelectedModel(
              selectedProvider,
              savedProvider?.model || info?.defaultModelId || '',
            ),
          );
        }
      } catch (error) {
        if (!cancelled) {
          console.error('Failed to load provider key:', error);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [onApiKeyChange, selectedProvider, providers]);

  useEffect(() => {
    if (!providerMenuOpen) return;

    const handlePointerDown = (event: MouseEvent) => {
      if (providerMenuRef.current && !providerMenuRef.current.contains(event.target as Node)) {
        setProviderMenuOpen(false);
      }
    };

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setProviderMenuOpen(false);
      }
    };

    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, [providerMenuOpen]);

  useEffect(() => {
    setOauthAuthedAccountId(null);
    setOauthModelOptions([]);
    setLoadingOAuthModels(false);
  }, [selectedProvider, authMode]);

  const selectedProviderData = SETUP_PROVIDERS.find((p) => p.id === selectedProvider);
  const selectedProviderIconUrl = selectedProviderData
    ? getProviderIconUrl(selectedProviderData.id)
    : undefined;
  const showBaseUrlField = selectedProviderData?.showBaseUrl ?? false;
  const showModelIdField = shouldShowProviderModelId(selectedProviderData, devModeUnlocked);
  const requiresKey = selectedProviderData?.requiresApiKey ?? false;
  const isOAuth = selectedProviderData?.isOAuth ?? false;
  const supportsApiKey = selectedProviderData?.supportsApiKey ?? false;
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');
  const useOpenAIOAuthModelPicker = selectedProvider === 'openai' && useOAuthFlow;
  const showEditableModelField = showModelIdField && !useOpenAIOAuthModelPicker;

  const handleValidateAndSave = async () => {
    if (!selectedProvider) return;

    try {
      const snapshot = await fetchProviderSnapshot();
      const existingVendorIds = new Set(snapshot.accounts.map((account) => account.vendorId));
      if (selectedProvider === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return;
      }
      if (selectedProvider === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
        toast.error(t('settings:aiProviders.toast.minimaxConflict'));
        return;
      }
    } catch {
      // ignore check failure
    }

    setValidating(true);
    setKeyValid(null);

    try {
      if (useOpenAIOAuthModelPicker && oauthAuthedAccountId) {
        const saveResult = await hostApiFetch<{ success: boolean; error?: string }>(
          `/api/provider-accounts/${encodeURIComponent(oauthAuthedAccountId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              updates: {
                label: selectedProviderData?.name || selectedProvider,
                model: modelId.trim(),
              },
            }),
          }
        );

        if (!saveResult.success) {
          throw new Error(saveResult.error || 'Failed to save provider config');
        }

        const defaultResult = await hostApiFetch<{ success: boolean; error?: string }>(
          '/api/provider-accounts/default',
          {
            method: 'PUT',
            body: JSON.stringify({ accountId: oauthAuthedAccountId }),
          }
        );

        if (!defaultResult.success) {
          throw new Error(defaultResult.error || 'Failed to set default provider');
        }

        setSelectedAccountId(oauthAuthedAccountId);
        onConfiguredChange(true);
        toast.success(t('provider.valid'));
        return;
      }

      // Validate key if the provider requires one and a key was entered
      const isApiKeyRequired = requiresKey || (supportsApiKey && authMode === 'apikey');
      if (isApiKeyRequired && apiKey) {
        const result = (await invokeIpc(
          'provider:validateKey',
          selectedAccountId || selectedProvider,
          apiKey,
          {
            baseUrl: baseUrl.trim() || undefined,
            apiProtocol: isSelfHostedProviderType(selectedProvider) ? 'openai-completions' : undefined,
          }
        )) as { valid: boolean; error?: string };

        setKeyValid(result.valid);

        if (!result.valid) {
          toast.error(result.error || t('provider.invalid'));
          setValidating(false);
          return;
        }
      } else {
        setKeyValid(true);
      }

      const effectiveModelId = resolveProviderModelForSave(
        selectedProviderData,
        modelId,
        devModeUnlocked
      );
      const snapshot = await fetchProviderSnapshot();
      const accountIdForSave = buildProviderAccountId(
        selectedProvider as ProviderType,
        selectedAccountId,
        snapshot.vendors
      );

      const effectiveApiKey = resolveProviderApiKeyForSave(selectedProvider, apiKey);
      const accountPayload: ProviderAccount = {
        id: accountIdForSave,
        vendorId: selectedProvider as ProviderType,
        label:
          selectedProvider === 'custom'
            ? t('settings:aiProviders.custom')
            : selectedProviderData?.name || selectedProvider,
        authMode: selectedProvider === 'ollama' ? 'local' : 'api_key',
        baseUrl: baseUrl.trim() || undefined,
        apiProtocol: isSelfHostedProviderType(selectedProvider) ? 'openai-completions' : undefined,
        model: effectiveModelId,
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };

      const saveResult = selectedAccountId
        ? await hostApiFetch<{ success: boolean; error?: string }>(
            `/api/provider-accounts/${encodeURIComponent(accountIdForSave)}`,
            {
              method: 'PUT',
              body: JSON.stringify({
                updates: {
                  label: accountPayload.label,
                  authMode: accountPayload.authMode,
                  baseUrl: accountPayload.baseUrl,
                  model: accountPayload.model,
                  enabled: accountPayload.enabled,
                },
                apiKey: effectiveApiKey,
              }),
            }
          )
        : await hostApiFetch<{ success: boolean; error?: string }>('/api/provider-accounts', {
            method: 'POST',
            body: JSON.stringify({ account: accountPayload, apiKey: effectiveApiKey }),
          });

      if (!saveResult.success) {
        throw new Error(saveResult.error || 'Failed to save provider config');
      }

      const defaultResult = await hostApiFetch<{ success: boolean; error?: string }>(
        '/api/provider-accounts/default',
        {
          method: 'PUT',
          body: JSON.stringify({ accountId: accountIdForSave }),
        }
      );

      if (!defaultResult.success) {
        throw new Error(defaultResult.error || 'Failed to set default provider');
      }

      setSelectedAccountId(accountIdForSave);
      onConfiguredChange(true);
      toast.success(t('provider.valid'));
    } catch (error) {
      setKeyValid(false);
      onConfiguredChange(false);
      toast.error('Configuration failed: ' + String(error));
    } finally {
      setValidating(false);
    }
  };

  // Can the user submit?
  const isApiKeyRequired = requiresKey || (supportsApiKey && authMode === 'apikey');
  const canSubmit =
    selectedProvider &&
    (isApiKeyRequired ? apiKey.length > 0 : true) &&
    ((showEditableModelField || useOpenAIOAuthModelPicker) ? modelId.trim().length > 0 : true) &&
    (!useOAuthFlow || Boolean(oauthAuthedAccountId));

  const handleSelectProvider = (providerId: string) => {
    onSelectProvider(providerId);
    setSelectedAccountId(null);
    onConfiguredChange(false);
    onApiKeyChange('');
    setKeyValid(null);
    setProviderMenuOpen(false);
    setAuthMode('oauth');
  };

  return (
    <div className="space-y-6">
      {/* Provider selector dropdown */}
      <div className="space-y-2">
        <Label>{t('provider.label')}</Label>
        <div className="relative" ref={providerMenuRef}>
          <button
            type="button"
            aria-haspopup="listbox"
            aria-expanded={providerMenuOpen}
            onClick={() => setProviderMenuOpen((open) => !open)}
            className={cn(
              'w-full rounded-md border border-input bg-background px-3 py-2 text-sm',
              'flex items-center justify-between gap-2',
              'focus:outline-none focus:ring-2 focus:ring-ring'
            )}
          >
            <div className="flex items-center gap-2 min-w-0">
              {selectedProvider && selectedProviderData ? (
                selectedProviderIconUrl ? (
                  <img
                    src={selectedProviderIconUrl}
                    alt={selectedProviderData.name}
                    className="h-4 w-4 shrink-0"
                  />
                ) : (
                  <span className="text-sm leading-none shrink-0">{selectedProviderData.icon}</span>
                )
              ) : (
                <span className="text-xs text-muted-foreground shrink-0">-</span>
              )}
              <span
                className={cn('truncate text-left', !selectedProvider && 'text-muted-foreground')}
              >
                {selectedProviderData
                  ? `${selectedProviderData.id === 'custom' ? t('settings:aiProviders.custom') : selectedProviderData.name}${selectedProviderData.model ? ` - ${selectedProviderData.model}` : ''}`
                  : t('provider.selectPlaceholder')}
              </span>
            </div>
            <ChevronDown
              className={cn(
                'h-3.5 w-3.5 text-muted-foreground shrink-0 transition-transform',
                providerMenuOpen && 'rotate-180'
              )}
            />
          </button>

          {providerMenuOpen && (
            <div
              role="listbox"
              className="absolute z-20 mt-1 w-full rounded-md border border-border bg-popover shadow-md max-h-64 overflow-auto"
            >
              {providers.map((p) => {
                const iconUrl = getProviderIconUrl(p.id);
                const isSelected = selectedProvider === p.id;

                return (
                  <button
                    key={p.id}
                    type="button"
                    role="option"
                    aria-selected={isSelected}
                    onClick={() => handleSelectProvider(p.id)}
                    className={cn(
                      'w-full px-3 py-2 text-left text-sm flex items-center justify-between gap-2',
                      'hover:bg-accent transition-colors',
                      isSelected && 'bg-accent/60'
                    )}
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      {iconUrl ? (
                        <img
                          src={iconUrl}
                          alt={p.name}
                          className="h-4 w-4 shrink-0"
                        />
                      ) : (
                        <span className="text-sm leading-none shrink-0">{p.icon}</span>
                      )}
                      <span className="truncate">
                        {p.id === 'custom' ? t('settings:aiProviders.custom') : p.name}
                        {p.model ? ` - ${p.model}` : ''}
                      </span>
                    </div>
                    {isSelected && <Check className="h-4 w-4 text-primary shrink-0" />}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Dynamic config fields based on selected provider */}
      {selectedProvider && (
        <motion.div
          key={selectedProvider}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          className="space-y-4"
        >
          {/* Base URL field (for siliconflow, ollama, custom) */}
          {showBaseUrlField && (
            <div className="space-y-2">
              <Label htmlFor="baseUrl">{t('provider.baseUrl')}</Label>
              <Input
                id="baseUrl"
                type="text"
                placeholder="https://api.example.com/v1"
                value={baseUrl}
                onChange={(e) => {
                  setBaseUrl(e.target.value);
                  onConfiguredChange(false);
                }}
                autoComplete="off"
                className="bg-background border-input"
              />
            </div>
          )}

          {/* Model ID field (for siliconflow etc.) */}
          {showEditableModelField && (
            <div className="space-y-2">
              <Label htmlFor="modelId">{t('provider.modelId')}</Label>
              <Input
                id="modelId"
                type="text"
                placeholder={
                  selectedProviderData?.modelIdPlaceholder || 'e.g. deepseek-ai/DeepSeek-V3'
                }
                value={modelId}
                onChange={(e) => {
                  setModelId(normalizeOAuthSelectedModel(selectedProvider, e.target.value));
                  onConfiguredChange(false);
                }}
                autoComplete="off"
                className="bg-background border-input"
              />
              <p className="text-xs text-muted-foreground">{t('provider.modelIdDesc')}</p>
            </div>
          )}
          {useOpenAIOAuthModelPicker && oauthAuthedAccountId && (
            <div className="space-y-2">
              <Label htmlFor="oauthModelId">{t('settings:aiProviders.dialog.model')}</Label>
              <Select
                id="oauthModelId"
                value={modelId}
                onChange={(e) => {
                  setModelId(normalizeOAuthSelectedModel(selectedProvider, e.target.value));
                  onConfiguredChange(false);
                }}
                className="w-full bg-background text-sm"
                disabled={loadingOAuthModels}
              >
                {oauthModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </Select>
              <p className="text-xs text-muted-foreground">{t('settings:aiProviders.oauth.modelAfterLogin')}</p>
            </div>
          )}

          {/* Auth mode toggle for providers supporting both */}
          {isOAuth && supportsApiKey && (
            <div className="flex rounded-lg border overflow-hidden text-sm">
              <button
                onClick={() => setAuthMode('oauth')}
                className={cn(
                  'flex-1 py-2 px-3 transition-colors',
                  authMode === 'oauth'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                )}
              >
                {t('settings:aiProviders.oauth.loginMode')}
              </button>
              <button
                onClick={() => setAuthMode('apikey')}
                className={cn(
                  'flex-1 py-2 px-3 transition-colors',
                  authMode === 'apikey'
                    ? 'bg-primary text-primary-foreground'
                    : 'hover:bg-muted text-muted-foreground'
                )}
              >
                {t('settings:aiProviders.oauth.apikeyMode')}
              </button>
            </div>
          )}

          {/* API Key field (hidden for ollama) */}
          {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
            <div className="space-y-2">
              <Label htmlFor="apiKey">{t('provider.apiKey')}</Label>
              <div className="relative">
                <Input
                  id="apiKey"
                  type={showKey ? 'text' : 'password'}
                  placeholder={selectedProviderData?.placeholder}
                  value={apiKey}
                  onChange={(e) => {
                    onApiKeyChange(e.target.value);
                    onConfiguredChange(false);
                    setKeyValid(null);
                  }}
                  autoComplete="off"
                  className="pr-10 bg-background border-input"
                />
                <button
                  type="button"
                  onClick={() => setShowKey(!showKey)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                </button>
              </div>
            </div>
          )}

          {/* Device OAuth Trigger */}
          {useOAuthFlow && (
            <div className="space-y-4 pt-2">
              <div className="rounded-lg bg-blue-500/10 border border-blue-500/20 p-4 text-center">
                <p className="text-sm text-blue-200 mb-3 block">
                  {oauthAuthedAccountId
                    ? t('settings:aiProviders.oauth.loginCompleted')
                    : t('settings:aiProviders.oauth.loginPrompt')}
                </p>
                <Button
                  onClick={handleStartOAuth}
                  disabled={oauthFlowing || Boolean(oauthAuthedAccountId)}
                  className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                >
                  {oauthFlowing ? (
                    <>
                      <LoadingIcon className="h-4 w-4 mr-2" /> {t('settings:aiProviders.oauth.waiting')}
                    </>
                  ) : oauthAuthedAccountId ? (
                    t('settings:aiProviders.oauth.loggedIn')
                  ) : (
                    t('settings:aiProviders.oauth.loginButton')
                  )}
                </Button>
              </div>

              {/* OAuth Active State Modal / Inline View */}
              {oauthFlowing && (
                <div className="mt-4 p-4 border rounded-xl bg-card relative overflow-hidden">
                  {/* Background pulse effect */}
                  <div className="absolute inset-0 bg-primary/5 animate-pulse" />

                  <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-4">
                    {oauthError ? (
                      <div className="text-red-400 space-y-2">
                        <XCircle className="h-8 w-8 mx-auto" />
                        <p className="font-medium">{t('settings:aiProviders.oauth.authFailed')}</p>
                        <p className="text-sm opacity-80">{oauthError}</p>
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={handleCancelOAuth}
                          className="mt-2"
                        >
                          {t('settings:aiProviders.oauth.tryAgain')}
                        </Button>
                      </div>
                    ) : !oauthData ? (
                      <div className="space-y-3 py-4">
                        <LoadingIcon className="h-8 w-8 text-primary mx-auto" />
                        <p className="text-sm text-muted-foreground animate-pulse">
                          {t('settings:aiProviders.oauth.requestingCode')}
                        </p>
                      </div>
                    ) : oauthData.mode === 'browser' ? (
                      <div className="space-y-4 w-full">
                        <div className="space-y-1">
                          <h3 className="font-medium text-lg">{t('settings:aiProviders.oauth.browserApproveTitle')}</h3>
                          <div className="text-sm text-muted-foreground text-left mt-2 space-y-1">
                            <p>{t('settings:aiProviders.oauth.browserApproveDesc')}</p>
                            <p>{t('settings:aiProviders.oauth.browserApproveHint')}</p>
                          </div>
                        </div>

                        {oauthData.verificationUri ? (
                          <Button
                            variant="secondary"
                            className="w-full"
                            onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                          >
                            <ExternalLink className="h-4 w-4 mr-2" />
                            {t('settings:aiProviders.oauth.openLoginPage')}
                          </Button>
                        ) : null}

                        {oauthData.manualInputRequired ? (
                          <div className="space-y-2 text-left">
                            <p className="text-sm font-medium">
                              {oauthData.promptMessage || t('settings:aiProviders.oauth.manualPrompt')}
                            </p>
                            <Input
                              value={oauthManualInput}
                              onChange={(event) => setOauthManualInput(event.target.value)}
                              placeholder={oauthData.placeholder || t('settings:aiProviders.oauth.manualPlaceholder')}
                            />
                            <Button
                              className="w-full bg-blue-600 hover:bg-blue-700 text-white"
                              onClick={handleSubmitOAuthManualInput}
                              disabled={!oauthManualInput.trim()}
                            >
                              {t('settings:aiProviders.oauth.manualSubmit')}
                            </Button>
                          </div>
                        ) : null}

                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                          <LoadingIcon className="h-3 w-3" />
                          <span>{t('settings:aiProviders.oauth.waitingApproval')}</span>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full mt-2"
                          onClick={handleCancelOAuth}
                        >
                          {t('settings:aiProviders.oauth.cancel')}
                        </Button>
                      </div>
                    ) : (
                      <div className="space-y-4 w-full">
                        <div className="space-y-1">
                          <h3 className="font-medium text-lg">{t('settings:aiProviders.oauth.approveLogin')}</h3>
                          <div className="text-sm text-muted-foreground text-left mt-2 space-y-1">
                            <p>1. {t('settings:aiProviders.oauth.step1')}</p>
                            <p>2. {t('settings:aiProviders.oauth.step2')}</p>
                            <p>3. {t('settings:aiProviders.oauth.step3')}</p>
                          </div>
                        </div>

                        <div className="flex items-center justify-center gap-2 p-3 bg-background border rounded-lg">
                          <code className="text-2xl font-mono tracking-widest font-bold text-primary">
                            {oauthData.userCode}
                          </code>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => {
                              navigator.clipboard.writeText(oauthData.userCode || '');
                              toast.success(t('settings:aiProviders.oauth.codeCopied'));
                            }}
                          >
                            <Copy className="h-4 w-4" />
                          </Button>
                        </div>

                        <Button
                          variant="secondary"
                          className="w-full"
                          onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                        >
                          <ExternalLink className="h-4 w-4 mr-2" />
                          {t('settings:aiProviders.oauth.openLoginPage')}
                        </Button>

                        <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground pt-2">
                          <LoadingIcon className="h-3 w-3" />
                          <span>{t('settings:aiProviders.oauth.waitingApproval')}</span>
                        </div>

                        <Button
                          variant="ghost"
                          size="sm"
                          className="w-full mt-2"
                          onClick={handleCancelOAuth}
                        >
                          {t('settings:aiProviders.oauth.cancel')}
                        </Button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Validate & Save */}
          <Button
            onClick={handleValidateAndSave}
            disabled={!canSubmit || validating}
            className="w-full"
          >
            {validating ? <LoadingIcon className="h-4 w-4 mr-2" /> : null}
            {useOpenAIOAuthModelPicker ? t('provider.save') : (requiresKey ? t('provider.validateSave') : t('provider.save'))}
          </Button>

          {keyValid !== null && (
            <p className={cn('text-sm text-center', keyValid ? 'text-green-400' : 'text-red-400')}>
              {keyValid ? `[OK] ${t('provider.valid')}` : `[X] ${t('provider.invalid')}`}
            </p>
          )}

          <p className="text-sm text-muted-foreground text-center">{t('provider.storedLocally')}</p>
        </motion.div>
      )}
    </div>
  );
}

// NOTE: SkillsContent component removed - auto-install essential skills

// Installation status for each skill
type InstallStatus = 'pending' | 'installing' | 'completed' | 'failed';

interface SkillInstallState {
  id: string;
  name: string;
  description: string;
  status: InstallStatus;
}

interface InstallingContentProps {
  dependencies: SetupDependency[];
  onComplete: (installedSkills: string[]) => void;
}

function InstallingContent({ dependencies, onComplete }: InstallingContentProps) {
  const { t } = useTranslation('setup');
  const [skillStates, setSkillStates] = useState<SkillInstallState[]>(
    dependencies.map((dependency) => ({ ...dependency, status: 'pending' as InstallStatus }))
  );
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const installStarted = useRef(false);

  // Real installation process
  useEffect(() => {
    if (installStarted.current) return;
    installStarted.current = true;

    const runRealInstall = async () => {
      try {
        // Step 1: Initialize all skills to 'installing' state for UI
        setSkillStates((prev) => prev.map((s) => ({ ...s, status: 'installing' })));

        // Step 2: Call the backend to install uv and setup Python
        const result = (await invokeIpc('uv:install-all')) as {
          success: boolean;
          error?: string;
          uvInstalled?: boolean;
          pythonReady?: boolean;
        };

        if (result.success) {
          setSkillStates((prev) => prev.map((s) => ({ ...s, status: 'completed' })));

          await new Promise((resolve) => setTimeout(resolve, 800));
          onComplete(dependencies.map((dependency) => dependency.id));
        } else {
          setSkillStates((prev) => prev.map((s) => {
            if (s.id === 'uv') {
              return { ...s, status: result.uvInstalled ? 'completed' : 'failed' };
            }
            if (s.id === 'managed-python') {
              return { ...s, status: result.pythonReady ? 'completed' : 'failed' };
            }
            return { ...s, status: 'failed' };
          }));
          setErrorMessage(result.error || 'Unknown error during installation');
          toast.error('Environment setup failed');
        }
      } catch (err) {
        setSkillStates((prev) => prev.map((s) => ({ ...s, status: 'failed' })));
        setErrorMessage(String(err));
        toast.error('Installation error');
      }
    };

    runRealInstall();
  }, [dependencies, onComplete]);

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-3 rounded-2xl border border-border/70 bg-muted/30 px-4 py-3">
        <LoadingIcon className="h-5 w-5 text-primary" />
        <p className="text-sm text-muted-foreground">{t('installing.subtitle')}</p>
      </div>

      <div className="space-y-3">
        {skillStates.map((skill) => (
          <div key={skill.id} className="flex items-start justify-between gap-4 rounded-xl border border-border/70 bg-card/70 px-4 py-3">
            <div>
              <p className="font-medium text-foreground">{skill.name}</p>
              <p className="mt-1 text-sm text-muted-foreground">{skill.description}</p>
            </div>
            <div className="shrink-0 pt-0.5 text-sm">
              {skill.status === 'completed' ? (
                <span className="inline-flex items-center gap-2 text-green-600 dark:text-green-400">
                  <CheckCircle2 className="h-4 w-4" />
                  {t('installing.status.installed')}
                </span>
              ) : skill.status === 'failed' ? (
                <span className="inline-flex items-center gap-2 text-red-600 dark:text-red-400">
                  <XCircle className="h-4 w-4" />
                  {t('installing.status.failed')}
                </span>
              ) : skill.status === 'installing' ? (
                <span className="inline-flex items-center gap-2 text-blue-600 dark:text-blue-400">
                  <LoadingIcon className="h-4 w-4" />
                  {t('installing.status.installing')}
                </span>
              ) : (
                <span className="text-muted-foreground">{t('installing.status.pending')}</span>
              )}
            </div>
          </div>
        ))}
      </div>

      {errorMessage ? (
        <motion.div
          initial={{ opacity: 0, scale: 0.95 }}
          animate={{ opacity: 1, scale: 1 }}
          className="rounded-xl border border-red-500/40 bg-red-900/10 p-4 text-left text-sm text-red-200"
        >
          <div className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 h-5 w-5 shrink-0 text-red-400" />
            <div className="space-y-1">
              <p className="font-semibold">{t('installing.error')}</p>
              <pre className="overflow-x-auto whitespace-pre-wrap rounded bg-black/20 p-2 text-xs font-monospace">
                {errorMessage}
              </pre>
              <Button
                variant="link"
                className="h-auto p-0 text-xs text-red-400 underline"
                onClick={() => window.location.reload()}
              >
                {t('installing.restart')}
              </Button>
            </div>
          </div>
        </motion.div>
      ) : null}
    </div>
  );
}

function ModelSetupContent({
  hasConfiguredModels,
  onRefreshConfigured,
  onSkip,
}: {
  hasConfiguredModels: boolean;
  onRefreshConfigured: () => Promise<boolean>;
  onSkip: () => void;
}) {
  const { t } = useTranslation('setup');
  const {
    accounts,
    refreshProviderSnapshot,
    createAccount,
    updateAccount,
    setDefaultAccount,
    getAccountApiKey,
  } = useProviderStore();
  const [refreshing, setRefreshing] = useState(false);
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [modelName, setModelName] = useState('');
  const [modelId, setModelId] = useState('');
  const [modelOptions, setModelOptions] = useState<SetupProviderModelOption[]>([]);
  const [providerReady, setProviderReady] = useState(false);
  const [manualMode, setManualMode] = useState(false);
  const [savingProvider, setSavingProvider] = useState(false);
  const [savingModel, setSavingModel] = useState(false);
  const [loadingModels, setLoadingModels] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);
  const [editingProvider, setEditingProvider] = useState(true);

  const localProviderAccount = useMemo(
    () => accounts.find((account) => isLocalModelProviderAccount(account)) ?? null,
    [accounts],
  );
  const localModelAccounts = useMemo(
    () => accounts.filter((account) => account.vendorId === 'local-model' && !account.metadata?.localModelProvider),
    [accounts],
  );

  useEffect(() => {
    if (!localProviderAccount) {
      setProviderReady(false);
      setModelOptions([]);
      setEditingProvider(true);
      return;
    }

    setProviderReady(true);
    setEditingProvider(false);
    setBaseUrl((current) => current || localProviderAccount.baseUrl || '');
    setApiProtocol((current) => current || localProviderAccount.apiProtocol || 'openai-completions');
  }, [localProviderAccount]);

  useEffect(() => {
    let cancelled = false;

    const loadStoredApiKey = async () => {
      if (!localProviderAccount) {
        setApiKey('');
        return;
      }
      const storedApiKey = await getAccountApiKey(localProviderAccount.id);
      if (!cancelled) {
        setApiKey(storedApiKey || '');
      }
    };

    void loadStoredApiKey();
    return () => {
      cancelled = true;
    };
  }, [getAccountApiKey, localProviderAccount]);

  const handleResolveModels = useCallback(async (accountId: string, nextApiKey: string, nextBaseUrl: string, nextProtocol: ProviderAccount['apiProtocol']) => {
    setLoadingModels(true);
    setFormError(null);
    try {
      const response = await resolveLocalProviderModels({
        accountId,
        apiKey: nextApiKey,
        baseUrl: nextBaseUrl,
        apiProtocol: nextProtocol,
      });
      const options = (Array.isArray(response.models) ? response.models : []).filter(isPrimarySetupModelOption);
      setModelOptions(options);
      if (options.length > 0) {
        setManualMode(false);
        setModelId((current) => current || options[0].id);
        setModelName((current) => current || options[0].name || options[0].id);
      } else {
        setManualMode(true);
        setFormError(response.error || t('modelSetup.manualDescription'));
      }
      return options;
    } finally {
      setLoadingModels(false);
    }
  }, [t]);

  const handleRefresh = async () => {
    try {
      setRefreshing(true);
      await onRefreshConfigured();
    } finally {
      setRefreshing(false);
    }
  };

  const handleSaveProvider = async () => {
    const trimmedApiKey = apiKey.trim();
    const trimmedBaseUrl = baseUrl.trim();
    if (!trimmedApiKey || !trimmedBaseUrl) {
      setFormError(t('modelSetup.providerRequired'));
      return;
    }

    setSavingProvider(true);
    setFormError(null);

    const now = new Date().toISOString();
    const accountId = localProviderAccount?.id ?? `local-model-provider-${crypto.randomUUID()}`;

    try {
      if (localProviderAccount) {
        await updateAccount(accountId, {
          label: '本地模型',
          authMode: 'api_key',
          baseUrl: trimmedBaseUrl,
          apiProtocol,
          enabled: true,
          metadata: {
            localModelProvider: true,
          },
          updatedAt: now,
        }, trimmedApiKey);

        for (const modelAccount of localModelAccounts) {
          await updateAccount(modelAccount.id, {
            baseUrl: trimmedBaseUrl,
            apiProtocol,
            updatedAt: now,
          }, trimmedApiKey);
        }
      } else {
        await createAccount({
          id: accountId,
          vendorId: 'local-model',
          label: '本地模型',
          authMode: 'api_key',
          baseUrl: trimmedBaseUrl,
          apiProtocol,
          enabled: true,
          isDefault: false,
          metadata: {
            localModelProvider: true,
          },
          createdAt: now,
          updatedAt: now,
        }, trimmedApiKey);
      }

      await refreshProviderSnapshot();
      setProviderReady(true);
      setEditingProvider(false);
      await handleResolveModels(accountId, trimmedApiKey, trimmedBaseUrl, apiProtocol);
    } catch (error) {
      setFormError(String(error));
    } finally {
      setSavingProvider(false);
    }
  };

  const handleAddModel = async () => {
    const trimmedModelId = modelId.trim();
    const trimmedModelName = modelName.trim();
    if (!providerReady || !localProviderAccount) {
      setFormError(t('modelSetup.providerRequired'));
      return;
    }
    if (!trimmedModelId || !trimmedModelName) {
      setFormError(t('modelSetup.modelRequired'));
      return;
    }

    setSavingModel(true);
    setFormError(null);
    try {
      const existing = localModelAccounts.find((account) => account.model?.trim() === trimmedModelId);
      if (existing) {
        await setDefaultAccount(existing.id);
      } else {
        const now = new Date().toISOString();
        const modelAccountId = `local-model-${crypto.randomUUID()}`;
        await createAccount({
          id: modelAccountId,
          vendorId: 'local-model',
          label: trimmedModelName,
          authMode: 'api_key',
          baseUrl: localProviderAccount.baseUrl,
          apiProtocol: localProviderAccount.apiProtocol || 'openai-completions',
          model: trimmedModelId,
          enabled: true,
          isDefault: false,
          metadata: {
            localModel: true,
          },
          createdAt: now,
          updatedAt: now,
        }, apiKey.trim() || undefined);
        await setDefaultAccount(modelAccountId);
      }

      await onRefreshConfigured();
    } catch (error) {
      setFormError(String(error));
    } finally {
      setSavingModel(false);
    }
  };

  if (hasConfiguredModels) {
    return (
      <div className="space-y-3">
        <div className="rounded-2xl border border-border/70 bg-muted/35 p-4">
          <div className="flex items-start gap-3">
            <div className="mt-0.5 flex h-10 w-10 items-center justify-center rounded-full bg-green-500/15 text-green-600 dark:text-green-400">
              <CheckCircle2 className="h-5 w-5" />
            </div>
            <div className="space-y-1">
              <p className="font-medium text-foreground">{t('modelSetup.configuredTitle')}</p>
              <p className="text-sm text-muted-foreground">{t('modelSetup.configuredDescription')}</p>
            </div>
          </div>
        </div>

        <div className="flex items-center justify-center">
          <RefreshButton
            label={t('modelSetup.refresh')}
            loading={refreshing}
            variant="ghost"
            className="h-11 rounded-xl px-6"
            onClick={() => void handleRefresh()}
          />
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="rounded-2xl border border-border/70 bg-muted/35 px-4 py-2.5">
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 items-center justify-center rounded-full bg-blue-500/12 text-blue-600 dark:text-blue-400">
            <AlertCircle className="h-5 w-5" />
          </div>
          <p className="text-sm text-muted-foreground">{t('modelSetup.description')}</p>
        </div>
      </div>

      <div className="rounded-2xl border border-border/70 bg-card/70 p-4">
        <div className="mb-3 flex items-center gap-2 text-sm">
          <div className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium',
            !providerReady || editingProvider
              ? 'bg-primary text-primary-foreground'
              : 'bg-green-500/12 text-green-700 dark:bg-green-400/12 dark:text-green-200'
          )}>
            <span className="text-xs">1</span>
            <span>{t('modelSetup.stepProvider')}</span>
          </div>
          <div className="h-px flex-1 bg-border/70" />
          <div className={cn(
            'inline-flex items-center gap-2 rounded-full px-3 py-1 font-medium',
            providerReady && !editingProvider
              ? 'bg-primary text-primary-foreground'
              : 'bg-muted/50 text-muted-foreground'
          )}>
            <span className="text-xs">2</span>
            <span>{t('modelSetup.stepModel')}</span>
          </div>
        </div>

        {!providerReady || editingProvider ? (
          <>
            <div className="grid gap-3 md:grid-cols-2">
              <div className="min-w-0 space-y-2">
                <Label htmlFor="setup-local-api-key">{t('modelSetup.apiKey')}</Label>
                <Input
                  id="setup-local-api-key"
                  type="password"
                  value={apiKey}
                  onChange={(event) => setApiKey(event.target.value)}
                  placeholder={t('modelSetup.apiKeyPlaceholder')}
                  className="h-11 rounded-xl"
                />
              </div>
              <div className="min-w-0 space-y-2">
                <Label htmlFor="setup-local-base-url">{t('modelSetup.baseUrl')}</Label>
                <Input
                  id="setup-local-base-url"
                  value={baseUrl}
                  onChange={(event) => setBaseUrl(event.target.value)}
                  placeholder={t('modelSetup.baseUrlPlaceholder')}
                  className="h-11 rounded-xl"
                />
              </div>
            </div>

            <div className="mt-3 flex flex-col gap-3 lg:flex-row lg:items-center lg:justify-between">
              <div>
                <div className="inline-flex rounded-xl border border-border bg-muted/35 p-1">
                  {([
                    ['openai-completions', t('modelSetup.protocolOpenAI')],
                    ['anthropic-messages', t('modelSetup.protocolAnthropic')],
                  ] as const).map(([value, label]) => (
                    <button
                      key={value}
                      type="button"
                      className={cn(
                        'h-9 min-w-[132px] rounded-lg px-4 text-sm font-medium transition-colors',
                        apiProtocol === value
                          ? 'bg-primary text-primary-foreground shadow-sm'
                          : 'text-foreground hover:bg-background'
                      )}
                      onClick={() => setApiProtocol(value)}
                    >
                      {label}
                    </button>
                  ))}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                <Button onClick={() => void handleSaveProvider()} disabled={savingProvider || loadingModels} className="h-10 rounded-xl px-5">
                  {(savingProvider || loadingModels) ? <LoadingIcon className="mr-2 h-4 w-4" /> : null}
                  {t('modelSetup.connectProvider')}
                </Button>
                <Button variant="outline" onClick={onSkip} className="h-10 rounded-xl px-5">
                  {t('modelSetup.skip')}
                </Button>
              </div>
            </div>
          </>
        ) : (
          <div className="rounded-xl border border-border/70 bg-muted/30 px-4 py-2.5">
            <div className="flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <span className="font-medium text-foreground">{t('modelSetup.providerConnected')}</span>
              <span className="truncate max-w-[360px]">{baseUrl}</span>
              <span>·</span>
              <span>{apiProtocol === 'anthropic-messages' ? t('modelSetup.protocolAnthropic') : t('modelSetup.protocolOpenAI')}</span>
              <Button
                variant="ghost"
                size="sm"
                className="ml-auto h-7 rounded-lg px-2.5 text-xs"
                onClick={() => setEditingProvider(true)}
              >
                {t('modelSetup.editProvider')}
              </Button>
              <RefreshButton
                label={t('modelSetup.refresh')}
                loading={refreshing}
                variant="ghost"
                mode="compact"
                className="h-7 rounded-lg px-2.5 text-xs"
                onClick={() => void handleRefresh()}
              />
            </div>
          </div>
        )}

        {providerReady && !editingProvider ? (
          <div className="mt-4 border-t border-border/60 pt-4">
            <p className="mb-3 text-sm text-muted-foreground">
              {modelOptions.length > 0 ? t('modelSetup.pickModelDescription') : t('modelSetup.manualDescription')}
            </p>

            <div className="grid gap-3 lg:grid-cols-12">
              {modelOptions.length > 0 ? (
                <div className="space-y-2 lg:col-span-6">
                  <Label htmlFor="setup-local-model-option">{t('modelSetup.model')}</Label>
                  {(() => {
                    return (
                      <>
                  <Select
                    id="setup-local-model-option"
                    value={modelId}
                    onChange={(event) => {
                      const selectedId = event.target.value;
                      const selected = modelOptions.find((option) => option.id === selectedId);
                      setModelId(selectedId);
                      setModelName(selected?.name || selectedId);
                    }}
                    className="h-11 rounded-xl border-border bg-background/80"
                  >
                    {modelOptions.map((option) => (
                      <option
                        key={option.id}
                        value={option.id}
                        data-badge-label={option.typeLabel?.trim() || undefined}
                      >
                        {option.name || option.id}
                      </option>
                    ))}
                  </Select>
                      </>
                    );
                  })()}
                </div>
              ) : null}
              <div className={cn('space-y-2', modelOptions.length > 0 ? 'lg:col-span-4' : 'lg:col-span-5')}>
                <Label htmlFor="setup-local-model-name">{t('modelSetup.modelName')}</Label>
                <Input
                  id="setup-local-model-name"
                  value={modelName}
                  onChange={(event) => setModelName(event.target.value)}
                  placeholder={t('modelSetup.modelNamePlaceholder')}
                  className="h-11 rounded-xl"
                />
              </div>
              {modelOptions.length === 0 ? (
                <div className="space-y-2 lg:col-span-5">
                  <Label htmlFor="setup-local-model-id">{t('modelSetup.modelId')}</Label>
                  <Input
                    id="setup-local-model-id"
                    value={modelId}
                    onChange={(event) => {
                      setModelId(event.target.value);
                      setManualMode(true);
                    }}
                    placeholder={t('modelSetup.modelIdPlaceholder')}
                    className="h-11 rounded-xl"
                  />
                </div>
              ) : null}
              <div className={cn('flex items-end', modelOptions.length > 0 ? 'lg:col-span-2' : 'lg:col-span-2')}>
                <Button onClick={() => void handleAddModel()} disabled={savingModel || loadingModels} className="h-11 w-full rounded-xl px-5">
                  {savingModel ? <LoadingIcon className="mr-2 h-4 w-4" /> : null}
                  {manualMode || modelOptions.length === 0 ? t('modelSetup.addManualModel') : t('modelSetup.addModel')}
                </Button>
              </div>
            </div>

            {formError ? (
              <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
                {formError}
              </div>
            ) : null}
          </div>
        ) : formError ? (
          <div className="mt-3 rounded-xl border border-red-500/25 bg-red-500/10 px-4 py-3 text-sm text-red-600 dark:text-red-300">
            {formError}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CompleteContent({ modelConfigured }: { modelConfigured: boolean }) {
  const { t } = useTranslation('setup');

  return (
    <div className="space-y-4 py-2 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
      </div>
      <p className="text-base text-muted-foreground">
        {modelConfigured ? t('complete.modelConfigured') : t('complete.modelSkipped')}
      </p>
    </div>
  );
}

export default Setup;
