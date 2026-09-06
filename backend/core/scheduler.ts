import type { CoreCronJob } from './cron-store';

/** Minimal durable scheduler for the cron expressions produced by the UI. */
export class CoreScheduler {
  private timer: NodeJS.Timeout | undefined;
  private readonly fired = new Map<string, string>();
  constructor(private readonly list: () => CoreCronJob[], private readonly trigger: (id: string) => Promise<unknown>) {}
  start(): void { if (!this.timer) { void this.tick(); this.timer = setInterval(() => void this.tick(), 30_000); } }
  stop(): void { if (this.timer) clearInterval(this.timer); this.timer = undefined; }
  private async tick(): Promise<void> {
    const now = new Date(); const minute = `${now.getFullYear()}-${now.getMonth()}-${now.getDate()}-${now.getHours()}-${now.getMinutes()}`;
    for (const job of this.list()) {
      if (!job.enabled || this.fired.get(job.id) === minute || !matches(job.schedule, now)) continue;
      this.fired.set(job.id, minute);
      try { await this.trigger(job.id); } catch { /* Run creation records provider/config errors separately. */ }
    }
  }
}

function matches(expr: string, date: Date): boolean {
  const [m, h, d, mon, dow] = expr.trim().split(/\s+/); if (!m || !h || !d || !mon || !dow) return false;
  return field(m, date.getMinutes()) && field(h, date.getHours()) && field(d, date.getDate()) && field(mon, date.getMonth() + 1) && field(dow, date.getDay());
}
function field(expr: string, value: number): boolean {
  if (expr === '*') return true;
  if (expr.startsWith('*/')) return value % Number(expr.slice(2)) === 0;
  return expr.split(',').some(part => Number(part) === value);
}
