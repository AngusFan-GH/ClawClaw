/**
 * Providers Settings Component
 * Manage AI provider configurations and API keys
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Plus,
  Trash2,
  Edit,
  Eye,
  EyeOff,
  Check,
  X,
  Key,
  ExternalLink,
  Copy,
  XCircle,
  ChevronDown,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import {
  useProviderStore,
  type ProviderAccount,
  type ProviderConfig,
  type ProviderVendorInfo,
} from '@/stores/providers';
import {
  PROVIDER_TYPE_INFO,
  type ProviderType,
  getProviderIconUrl,
  resolveProviderApiKeyForSave,
  resolveProviderModelForSave,
  shouldShowProviderModelId,
} from '@/lib/providers';
import {
  buildProviderAccountId,
  buildProviderListItems,
  hasConfiguredCredentials,
  type ProviderListItem,
} from '@/lib/provider-accounts';
import { cn } from '@/lib/utils';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { LoadingIcon } from '@/components/common/LoadingSpinner';

const inputClasses = 'h-[44px] rounded-xl font-mono text-[13px] bg-muted/70 dark:bg-muted/40 border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';

function getOpenClawRuntimeProviderKeyPreview(account: Pick<ProviderAccount, 'id' | 'vendorId' | 'authMode'>): string {
  if (account.vendorId === 'google' && account.authMode === 'oauth_browser') {
    return 'google-gemini-cli';
  }
  if (
    account.vendorId === 'openai'
    && (account.authMode === 'oauth_browser' || account.authMode === 'oauth_device')
  ) {
    return 'openai-codex';
  }
  if (
    account.vendorId === 'custom'
    || account.vendorId === 'ollama'
  ) {
    const normalized = account.id.replace(/[^a-zA-Z0-9]/g, '').toLowerCase() || 'default';
    return `${account.vendorId}-${normalized}`;
  }
  if (account.vendorId === 'minimax-portal-cn') {
    return 'minimax-portal';
  }
  return account.vendorId;
}

function normalizeFallbackProviderIds(ids?: string[]): string[] {
  return Array.from(new Set((ids ?? []).filter(Boolean)));
}

function fallbackProviderIdsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackProviderIds(a).sort();
  const right = normalizeFallbackProviderIds(b).sort();
  return left.length === right.length && left.every((id, index) => id === right[index]);
}

function normalizeFallbackModels(models?: string[]): string[] {
  return Array.from(new Set((models ?? []).map((model) => model.trim()).filter(Boolean)));
}

function fallbackModelsEqual(a?: string[], b?: string[]): boolean {
  const left = normalizeFallbackModels(a);
  const right = normalizeFallbackModels(b);
  return left.length === right.length && left.every((model, index) => model === right[index]);
}

function isPresetManagedCustomAccount(account: Pick<ProviderAccount, 'vendorId' | 'metadata'>): boolean {
  return account.vendorId === 'custom' && account.metadata?.managedBy === 'preset-local-model';
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

function getAuthModeLabel(
  authMode: ProviderAccount['authMode'],
  t: (key: string) => string
): string {
  switch (authMode) {
    case 'api_key':
      return t('aiProviders.authModes.apiKey');
    case 'oauth_device':
      return t('aiProviders.authModes.oauthDevice');
    case 'oauth_browser':
      return t('aiProviders.authModes.oauthBrowser');
    case 'local':
      return t('aiProviders.authModes.local');
    default:
      return authMode;
  }
}

export function ProvidersSettings({
  embedded = false,
  hideHeader = false,
  actionOnly = false,
  autoOpenOnEmpty = false,
}: {
  embedded?: boolean;
  hideHeader?: boolean;
  actionOnly?: boolean;
  autoOpenOnEmpty?: boolean;
}) {
  const { t } = useTranslation('settings');
  const devModeUnlocked = useSettingsStore((state) => state.devModeUnlocked);
  const {
    statuses,
    accounts,
    vendors,
    defaultAccountId,
    loading,
    refreshProviderSnapshot,
    createAccount,
    removeAccount,
    updateAccount,
    setDefaultAccount,
    validateAccountApiKey,
  } = useProviderStore();

  const [showAddDialog, setShowAddDialog] = useState(false);
  const autoOpenedRef = useRef(false);
  const [editingProvider, setEditingProvider] = useState<string | null>(null);
  const vendorMap = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor]));
  const existingVendorIds = new Set((accounts ?? []).map((account) => account.vendorId));
  const displayProviders = useMemo(
    () => buildProviderListItems(accounts, statuses, vendors, defaultAccountId)
      .filter((item) => item.account.vendorId !== 'local-model')
      .filter((item) => !isPresetManagedCustomAccount(item.account)),
    [accounts, statuses, vendors, defaultAccountId],
  );

  // Fetch providers on mount
  useEffect(() => {
    refreshProviderSnapshot();
  }, [refreshProviderSnapshot]);

  useEffect(() => {
    if (!autoOpenOnEmpty || actionOnly || loading || autoOpenedRef.current) {
      return;
    }
    if (displayProviders.length === 0) {
      autoOpenedRef.current = true;
      setShowAddDialog(true);
    }
  }, [actionOnly, autoOpenOnEmpty, displayProviders.length, loading]);

  const handleAddProvider = async (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: { baseUrl?: string; model?: string; authMode?: ProviderAccount['authMode']; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => {
    const vendor = vendorMap.get(type);
    const id = buildProviderAccountId(type, null, vendors);
    const effectiveApiKey = resolveProviderApiKeyForSave(type, apiKey);
    try {
      await createAccount({
        id,
        vendorId: type,
        label: name,
        authMode: options?.authMode || vendor?.defaultAuthMode || (type === 'ollama' || type === 'custom' ? 'local' : 'api_key'),
        baseUrl: options?.baseUrl,
        apiProtocol: options?.apiProtocol,
        model: options?.model,
        enabled: true,
        isDefault: false,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      }, effectiveApiKey);

      // Auto-set as default if no default is currently configured
      if (!defaultAccountId) {
        await setDefaultAccount(id);
      }

      setShowAddDialog(false);
      toast.success(t('aiProviders.toast.added'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedAdd')}: ${error}`);
    }
  };

  const handleDeleteProvider = async (providerId: string) => {
    try {
      await removeAccount(providerId);
      toast.success(t('aiProviders.toast.deleted'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDelete')}: ${error}`);
    }
  };

  const handleSetDefault = async (providerId: string) => {
    try {
      await setDefaultAccount(providerId);
      toast.success(t('aiProviders.toast.defaultUpdated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedDefault')}: ${error}`);
    }
  };

  const addButton = (
    <Button onClick={() => setShowAddDialog(true)} className="h-9 rounded-xl border border-border/70 bg-card/85 px-5 text-[13px] font-medium text-foreground shadow-none hover:bg-accent/70">
      <Plus className="h-4 w-4 mr-2" />
      {t('aiProviders.add')}
    </Button>
  );

  if (actionOnly) {
    return (
      <>
        {addButton}
        {showAddDialog && (
          <AddProviderDialog
            existingVendorIds={existingVendorIds}
            vendors={vendors}
            onClose={() => setShowAddDialog(false)}
            onAdd={handleAddProvider}
            onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
            devModeUnlocked={devModeUnlocked}
          />
        )}
      </>
    );
  }

  return (
    <div className={cn("space-y-6", embedded && "space-y-4")}>
      {!hideHeader && (
        <div className="flex items-start justify-between gap-3">
          <div>
            <h2 className="text-2xl font-semibold tracking-tight text-foreground">
              {t('aiProviders.title', 'AI Providers')}
            </h2>
            {!embedded && (
              <p className="mt-1 text-[13px] text-muted-foreground">
                {t('aiProviders.description')}
              </p>
            )}
          </div>
          {addButton}
        </div>
      )}

      {loading ? (
        <div className="flex items-center justify-center py-12 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-2xl border border-transparent border-dashed">
          <LoadingIcon className="h-6 w-6" />
        </div>
      ) : displayProviders.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-20 text-muted-foreground bg-black/5 dark:bg-white/5 rounded-2xl border border-transparent border-dashed">
          <Key className="h-12 w-12 mb-4 opacity-50" />
          <h3 className="text-[15px] font-medium mb-1 text-foreground">{t('aiProviders.empty.title')}</h3>
          <p className="text-[13px] text-center mb-6 max-w-sm">
            {t('aiProviders.empty.desc')}
          </p>
          <Button onClick={() => setShowAddDialog(true)} className="h-10 rounded-xl px-6 bg-primary text-primary-foreground hover:bg-primary/90">
            <Plus className="h-4 w-4 mr-2" />
            {t('aiProviders.empty.cta')}
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {displayProviders.map((item) => (
            <ProviderCard
              key={item.account.id}
              item={item}
              allProviders={displayProviders}
              isDefault={item.account.id === defaultAccountId}
              isEditing={editingProvider === item.account.id}
              onEdit={() => setEditingProvider(item.account.id)}
              onCancelEdit={() => setEditingProvider(null)}
              onDelete={() => handleDeleteProvider(item.account.id)}
              onSetDefault={() => handleSetDefault(item.account.id)}
              onSaveEdits={async (payload) => {
                const updates: Partial<ProviderAccount> = {};
                if (payload.updates) {
                  if (payload.updates.baseUrl !== undefined) updates.baseUrl = payload.updates.baseUrl;
                  if (payload.updates.apiProtocol !== undefined) updates.apiProtocol = payload.updates.apiProtocol;
                  if (payload.updates.model !== undefined) updates.model = payload.updates.model;
                  if (payload.updates.fallbackModels !== undefined) updates.fallbackModels = payload.updates.fallbackModels;
                  if (payload.updates.fallbackProviderIds !== undefined) {
                    updates.fallbackAccountIds = payload.updates.fallbackProviderIds;
                  }
                }
                await updateAccount(
                  item.account.id,
                  updates,
                  payload.newApiKey
                );
                setEditingProvider(null);
              }}
              onValidateKey={(key, options) => validateAccountApiKey(item.account.id, key, options)}
              devModeUnlocked={devModeUnlocked}
            />
          ))}
        </div>
      )}

      {/* Add Provider Dialog */}
      {showAddDialog && (
        <AddProviderDialog
          existingVendorIds={existingVendorIds}
          vendors={vendors}
          onClose={() => setShowAddDialog(false)}
          onAdd={handleAddProvider}
          onValidateKey={(type, key, options) => validateAccountApiKey(type, key, options)}
          devModeUnlocked={devModeUnlocked}
        />
      )}
    </div>
  );
}

interface ProviderCardProps {
  item: ProviderListItem;
  allProviders: ProviderListItem[];
  isDefault: boolean;
  isEditing: boolean;
  onEdit: () => void;
  onCancelEdit: () => void;
  onDelete: () => void;
  onSetDefault: () => void;
  onSaveEdits: (payload: { newApiKey?: string; updates?: Partial<ProviderConfig> }) => Promise<void>;
  onValidateKey: (
    key: string,
    options?: { baseUrl?: string; apiProtocol?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}



function ProviderCard({
  item,
  allProviders,
  isDefault,
  isEditing,
  onEdit,
  onCancelEdit,
  onDelete,
  onSetDefault,
  onSaveEdits,
  onValidateKey,
  devModeUnlocked,
}: ProviderCardProps) {
  const { t } = useTranslation('settings');
  const { account, vendor, status } = item;
  const [newKey, setNewKey] = useState('');
  const [baseUrl, setBaseUrl] = useState(account.baseUrl || '');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>(account.apiProtocol || 'openai-completions');
  const [modelId, setModelId] = useState(account.model || '');
  const [fallbackModelsText, setFallbackModelsText] = useState(
    normalizeFallbackModels(account.fallbackModels).join('\n')
  );
  const [fallbackProviderIds, setFallbackProviderIds] = useState<string[]>(
    normalizeFallbackProviderIds(account.fallbackAccountIds)
  );
  const [showKey, setShowKey] = useState(false);
  const [showFallback, setShowFallback] = useState(false);
  const [validating, setValidating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modelOptions, setModelOptions] = useState<ProviderModelOption[]>([]);
  const [loadingModelOptions, setLoadingModelOptions] = useState(false);

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === account.vendorId);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const canEditModelConfig = Boolean(typeInfo?.showBaseUrl || showModelIdField);
  const usesOpenAIOAuthModelPicker = account.vendorId === 'openai' && account.authMode === 'oauth_browser';
  const runtimeProviderKey = getOpenClawRuntimeProviderKeyPreview(account);

  useEffect(() => {
    if (isEditing) {
      setNewKey('');
      setShowKey(false);
      setBaseUrl(account.baseUrl || '');
      setApiProtocol(account.apiProtocol || 'openai-completions');
      setModelId(normalizeOAuthSelectedModel(account.vendorId, account.model));
      setFallbackModelsText(normalizeFallbackModels(account.fallbackModels).join('\n'));
      setFallbackProviderIds(normalizeFallbackProviderIds(account.fallbackAccountIds));
    }
  }, [isEditing, account.baseUrl, account.fallbackModels, account.fallbackAccountIds, account.model, account.apiProtocol]);

  useEffect(() => {
    let cancelled = false;
    if (!isEditing || !usesOpenAIOAuthModelPicker) {
      setModelOptions([]);
      setLoadingModelOptions(false);
      return;
    }

    setLoadingModelOptions(true);
    hostApiFetch<{ models: ProviderModelOption[] }>('/api/provider-model-options?vendorId=openai&authMode=oauth_browser')
      .then((response) => {
        if (cancelled) return;
        setModelOptions(response.models ?? []);
        setModelId((current) => pickOAuthModelSelection(
          account.vendorId,
          response.models ?? [],
          current || account.model,
          typeInfo?.defaultModelId,
        ));
      })
      .catch((error) => {
        if (!cancelled) {
          console.error('Failed to load OpenAI OAuth model options:', error);
          setModelOptions([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setLoadingModelOptions(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [account.model, account.vendorId, isEditing, typeInfo?.defaultModelId, usesOpenAIOAuthModelPicker]);

  const fallbackOptions = allProviders.filter((candidate) => candidate.account.id !== account.id);

  const toggleFallbackProvider = (providerId: string) => {
    setFallbackProviderIds((current) => (
      current.includes(providerId)
        ? current.filter((id) => id !== providerId)
        : [...current, providerId]
    ));
  };

  const handleSaveEdits = async () => {
    setSaving(true);
    try {
      const payload: { newApiKey?: string; updates?: Partial<ProviderConfig> } = {};
      const normalizedFallbackModels = normalizeFallbackModels(fallbackModelsText.split('\n'));

      if (newKey.trim()) {
        setValidating(true);
        const result = await onValidateKey(newKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (account.vendorId === 'custom' || account.vendorId === 'ollama') ? apiProtocol : undefined,
        });
        setValidating(false);
        if (!result.valid) {
          toast.error(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
        payload.newApiKey = newKey.trim();
      }

      {
        if (showModelIdField && !modelId.trim()) {
          toast.error(t('aiProviders.toast.modelRequired'));
          setSaving(false);
          return;
        }

        const updates: Partial<ProviderConfig> = {};
        if (typeInfo?.showBaseUrl && (baseUrl.trim() || undefined) !== (account.baseUrl || undefined)) {
          updates.baseUrl = baseUrl.trim() || undefined;
        }
        if ((account.vendorId === 'custom' || account.vendorId === 'ollama') && apiProtocol !== account.apiProtocol) {
          updates.apiProtocol = apiProtocol;
        }
        if (showModelIdField && (modelId.trim() || undefined) !== (account.model || undefined)) {
          updates.model = modelId.trim() || undefined;
        }
        if (!fallbackModelsEqual(normalizedFallbackModels, account.fallbackModels)) {
          updates.fallbackModels = normalizedFallbackModels;
        }
        if (!fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)) {
          updates.fallbackProviderIds = normalizeFallbackProviderIds(fallbackProviderIds);
        }
        if (Object.keys(updates).length > 0) {
          payload.updates = updates;
        }
      }

      // Keep Ollama key optional in UI, but persist a placeholder when
      // editing legacy configs that have no stored key.
      if ((account.vendorId === 'ollama' || account.vendorId === 'custom') && !status?.hasKey && !payload.newApiKey) {
        payload.newApiKey = resolveProviderApiKeyForSave(account.vendorId, '') as string;
      }

      if (!payload.newApiKey && !payload.updates) {
        onCancelEdit();
        setSaving(false);
        return;
      }

      await onSaveEdits(payload);
      setNewKey('');
      toast.success(t('aiProviders.toast.updated'));
    } catch (error) {
      toast.error(`${t('aiProviders.toast.failedUpdate')}: ${error}`);
    } finally {
      setSaving(false);
      setValidating(false);
    }
  };

  const currentInputClasses = isDefault
    ? "h-[40px] rounded-xl font-mono text-[13px] bg-white dark:bg-card border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm"
    : inputClasses;

  const currentLabelClasses = isDefault ? "text-[13px] text-muted-foreground" : labelClasses;
  const currentSectionLabelClasses = isDefault ? "text-[14px] font-bold text-foreground/80" : labelClasses;
  const vendorDisplayName = vendor?.name || account.vendorId;
  const showVendorName =
    account.vendorId !== 'custom'
    && account.label.trim().toLowerCase() !== vendorDisplayName.trim().toLowerCase();

  return (
    <div
      role={!isEditing && !isDefault ? 'button' : undefined}
      tabIndex={!isEditing && !isDefault ? 0 : undefined}
      onClick={!isEditing && !isDefault ? onSetDefault : undefined}
      onKeyDown={
        !isEditing && !isDefault
          ? (event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                onSetDefault();
              }
            }
          : undefined
      }
      className={cn(
        "flex flex-col p-4 rounded-2xl transition-all relative overflow-hidden",
        isDefault
          ? "bg-white dark:bg-accent border border-black/10 dark:border-white/10 shadow-sm"
          : "bg-transparent border border-black/10 dark:border-white/10 cursor-pointer hover:bg-black/[0.02] dark:hover:bg-white/[0.03]"
      )}
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <div className={cn("h-[42px] w-[42px] shrink-0 flex items-center justify-center text-foreground border border-black/5 dark:border-white/10 rounded-full shadow-sm transition-transform", isDefault ? "bg-black/5 dark:bg-white/5" : "bg-white dark:bg-accent")}>
            {getProviderIconUrl(account.vendorId) ? (
              <img src={getProviderIconUrl(account.vendorId)} alt={typeInfo?.name || account.vendorId} className="h-5 w-5" />
            ) : (
              <span className="text-xl">{vendor?.icon || typeInfo?.icon || 'Key'}</span>
            )}
          </div>
          <div>
            <div className="flex items-center gap-2">
              <span className="font-semibold text-[15px]">{account.label}</span>
              {isDefault && (
                <span className="flex items-center gap-1 text-[11px] font-medium text-primary bg-primary/10 px-2 py-0.5 rounded-full border border-primary/20">
                  <Check className="h-3 w-3" />
                  {t('aiProviders.card.default')}
                </span>
              )}
            </div>
            <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-0.5 text-[13px] text-muted-foreground">
              {showVendorName && (
                <>
                  <span className="capitalize">{vendorDisplayName}</span>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                </>
              )}
              <span>{getAuthModeLabel(account.authMode, t)}</span>
              {account.model && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[200px]">{account.model}</span>
                </>
              )}
              {(account.vendorId === 'custom' || account.vendorId === 'ollama') && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[220px] font-mono text-[12px]" title={runtimeProviderKey}>
                    OpenClaw · {runtimeProviderKey}
                  </span>
                </>
              )}
              {!hasConfiguredCredentials(account, status) && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="flex items-center gap-1 text-red-500 dark:text-red-400">
                    <div className="w-1.5 h-1.5 rounded-full bg-current" />
                    {t('aiProviders.dialog.apiKeyMissing')}
                  </span>
                </>
              )}
              {((account.fallbackModels?.length ?? 0) > 0 || (account.fallbackAccountIds?.length ?? 0) > 0) && (
                <>
                  <span className="w-1 h-1 rounded-full bg-black/20 dark:bg-white/20" />
                  <span className="truncate max-w-[150px]" title={t('aiProviders.sections.fallback')}>
                    {t('aiProviders.sections.fallback')}: {[
                      ...normalizeFallbackModels(account.fallbackModels),
                      ...normalizeFallbackProviderIds(account.fallbackAccountIds)
                        .map((fallbackId) => allProviders.find((candidate) => candidate.account.id === fallbackId)?.account.label)
                        .filter(Boolean),
                    ].join(', ')}
                  </span>
                </>
              )}
            </div>
          </div>
        </div>

        {!isEditing && (
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-8 w-8 rounded-full text-muted-foreground hover:text-foreground hover:bg-white dark:hover:bg-card shadow-sm"
              onClick={(event) => {
                event.stopPropagation();
                onEdit();
              }}
              title={t('aiProviders.card.editKey')}
            >
              <Edit className="h-4 w-4" />
            </Button>
            <Button
              variant="dangerGhost"
              size="icon"
              className="h-8 w-8 rounded-[10px]"
              onClick={(event) => {
                event.stopPropagation();
                onDelete();
              }}
              title={t('aiProviders.card.delete')}
            >
              <Trash2 className="h-4 w-4" />
            </Button>
          </div>
        )}
      </div>

      {isEditing && (
        <div className="space-y-6 mt-4 pt-4 border-t border-black/5 dark:border-white/5">
          {canEditModelConfig && (
            <div className="space-y-3">
              <p className={currentSectionLabelClasses}>{t('aiProviders.sections.model')}</p>
              {typeInfo?.showBaseUrl && (
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                  <Input
                    value={baseUrl}
                    onChange={(e) => setBaseUrl(e.target.value)}
                    placeholder={apiProtocol === 'anthropic-messages' ? "https://api.example.com/anthropic" : "https://api.example.com/v1"}
                    className={currentInputClasses}
                  />
                </div>
              )}
              {showModelIdField && !usesOpenAIOAuthModelPicker && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                  <Input
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                    className={currentInputClasses}
                  />
                </div>
              )}
              {showModelIdField && usesOpenAIOAuthModelPicker && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.model')}</Label>
                  <select
                    value={modelId}
                    onChange={(e) => setModelId(e.target.value)}
                    className={cn(currentInputClasses, 'font-sans')}
                    disabled={loadingModelOptions}
                  >
                    {modelOptions.map((option) => (
                      <option key={option.id} value={option.id}>
                        {option.name}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {account.vendorId === 'custom' && (
                <div className="space-y-1.5 pt-2">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                  <div className="flex gap-2 text-[13px]">
                    <button
                      type="button"
                      onClick={() => setApiProtocol('openai-completions')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.openai', 'OpenAI')}
                    </button>
                    <button
                      type="button"
                      onClick={() => setApiProtocol('anthropic-messages')}
                      className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                    >
                      {t('aiProviders.protocols.anthropic', 'Anthropic')}
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
          <div className="space-y-3">
            <button
              onClick={() => setShowFallback(!showFallback)}
              className="flex items-center justify-between w-full text-[14px] font-bold text-foreground/80 hover:text-foreground transition-colors"
            >
              <span>{t('aiProviders.sections.fallback')}</span>
              <ChevronDown className={cn("h-4 w-4 transition-transform", showFallback && "rotate-180")} />
            </button>
            {showFallback && (
              <div className="space-y-3 pt-2">
                <div className="space-y-1.5">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackModelIds')}</Label>
                  <textarea
                    value={fallbackModelsText}
                    onChange={(e) => setFallbackModelsText(e.target.value)}
                    placeholder={t('aiProviders.dialog.fallbackModelIdsPlaceholder')}
                    className={isDefault
                      ? "min-h-24 w-full rounded-xl border border-black/10 dark:border-white/10 bg-white dark:bg-card px-3 py-2 text-[13px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 shadow-sm"
                      : "min-h-24 w-full rounded-xl border border-black/10 dark:border-white/10 bg-muted/70 dark:bg-muted/40 px-3 py-2 text-[13px] font-mono outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40"}
                  />
                  <p className="text-[12px] text-muted-foreground">
                    {t('aiProviders.dialog.fallbackModelIdsHelp')}
                  </p>
                </div>
                <div className="space-y-2 pt-1">
                  <Label className={currentLabelClasses}>{t('aiProviders.dialog.fallbackProviders')}</Label>
                  {fallbackOptions.length === 0 ? (
                    <p className="text-[13px] text-muted-foreground">{t('aiProviders.dialog.noFallbackOptions')}</p>
                  ) : (
                    <div className={cn("space-y-2 rounded-xl border border-black/10 dark:border-white/10 p-3 shadow-sm", isDefault ? "bg-white dark:bg-card" : "bg-muted/70 dark:bg-muted/40")}>
                      {fallbackOptions.map((candidate) => (
                        <label key={candidate.account.id} className="flex items-center gap-3 text-[13px] cursor-pointer group/label">
                          <input
                            type="checkbox"
                            checked={fallbackProviderIds.includes(candidate.account.id)}
                            onChange={() => toggleFallbackProvider(candidate.account.id)}
                            className="rounded border-black/20 dark:border-white/20 text-blue-500 focus:ring-blue-500/50"
                          />
                          <span className="font-medium group-hover/label:text-blue-500 transition-colors">{candidate.account.label}</span>
                          <span className="text-[12px] text-muted-foreground">
                            {candidate.account.model || candidate.vendor?.name || candidate.account.vendorId}
                          </span>
                        </label>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="space-y-0.5">
                <Label className={currentSectionLabelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                <p className="text-[12px] text-muted-foreground">
                  {hasConfiguredCredentials(account, status)
                    ? t('aiProviders.dialog.apiKeyConfigured')
                    : t('aiProviders.dialog.apiKeyMissing')}
                </p>
              </div>
              {hasConfiguredCredentials(account, status) ? (
                <div className="flex items-center gap-1.5 text-[11px] font-medium text-green-600 dark:text-green-500 bg-green-500/10 px-2 py-1 rounded-md">
                  <div className="w-1.5 h-1.5 rounded-full bg-current" />
                  {t('aiProviders.card.configured')}
                </div>
              ) : null}
            </div>
            {typeInfo?.apiKeyUrl && (
              <div className="flex justify-start">
                <a
                  href={typeInfo.apiKeyUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[13px] text-primary hover:text-primary/80 hover:underline flex items-center gap-1"
                  tabIndex={-1}
                >
                  {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                </a>
              </div>
            )}
            <div className="space-y-1.5 pt-1">
              <Label className={currentLabelClasses}>{t('aiProviders.dialog.replaceApiKey')}</Label>
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Input
                    type={showKey ? 'text' : 'password'}
                    placeholder={typeInfo?.requiresApiKey ? typeInfo?.placeholder : ((typeInfo?.id === 'ollama' || typeInfo?.id === 'custom') ? t('aiProviders.notRequired') : t('aiProviders.card.editKey'))}
                    value={newKey}
                    onChange={(e) => setNewKey(e.target.value)}
                    className={cn(currentInputClasses, 'pr-10')}
                  />
                  <button
                    type="button"
                    onClick={() => setShowKey(!showKey)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                  >
                    {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                  </button>
                </div>
                <Button
                  variant="outline"
                  onClick={handleSaveEdits}
                  className={cn(
                    "rounded-xl px-4 border-black/10 dark:border-white/10",
                    isDefault
                      ? "h-[40px] bg-white dark:bg-card hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-[44px] bg-muted/70 dark:bg-muted/40 hover:bg-black/5 dark:hover:bg-white/10 shadow-sm"
                  )}
                  disabled={
                    validating
                    || saving
                    || (
                      !newKey.trim()
                      && (baseUrl.trim() || undefined) === (account.baseUrl || undefined)
                      && (modelId.trim() || undefined) === (account.model || undefined)
                      && fallbackModelsEqual(normalizeFallbackModels(fallbackModelsText.split('\n')), account.fallbackModels)
                      && fallbackProviderIdsEqual(fallbackProviderIds, account.fallbackAccountIds)
                    )
                    || Boolean(showModelIdField && !modelId.trim())
                  }
                >
                  {validating || saving ? (
                    <LoadingIcon className="h-4 w-4" />
                  ) : (
                    <Check className="h-4 w-4 text-green-500" />
                  )}
                </Button>
                <Button
                  variant="ghost"
                  onClick={onCancelEdit}
                  className={cn(
                    "p-0 rounded-xl",
                    isDefault
                      ? "h-[40px] w-[40px] hover:bg-black/5 dark:hover:bg-white/10"
                      : "h-[44px] w-[44px] bg-muted/70 dark:bg-muted/40 border border-black/10 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/10 shadow-sm text-muted-foreground hover:text-foreground"
                  )}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
              <p className="text-[12px] text-muted-foreground">
                {t('aiProviders.dialog.replaceApiKeyHelp')}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

interface AddProviderDialogProps {
  existingVendorIds: Set<string>;
  vendors: ProviderVendorInfo[];
  onClose: () => void;
  onAdd: (
    type: ProviderType,
    name: string,
    apiKey: string,
    options?: { baseUrl?: string; model?: string; authMode?: ProviderAccount['authMode']; apiProtocol?: ProviderAccount['apiProtocol'] }
  ) => Promise<void>;
  onValidateKey: (
    type: string,
    apiKey: string,
    options?: { baseUrl?: string; apiProtocol?: string }
  ) => Promise<{ valid: boolean; error?: string }>;
  devModeUnlocked: boolean;
}

function AddProviderDialog({
  existingVendorIds,
  vendors,
  onClose,
  onAdd,
  onValidateKey,
  devModeUnlocked,
}: AddProviderDialogProps) {
  const { t } = useTranslation('settings');
  const [selectedType, setSelectedType] = useState<ProviderType | null>(null);
  const [name, setName] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [modelId, setModelId] = useState('');
  const [apiProtocol, setApiProtocol] = useState<ProviderAccount['apiProtocol']>('openai-completions');
  const [showKey, setShowKey] = useState(false);
  const [saving, setSaving] = useState(false);
  const [validationError, setValidationError] = useState<string | null>(null);

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
  const [oauthAuthedAccountId, setOauthAuthedAccountId] = useState<string | null>(null);
  const [oauthModelOptions, setOauthModelOptions] = useState<ProviderModelOption[]>([]);
  const [loadingOAuthModels, setLoadingOAuthModels] = useState(false);
  // For providers that support both OAuth and API key, let the user choose.
  // Default to the vendor's declared auth mode instead of hard-coding OAuth.
  const [authMode, setAuthMode] = useState<'oauth' | 'apikey'>('apikey');

  const typeInfo = PROVIDER_TYPE_INFO.find((t) => t.id === selectedType);
  const showModelIdField = shouldShowProviderModelId(typeInfo, devModeUnlocked);
  const isOAuth = typeInfo?.isOAuth ?? false;
  const supportsApiKey = typeInfo?.supportsApiKey ?? false;
  const vendorMap = new Map((vendors ?? []).map((vendor) => [vendor.id, vendor]));
  const selectedVendor = selectedType ? vendorMap.get(selectedType) : undefined;
  const preferredOAuthMode = selectedVendor?.supportedAuthModes.includes('oauth_browser')
    ? 'oauth_browser'
    : (selectedVendor?.supportedAuthModes.includes('oauth_device')
      ? 'oauth_device'
      : (selectedType === 'google' ? 'oauth_browser' : null));
  // Effective OAuth mode: pure OAuth providers, or dual-mode with oauth selected
  const useOAuthFlow = isOAuth && (!supportsApiKey || authMode === 'oauth');
  const useOpenAIOAuthModelPicker = selectedType === 'openai' && useOAuthFlow;
  const showEditableModelField = showModelIdField && !useOpenAIOAuthModelPicker;

  const loadOAuthModelOptions = async (vendorId: string, authModeValue: 'oauth_browser' | 'oauth_device') => {
    const response = await hostApiFetch<{ models: ProviderModelOption[] }>(
      `/api/provider-model-options?vendorId=${encodeURIComponent(vendorId)}&authMode=${encodeURIComponent(authModeValue)}`
    );
    return response.models ?? [];
  };

  useEffect(() => {
    if (!selectedVendor || !isOAuth || !supportsApiKey) {
      return;
    }
    setAuthMode(selectedVendor.defaultAuthMode === 'api_key' ? 'apikey' : 'oauth');
  }, [selectedVendor, isOAuth, supportsApiKey]);

  useEffect(() => {
    setOauthAuthedAccountId(null);
    setOauthModelOptions([]);
    setLoadingOAuthModels(false);
  }, [selectedType, authMode]);

  // Keep refs to the latest values so event handlers see the current dialog state.
  const latestRef = React.useRef({ selectedType, typeInfo, onAdd, onClose, t });
  const pendingOAuthRef = React.useRef<{ accountId: string; label: string } | null>(null);
  useEffect(() => {
    latestRef.current = { selectedType, typeInfo, onAdd, onClose, t };
  });

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
      setValidationError(null);

      const { onClose: close, t: translate, selectedType: currentSelectedType } = latestRef.current;
      const payload = (data as { accountId?: string } | undefined) || undefined;
      const accountId = payload?.accountId || pendingOAuthRef.current?.accountId;

      // device-oauth.ts already saved the provider config to the backend,
      // including the dynamically resolved baseUrl for the region (e.g. CN vs Global).
      // If we call add() here with undefined baseUrl, it will overwrite and erase it!
      // So we just fetch the latest list from the backend to update the UI.
      try {
        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();

        // Auto-set as default if no default is currently configured
        if (!store.defaultAccountId && accountId) {
          await store.setDefaultAccount(accountId);
        }

        if (currentSelectedType === 'openai' && accountId) {
          setOauthAuthedAccountId(accountId);
          setLoadingOAuthModels(true);
          const options = await loadOAuthModelOptions('openai', 'oauth_browser');
          setOauthModelOptions(options);
          const matchedAccount = store.accounts.find((account) => account.id === accountId);
          const resolvedModel = pickOAuthModelSelection(
            'openai',
            options,
            matchedAccount?.model,
            latestRef.current.typeInfo?.defaultModelId,
          );
          setModelId(resolvedModel);
          setLoadingOAuthModels(false);
          pendingOAuthRef.current = null;
          toast.success(translate('aiProviders.oauth.authSucceeded'));
          return;
        }
      } catch (err) {
        console.error('Failed to refresh providers after OAuth:', err);
        setLoadingOAuthModels(false);
      }

      pendingOAuthRef.current = null;
      close();
      toast.success(translate('aiProviders.toast.added'));
    };

    const handleError = (data: unknown) => {
      setOauthError((data as { message: string }).message);
      setOauthData(null);
      setLoadingOAuthModels(false);
      setOauthAuthedAccountId(null);
      setOauthModelOptions([]);
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
  }, []);

  const handleStartOAuth = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setOauthFlowing(true);
    setOauthData(null);
    setOauthError(null);
    setOauthManualInput('');
    setOauthAuthedAccountId(null);
    setOauthModelOptions([]);
    setLoadingOAuthModels(false);

    try {
      const vendor = vendorMap.get(selectedType);
      const supportsMultipleAccounts = vendor?.supportsMultipleAccounts ?? selectedType === 'custom';
      const accountId = supportsMultipleAccounts ? `${selectedType}-${crypto.randomUUID()}` : selectedType;
      const label = name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType;
      pendingOAuthRef.current = { accountId, label };
      await hostApiFetch('/api/providers/oauth/start', {
        method: 'POST',
        body: JSON.stringify({
          provider: selectedType,
          accountId,
          label,
          model: selectedType === 'openai' ? undefined : resolveProviderModelForSave(typeInfo, modelId, devModeUnlocked),
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
    await hostApiFetch('/api/providers/oauth/cancel', {
      method: 'POST',
    });
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

  const availableTypes = PROVIDER_TYPE_INFO.filter((type) => {
    if (type.id === 'local-model') {
      return false;
    }

    const vendor = vendorMap.get(type.id);
    if (!vendor) {
      return !existingVendorIds.has(type.id);
    }
    return vendor.supportsMultipleAccounts || !existingVendorIds.has(type.id);
  });

  const handleAdd = async () => {
    if (!selectedType) return;

    if (selectedType === 'minimax-portal' && existingVendorIds.has('minimax-portal-cn')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }
    if (selectedType === 'minimax-portal-cn' && existingVendorIds.has('minimax-portal')) {
      toast.error(t('aiProviders.toast.minimaxConflict'));
      return;
    }

    setSaving(true);
    setValidationError(null);

    try {
      // Validate key first if the provider requires one and a key was entered
      const requiresKey = typeInfo?.requiresApiKey ?? false;
      if (requiresKey && !apiKey.trim()) {
        setValidationError(t('aiProviders.toast.invalidKey')); // reusing invalid key msg or should add 'required' msg? null checks
        setSaving(false);
        return;
      }
      if (requiresKey && apiKey) {
        const result = await onValidateKey(selectedType, apiKey, {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
        });
        if (!result.valid) {
          setValidationError(result.error || t('aiProviders.toast.invalidKey'));
          setSaving(false);
          return;
        }
      }

      const requiresModel = showModelIdField;
      if (requiresModel && !modelId.trim()) {
        setValidationError(t('aiProviders.toast.modelRequired'));
        setSaving(false);
        return;
      }

      if (useOpenAIOAuthModelPicker && oauthAuthedAccountId) {
        const accountLabel = name
          || typeInfo?.name
          || selectedType;
        const result = await hostApiFetch<{ success: boolean; error?: string }>(
          `/api/provider-accounts/${encodeURIComponent(oauthAuthedAccountId)}`,
          {
            method: 'PUT',
            body: JSON.stringify({
              updates: {
                label: accountLabel,
                model: modelId.trim(),
              },
            }),
          }
        );

        if (!result.success) {
          throw new Error(result.error || 'Failed to update OAuth provider');
        }

        const store = useProviderStore.getState();
        await store.refreshProviderSnapshot();
        onClose();
        toast.success(t('aiProviders.toast.added'));
        return;
      }

      await onAdd(
        selectedType,
        name || (typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name) || selectedType,
        apiKey.trim(),
        {
          baseUrl: baseUrl.trim() || undefined,
          apiProtocol: (selectedType === 'custom' || selectedType === 'ollama') ? apiProtocol : undefined,
          model: resolveProviderModelForSave(typeInfo, modelId, devModeUnlocked),
          authMode: useOAuthFlow ? (preferredOAuthMode || 'oauth_device') : (selectedType === 'ollama' || (selectedType === 'custom' && !apiKey.trim()))
            ? 'local'
            : (isOAuth && supportsApiKey && authMode === 'apikey')
              ? 'api_key'
              : vendorMap.get(selectedType)?.defaultAuthMode || 'api_key',
        }
      );
    } catch {
      // error already handled via toast in parent
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4">
      <Card className="w-full max-w-2xl max-h-[90vh] flex flex-col rounded-2xl bg-card dark:bg-card overflow-hidden">
        <CardHeader className="relative pb-2 shrink-0">
          <CardTitle className="text-2xl font-semibold">{t('aiProviders.dialog.title')}</CardTitle>
          <CardDescription className="text-[15px] mt-1 text-foreground/70">
            {t('aiProviders.dialog.desc')}
          </CardDescription>
          <Button
            variant="ghost"
            size="icon"
            className="absolute right-4 top-4 -mr-2 -mt-2 h-8 w-8 rounded-xl text-muted-foreground hover:bg-black/5 hover:text-foreground dark:hover:bg-white/5"
            onClick={onClose}
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
              {availableTypes.map((type) => (
                <button
                  key={type.id}
                  onClick={() => {
                    setSelectedType(type.id);
                    setName(type.id === 'custom' ? t('aiProviders.custom') : type.name);
                    setBaseUrl(type.defaultBaseUrl || '');
                    setModelId(normalizeOAuthSelectedModel(type.id, type.defaultModelId || ''));
                  }}
                  className="p-4 rounded-2xl border border-black/5 dark:border-white/5 hover:bg-black/5 dark:hover:bg-white/5 transition-colors text-center group"
                >
                  <div className="h-12 w-12 mx-auto mb-3 flex items-center justify-center bg-white dark:bg-card rounded-xl shadow-sm border border-black/5 dark:border-white/5 group-hover:scale-105 transition-transform">
                    {getProviderIconUrl(type.id) ? (
                      <img src={getProviderIconUrl(type.id)} alt={type.name} className="h-6 w-6" />
                    ) : (
                      <span className="text-2xl">{type.icon}</span>
                    )}
                  </div>
                  <p className="font-medium text-[13px]">{type.id === 'custom' ? t('aiProviders.custom') : type.name}</p>
                </button>
              ))}
            </div>
          ) : (
            <div className="space-y-6">
              <div className="flex items-center gap-3 p-4 rounded-2xl bg-white dark:bg-card border border-black/5 dark:border-white/5 shadow-sm">
                <div className="h-10 w-10 shrink-0 flex items-center justify-center bg-black/5 dark:bg-white/5 rounded-xl">
                  {getProviderIconUrl(selectedType!) ? (
                    <img src={getProviderIconUrl(selectedType!)} alt={typeInfo?.name} className="h-6 w-6" />
                  ) : (
                    <span className="text-xl">{typeInfo?.icon}</span>
                  )}
                </div>
                <div>
                  <p className="font-semibold text-[15px]">{typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}</p>
                  <button
                    onClick={() => {
                      setSelectedType(null);
                      setValidationError(null);
                      setBaseUrl('');
                      setModelId('');
                    }}
                    className="text-[13px] text-primary hover:text-primary/80 font-medium"
                  >
                    {t('aiProviders.dialog.change')}
                  </button>
                </div>
              </div>

              <div className="space-y-6 bg-transparent p-0">
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('aiProviders.dialog.displayName')}</Label>
                  <Input
                    id="name"
                    placeholder={typeInfo?.id === 'custom' ? t('aiProviders.custom') : typeInfo?.name}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className={inputClasses}
                  />
                </div>

                {/* Auth mode toggle for providers supporting both */}
                {isOAuth && supportsApiKey && (
                  <div className="flex rounded-xl border border-black/10 dark:border-white/10 overflow-hidden text-[13px] font-medium shadow-sm bg-muted/70 dark:bg-muted/40 p-1 gap-1">
                    <button
                      onClick={() => setAuthMode('oauth')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'oauth' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.loginMode')}
                    </button>
                    <button
                      onClick={() => setAuthMode('apikey')}
                      className={cn(
                        'flex-1 py-2 px-3 rounded-lg transition-colors',
                        authMode === 'apikey' ? 'bg-black/5 dark:bg-white/10 text-foreground' : 'text-muted-foreground hover:bg-black/5 dark:hover:bg-white/5'
                      )}
                    >
                      {t('aiProviders.oauth.apikeyMode')}
                    </button>
                  </div>
                )}

                {/* API Key input 闁?shown for non-OAuth providers or when apikey mode is selected */}
                {(!isOAuth || (supportsApiKey && authMode === 'apikey')) && (
                  <div className="space-y-2.5">
                    <div className="flex items-center justify-between">
                      <Label htmlFor="apiKey" className={labelClasses}>{t('aiProviders.dialog.apiKey')}</Label>
                      {typeInfo?.apiKeyUrl && (
                        <a
                          href={typeInfo.apiKeyUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[13px] text-primary hover:text-primary/80 font-medium flex items-center gap-1"
                          tabIndex={-1}
                        >
                          {t('aiProviders.oauth.getApiKey')} <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="relative">
                      <Input
                        id="apiKey"
                        type={showKey ? 'text' : 'password'}
                        placeholder={(typeInfo?.id === 'ollama' || typeInfo?.id === 'custom') ? t('aiProviders.notRequired') : typeInfo?.placeholder}
                        value={apiKey}
                        onChange={(e) => {
                          setApiKey(e.target.value);
                          setValidationError(null);
                        }}
                        className={inputClasses}
                      />
                      <button
                        type="button"
                        onClick={() => setShowKey(!showKey)}
                        className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                      >
                        {showKey ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
                      </button>
                    </div>
                    {validationError && (
                      <p className="text-[13px] text-red-500 font-medium">{validationError}</p>
                    )}
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.dialog.apiKeyStored')}
                    </p>
                  </div>
                )}

                {typeInfo?.showBaseUrl && (
                  <div className="space-y-2.5">
                    <Label htmlFor="baseUrl" className={labelClasses}>{t('aiProviders.dialog.baseUrl')}</Label>
                    <Input
                      id="baseUrl"
                      placeholder={apiProtocol === 'anthropic-messages' ? "https://api.example.com/anthropic" : "https://api.example.com/v1"}
                      value={baseUrl}
                      onChange={(e) => setBaseUrl(e.target.value)}
                      className={inputClasses}
                    />
                  </div>
                )}

                {showEditableModelField && (
                  <div className="space-y-2.5">
                    <Label htmlFor="modelId" className={labelClasses}>{t('aiProviders.dialog.modelId')}</Label>
                    <Input
                      id="modelId"
                      placeholder={typeInfo?.modelIdPlaceholder || 'provider/model-id'}
                      value={modelId}
                      onChange={(e) => {
                        setModelId(normalizeOAuthSelectedModel(selectedType, e.target.value));
                        setValidationError(null);
                      }}
                      className={inputClasses}
                    />
                  </div>
                )}
                {useOpenAIOAuthModelPicker && oauthAuthedAccountId && (
                  <div className="space-y-2.5">
                    <Label htmlFor="oauthModelId" className={labelClasses}>{t('aiProviders.dialog.model')}</Label>
                    <select
                      id="oauthModelId"
                      value={modelId}
                      onChange={(e) => {
                        setModelId(e.target.value);
                        setValidationError(null);
                      }}
                      className={cn(inputClasses, 'font-sans')}
                      disabled={loadingOAuthModels}
                    >
                      {oauthModelOptions.map((option) => (
                        <option key={option.id} value={option.id}>
                          {option.name}
                        </option>
                      ))}
                    </select>
                    <p className="text-[12px] text-muted-foreground">
                      {t('aiProviders.oauth.modelAfterLogin')}
                    </p>
                  </div>
                )}
                {selectedType === 'custom' && (
                  <div className="space-y-2.5">
                    <Label className={labelClasses}>{t('aiProviders.dialog.protocol', 'Protocol')}</Label>
                    <div className="flex gap-2 text-[13px]">
                      <button
                        type="button"
                        onClick={() => setApiProtocol('openai-completions')}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'openai-completions' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.protocols.openai', 'OpenAI')}
                      </button>
                      <button
                        type="button"
                        onClick={() => setApiProtocol('anthropic-messages')}
                        className={cn("flex-1 py-1.5 px-3 rounded-lg border transition-colors", apiProtocol === 'anthropic-messages' ? "bg-white dark:bg-card border-black/20 dark:border-white/20 shadow-sm font-medium" : "border-transparent bg-black/5 dark:bg-white/5 text-muted-foreground hover:bg-black/10 dark:hover:bg-white/10")}
                      >
                        {t('aiProviders.protocols.anthropic', 'Anthropic')}
                      </button>
                    </div>
                  </div>
                )}
                {/* Device OAuth Trigger 闁?only shown when in OAuth mode */}
                {useOAuthFlow && (
                  <div className="space-y-4 pt-2">
                    <div className="rounded-xl bg-blue-500/10 border border-blue-500/20 p-5 text-center">
                      <p className="text-[13px] font-medium text-blue-600 dark:text-blue-400 mb-4 block">
                        {oauthAuthedAccountId
                          ? t('aiProviders.oauth.loginCompleted')
                          : t('aiProviders.oauth.loginPrompt')}
                      </p>
                      <Button
                        onClick={handleStartOAuth}
                        disabled={oauthFlowing || Boolean(oauthAuthedAccountId)}
                        className="h-[42px] w-full rounded-xl bg-primary text-primary-foreground shadow-sm hover:bg-primary/90"
                      >
                        {oauthFlowing ? (
                          <><LoadingIcon className="h-4 w-4 mr-2" />{t('aiProviders.oauth.waiting')}</>
                        ) : oauthAuthedAccountId ? (
                          t('aiProviders.oauth.loggedIn')
                        ) : (
                          t('aiProviders.oauth.loginButton')
                        )}
                      </Button>
                    </div>

                    {/* OAuth Active State Modal / Inline View */}
                    {oauthFlowing && (
                      <div className="mt-4 p-5 border border-black/10 dark:border-white/10 rounded-2xl bg-white dark:bg-card shadow-sm relative overflow-hidden">
                        {/* Background pulse effect */}
                        <div className="absolute inset-0 bg-blue-500/5 animate-pulse" />

                        <div className="relative z-10 flex flex-col items-center justify-center text-center space-y-5">
                          {oauthError ? (
                            <div className="text-red-500 space-y-3">
                              <XCircle className="h-10 w-10 mx-auto" />
                              <p className="font-semibold text-[15px]">{t('aiProviders.oauth.authFailed')}</p>
                              <p className="text-[13px] opacity-80">{oauthError}</p>
                              <Button variant="outline" size="sm" onClick={handleCancelOAuth} className="mt-2 h-9 rounded-xl px-6">
                                {t('aiProviders.oauth.tryAgain')}
                              </Button>
                            </div>
                          ) : !oauthData ? (
                            <div className="space-y-4 py-6">
                              <LoadingIcon className="h-10 w-10 text-blue-500 mx-auto" />
                              <p className="text-[13px] font-medium text-muted-foreground animate-pulse">{t('aiProviders.oauth.requestingCode')}</p>
                            </div>
                          ) : oauthData.mode === 'browser' ? (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.browserApproveTitle')}</h3>
                                <div className="text-[13px] text-muted-foreground text-left mt-2 space-y-1.5 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  <p>{t('aiProviders.oauth.browserApproveDesc')}</p>
                                  <p>{t('aiProviders.oauth.browserApproveHint')}</p>
                                </div>
                              </div>

                              {oauthData.verificationUri ? (
                                <Button
                                  variant="secondary"
                                  className="w-full rounded-full h-[42px] font-semibold"
                                  onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                                >
                                  <ExternalLink className="h-4 w-4 mr-2" />
                                  {t('aiProviders.oauth.openLoginPage')}
                                </Button>
                              ) : null}

                              {oauthData.manualInputRequired ? (
                                <div className="space-y-3 text-left">
                                  <p className="text-[13px] font-medium text-foreground">
                                    {oauthData.promptMessage || t('aiProviders.oauth.manualPrompt')}
                                  </p>
                                  <Input
                                    value={oauthManualInput}
                                    onChange={(event) => setOauthManualInput(event.target.value)}
                                    placeholder={oauthData.placeholder || t('aiProviders.oauth.manualPlaceholder')}
                                    className={inputClasses}
                                  />
                                  <Button
                                    className="h-[42px] w-full rounded-xl bg-primary text-primary-foreground hover:bg-primary/90"
                                    onClick={handleSubmitOAuthManualInput}
                                    disabled={!oauthManualInput.trim()}
                                  >
                                    {t('aiProviders.oauth.manualSubmit')}
                                  </Button>
                                </div>
                              ) : null}

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <LoadingIcon className="h-4 w-4 text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="h-[42px] w-full rounded-xl text-muted-foreground" onClick={handleCancelOAuth}>
                                {t('aiProviders.oauth.cancel')}
                              </Button>
                            </div>
                          ) : (
                            <div className="space-y-5 w-full">
                              <div className="space-y-2">
                                <h3 className="font-semibold text-[16px] text-foreground">{t('aiProviders.oauth.approveLogin')}</h3>
                                <div className="text-[13px] text-muted-foreground text-left mt-2 space-y-1.5 bg-black/5 dark:bg-white/5 p-4 rounded-xl">
                                  <p>1. {t('aiProviders.oauth.step1')}</p>
                                  <p>2. {t('aiProviders.oauth.step2')}</p>
                                  <p>3. {t('aiProviders.oauth.step3')}</p>
                                </div>
                              </div>

                              <div className="flex items-center justify-center gap-3 p-4 bg-muted/70 dark:bg-muted/40 border border-black/5 dark:border-white/5 rounded-xl shadow-inner">
                                <code className="text-3xl font-mono tracking-[0.2em] font-bold text-foreground">
                                  {oauthData.userCode}
                                </code>
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="h-10 w-10 rounded-xl hover:bg-black/5 dark:hover:bg-white/10"
                                  onClick={() => {
                                    navigator.clipboard.writeText(oauthData.userCode || '');
                                    toast.success(t('aiProviders.oauth.codeCopied'));
                                  }}
                                >
                                  <Copy className="h-5 w-5" />
                                </Button>
                              </div>

                              <Button
                                variant="secondary"
                                className="h-[42px] w-full rounded-xl"
                                onClick={() => invokeIpc('shell:openExternal', oauthData.verificationUri)}
                              >
                                <ExternalLink className="h-4 w-4 mr-2" />
                                {t('aiProviders.oauth.openLoginPage')}
                              </Button>

                              <div className="flex items-center justify-center gap-2 text-[13px] font-medium text-muted-foreground pt-2">
                                <LoadingIcon className="h-4 w-4 text-blue-500" />
                                <span>{t('aiProviders.oauth.waitingApproval')}</span>
                              </div>

                              <Button variant="ghost" className="h-[42px] w-full rounded-xl text-muted-foreground" onClick={handleCancelOAuth}>
                                {t('aiProviders.oauth.cancel')}
                              </Button>
                            </div>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex justify-end gap-3">
                <Button
                  onClick={handleAdd}
                  className={cn(
                    "h-[42px] rounded-xl px-8 text-[13px] font-semibold bg-primary text-primary-foreground shadow-sm hover:bg-primary/90",
                    useOAuthFlow && !oauthAuthedAccountId && "hidden",
                  )}
                  disabled={
                    !selectedType
                    || saving
                    || ((showEditableModelField || useOpenAIOAuthModelPicker) && modelId.trim().length === 0)
                  }
                >
                  {saving ? (
                    <LoadingIcon className="h-4 w-4 mr-2" />
                  ) : null}
                  {useOpenAIOAuthModelPicker ? t('aiProviders.dialog.save') : t('aiProviders.dialog.add')}
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
