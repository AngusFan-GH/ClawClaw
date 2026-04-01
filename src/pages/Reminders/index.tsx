/**
 * Reminders Page
 * Manage叮嘱 (reminders) for the lobster agent
 */
import { useEffect, useMemo, useState } from 'react';
import {
  Check,
  PencilLine,
  Plus,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Badge } from '@/components/ui/badge';
import { Textarea } from '@/components/ui/textarea';
import { toast } from 'sonner';
import { useTranslation } from 'react-i18next';
import { useSettingsStore } from '@/stores/settings';
import { cn } from '@/lib/utils';
import { PageHeader } from '@/components/layout/PageHeader';
import type { ReminderItem } from '@/shared/reminders';

function SubCard({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
      <div className="mb-4 flex flex-col gap-3 md:items-start md:justify-between">
        <div className="min-w-0">
          <h3 className="text-[15px] font-medium text-foreground">{title}</h3>
          {description ? <p className="mt-1 text-[13px] text-muted-foreground">{description}</p> : null}
        </div>
      </div>
      {children}
    </div>
  );
}

export function Reminders() {
  useEffect(() => {
    console.debug('[reminders] Reminders component mounted');
    return () => console.debug('[reminders] Reminders component unmounted');
  }, []);

  const { t } = useTranslation(['settings', 'common']);
  const reminders = useSettingsStore((state) => state.reminders);
  const setReminders = useSettingsStore((state) => state.setReminders);

  const [newReminderText, setNewReminderText] = useState('');
  const [editingReminderId, setEditingReminderId] = useState<string | null>(null);
  const [editingReminderText, setEditingReminderText] = useState('');

  const enabledReminderCount = useMemo(
    () => reminders.filter((r) => r.enabled).length,
    [reminders]
  );

  const presetReminders = useMemo(
    () => [
      t('reminders.presets.privacy'),
      t('reminders.presets.files'),
      t('reminders.presets.mail'),
      t('reminders.presets.approval'),
      t('reminders.presets.externalShare'),
    ],
    [t]
  );

  /* eslint-disable react-hooks/purity -- only called from event handlers, not during render */
  const addReminder = (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;
    setReminders([
      {
        id: `reminder-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        text: trimmed,
        enabled: true,
      },
      ...reminders,
    ]);
  };
  /* eslint-enable react-hooks/purity */

  const handleCreateReminder = () => {
    addReminder(newReminderText);
    setNewReminderText('');
  };

  const handleAddPresetReminder = (text: string) => {
    const exists = reminders.some((item) => item.text.trim() === text.trim());
    if (exists) {
      toast.message(t('reminders.toasts.exists'));
      return;
    }
    addReminder(text);
  };

  const handleToggleReminder = (id: string, enabled: boolean) => {
    setReminders(reminders.map((item) => (item.id === id ? { ...item, enabled } : item)));
  };

  const handleDeleteReminder = (id: string) => {
    setReminders(reminders.filter((item) => item.id !== id));
    if (editingReminderId === id) {
      setEditingReminderId(null);
      setEditingReminderText('');
    }
  };

  const handleStartEditReminder = (item: ReminderItem) => {
    setEditingReminderId(item.id);
    setEditingReminderText(item.text);
  };

  const handleSaveEditReminder = () => {
    const trimmed = editingReminderText.trim();
    if (!editingReminderId || !trimmed) return;
    setReminders(reminders.map((item) => (item.id === editingReminderId ? { ...item, text: trimmed } : item)));
    setEditingReminderId(null);
    setEditingReminderText('');
  };

  const handleCancelEditReminder = () => {
    setEditingReminderId(null);
    setEditingReminderText('');
  };

  return (
    <div className="-m-6 flex h-[calc(100vh-2.5rem)] flex-col overflow-hidden dark:bg-background">
      <div className="mx-auto flex h-full w-full max-w-6xl flex-col px-6 py-8 md:px-10 md:py-10">
        <PageHeader
          title={t('reminders.title')}
          description={t('reminders.description')}
        />

        <div className="-mr-2 min-h-0 flex-1 space-y-6 overflow-y-auto pr-2 pb-8">
          <div className="grid gap-4 xl:grid-cols-[minmax(0,0.92fr)_minmax(0,1.08fr)]">
            {/* Left: Compose + Presets */}
            <SubCard
              title={t('reminders.compose.title')}
              description={t('reminders.compose.description')}
            >
              <div className="space-y-4">
                <div className="rounded-[10px] border border-black/10 bg-white/75 p-4 dark:border-white/10 dark:bg-white/[0.04]">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant="secondary" className="rounded-[10px] px-3 py-1 text-[12px]">
                      {t('reminders.compose.activeCount', { count: enabledReminderCount })}
                    </Badge>
                    <span className="text-[12px] text-muted-foreground">
                      {t('reminders.compose.helper')}
                    </span>
                  </div>

                  <div className="mt-4 space-y-2">
                    <Label htmlFor="new-reminder" className="text-[13px] text-foreground/85">
                      {t('reminders.compose.label')}
                    </Label>
                    <Textarea
                      id="new-reminder"
                      value={newReminderText}
                      onChange={(event) => setNewReminderText(event.target.value)}
                      placeholder={t('reminders.compose.placeholder')}
                      className="min-h-[124px] rounded-[14px] border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]"
                    />
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button
                      type="button"
                      className="rounded-[10px] px-4"
                      onClick={handleCreateReminder}
                      disabled={!newReminderText.trim()}
                    >
                      <Plus className="mr-2 h-4 w-4" />
                      {t('reminders.compose.add')}
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="rounded-[10px] border-black/10 bg-transparent px-4 dark:border-white/10 dark:hover:bg-white/5"
                      onClick={() => setNewReminderText('')}
                      disabled={!newReminderText.trim()}
                    >
                      {t('common:actions.clear')}
                    </Button>
                  </div>
                </div>

                <div className="rounded-[10px] border border-black/10 bg-black/[0.03] p-4 dark:border-white/10 dark:bg-white/[0.03]">
                  <div className="mb-3">
                    <div className="text-[14px] font-medium text-foreground">
                      {t('reminders.presets.title')}
                    </div>
                    <p className="mt-1 text-[12px] leading-5 text-muted-foreground">
                      {t('reminders.presets.description')}
                    </p>
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {presetReminders.map((preset) => (
                      <button
                        key={preset}
                        type="button"
                        onClick={() => handleAddPresetReminder(preset)}
                        className="rounded-full border border-black/10 bg-white px-3 py-2 text-left text-[12px] text-foreground transition-colors hover:bg-black/[0.03] dark:border-white/10 dark:bg-white/[0.05] dark:hover:bg-white/[0.08]"
                      >
                        <span className="mr-1 text-muted-foreground">+</span>
                        {preset}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </SubCard>

            {/* Right: Current reminders list */}
            <SubCard
              title={t('reminders.list.title')}
              description={t('reminders.list.description')}
            >
              <div className="space-y-3">
                {reminders.length === 0 ? (
                  <div className="rounded-[12px] border border-dashed border-black/10 px-4 py-8 text-center text-[13px] text-muted-foreground dark:border-white/10">
                    {t('reminders.list.empty')}
                  </div>
                ) : (
                  reminders.map((item) => {
                    const isEditing = editingReminderId === item.id;
                    return (
                      <div
                        key={item.id}
                        className={cn(
                          'rounded-[14px] border px-4 py-4 transition-colors',
                          item.enabled
                            ? 'border-black/10 bg-white/75 dark:border-white/10 dark:bg-white/[0.04]'
                            : 'border-black/10 bg-black/[0.03] opacity-75 dark:border-white/10 dark:bg-white/[0.02]'
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className="pt-0.5">
                            <Switch
                              checked={item.enabled}
                              onCheckedChange={(checked) => handleToggleReminder(item.id, checked)}
                            />
                          </div>

                          <div className="min-w-0 flex-1">
                            {isEditing ? (
                              <div className="space-y-3">
                                <Textarea
                                  value={editingReminderText}
                                  onChange={(event) => setEditingReminderText(event.target.value)}
                                  className="min-h-[108px] rounded-[12px] border-black/10 bg-white dark:border-white/10 dark:bg-white/[0.03]"
                                />
                                <div className="flex flex-wrap gap-2">
                                  <Button
                                    type="button"
                                    size="sm"
                                    className="rounded-[10px] px-3"
                                    onClick={handleSaveEditReminder}
                                    disabled={!editingReminderText.trim()}
                                  >
                                    <Check className="mr-1.5 h-3.5 w-3.5" />
                                    {t('common:actions.save')}
                                  </Button>
                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    className="rounded-[10px] border-black/10 bg-transparent px-3 dark:border-white/10 dark:hover:bg-white/5"
                                    onClick={handleCancelEditReminder}
                                  >
                                    <X className="mr-1.5 h-3.5 w-3.5" />
                                    {t('common:actions.cancel')}
                                  </Button>
                                </div>
                              </div>
                            ) : (
                              <>
                                <div className="flex flex-wrap items-center gap-2">
                                  <Badge
                                    variant="secondary"
                                    className="rounded-[10px] border px-2.5 py-0.5 text-[11px]"
                                  >
                                    {item.enabled
                                      ? t('reminders.list.enabled')
                                      : t('reminders.list.paused')}
                                  </Badge>
                                </div>
                                <p className="mt-3 whitespace-pre-wrap text-[14px] leading-7 text-foreground">
                                  {item.text}
                                </p>
                              </>
                            )}
                          </div>

                          {!isEditing ? (
                            <div className="flex shrink-0 gap-2">
                              <Button
                                type="button"
                                variant="ghost"
                                size="icon"
                                className="h-9 w-9 rounded-[10px]"
                                onClick={() => handleStartEditReminder(item)}
                              >
                                <PencilLine className="h-4 w-4" />
                              </Button>
                              <Button
                                type="button"
                                variant="dangerGhost"
                                size="icon"
                                className="h-9 w-9 rounded-[10px]"
                                onClick={() => handleDeleteReminder(item.id)}
                              >
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </SubCard>
          </div>
        </div>
      </div>
    </div>
  );
}
