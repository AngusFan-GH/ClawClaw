/**
 * BackupRestoreSettings — export and import ClawClaw backups.
 * Export: builds a full backup JSON (settings + OpenClaw config + provider metadata).
 * Import: two-phase — select file → preview → confirm → apply.
 */
import { useState, useCallback } from 'react';
import { hostApiFetch } from '@/lib/host-api';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { Download, Upload, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/confirm-dialog';

interface BackupPreview {
  appVersion: string;
  exportedAt: string;
  backupId: string;
  hasOpenClawConfig: boolean;
  providerCount: number;
}

interface BackupPayload {
  version: 1;
  metadata: { appVersion: string; platform: string; exportedAt: string; backupId: string };
  settings: Record<string, unknown>;
  openclawConfig: Record<string, unknown>;
  providerMeta: Array<{ name: string; hasApiKey: boolean }>;
}

interface ImportResult {
  success: boolean;
  importedSettings: boolean;
  importedOpenClawConfig: boolean;
  importedProviders: number;
  warnings: string[];
  autoBackupPath?: string;
}

export function BackupRestoreSettings() {
  const { t } = useTranslation(['settings', 'common']);
  const [exporting, setExporting] = useState(false);
  const [importing, setImporting] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [pendingPayload, setPendingPayload] = useState<BackupPayload | null>(null);
  const [preview, setPreview] = useState<BackupPreview | null>(null);
  const [importResult, setImportResult] = useState<ImportResult | null>(null);

  const handleExport = useCallback(async () => {
    setExporting(true);
    try {
      const result = await hostApiFetch<{ success: boolean; savedPath?: string; cancelled?: boolean }>(
        '/api/settings/export-config',
        { method: 'POST' },
      );
      if (result.cancelled) { setExporting(false); return; }
      if (result.success && result.savedPath) {
        toast.success(t('backupRestore.exportSuccess', { path: result.savedPath }));
      } else {
        toast.error(t('backupRestore.exportFailed'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setExporting(false);
    }
  }, [t]);

  const handleImportSelect = useCallback(async () => {
    setImporting(true);
    setPreview(null);
    setImportResult(null);
    setPendingPayload(null);
    try {
      const result = await hostApiFetch<{
        success: boolean;
        preview?: BackupPreview;
        cancelled?: boolean;
        payload?: BackupPayload;
      }>('/api/settings/import-config', { method: 'POST' });

      if (result.cancelled) { setImporting(false); return; }
      if (!result.success || !result.preview || !result.payload) {
        toast.error(t('backupRestore.importFailed'));
        setImporting(false);
        return;
      }
      setPreview(result.preview);
      setPendingPayload(result.payload);
      setConfirmOpen(true);
    } catch (error) {
      toast.error(String(error));
    } finally {
      setImporting(false);
    }
  }, [t]);

  const handleConfirmImport = useCallback(async () => {
    if (!pendingPayload) return;
    setConfirmOpen(false);
    setImporting(true);
    try {
      const result = await hostApiFetch<ImportResult>(
        '/api/settings/apply-import',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ payload: pendingPayload, skipApiKeyWarning: true }),
        },
      );

      setImportResult(result ?? { success: false, warnings: [], importedSettings: false, importedOpenClawConfig: false, importedProviders: 0 });

      if (result?.success) {
        toast.success(t('backupRestore.importSuccess'));
      } else {
        toast.error(t('backupRestore.importPartial'));
      }
    } catch (error) {
      toast.error(String(error));
    } finally {
      setImporting(false);
      setPendingPayload(null);
      setPreview(null);
    }
  }, [pendingPayload, t]);

  return (
    <div className="space-y-4">
      {/* Export */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-[10px] border-black/10 px-4 dark:border-white/10 dark:hover:bg-white/5"
          disabled={exporting}
          onClick={handleExport}
        >
          {exporting ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Download className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('backupRestore.export')}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {t('backupRestore.exportHelp')}
        </span>
      </div>

      {/* Import */}
      <div className="flex flex-wrap items-center gap-3">
        <Button
          variant="outline"
          size="sm"
          className="h-9 rounded-[10px] border-black/10 px-4 dark:border-white/10 dark:hover:bg-white/5"
          disabled={importing}
          onClick={handleImportSelect}
        >
          {importing ? (
            <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" />
          ) : (
            <Upload className="mr-1.5 h-3.5 w-3.5" />
          )}
          {t('backupRestore.import')}
        </Button>
        <span className="text-[13px] text-muted-foreground">
          {t('backupRestore.importHelp')}
        </span>
      </div>

      {/* Import result */}
      {importResult && (
        <div
          className={`rounded-[10px] border p-4 text-[13px] ${
            importResult.success
              ? 'border-green-500/20 bg-green-500/5'
              : 'border-red-500/20 bg-red-500/5'
          }`}
        >
          <div className="mb-2 flex items-center gap-2">
            {importResult.success ? (
              <CheckCircle2 className="h-4 w-4 text-green-600 dark:text-green-400" />
            ) : (
              <AlertTriangle className="h-4 w-4 text-red-600 dark:text-red-400" />
            )}
            <span
              className={
                importResult.success
                  ? 'text-green-700 dark:text-green-300'
                  : 'text-red-700 dark:text-red-300'
              }
            >
              {importResult.success
                ? t('backupRestore.importSucceeded')
                : t('backupRestore.importHadWarnings')}
            </span>
          </div>
          {importResult.warnings.length > 0 && (
            <ul className="ml-6 list-disc space-y-1 text-muted-foreground">
              {importResult.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          )}
          {importResult.autoBackupPath && (
            <p className="mt-2 text-[12px] text-muted-foreground">
              {t('backupRestore.autoBackupSaved', { path: importResult.autoBackupPath })}
            </p>
          )}
        </div>
      )}

      {/* Confirmation dialog */}
      <ConfirmDialog
        open={confirmOpen}
        title={t('backupRestore.confirmTitle')}
        message={
          preview
            ? t('backupRestore.confirmMessage', {
                version: preview.appVersion,
                date: new Date(preview.exportedAt).toLocaleString(),
                providers: preview.providerCount,
              })
            : t('backupRestore.confirmGeneric')
        }
        confirmLabel={t('backupRestore.confirm')}
        cancelLabel={t('common:actions.cancel')}
        variant="destructive"
        confirmPending={importing}
        onConfirm={handleConfirmImport}
        onCancel={() => {
          setConfirmOpen(false);
          setPreview(null);
          setPendingPayload(null);
        }}
      />
    </div>
  );
}
