/**
 * GatewayPortsSettings — scan and manage all OpenClaw Gateway instances
 * running on this machine (installed + portable).
 */
import { useState, useCallback } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { RefreshCw, Terminal, Loader2, XCircle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';
import type { DetectedGateway } from '@/types/gateway';
import { cn } from '@/lib/utils';

interface GatewayPortsSettingsProps {
  currentPort: number;
  currentPid?: number;
}

export function GatewayPortsSettings({ currentPort, currentPid }: GatewayPortsSettingsProps) {
  const { t } = useTranslation(['settings', 'common']);
  const [gateways, setGateways] = useState<DetectedGateway[]>([]);
  const [scanning, setScanning] = useState(false);
  const [killingPort, setKillingPort] = useState<number | null>(null);
  const [confirmKillPort, setConfirmKillPort] = useState<number | null>(null);

  const scan = useCallback(async () => {
    setScanning(true);
    try {
      const result = await hostApiFetch<DetectedGateway[]>('/api/gateway/ports');
      setGateways(result ?? []);
      if (!result || result.length === 0) {
        toast.success(t('gatewayPorts.scanCompleteEmpty'));
      } else {
        toast.success(t('gatewayPorts.scanComplete', { count: result.length }));
      }
    } catch (error) {
      toast.error(t('gatewayPorts.scanFailed'));
    } finally {
      setScanning(false);
    }
  }, [t]);

  const killGateway = useCallback(async (port: number) => {
    setKillingPort(port);
    try {
      const result = await hostApiFetch<{ success: boolean; error?: string }>(
        `/api/gateway/ports/${port}/kill`,
        { method: 'POST' },
      );
      if (result?.success) {
        toast.success(t('gatewayPorts.killSuccess', { port }));
        setGateways((prev) => prev.filter((g) => g.port !== port));
      } else {
        toast.error(t('gatewayPorts.killFailed', { error: result?.error ?? '' }));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setKillingPort(null);
      setConfirmKillPort(null);
    }
  }, [t]);

  const isOwnGateway = (g: DetectedGateway) =>
    g.port === currentPort || (currentPid && g.pids.includes(currentPid));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-[10px] border-black/10 px-4 dark:border-white/10 dark:hover:bg-white/5"
          disabled={scanning}
          onClick={scan}
        >
          {scanning ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <RefreshCw className="mr-1.5 h-3.5 w-3.5" />
          )}
          {scanning ? t('gatewayPorts.scanning') : t('gatewayPorts.scan')}
        </Button>
        {gateways.length > 0 && (
          <span className="text-[13px] text-muted-foreground">
            {t('gatewayPorts.found', { count: gateways.length })}
          </span>
        )}
      </div>

      {gateways.length > 0 ? (
        <div className="space-y-2">
          {gateways.map((g) => (
            <div
              key={g.port}
              className={cn(
                'flex flex-col gap-2 rounded-[10px] border p-4 sm:flex-row sm:items-center sm:justify-between',
                isOwnGateway(g)
                  ? 'border-black/10 bg-white/75 dark:border-white/10 dark:bg-white/[0.04]'
                  : 'border-amber-500/20 bg-amber-500/5 dark:border-amber-500/30 dark:bg-amber-500/5',
              )}
            >
              <div className="flex flex-wrap items-center gap-2">
                <Terminal className="h-4 w-4 text-muted-foreground" />
                <span className="font-mono text-[13px] font-medium">:{g.port}</span>
                {isOwnGateway(g) ? (
                  <Badge variant="secondary" className="rounded-[10px] px-2 py-0.5 text-[11px]">
                    {t('gatewayPorts.ownInstance')}
                  </Badge>
                ) : (
                  <Badge
                    variant="outline"
                    className="rounded-[10px] border-amber-500/30 bg-amber-500/5 px-2 py-0.5 text-[11px] text-amber-600 dark:text-amber-400"
                  >
                    {t('gatewayPorts.externalInstance')}
                  </Badge>
                )}
                <span className="text-[12px] text-muted-foreground">
                  PID {g.pids.join(', ')}
                </span>
              </div>
              {!isOwnGateway(g) && (
                <Button
                  variant="outline"
                  size="sm"
                  className="h-8 rounded-[10px] border-red-500/30 bg-red-500/5 px-3 text-[12px] text-red-600 hover:bg-red-500/10 dark:border-red-500/30 dark:text-red-400 dark:hover:bg-red-500/10"
                  disabled={killingPort === g.port}
                  onClick={() => setConfirmKillPort(g.port)}
                >
                  {killingPort === g.port ? (
                    <Loader2 className="mr-1.5 h-3 w-3 animate-spin" />
                  ) : (
                    <XCircle className="mr-1.5 h-3 w-3" />
                  )}
                  {t('gatewayPorts.stop')}
                </Button>
              )}
            </div>
          ))}
        </div>
      ) : (
        !scanning &&
        gateways.length === 0 && (
          <p className="text-[13px] text-muted-foreground">
            {t('gatewayPorts.noGateways')}
          </p>
        )
      )}

      <ConfirmDialog
        open={confirmKillPort !== null}
        title={t('gatewayPorts.confirmKillTitle')}
        message={t('gatewayPorts.confirmKillMessage', { port: confirmKillPort ?? 0 })}
        confirmLabel={t('gatewayPorts.stop')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        confirmPending={killingPort !== null}
        onConfirm={() => {
          if (confirmKillPort !== null) killGateway(confirmKillPort);
        }}
        onCancel={() => setConfirmKillPort(null)}
      />
    </div>
  );
}
