import { useEffect, useMemo } from 'react';
import { CheckCircle2, RotateCw } from 'lucide-react';
import { toast } from 'sonner';
import { Button } from '@/components/ui/button';
import { useRuntimeApplyStore } from '@/stores/runtime-apply';
import type { RuntimeApplyDomain } from '@/shared/runtime-apply';
import { cn } from '@/lib/utils';

const DOMAIN_LABELS: Record<RuntimeApplyDomain, string> = {
  providers: '模型',
  agents: '分身',
  channels: '连接',
  security: '安全',
};

type RuntimeApplyBannerProps = {
  domains?: RuntimeApplyDomain[];
  className?: string;
  refreshAfterAction?: () => void | Promise<void>;
};

export function RuntimeApplyBanner({
  domains,
  className,
  refreshAfterAction,
}: RuntimeApplyBannerProps) {
  const plan = useRuntimeApplyStore((state) => state.plan);
  const applying = useRuntimeApplyStore((state) => state.applying);
  const loading = useRuntimeApplyStore((state) => state.loading);
  const applyPendingChanges = useRuntimeApplyStore((state) => state.applyPendingChanges);
  const discardPendingChanges = useRuntimeApplyStore((state) => state.discardPendingChanges);
  const refreshPlan = useRuntimeApplyStore((state) => state.refreshPlan);

  useEffect(() => {
    void refreshPlan();
  }, [refreshPlan]);

  const visibleChanges = useMemo(() => {
    if (!domains || domains.length === 0) {
      return plan.pending;
    }
    const allowed = new Set(domains);
    return plan.pending.filter((change) => allowed.has(change.domain));
  }, [domains, plan.pending]);

  if (visibleChanges.length === 0) {
    return null;
  }

  const domainSummary = Array.from(new Set(visibleChanges.map((change) => DOMAIN_LABELS[change.domain]))).join('、');
  const requiresRestart = plan.action === 'restart';

  const handleApply = async () => {
    try {
      const result = await applyPendingChanges();
      await refreshAfterAction?.();
      if (!result.accepted && !result.triggered) {
        toast.success('更改已写入配置，服务启动后会加载');
        return;
      }
      toast.success(result.action === 'restart' ? '更改已应用，服务已短暂重启' : '更改已应用');
    } catch (error) {
      toast.error(`应用更改失败：${String(error)}`);
    }
  };

  const handleCancel = async () => {
    try {
      await discardPendingChanges();
      await refreshAfterAction?.();
      toast.success('已取消本次待应用更改');
    } catch (error) {
      toast.error(`取消失败：${String(error)}`);
    }
  };

  return (
    <div
      className={cn(
        'flex flex-col gap-3 rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-amber-950 dark:border-amber-800 dark:bg-amber-950/35 dark:text-amber-100',
        'md:flex-row md:items-center md:justify-between',
        className,
      )}
    >
      <div className="flex min-w-0 items-start gap-3">
        <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-amber-700 dark:text-amber-300" />
        <div className="min-w-0">
          <div className="text-sm font-medium">
            {domainSummary}有 {visibleChanges.length} 项更改待应用
          </div>
          <div className="mt-0.5 text-xs text-amber-800/80 dark:text-amber-100/72">
            {requiresRestart ? '应用时服务会短暂重启，通常只需要几秒。' : '应用后服务会加载最新配置。'}
          </div>
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          onClick={() => void handleCancel()}
          disabled={applying || loading}
          className="h-8 rounded-lg border-amber-400/60 bg-transparent px-3 text-xs text-amber-950 shadow-none hover:bg-amber-100 dark:border-amber-700 dark:text-amber-100 dark:hover:bg-amber-900/40"
        >
          取消
        </Button>
        <Button
          size="sm"
          onClick={() => void handleApply()}
          disabled={applying}
          className="h-8 rounded-lg px-3 text-xs shadow-none"
        >
          {applying ? <RotateCw className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : null}
          {applying ? '应用中' : '应用更改'}
        </Button>
      </div>
    </div>
  );
}
