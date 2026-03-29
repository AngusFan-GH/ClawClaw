import { useCallback, useEffect, useState } from 'react';
import { Download, RefreshCw, Rocket, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Progress } from '@/components/ui/progress';
import { Switch } from '@/components/ui/switch';
import { invokeIpc } from '@/lib/api-client';
import { useSettingsStore } from '@/stores/settings';
import { useUpdateStore } from '@/stores/update';
import { useTranslation } from 'react-i18next';
import { LoadingIcon } from '@/components/common/LoadingSpinner';

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

export function UpdateSettings() {
  const { t } = useTranslation('settings');
  const [openclawVersion, setOpenclawVersion] = useState<string | null>(null);
  const {
    autoCheckUpdate,
    autoDownloadUpdate,
    setAutoCheckUpdate,
    setAutoDownloadUpdate,
  } = useSettingsStore();
  const {
    status,
    currentVersion,
    updateInfo,
    progress,
    error,
    isInitialized,
    isSupported,
    hasCheckedOnce,
    autoInstallCountdown,
    init,
    checkForUpdates,
    downloadUpdate,
    installUpdate,
    cancelAutoInstall,
    setChannel,
    setAutoDownload,
    clearError,
  } = useUpdateStore();

  useEffect(() => {
    void init();
  }, [init]);

  useEffect(() => {
    let cancelled = false;

    void invokeIpc<{
      packageExists: boolean;
      version?: string;
    }>('openclaw:status')
      .then((status: { packageExists: boolean; version?: string }) => {
        if (cancelled) return;
        setOpenclawVersion(status.packageExists ? status.version ?? null : null);
      })
      .catch(() => {
        if (cancelled) return;
        setOpenclawVersion(null);
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    void setChannel('stable');
  }, [setChannel]);

  useEffect(() => {
    void setAutoDownload(autoDownloadUpdate);
  }, [autoDownloadUpdate, setAutoDownload]);

  useEffect(() => {
    if (!isInitialized || !isSupported || !autoCheckUpdate || hasCheckedOnce || status !== 'idle') {
      return;
    }
    void checkForUpdates();
  }, [autoCheckUpdate, checkForUpdates, hasCheckedOnce, isInitialized, isSupported, status]);

  const handleCheckForUpdates = useCallback(async () => {
    clearError();
    await checkForUpdates();
  }, [checkForUpdates, clearError]);

  const renderStatusIcon = () => {
    switch (status) {
      case 'checking':
      case 'downloading':
        return <LoadingIcon className="h-4 w-4 text-muted-foreground" />;
      case 'available':
        return <Download className="h-4 w-4 text-primary" />;
      case 'downloaded':
        return <Rocket className="h-4 w-4 text-primary" />;
      case 'error':
        return <RefreshCw className="h-4 w-4 text-destructive" />;
      default:
        return <RefreshCw className="h-4 w-4 text-muted-foreground" />;
    }
  };

  const renderStatusText = () => {
    if (!isSupported) {
      return t('updates.unsupported');
    }
    if (status === 'downloaded' && autoInstallCountdown != null && autoInstallCountdown >= 0) {
      return t('updates.status.autoInstalling', { seconds: autoInstallCountdown });
    }
    switch (status) {
      case 'checking':
        return t('updates.status.checking');
      case 'downloading':
        return t('updates.status.downloading');
      case 'available':
        return t('updates.status.available', { version: updateInfo?.version });
      case 'downloaded':
        return t('updates.status.downloaded', { version: updateInfo?.version });
      case 'error':
        return error || t('updates.status.failed');
      case 'not-available':
        return t('updates.status.latest');
      default:
        return t('updates.status.check');
    }
  };

  const renderAction = () => {
    if (!isSupported) {
      return (
        <Button disabled variant="outline" size="sm">
          {t('updates.actionsDisabled')}
        </Button>
      );
    }

    switch (status) {
      case 'checking':
        return (
          <Button disabled variant="outline" size="sm">
            <LoadingIcon className="mr-2 h-4 w-4" />
            {t('updates.action.checking')}
          </Button>
        );
      case 'downloading':
        return (
          <Button disabled variant="outline" size="sm">
            <LoadingIcon className="mr-2 h-4 w-4" />
            {t('updates.action.downloading')}
          </Button>
        );
      case 'available':
        return (
          <Button onClick={downloadUpdate} size="sm">
            <Download className="mr-2 h-4 w-4" />
            {t('updates.action.download')}
          </Button>
        );
      case 'downloaded':
        if (autoInstallCountdown != null && autoInstallCountdown >= 0) {
          return (
            <Button onClick={cancelAutoInstall} size="sm" variant="outline">
              <XCircle className="mr-2 h-4 w-4" />
              {t('updates.action.cancelAutoInstall')}
            </Button>
          );
        }
        return (
          <Button onClick={installUpdate} size="sm">
            <Rocket className="mr-2 h-4 w-4" />
            {t('updates.action.install')}
          </Button>
        );
      case 'error':
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('updates.action.retry')}
          </Button>
        );
      default:
        return (
          <Button onClick={handleCheckForUpdates} variant="outline" size="sm">
            <RefreshCw className="mr-2 h-4 w-4" />
            {t('updates.action.check')}
          </Button>
        );
    }
  };

  if (!isInitialized) {
    return (
      <div className="flex items-center gap-2 text-muted-foreground">
        <LoadingIcon className="h-4 w-4" />
        <span>{t('common:status.loading')}</span>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="rounded-[10px] border border-black/10 bg-card/80 p-5 dark:border-white/10 dark:bg-card/50">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0">
            <p className="text-sm font-medium text-muted-foreground">{t('updates.currentVersion')}</p>
            <div className="mt-3 flex flex-wrap items-center gap-3">
              <p className="text-4xl font-bold tracking-tight">v{currentVersion}</p>
              <div className="inline-flex max-w-full items-center gap-2 rounded-full border border-black/10 bg-black/[0.03] px-3 py-1.5 text-[13px] text-muted-foreground dark:border-white/10 dark:bg-white/[0.03]">
                {renderStatusIcon()}
                <span>{renderStatusText()}</span>
              </div>
            </div>
            <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-muted-foreground">
              <span className="font-medium">{t('updates.openclawVersionLabel')}</span>
              <span className="rounded-full border border-black/10 bg-black/[0.03] px-2.5 py-1 font-mono dark:border-white/10 dark:bg-white/[0.03]">
                {openclawVersion ? `v${openclawVersion}` : t('updates.openclawVersionUnavailable')}
              </span>
            </div>
          </div>

          <div className="shrink-0">{renderAction()}</div>
        </div>

        {status === 'downloading' && progress ? (
          <div className="mt-4 space-y-2 rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-4 text-sm">
              <span>
                {formatBytes(progress.transferred)} / {formatBytes(progress.total)}
              </span>
              <span>{formatBytes(progress.bytesPerSecond)}/s</span>
            </div>
            <Progress value={progress.percent} className="h-2" />
            <p className="text-center text-xs text-muted-foreground">
              {Math.round(progress.percent)}%
            </p>
          </div>
        ) : null}

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('updates.autoCheck')}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{t('updates.autoCheckDesc')}</p>
              </div>
              <Switch checked={autoCheckUpdate} onCheckedChange={setAutoCheckUpdate} />
            </div>
          </div>

          <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="text-sm font-medium">{t('updates.autoDownload')}</p>
                <p className="mt-1 text-[13px] text-muted-foreground">{t('updates.autoDownloadDesc')}</p>
              </div>
              <Switch checked={autoDownloadUpdate} onCheckedChange={setAutoDownloadUpdate} />
            </div>
          </div>
        </div>
      </div>

      {updateInfo && (status === 'available' || status === 'downloaded') ? (
        <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
          <div className="flex items-center justify-between gap-4">
            <p className="font-medium">v{updateInfo.version}</p>
            {updateInfo.releaseDate ? (
              <p className="text-sm text-muted-foreground">
                {new Date(updateInfo.releaseDate).toLocaleDateString()}
              </p>
            ) : null}
          </div>
          {updateInfo.releaseNotes ? (
            <div className="mt-3 space-y-1 text-sm text-muted-foreground">
              <p className="font-medium text-foreground">{t('updates.whatsNew')}</p>
              <p className="whitespace-pre-wrap">{updateInfo.releaseNotes}</p>
            </div>
          ) : null}
        </div>
      ) : null}

      {status === 'error' && error ? (
        <div className="rounded-[10px] border border-destructive/20 bg-destructive/5 p-4 text-sm text-destructive">
          <p className="font-medium">{t('updates.errorDetails')}</p>
          <p className="mt-1">{error}</p>
        </div>
      ) : null}
    </div>
  );
}

export default UpdateSettings;
