import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import {
  X,
  QrCode,
  Eye,
  EyeOff,
  Check,
  AlertCircle,
  CheckCircle,
  ShieldCheck,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Separator } from '@/components/ui/separator';
import { Badge } from '@/components/ui/badge';
import { LoadingIcon } from '@/components/common/LoadingSpinner';
import { useChannelsStore } from '@/stores/channels';
import { useGatewayStore } from '@/stores/gateway';
import { useRuntimeApplyStore } from '@/stores/runtime-apply';
import { hostApiFetch } from '@/lib/host-api';
import { subscribeHostEvent } from '@/lib/host-events';
import { buildQrChannelEventName, usesPluginManagedQrAccounts } from '@/lib/channel-alias';
import { cn } from '@/lib/utils';
import {
  CHANNEL_ICONS,
  CHANNEL_NAMES,
  CHANNEL_META,
  getPrimaryChannels,
  channelSupportsMultipleAccounts,
  type ChannelType,
  type ChannelMeta,
  type ChannelConfigField,
} from '@/types/channel';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import telegramIcon from '@/assets/channels/telegram.svg';
import discordIcon from '@/assets/channels/discord.svg';
import whatsappIcon from '@/assets/channels/whatsapp.svg';
import dingtalkIcon from '@/assets/channels/dingtalk.svg';
import feishuIcon from '@/assets/channels/feishu.svg';
import wechatIcon from '@/assets/channels/wechat.svg';
import wecomIcon from '@/assets/channels/wecom.svg';
import qqIcon from '@/assets/channels/qq.svg';

const CHANNEL_BRAND_STYLES: Partial<Record<ChannelType, { shell: string; icon: string }>> = {
  telegram: {
    shell: 'bg-[#27A7E7] border-[#1f8ec7] shadow-[0_10px_24px_rgba(39,167,231,0.22)]',
    icon: 'brightness-0 invert',
  },
  discord: {
    shell: 'bg-[#5865F2] border-[#4752c4] shadow-[0_10px_24px_rgba(88,101,242,0.22)]',
    icon: 'brightness-0 invert',
  },
  whatsapp: {
    shell: 'bg-[#25D366] border-[#1faf54] shadow-[0_10px_24px_rgba(37,211,102,0.2)]',
    icon: 'brightness-0 invert',
  },
  wechat: {
    shell: 'bg-[#07C160] border-[#059c4e] shadow-[0_10px_24px_rgba(7,193,96,0.22)]',
    icon: '',
  },
  feishu: {
    shell: 'bg-[linear-gradient(135deg,#0F67FF,#00C2FF)] border-[#0f67ff] shadow-[0_10px_24px_rgba(15,103,255,0.22)]',
    icon: 'brightness-0 invert',
  },
  dingtalk: {
    shell: 'bg-[#1677FF] border-[#0f5fd1] shadow-[0_10px_24px_rgba(22,119,255,0.22)]',
    icon: 'brightness-0 invert',
  },
  wecom: {
    shell: 'bg-[linear-gradient(135deg,#07C160,#00A1EA)] border-[#07c160] shadow-[0_10px_24px_rgba(7,193,96,0.22)]',
    icon: 'brightness-0 invert',
  },
  qqbot: {
    shell: 'bg-[linear-gradient(135deg,#12B7F5,#4E8CFF)] border-[#12b7f5] shadow-[0_10px_24px_rgba(18,183,245,0.22)]',
    icon: 'brightness-0 invert',
  },
};

interface ChannelConfigModalProps {
  initialSelectedType?: ChannelType | null;
  initialAccountId?: string | null;
  initialCreateNewAccount?: boolean;
  configuredTypes?: string[];
  showChannelName?: boolean;
  allowExistingConfig?: boolean;
  onClose: () => void;
  onChannelSaved?: (channelType: ChannelType, accountId?: string) => void | Promise<void>;
}

async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, message: string): Promise<T> {
  return await Promise.race([
    promise,
    new Promise<T>((_, reject) => {
      setTimeout(() => reject(new Error(message)), timeoutMs);
    }),
  ]);
}

const inputClasses = 'h-[44px] rounded-xl font-mono text-[13px] bg-muted/70 dark:bg-muted/40 border-black/10 dark:border-white/10 focus-visible:ring-2 focus-visible:ring-blue-500/50 focus-visible:border-blue-500 shadow-sm transition-all text-foreground placeholder:text-foreground/40';
const labelClasses = 'text-[14px] text-foreground/80 font-bold';
const outlineButtonClasses = 'h-9 text-[13px] font-medium rounded-xl px-4 border-black/10 dark:border-white/10 bg-transparent hover:bg-black/5 dark:hover:bg-white/5 shadow-none text-foreground/80 hover:text-foreground';
const primaryButtonClasses = 'h-9 rounded-xl px-4 text-[13px] font-semibold bg-blue-600 text-white hover:bg-blue-700 shadow-[0_10px_24px_rgba(37,99,235,0.26)]';

export function ChannelConfigModal({
  initialSelectedType = null,
  initialAccountId = null,
  initialCreateNewAccount = false,
  configuredTypes = [],
  showChannelName = true,
  allowExistingConfig = true,
  onClose,
  onChannelSaved,
}: ChannelConfigModalProps) {
  const { t } = useTranslation('channels');
  const { channels, addChannel, fetchChannels } = useChannelsStore();
  const setGatewayOverlaySuppressed = useGatewayStore((state) => state.setOverlaySuppressed);
  const [selectedType, setSelectedType] = useState<ChannelType | null>(initialSelectedType);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(initialAccountId);
  const [createNewAccount, setCreateNewAccount] = useState(initialCreateNewAccount);
  const [accountIdInput, setAccountIdInput] = useState(
    initialCreateNewAccount ? '' : (initialAccountId && initialAccountId !== 'default' ? initialAccountId : 'default'),
  );
  const [configValues, setConfigValues] = useState<Record<string, string>>({});
  const [channelName, setChannelName] = useState('');
  const [connecting, setConnecting] = useState(false);
  const [showSecrets, setShowSecrets] = useState<Record<string, boolean>>({});
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [validating, setValidating] = useState(false);
  const [loadingConfig, setLoadingConfig] = useState(false);
  const [isExistingConfig, setIsExistingConfig] = useState(false);
  const firstInputRef = useRef<HTMLInputElement>(null);
  const [validationResult, setValidationResult] = useState<{
    valid: boolean;
    errors: string[];
    warnings: string[];
  } | null>(null);
  const [validatedSignature, setValidatedSignature] = useState<string | null>(null);

  const meta: ChannelMeta | null = selectedType ? CHANNEL_META[selectedType] : null;
  const supportsMultipleAccounts = !!selectedType && channelSupportsMultipleAccounts(selectedType);
  const usesManagedQrAccounts = usesPluginManagedQrAccounts(selectedType);
  const normalizedAccountIdInput = accountIdInput.trim();
  const isEditingDefaultAccount = !createNewAccount && (!selectedAccountId || selectedAccountId === 'default');
  const requiresNamedAccountId = !!selectedType && supportsMultipleAccounts && createNewAccount && !usesManagedQrAccounts;
  const configSignature = useMemo(
    () => JSON.stringify({
      selectedType,
      createNewAccount,
      accountId: requiresNamedAccountId ? normalizedAccountIdInput : (selectedAccountId || 'default'),
      values: configValues,
    }),
    [configValues, createNewAccount, normalizedAccountIdInput, requiresNamedAccountId, selectedAccountId, selectedType],
  );

  useEffect(() => {
    setSelectedType(initialSelectedType);
    setSelectedAccountId(initialAccountId);
    setCreateNewAccount(initialCreateNewAccount);
    setAccountIdInput(
      initialCreateNewAccount
        ? ''
        : (initialAccountId && initialAccountId !== 'default' ? initialAccountId : 'default'),
    );
  }, [initialAccountId, initialCreateNewAccount, initialSelectedType]);

  useEffect(() => {
    const suppress = selectedType === 'wechat' && (connecting || Boolean(qrCode));
    setGatewayOverlaySuppressed(suppress);
    return () => {
      setGatewayOverlaySuppressed(false);
    };
  }, [connecting, qrCode, selectedType, setGatewayOverlaySuppressed]);

  useEffect(() => {
    if (!selectedType) {
      setConfigValues({});
      setChannelName('');
      setIsExistingConfig(false);
      setValidationResult(null);
      setValidatedSignature(null);
      setQrCode(null);
      setConnecting(false);
      hostApiFetch('/api/channels/whatsapp/cancel', { method: 'POST' }).catch(() => {});
      return;
    }

    const shouldLoadExistingConfig =
      allowExistingConfig && configuredTypes.includes(selectedType) && !createNewAccount;
    if (!shouldLoadExistingConfig) {
      setConfigValues(
        !usesManagedQrAccounts && selectedAccountId && selectedAccountId !== 'default' ? { __accountId: selectedAccountId } : {},
      );
      setIsExistingConfig(false);
      setLoadingConfig(false);
      setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');
      setValidationResult(null);
      setValidatedSignature(null);
      return;
    }

    let cancelled = false;
    setLoadingConfig(true);
    setChannelName(showChannelName ? CHANNEL_NAMES[selectedType] : '');

    (async () => {
      try {
        const result = await hostApiFetch<{ success: boolean; values?: Record<string, string> }>(
          `/api/channels/config/${encodeURIComponent(selectedType)}${selectedAccountId ? `?accountId=${encodeURIComponent(selectedAccountId)}` : ''}`
        );
        if (cancelled) return;

        if (result.success && result.values && Object.keys(result.values).length > 0) {
          setConfigValues(result.values);
          setSelectedAccountId(result.values.__accountId || selectedAccountId);
          setAccountIdInput(result.values.__accountId || selectedAccountId || 'default');
          setIsExistingConfig(true);
        } else {
          setConfigValues(
            !usesManagedQrAccounts && selectedAccountId && selectedAccountId !== 'default' ? { __accountId: selectedAccountId } : {},
          );
          setIsExistingConfig(false);
        }
      } catch {
        if (!cancelled) {
          setConfigValues(
            !usesManagedQrAccounts && selectedAccountId && selectedAccountId !== 'default' ? { __accountId: selectedAccountId } : {},
          );
          setIsExistingConfig(false);
        }
      } finally {
        if (!cancelled) setLoadingConfig(false);
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [allowExistingConfig, configuredTypes, createNewAccount, selectedAccountId, selectedType, showChannelName, usesManagedQrAccounts]);

  useEffect(() => {
    setValidationResult((current) => (validatedSignature && current ? current : null));
  }, [validatedSignature]);

  useEffect(() => {
    if (validatedSignature && validatedSignature !== configSignature) {
      setValidatedSignature(null);
      setValidationResult(null);
    }
  }, [configSignature, validatedSignature]);

  useEffect(() => {
    if (selectedType && !loadingConfig && showChannelName && firstInputRef.current) {
      firstInputRef.current.focus();
    }
  }, [selectedType, loadingConfig, showChannelName]);

  const finishSave = useCallback(async (channelType: ChannelType, savedAccountId?: string) => {
    try {
      const displayName = showChannelName && channelName.trim()
        ? channelName.trim()
        : CHANNEL_NAMES[channelType];
      const existingChannel = channels.find((channel) => channel.type === channelType);

      if (!existingChannel) {
        await addChannel({
          type: channelType,
          name: displayName,
        });
      } else {
        await fetchChannels(false, { includeRuntime: false });
      }

      await onChannelSaved?.(channelType, savedAccountId);
    } catch (error) {
      console.error('post-save channel refresh failed', error);
      toast.warning(t('toast.channelSavedRefreshPending', {
        name: CHANNEL_NAMES[channelType],
        defaultValue: `${CHANNEL_NAMES[channelType]} 已保存，列表会在稍后自动同步`,
      }));
    }
  }, [addChannel, channelName, channels, fetchChannels, onChannelSaved, showChannelName, t]);

  useEffect(() => {
    if (!selectedType || meta?.connectionType !== 'qr') return;
    const channelType = selectedType;

    const onQr = (...args: unknown[]) => {
      const data = args[0] as { qr?: string; raw?: string };
      const source = data.qr || data.raw || '';
      if (!source) return;
      setQrCode(
        source.startsWith('data:image') || source.startsWith('http://') || source.startsWith('https://')
          ? source
          : `data:image/png;base64,${source}`,
      );
      setConnecting(false);
    };

    const onSuccess = async (...args: unknown[]) => {
      const payload = (args[0] && typeof args[0] === 'object' ? args[0] : null) as { accountId?: string } | null;
      const savedAccountId = payload?.accountId?.trim() || undefined;
      toast.success(t(channelType === 'wechat' ? 'toast.wechatConnected' : 'toast.whatsappConnected'));
      try {
        if (channelType === 'whatsapp') {
          const saveResult = await hostApiFetch<{ success?: boolean; error?: string }>('/api/channels/config', {
            method: 'POST',
            body: JSON.stringify({ channelType: 'whatsapp', config: { enabled: true } }),
          });
          if (!saveResult?.success) {
            throw new Error(saveResult?.error || 'Failed to save WhatsApp config');
          }
          await useRuntimeApplyStore.getState().refreshPlan();
        }
        if (savedAccountId) {
          setSelectedAccountId(savedAccountId);
        }
        await finishSave(channelType, savedAccountId);
        onClose();
      } catch (error) {
        toast.error(t('toast.configFailed', { error: String(error) }));
        setConnecting(false);
      }
    };

    const onError = (...args: unknown[]) => {
      const err = args[0] as string;
      toast.error(t(channelType === 'wechat' ? 'toast.wechatFailed' : 'toast.whatsappFailed', { error: err }));
      setQrCode(null);
      setConnecting(false);
    };

    const removeQrListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'qr'), onQr);
    const removeSuccessListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'success'), onSuccess);
    const removeErrorListener = subscribeHostEvent(buildQrChannelEventName(channelType, 'error'), onError);

    return () => {
      removeQrListener();
      removeSuccessListener();
      removeErrorListener();
      hostApiFetch(`/api/channels/${encodeURIComponent(channelType)}/cancel`, {
        method: 'POST',
        body: JSON.stringify(usesManagedQrAccounts && selectedAccountId ? { accountId: selectedAccountId } : {}),
      }).catch(() => {});
    };
  }, [finishSave, meta?.connectionType, onClose, selectedAccountId, selectedType, t, usesManagedQrAccounts]);


  const handleValidate = async () => {
    if (!selectedType) return;

    setValidating(true);
    setValidationResult(null);

    try {
      const result = await withTimeout(hostApiFetch<{
        success: boolean;
        valid?: boolean;
        errors?: string[];
        warnings?: string[];
        details?: Record<string, string>;
      }>('/api/channels/credentials/validate', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config: configValues }),
      }), 10000, t('toast.validateTimedOut', '验证请求超时，请重试'));

      const warnings = result.warnings || [];
      if (result.valid && result.details) {
        const details = result.details;
        if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
        if (details.guildName) warnings.push(`Server: ${details.guildName}`);
        if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
      }

      setValidationResult({
        valid: result.valid || false,
        errors: result.errors || [],
        warnings,
      });
      setValidatedSignature(result.valid ? configSignature : null);
    } catch (error) {
      setValidationResult({
        valid: false,
        errors: [String(error)],
        warnings: [],
      });
      setValidatedSignature(null);
    } finally {
      setValidating(false);
    }
  };

  const handleConnect = async () => {
    if (!selectedType || !meta) return;
    if (requiresNamedAccountId && !normalizedAccountIdInput) {
      toast.error(t('dialog.accountIdRequired', '请先填写账户 ID'));
      return;
    }
    if (requiresNamedAccountId && normalizedAccountIdInput === 'default') {
      toast.error(t('dialog.accountIdReserved', 'default 已保留给默认账户，请使用其他账户 ID'));
      return;
    }

    setConnecting(true);
    setValidationResult(null);

    try {
      if (selectedType === 'wechat') {
        const payload = !createNewAccount && selectedAccountId
          ? { accountId: selectedAccountId }
          : undefined;
        await hostApiFetch('/api/channels/wechat/start', {
          method: 'POST',
          body: payload ? JSON.stringify(payload) : undefined,
        });
        return;
      }

      if (meta.connectionType === 'qr') {
        await hostApiFetch('/api/channels/whatsapp/start', {
          method: 'POST',
          body: JSON.stringify({ accountId: 'default' }),
        });
        return;
      }

      if (meta.connectionType === 'token' && validatedSignature !== configSignature) {
        const validationResponse = await withTimeout(hostApiFetch<{
          success: boolean;
          valid?: boolean;
          errors?: string[];
          warnings?: string[];
          details?: Record<string, string>;
        }>('/api/channels/credentials/validate', {
          method: 'POST',
          body: JSON.stringify({ channelType: selectedType, config: configValues }),
        }), 10000, t('toast.validateTimedOut', '验证请求超时，请重试'));

        if (!validationResponse.valid) {
          setValidationResult({
            valid: false,
            errors: validationResponse.errors || ['Validation failed'],
            warnings: validationResponse.warnings || [],
          });
          setValidatedSignature(null);
          setConnecting(false);
          return;
        }

        const warnings = validationResponse.warnings || [];
        if (validationResponse.details) {
          const details = validationResponse.details;
          if (details.botUsername) warnings.push(`Bot: @${details.botUsername}`);
          if (details.guildName) warnings.push(`Server: ${details.guildName}`);
          if (details.channelName) warnings.push(`Channel: #${details.channelName}`);
        }

        setValidationResult({
          valid: true,
          errors: [],
          warnings,
        });
        setValidatedSignature(configSignature);
      }

      const config: Record<string, unknown> = { ...configValues };
      if (supportsMultipleAccounts && normalizedAccountIdInput && normalizedAccountIdInput !== 'default') {
        config.__accountId = normalizedAccountIdInput;
      } else {
        delete config.__accountId;
      }
      const saveResult = await withTimeout(hostApiFetch<{
        success?: boolean;
        error?: string;
        warning?: string;
      }>('/api/channels/config', {
        method: 'POST',
        body: JSON.stringify({ channelType: selectedType, config }),
      }), 15000, t('toast.saveTimedOut', '保存请求超时，请稍后重试'));
      if (!saveResult?.success) {
        throw new Error(saveResult?.error || 'Failed to save channel config');
      }
      if (typeof saveResult.warning === 'string' && saveResult.warning) {
        toast.warning(saveResult.warning);
      }

      await useRuntimeApplyStore.getState().refreshPlan();
      toast.success(t('toast.channelSaved', { name: meta.name }));
      toast.success(t('toast.channelConnecting', { name: meta.name }));
      void finishSave(selectedType);
      onClose();
    } catch (error) {
      toast.error(t('toast.configFailed', { error: String(error) }));
      setConnecting(false);
    }
  };

  const isFormValid = () => {
    if (!meta) return false;
    const fieldsValid = meta.configFields
      .filter((field) => field.required)
      .every((field) => configValues[field.key]?.trim());
    if (!fieldsValid) return false;
    if (requiresNamedAccountId) {
      return normalizedAccountIdInput.length > 0 && normalizedAccountIdInput !== 'default';
    }
    return true;
  };

  const updateConfigValue = (key: string, value: string) => {
    setConfigValues((prev) => ({ ...prev, [key]: value }));
  };

  const toggleSecretVisibility = (key: string) => {
    setShowSecrets((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  return (
    <div className="fixed inset-0 z-50 bg-black/50 flex items-center justify-center p-4" onClick={onClose}>
      <Card
        className="w-full max-w-3xl max-h-[90vh] flex flex-col rounded-2xl bg-card overflow-hidden"
        onClick={(event) => event.stopPropagation()}
      >
        <CardHeader className="flex flex-row items-start justify-between pb-2 shrink-0">
          <div>
            <CardTitle className="text-2xl font-semibold tracking-tight">
              {selectedType
                ? isExistingConfig
                  ? t('dialog.updateTitle', { name: CHANNEL_NAMES[selectedType] })
                  : t('dialog.configureTitle', { name: CHANNEL_NAMES[selectedType] })
                : t('dialog.addTitle')}
            </CardTitle>
            <CardDescription className="text-[15px] mt-1 text-foreground/70">
              {selectedType && isExistingConfig
                ? t('dialog.existingDesc')
                : meta ? t(meta.description.replace('channels:', '')) : t('dialog.selectDesc')}
            </CardDescription>
          </div>
          <Button
            variant="ghost"
            size="icon"
            onClick={onClose}
            className="rounded-xl h-8 w-8 -mr-2 -mt-2 text-muted-foreground hover:text-foreground hover:bg-black/5 dark:hover:bg-white/5"
          >
            <X className="h-4 w-4" />
          </Button>
        </CardHeader>
        <CardContent className="space-y-6 pt-4 overflow-y-auto flex-1 p-6">
          {!selectedType ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              {getPrimaryChannels().map((type) => {
                const channelMeta = CHANNEL_META[type];
                const isConfigured = configuredTypes.includes(type);
                return (
                  <button
                    key={type}
                    onClick={() => {
                      setSelectedType(type);
                      setSelectedAccountId(null);
                    }}
                    className={cn(
                      'group flex items-start gap-4 p-4 rounded-2xl transition-all text-left border relative overflow-hidden bg-muted/70 dark:bg-muted/40 shadow-sm',
                      isConfigured
                        ? 'border-green-500/40 bg-green-500/5 dark:bg-green-500/10'
                        : 'border-black/5 dark:border-white/10 hover:bg-black/5 dark:hover:bg-white/5'
                    )}
                  >
                    <ChannelLogo type={type} branded />
                    <div className="flex flex-col flex-1 min-w-0 py-0.5 mt-1">
                      <div className="flex items-center gap-2 mb-1">
                        <p className="text-[16px] font-semibold text-foreground truncate">{channelMeta.name}</p>
                        {channelMeta.isPlugin && (
                          <Badge
                            variant="secondary"
                            className="font-mono text-[10px] font-medium px-2 py-0.5 rounded-xl bg-black/[0.04] dark:bg-white/[0.08] border-0 shadow-none text-foreground/70"
                          >
                            {t('pluginBadge')}
                          </Badge>
                        )}
                      </div>
                      <p className="text-[13.5px] text-muted-foreground line-clamp-2 leading-[1.5]">
                        {t(channelMeta.description.replace('channels:', ''))}
                      </p>
                      <p className="text-[12px] font-medium text-muted-foreground/80 mt-2">
                        {channelMeta.connectionType === 'qr' ? t('dialog.qrCode') : t('dialog.token')}
                      </p>
                    </div>
                    {isConfigured && (
                      <Badge className="absolute top-3 right-3 text-[10px] font-medium rounded-xl bg-green-600 hover:bg-green-600">
                        {t('configuredBadge')}
                      </Badge>
                    )}
                  </button>
                );
              })}
            </div>
          ) : qrCode ? (
            <div className="space-y-6 text-center">
              <div className="inline-block rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
                {qrCode.startsWith('data:image') ? (
                  <img src={qrCode} alt="Scan QR Code" className="w-64 h-64 object-contain rounded-2xl" />
                ) : (
                  <div className="w-64 h-64 bg-white dark:bg-background rounded-2xl flex items-center justify-center">
                    <QrCode className="h-32 w-32 text-gray-400" />
                  </div>
                )}
              </div>
              <p className="text-[14px] text-muted-foreground">
                {t('dialog.scanQR', { name: meta?.name })}
              </p>
              <div className="flex justify-center gap-2">
                <Button
                  variant="outline"
                  className={outlineButtonClasses}
                  onClick={() => {
                    setQrCode(null);
                    void handleConnect();
                  }}
                >
                  {t('dialog.refreshCode')}
                </Button>
              </div>
            </div>
          ) : loadingConfig ? (
            <div className="flex items-center justify-center rounded-2xl border border-border/70 bg-card/85 py-10">
              <LoadingIcon className="h-6 w-6 text-muted-foreground" />
              <span className="ml-2 text-[14px] text-muted-foreground">{t('dialog.loadingConfig')}</span>
            </div>
          ) : (
            <div className="space-y-6">
              {isExistingConfig && (
                <div className="bg-blue-500/10 text-blue-600 dark:text-blue-400 p-4 rounded-2xl text-[13.5px] flex items-center gap-2 border border-blue-500/20">
                  <CheckCircle className="h-4 w-4 shrink-0" />
                  <span>{t('dialog.existingHint')}</span>
                </div>
              )}

              {(selectedAccountId || createNewAccount) && (
                <div className="bg-muted/70 text-foreground/75 p-4 rounded-2xl text-[13.5px] flex items-center gap-2 border border-border/70">
                  <ShieldCheck className="h-4 w-4 shrink-0" />
                  <span>
                    {createNewAccount
                      ? t('dialog.newAccountHint', '正在创建一个新的命名账户')
                      : t('dialog.accountHint', {
                          accountId: selectedAccountId,
                          defaultValue: `当前编辑账户：${selectedAccountId}`,
                        })}
                  </span>
                </div>
              )}

              {supportsMultipleAccounts && !usesManagedQrAccounts && (
                <div className="space-y-2.5">
                  <Label htmlFor="accountId" className={labelClasses}>
                    {t('dialog.accountIdLabel', '账户 ID')}
                  </Label>
                  <Input
                    id="accountId"
                    placeholder={t('dialog.accountIdPlaceholder', '例如 default、work、bot2')}
                    value={accountIdInput}
                    readOnly={!createNewAccount}
                    onChange={(event) => setAccountIdInput(event.target.value)}
                    className={inputClasses}
                  />
                  <p className="text-[12px] leading-[1.5] text-muted-foreground">
                    {createNewAccount
                      ? t(
                          'dialog.accountIdDescriptionCreate',
                          'OpenClaw 会把该账户保存到此连接类型的 accounts.<id> 下。default 保留给默认账户。',
                        )
                      : isEditingDefaultAccount
                        ? t(
                            'dialog.accountIdDescriptionDefault',
                            '默认账户使用顶层配置，账户 ID 固定为 default。',
                          )
                        : t(
                            'dialog.accountIdDescriptionEdit',
                            '已存在账户的账户 ID 不能直接修改；如需更换，请新建账户后删除旧账户。',
                          )}
                  </p>
                </div>
              )}

              <div className="space-y-4 rounded-2xl border border-border/70 bg-card/85 p-4 shadow-sm">
                <div>
                  <div>
                    <p className={labelClasses}>{t('dialog.howToConnect')}</p>
                    <p className="text-[13px] text-muted-foreground mt-1">
                      {meta ? t(meta.description.replace('channels:', '')) : ''}
                    </p>
                  </div>
                </div>
                <ol className="list-decimal pl-5 text-[13px] text-muted-foreground leading-relaxed space-y-1.5">
                  {meta?.instructions.map((instruction, index) => (
                    <li key={index}>{t(instruction)}</li>
                  ))}
                </ol>
              </div>

              {showChannelName && (
                <div className="space-y-2.5">
                  <Label htmlFor="name" className={labelClasses}>{t('dialog.channelName')}</Label>
                  <Input
                    ref={firstInputRef}
                    id="name"
                    placeholder={t('dialog.channelNamePlaceholder', { name: meta?.name })}
                    value={channelName}
                    onChange={(event) => setChannelName(event.target.value)}
                    className={inputClasses}
                  />
                </div>
              )}

              <div className="space-y-4">
                {meta?.configFields.map((field) => (
                  <ConfigField
                    key={field.key}
                    field={field}
                    value={configValues[field.key] || ''}
                    onChange={(value) => updateConfigValue(field.key, value)}
                    showSecret={showSecrets[field.key] || false}
                    onToggleSecret={() => toggleSecretVisibility(field.key)}
                  />
                ))}
              </div>

              {validationResult && (
                <div
                  className={cn(
                    'p-4 rounded-2xl text-sm border',
                    validationResult.valid
                      ? 'bg-green-500/10 text-green-700 dark:text-green-400 border-green-500/20'
                      : 'bg-destructive/10 text-destructive border-destructive/20'
                  )}
                >
                  <div className="flex items-start gap-2">
                    {validationResult.valid ? (
                      <CheckCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    ) : (
                      <AlertCircle className="h-4 w-4 mt-0.5 shrink-0" />
                    )}
                    <div className="min-w-0">
                      <h4 className="font-medium mb-1">
                        {validationResult.valid ? t('dialog.credentialsVerified') : t('dialog.validationFailed')}
                      </h4>
                      {validationResult.errors.length > 0 && (
                        <ul className="list-disc list-inside space-y-0.5">
                          {validationResult.errors.map((err, index) => (
                            <li key={index}>{err}</li>
                          ))}
                        </ul>
                      )}
                      {validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-1 text-green-600 dark:text-green-400 space-y-0.5">
                          {validationResult.warnings.map((info, index) => (
                            <p key={index} className="text-xs">{info}</p>
                          ))}
                        </div>
                      )}
                      {!validationResult.valid && validationResult.warnings.length > 0 && (
                        <div className="mt-2 text-yellow-600 dark:text-yellow-500">
                          <p className="font-medium text-xs uppercase mb-1">{t('dialog.warnings')}</p>
                          <ul className="list-disc list-inside space-y-0.5">
                            {validationResult.warnings.map((warn, index) => (
                              <li key={index}>{warn}</li>
                            ))}
                          </ul>
                        </div>
                      )}
                    </div>
                  </div>
                </div>
              )}

              <Separator className="bg-black/10 dark:bg-white/10" />

              <div className="flex flex-col sm:flex-row sm:justify-end gap-3 pt-2">
                <div className="flex flex-col sm:flex-row gap-2">
                  {meta?.connectionType === 'token' && (
                    <Button
                      variant="outline"
                      onClick={handleValidate}
                      disabled={validating}
                      className={outlineButtonClasses}
                    >
                      {validating ? (
                        <>
                          <LoadingIcon className="h-4 w-4 mr-2" />
                          {t('dialog.validating')}
                        </>
                      ) : (
                        <>
                          <ShieldCheck className="h-4 w-4 mr-2" />
                          {t('dialog.validateConfig')}
                        </>
                      )}
                    </Button>
                  )}
                  <Button
                    onClick={() => {
                      void handleConnect();
                    }}
                    disabled={connecting || !isFormValid()}
                    className={primaryButtonClasses}
                  >
                    {connecting ? (
                      <>
                        <LoadingIcon className="h-4 w-4 mr-2" />
                        {meta?.connectionType === 'qr' ? t('dialog.generatingQR') : t('dialog.validatingAndSaving')}
                      </>
                    ) : meta?.connectionType === 'qr' ? (
                      t('dialog.generateQRCode')
                    ) : (
                      <>
                        <Check className="h-4 w-4 mr-2" />
                        {isExistingConfig ? t('dialog.updateAndReconnect') : t('dialog.saveAndConnect')}
                      </>
                    )}
                  </Button>
                </div>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

interface ConfigFieldProps {
  field: ChannelConfigField;
  value: string;
  onChange: (value: string) => void;
  showSecret: boolean;
  onToggleSecret: () => void;
}

function ChannelLogo({ type, branded = false }: { type: ChannelType; branded?: boolean }) {
  const brand = CHANNEL_BRAND_STYLES[type];
  const shellClass = branded
    ? brand?.shell ?? 'bg-slate-900 border-slate-800 shadow-[0_10px_24px_rgba(15,23,42,0.16)]'
    : 'bg-black/5 dark:bg-white/5 border-black/5 dark:border-white/10 shadow-sm';
  const iconClass = branded ? brand?.icon ?? 'brightness-0 invert' : '';

  const wrap = (content: React.ReactNode) => (
    <div
      className={cn(
        'h-[46px] w-[46px] shrink-0 flex items-center justify-center rounded-xl border',
        shellClass,
      )}
    >
      {content}
    </div>
  );

  switch (type) {
    case 'telegram':
      return wrap(<img src={telegramIcon} alt="Telegram" className={cn('w-[22px] h-[22px]', iconClass)} />);
    case 'discord':
      return wrap(<img src={discordIcon} alt="Discord" className={cn('w-[22px] h-[22px]', iconClass)} />);
    case 'whatsapp':
      return wrap(<img src={whatsappIcon} alt="WhatsApp" className={cn('w-[22px] h-[22px]', iconClass)} />);
    case 'wechat':
      return wrap(<img src={wechatIcon} alt="WeChat" className={cn('w-[22px] h-[22px]', iconClass)} />);
    case 'dingtalk':
      return wrap(<img src={dingtalkIcon} alt="DingTalk" className={cn('w-[22px] h-[22px]', iconClass)} />);
    case 'feishu':
      return wrap(<img src={feishuIcon} alt="Feishu" className={cn('w-[22px] h-[22px]', iconClass)} />);
    case 'wecom':
      return wrap(<img src={wecomIcon} alt="WeCom" className={cn('w-[22px] h-[22px]', iconClass)} />);
    case 'qqbot':
      return wrap(<img src={qqIcon} alt="QQ" className={cn('w-[22px] h-[22px]', iconClass)} />);
    default:
      return <span className="text-[22px]">{CHANNEL_ICONS[type] || '馃挰'}</span>;
  }
}

function ConfigField({ field, value, onChange, showSecret, onToggleSecret }: ConfigFieldProps) {
  const { t } = useTranslation('channels');
  const isPassword = field.type === 'password';

  return (
    <div className="space-y-2.5">
      <Label htmlFor={field.key} className={labelClasses}>
        {t(field.label)}
        {field.required && <span className="text-destructive ml-1">*</span>}
      </Label>
      <div className="flex gap-2">
        <Input
          id={field.key}
          type={isPassword && !showSecret ? 'password' : 'text'}
          placeholder={field.placeholder ? t(field.placeholder) : undefined}
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className={inputClasses}
        />
        {isPassword && (
          <Button
            type="button"
            variant="outline"
            size="icon"
            onClick={onToggleSecret}
            className="h-[44px] w-[44px] rounded-xl bg-muted/70 dark:bg-muted/40 border-black/10 dark:border-white/10 text-muted-foreground hover:text-foreground shrink-0 shadow-sm"
          >
            {showSecret ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </Button>
        )}
      </div>
      {field.description && (
        <p className="text-[13px] text-muted-foreground leading-relaxed">
          {t(field.description)}
        </p>
      )}
      {field.envVar && (
        <p className="text-[12px] text-muted-foreground/70 font-mono">
          {t('dialog.envVar', { var: field.envVar })}
        </p>
      )}
    </div>
  );
}
