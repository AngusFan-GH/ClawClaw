/**
 * Single-instance, non-reentrant scheduler tick. Idempotency and restart
 * dedupe are owned by CoreCronStore via the durable fire cursor; this class
 * only paces the tick and guarantees two ticks never overlap.
 */
export class CoreScheduler {
  private timer: NodeJS.Timeout | undefined;
  private running = false;

  constructor(
    private readonly tick: () => Promise<void>,
    private readonly intervalMs = 20_000,
  ) {}

  start(): void {
    if (this.timer) return;
    // Initial slight delay so startup recovery completes before the first tick.
    setTimeout(() => void this.fire(), 3_000).unref?.();
    this.timer = setInterval(() => void this.fire(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
  }

  private async fire(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.tick();
    } catch {
      // A failing tick must never crash the scheduler; per-job errors are
      // recorded on the fire cursor by the caller.
    } finally {
      this.running = false;
    }
  }
}
