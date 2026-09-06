import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ToolInvocation } from '../../lib/types';
import { useChat } from '../../stores/chat';
import { riskColor } from '../../components/extras';

export function ApprovalCard({ invocation }: { invocation: ToolInvocation }) {
  const { t } = useTranslation();
  const approve = useChat((s) => s.approve);
  const deny = useChat((s) => s.deny);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  const act = async (approved: boolean) => {
    setBusy(true);
    try {
      if (approved) await approve(invocation.toolCallId);
      else await deny(invocation.toolCallId, reason || undefined);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/60 p-4">
      <div className="flex items-center gap-2">
        <span className="text-sm font-semibold">{t('approval.title')}</span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${riskColor(invocation.risk)}`}>{invocation.risk}</span>
        {invocation.approvalPolicy === 'auto' && <span className="text-xs text-muted-foreground">· {t('approval.auto')}</span>}
      </div>
      <p className="mt-1 text-xs text-muted-foreground">{t('approval.description')}</p>
      <div className="mt-3 rounded-lg bg-white/70 p-3 text-sm">
        <div className="font-mono text-xs text-primary">{invocation.toolName}</div>
        <pre className="mt-2 overflow-x-auto text-xs text-muted-foreground">{JSON.stringify(invocation.argsSummary, null, 2)}</pre>
      </div>
      <input
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder={t('approval.reason')}
        className="mt-3 w-full rounded-lg border border-border bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring/40"
      />
      <div className="mt-3 flex gap-2">
        <button disabled={busy} onClick={() => void act(true)} className="rounded-lg bg-primary px-4 py-1.5 text-sm font-medium text-primary-foreground disabled:opacity-50">
          {t('approval.approve')}
        </button>
        <button disabled={busy} onClick={() => void act(false)} className="rounded-lg border border-red-200 px-4 py-1.5 text-sm font-medium text-red-600 disabled:opacity-50">
          {t('approval.deny')}
        </button>
      </div>
    </div>
  );
}
