import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export function PageHeader({ title, subtitle, action }: { title: string; subtitle?: string; action?: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-border/60 px-6 py-4">
      <div>
        <h1 className="text-lg font-semibold">{title}</h1>
        {subtitle && <p className="mt-1 max-w-2xl text-sm text-muted-foreground">{subtitle}</p>}
      </div>
      {action}
    </div>
  );
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="grid h-full place-items-center p-10 text-center text-sm text-muted-foreground">{children}</div>;
}

export function ErrorNote({ children }: { children: ReactNode }) {
  if (!children) return null;
  return <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{children}</div>;
}

const STATUS_STYLE: Record<string, string> = {
  connected: 'bg-emerald-100 text-emerald-700',
  configured: 'bg-sky-100 text-sky-700',
  connecting: 'bg-amber-100 text-amber-700',
  disconnected: 'bg-slate-100 text-slate-600',
  error: 'bg-red-100 text-red-700',
  unconfigured: 'bg-slate-100 text-slate-500',
};

export function StatusBadge({ status }: { status: string }) {
  return (
    <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${STATUS_STYLE[status] ?? 'bg-slate-100 text-slate-600'}`}>
      {status}
    </span>
  );
}

/** Localize a backend error code via the `error.*` i18n tree, falling back to message. */
export function useErrorMessage() {
  const { t } = useTranslation();
  return (error: unknown): string => {
    const code = (error as { code?: string })?.code;
    if (code && t(`error.${code}`, { defaultValue: '' })) return t(`error.${code}`);
    return error instanceof Error ? error.message : String(error);
  };
}

export function riskColor(risk: string): string {
  if (risk === 'low') return 'bg-emerald-100 text-emerald-700';
  if (risk === 'high') return 'bg-red-100 text-red-700';
  return 'bg-amber-100 text-amber-700';
}
