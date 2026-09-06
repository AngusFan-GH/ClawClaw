import { useToast } from '../lib/toast';

export function Toaster() {
  const { toasts, dismiss } = useToast();
  return (
    <div className="fixed bottom-4 right-4 z-50 flex flex-col gap-2">
      {toasts.map((t) => (
        <button
          key={t.id}
          onClick={() => dismiss(t.id)}
          className={`pointer-events-auto min-w-[240px] max-w-sm rounded-xl border px-4 py-3 text-left text-sm shadow-lg ${
            t.kind === 'error'
              ? 'border-red-200 bg-red-50 text-red-800'
              : t.kind === 'success'
                ? 'border-emerald-200 bg-emerald-50 text-emerald-800'
                : 'border-slate-200 bg-white text-slate-700'
          }`}
        >
          {t.message}
        </button>
      ))}
    </div>
  );
}
