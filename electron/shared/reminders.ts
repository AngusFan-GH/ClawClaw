export interface ReminderItem {
  id: string;
  text: string;
  enabled: boolean;
}

function normalizeReminderId(value: unknown, fallback: number): string {
  if (typeof value === 'string' && value.trim()) {
    return value.trim();
  }
  return `reminder-${fallback}`;
}

function normalizeReminderText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizeReminderEnabled(value: unknown): boolean {
  return value !== false;
}

export function normalizeReminders(raw: unknown): ReminderItem[] {
  if (!Array.isArray(raw)) return [];

  const out: ReminderItem[] = [];
  const seenId = new Set<string>();
  const seenText = new Set<string>();

  raw.forEach((item, index) => {
    if (typeof item === 'string') {
      const text = normalizeReminderText(item);
      if (!text) return;
      const textKey = text.toLowerCase();
      if (seenText.has(textKey)) return;
      seenText.add(textKey);
      const id = `reminder-${index + 1}`;
      out.push({ id, text, enabled: true });
      seenId.add(id);
      return;
    }

    if (!item || typeof item !== 'object') return;
    const record = item as Record<string, unknown>;
    const text = normalizeReminderText(record.text);
    if (!text) return;

    const textKey = text.toLowerCase();
    if (seenText.has(textKey)) return;

    let id = normalizeReminderId(record.id, index + 1);
    if (seenId.has(id)) {
      id = `${id}-${index + 1}`;
    }

    seenId.add(id);
    seenText.add(textKey);
    out.push({
      id,
      text,
      enabled: normalizeReminderEnabled(record.enabled),
    });
  });

  return out;
}

