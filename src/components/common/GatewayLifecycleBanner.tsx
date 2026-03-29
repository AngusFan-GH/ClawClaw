import { useState } from 'react';
import { AlertCircle, ChevronDown, ChevronUp, Copy, LifeBuoy } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import type { GatewayLifecycle } from '@/types/gateway';
import { cn } from '@/lib/utils';
import { getGatewayRecoveryPresentation } from '@/lib/gateway-recovery';

function getSourceLabel(t: (key: string) => string, source?: string): string {
  if (source?.startsWith('channel:saveConfig:') || source?.startsWith('channel:setEnabled') || source?.startsWith('channel:delete')) {
    return t('gateway.lifecycle.sources.channels');
  }
  if (source?.startsWith('create-agent') || source?.startsWith('update-agent') || source?.startsWith('assign-channel') || source?.startsWith('delete-agent') || source?.startsWith('remove-agent-channel')) {
    return t('gateway.lifecycle.sources.agents');
  }

  switch (source) {
    case 'settings.proxy':
      return t('gateway.lifecycle.sources.proxy');
    case 'security.apply':
    case 'security.reset':
      return t('gateway.lifecycle.sources.security');
    case 'gateway.manualRestart':
      return t('gateway.lifecycle.sources.manual');
    case 'gateway.autoStart':
      return t('gateway.lifecycle.sources.startup');
    default:
      return t('gateway.lifecycle.sources.config');
  }
}

export function GatewayLifecycleBanner({ lifecycle }: { lifecycle: GatewayLifecycle }) {
  const { t } = useTranslation('common');
  const [showDetails, setShowDetails] = useState(false);

  const recovery = getGatewayRecoveryPresentation(lifecycle.recovery);
  const showRecoverySuccess = lifecycle.state === 'completed' && Boolean(recovery);
  if (lifecycle.state !== 'failed' && !showRecoverySuccess) return null;

  const sourceLabel = getSourceLabel(t, lifecycle.source);
  const title = showRecoverySuccess
    ? t('gateway.lifecycle.recovery.completedTitle')
    : t('gateway.lifecycle.failedTitle');
  const description = recovery
    ? t(recovery.summaryKey)
    : lifecycle.error || t('gateway.lifecycle.failedDescription');
  const backupPath = lifecycle.recovery?.backupPath;

  const handleCopyBackupPath = async (): Promise<void> => {
    if (!backupPath || typeof navigator === 'undefined' || !navigator.clipboard?.writeText) return;
    try {
      await navigator.clipboard.writeText(backupPath);
    } catch {
      // Ignore clipboard failures; the path remains visible in the UI.
    }
  };

  return (
    <div
      className={cn(
        'mb-6 rounded-2xl border px-4 py-4 transition-colors',
        showRecoverySuccess
          ? 'border-emerald-500/25 bg-emerald-500/10'
          : 'border-destructive/30 bg-destructive/10'
      )}
    >
      <div className="flex items-start gap-3">
        <div className="mt-0.5 shrink-0">
          <AlertCircle className={cn('h-4.5 w-4.5', showRecoverySuccess ? 'text-emerald-600 dark:text-emerald-300' : 'text-destructive')} />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <div className="text-[13px] font-medium text-foreground">{title}</div>
            <span
              className={cn(
                'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                showRecoverySuccess
                  ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                  : 'bg-destructive/12 text-destructive'
              )}
            >
              {sourceLabel}
            </span>
            {recovery ? (
              <span
                className={cn(
                  'inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-medium',
                  recovery.tone === 'repaired'
                    ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                    : recovery.tone === 'preflight'
                      ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
                      : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                )}
              >
                {t(recovery.badgeKey)}
              </span>
            ) : null}
          </div>
          <div className="mt-1 text-[12px] leading-[1.7] text-muted-foreground">{description}</div>

          {recovery ? (
            <div className="mt-3 rounded-xl border border-border/70 bg-background/70 p-3">
              <div className="flex items-start gap-2">
                <div
                  className={cn(
                    'mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg',
                    recovery.tone === 'repaired'
                      ? 'bg-emerald-500/12 text-emerald-700 dark:text-emerald-300'
                      : recovery.tone === 'preflight'
                        ? 'bg-sky-500/12 text-sky-700 dark:text-sky-300'
                        : 'bg-amber-500/12 text-amber-700 dark:text-amber-300'
                  )}
                >
                  <LifeBuoy className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0 flex-1">
                  <div className="text-[12px] font-medium text-foreground">
                    {t('gateway.lifecycle.recovery.panelTitle')}
                  </div>
                  <div className="mt-1 text-[12px] leading-[1.6] text-muted-foreground">
                    {t(recovery.nextStepKey)}
                  </div>
                  <div className="mt-2 flex flex-wrap items-center gap-2">
                    {lifecycle.recovery?.topics?.map((topic) => (
                      <span key={topic} className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t(`gateway.lifecycle.recovery.topic.${topic}`)}
                      </span>
                    ))}
                    {recovery.strategyLabel ? (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t('gateway.lifecycle.recovery.strategyLabel', { strategy: recovery.strategyLabel })}
                      </span>
                    ) : null}
                    {backupPath ? (
                      <span className="inline-flex rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                        {t('gateway.lifecycle.recovery.backupCreated')}
                      </span>
                    ) : null}
                  </div>
                </div>
              </div>

              {backupPath ? (
                <div className="mt-3 rounded-lg border border-border/70 bg-muted/40 px-3 py-2">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium uppercase tracking-[0.08em] text-muted-foreground">
                        {t('gateway.lifecycle.recovery.backupPathLabel')}
                      </div>
                      <div className="mt-1 break-all font-mono text-[11px] leading-[1.7] text-foreground/85">
                        {backupPath}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => { void handleCopyBackupPath(); }}
                      className="inline-flex shrink-0 items-center gap-1 rounded-md border border-border/70 bg-background/85 px-2 py-1 text-[11px] font-medium text-foreground transition-colors hover:bg-background"
                    >
                      <Copy className="h-3.5 w-3.5" />
                      {t('actions.copy')}
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          ) : null}

          {lifecycle.error ? (
            <div className="mt-3">
              <button
                type="button"
                onClick={() => setShowDetails((value) => !value)}
                className="inline-flex items-center gap-1.5 text-[11px] font-medium text-muted-foreground transition-colors hover:text-foreground"
              >
                {showDetails ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
                {showDetails ? t('gateway.lifecycle.recovery.hideDetails') : t('gateway.lifecycle.recovery.showDetails')}
              </button>
              {showDetails ? (
                <div className="mt-2 rounded-lg border border-border/70 bg-background/65 px-3 py-2 font-mono text-[11px] leading-[1.7] text-muted-foreground">
                  {lifecycle.error}
                </div>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
