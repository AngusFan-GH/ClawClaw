/**
 * Setup Wizard Page
 * First-time setup experience for new users
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
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
import { cn } from '@/lib/utils';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { useGatewayStore } from '@/stores/gateway';
import { useSettingsStore } from '@/stores/settings';
import { useTranslation } from 'react-i18next';
import type { TFunction } from 'i18next';
import { toast } from 'sonner';
import { invokeIpc } from '@/lib/api-client';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
interface SetupStep {
  id: string;
  title: string;
  description: string;
}

type LocalModelPresetSummary = {
  id: string;
  name: string;
  modelId: string;
  baseUrl: string;
};

const STEP = {
  WELCOME: 0,
  RUNTIME: 1,
  PROVIDER: 2,
  INSTALLING: 3,
  COMPLETE: 4,
} as const;

const getSteps = (t: TFunction): SetupStep[] => [
  {
    id: 'welcome',
    title: t('steps.welcome.title'),
    description: t('steps.welcome.description'),
  },
  {
    id: 'runtime',
    title: t('steps.runtime.title'),
    description: t('steps.runtime.description'),
  },
  {
    id: 'provider',
    title: t('steps.provider.title'),
    description: t('steps.provider.description'),
  },
  {
    id: 'installing',
    title: t('steps.installing.title'),
    description: t('steps.installing.description'),
  },
  {
    id: 'complete',
    title: t('steps.complete.title'),
    description: t('steps.complete.description'),
  },
];

// Default skills to auto-install (no additional API keys required)
interface DefaultSkill {
  id: string;
  name: string;
  description: string;
}

const getDefaultSkills = (t: TFunction): DefaultSkill[] => [
  {
    id: 'opencode',
    name: t('defaultSkills.opencode.name'),
    description: t('defaultSkills.opencode.description'),
  },
  {
    id: 'python-env',
    name: t('defaultSkills.python-env.name'),
    description: t('defaultSkills.python-env.description'),
  },
  {
    id: 'code-assist',
    name: t('defaultSkills.code-assist.name'),
    description: t('defaultSkills.code-assist.description'),
  },
  {
    id: 'file-tools',
    name: t('defaultSkills.file-tools.name'),
    description: t('defaultSkills.file-tools.description'),
  },
  {
    id: 'terminal',
    name: t('defaultSkills.terminal.name'),
    description: t('defaultSkills.terminal.description'),
  },
];

import {
  SETUP_PROVIDERS,
  type ProviderAccount,
  type ProviderType,
  type ProviderTypeInfo,
  getProviderIconUrl,
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
import clawclawIcon from '@/assets/logo.svg';

// Use the shared provider registry for setup providers
const providers = SETUP_PROVIDERS;

// NOTE: Channel types moved to Settings > Channels page
// NOTE: Skill bundles moved to Settings > Skills page - auto-install essential skills during setup

export function Setup() {
  const { t } = useTranslation(['setup', 'channels']);
  const navigate = useNavigate();
  const [currentStep, setCurrentStep] = useState<number>(STEP.WELCOME);
  // Runtime check status
  const [runtimeChecksPassed, setRuntimeChecksPassed] = useState(false);

  const safeStepIndex = Number.isInteger(currentStep)
    ? Math.min(Math.max(currentStep, STEP.WELCOME), STEP.INSTALLING)
    : STEP.WELCOME;
  const markSetupComplete = useSettingsStore((state) => state.markSetupComplete);

  // Auto-proceed when installation is complete
  const handleInstallationComplete = useCallback((_skills: string[]) => {
    window.setTimeout(() => {
      markSetupComplete();
      navigate('/');
    }, 700);
  }, [markSetupComplete, navigate]);

  useEffect(() => {
    if (safeStepIndex !== STEP.WELCOME) return;
    const timer = setTimeout(() => {
      setCurrentStep(STEP.RUNTIME);
    }, 1200);
    return () => clearTimeout(timer);
  }, [safeStepIndex]);

  useEffect(() => {
    if (safeStepIndex !== STEP.RUNTIME || !runtimeChecksPassed) return;
    const timer = setTimeout(() => {
      setCurrentStep(STEP.INSTALLING);
    }, 900);
    return () => clearTimeout(timer);
  }, [runtimeChecksPassed, safeStepIndex]);

  const progressPercent =
    safeStepIndex === STEP.WELCOME ? 12 :
      safeStepIndex === STEP.RUNTIME ? 42 :
        safeStepIndex === STEP.INSTALLING ? 82 : 100;

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-background text-foreground">
      <TitleBar />
      <div className="flex-1 overflow-auto">
        <div className="mx-auto max-w-2xl px-6 pb-10 pt-16 md:px-8 md:pt-20">
          <div className="mb-10 text-center">
            <div className="mb-6 flex justify-center">
              <div className="flex h-20 w-20 items-center justify-center rounded-3xl border border-border/70 bg-muted/40 shadow-sm">
                <img src={clawclawIcon} alt="ClawClaw" className="h-12 w-12" />
              </div>
            </div>
            <h1 className="mb-3 text-4xl font-semibold tracking-tight">{t('welcome.title')}</h1>
            <p className="mx-auto max-w-xl text-base text-muted-foreground">
              {t('welcome.description')}
            </p>
          </div>

          <div className="mb-6 rounded-3xl border border-border/70 bg-card/90 p-8 text-card-foreground shadow-sm md:p-10">
            <div className="mb-6">
              <div className="mb-2 flex items-center justify-between text-sm">
                <span className="font-medium text-foreground">
                  {safeStepIndex === STEP.WELCOME
                    ? t('steps.welcome.title')
                    : safeStepIndex === STEP.RUNTIME
                      ? t('steps.runtime.title')
                      : t('steps.installing.title')}
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

            {safeStepIndex === STEP.WELCOME && <WelcomeContent />}
            {safeStepIndex === STEP.RUNTIME && (
              <RuntimeContent onStatusChange={setRuntimeChecksPassed} />
            )}
            {safeStepIndex === STEP.INSTALLING && (
              <InstallingContent
                skills={getDefaultSkills(t)}
                onComplete={handleInstallationComplete}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ==================== Step Content Components ====================

function WelcomeContent() {
  return (
    <div className="h-2" />
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
    } catch (error) {
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
        gateway: { status: 'error', message: currentGateway.error || t('runtime.status.error') },
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
    runChecks();
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
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: t('runtime.status.checking') },
    }));
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
      setChecks((prev) => ({
        ...prev,
        gateway: {
          status: 'success',
          message: t('runtime.status.gatewayRunning', { port: gatewayStatus.port || 18789 }),
        },
      }));
    } else if (gatewayStatus.state === 'error') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || t('runtime.status.error') },
      }));
    } else if (gatewayStatus.state === 'starting' || gatewayStatus.state === 'reconnecting') {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'checking', message: t('runtime.status.checking') },
      }));
    } else if (gatewayStatus.state === 'stopped' && gatewayStartAttemptedRef.current) {
      setChecks((prev) => ({
        ...prev,
        gateway: { status: 'error', message: gatewayStatus.error || t('runtime.status.error') },
      }));
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
              message: gatewayStatus.error || t('runtime.status.error'),
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
    setChecks((prev) => ({
      ...prev,
      gateway: { status: 'checking', message: t('runtime.status.checking') },
    }));
    await startGateway();
  };

  const renderStatus = (status: 'checking' | 'success' | 'error', message: string) => {
    if (status === 'checking') {
      return (
        <span className="flex items-center gap-2 text-yellow-400 whitespace-nowrap">
          <LoadingIcon className="h-5 w-5 flex-shrink-0" />
          {message || 'Checking...'}
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
      <span className="flex items-center gap-2 text-red-400 whitespace-nowrap">
        <XCircle className="h-5 w-5 flex-shrink-0" />
        <span>{message}</span>
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
        <div className="grid grid-cols-[1fr_auto] items-center gap-4 p-3 rounded-lg bg-muted/50">
          <div className="flex items-center gap-2 text-left">
            <span>{t('runtime.gateway')}</span>
            {checks.gateway.status === 'error' && (
              <Button variant="outline" size="sm" onClick={handleStartGateway}>
                {t('runtime.startGateway')}
              </Button>
            )}
          </div>
          <div className="flex justify-end">
            {renderStatus(checks.gateway.status, checks.gateway.message)}
          </div>
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

function AutoConfiguredLocalModelContent({
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

type ProviderModelOption = {
  id: string;
  name: string;
};

const OPENAI_OAUTH_PREFERRED_MODEL_ID = 'gpt-5.4';

function normalizeOAuthSelectedModel(vendorId: string, modelId?: string | null): string {
  const normalized = modelId?.trim() || '';
  if (!normalized) {
    return '';
  }
  if (vendorId === 'openai' && (normalized === 'gpt-5.2' || normalized === 'gpt-5.3-codex')) {
    return OPENAI_OAUTH_PREFERRED_MODEL_ID;
  }
  return normalized;
}

function pickOAuthModelSelection(
  vendorId: string,
  options: ProviderModelOption[],
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

  if (vendorId === 'openai' && options.some((option) => option.id === OPENAI_OAUTH_PREFERRED_MODEL_ID)) {
    return OPENAI_OAUTH_PREFERRED_MODEL_ID;
  }

  return options[0]?.id || normalizedFallback || normalizedPreferred || '';
}

function ProviderContent({
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
  const [oauthModelOptions, setOauthModelOptions] = useState<ProviderModelOption[]>([]);
  const [loadingOAuthModels, setLoadingOAuthModels] = useState(false);

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
            setOauthAuthedAccountId(accountId);
            setLoadingOAuthModels(true);
            const models = await loadOAuthModelOptions('openai', 'oauth_browser');
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
  }, [onConfiguredChange, t]);

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

  const selectedProviderData = providers.find((p) => p.id === selectedProvider);
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

  const loadOAuthModelOptions = async (vendorId: string, authModeValue: 'oauth_browser' | 'oauth_device') => {
    const response = await hostApiFetch<{ models: ProviderModelOption[] }>(
      `/api/provider-model-options?vendorId=${encodeURIComponent(vendorId)}&authMode=${encodeURIComponent(authModeValue)}`
    );
    return response.models ?? [];
  };

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
          { baseUrl: baseUrl.trim() || undefined }
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
              <select
                id="oauthModelId"
                value={modelId}
                onChange={(e) => {
                  setModelId(normalizeOAuthSelectedModel(selectedProvider, e.target.value));
                  onConfiguredChange(false);
                }}
                className="w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                disabled={loadingOAuthModels}
              >
                {oauthModelOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.name}
                  </option>
                ))}
              </select>
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
  skills: DefaultSkill[];
  onComplete: (installedSkills: string[]) => void;
}

function InstallingContent({ skills, onComplete }: InstallingContentProps) {
  const { t } = useTranslation('setup');
  const [skillStates, setSkillStates] = useState<SkillInstallState[]>(
    skills.map((s) => ({ ...s, status: 'pending' as InstallStatus }))
  );
  const [overallProgress, setOverallProgress] = useState(0);
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
        setOverallProgress(10);

        // Step 2: Call the backend to install uv and setup Python
        const result = (await invokeIpc('uv:install-all')) as {
          success: boolean;
          error?: string;
        };

        if (result.success) {
          setSkillStates((prev) => prev.map((s) => ({ ...s, status: 'completed' })));
          setOverallProgress(100);

          await new Promise((resolve) => setTimeout(resolve, 800));
          onComplete(skills.map((s) => s.id));
        } else {
          setSkillStates((prev) => prev.map((s) => ({ ...s, status: 'failed' })));
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
  }, [skills, onComplete]);

  return (
    <div className="space-y-4 text-center">
      <div className="text-center">
        <div className="mx-auto mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-blue-50">
          <LoadingIcon className="h-8 w-8 text-blue-600" />
        </div>
        <p className="text-base text-muted-foreground">{t('installing.subtitle')}</p>
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
      ) : (
        <div className="text-sm text-slate-400">
          {t('installing.wait')}
        </div>
      )}
    </div>
  );
}
interface CompleteContentProps {
  selectedProvider: string | null;
  installedSkills: string[];
}

function CompleteContent({ selectedProvider, installedSkills }: CompleteContentProps) {
  const { t } = useTranslation(['setup', 'settings']);

  return (
    <div className="space-y-4 text-center">
      <div className="mx-auto flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50">
        <CheckCircle2 className="h-8 w-8 text-emerald-600" />
      </div>
      <p className="text-muted-foreground">{t('complete.subtitle')}</p>
      <div className="rounded-xl border border-border bg-muted/40 px-4 py-3 text-sm text-muted-foreground">
        {t('complete.autoEnter')}
      </div>
    </div>
  );
}

export default Setup;

