// Abuse limits: the only state the API keeps (CLOAKROOM_PLAN.md section 15, "Logs: rate-limit counters for 24 hours,
// nothing else"). Counters are keyed by a short hash (core's counterKey), never by a raw address, and are dropped at
// the start of each UTC day.

const DAY = 24 * 3600;

export class DailyCounters {
  private day: number;
  private readonly counts = new Map<string, number>();

  constructor(private readonly now: () => number) {
    this.day = Math.floor(now() / DAY);
  }

  private roll() {
    const today = Math.floor(this.now() / DAY);
    if (today !== this.day) {
      this.day = today;
      this.counts.clear();
    }
  }

  /** Adds `amount` under `key` if the total stays within `limit`; returns whether it did. */
  take(key: string, amount: number | bigint, limit: number | bigint): boolean {
    this.roll();
    const current = BigInt(this.counts.get(key) ?? 0);
    const next = current + BigInt(amount);
    if (next > BigInt(limit)) return false;
    this.counts.set(key, Number(next));
    return true;
  }

  /** Gives back what `take` added, when the action it paid for failed. */
  give(key: string, amount: number | bigint) {
    this.roll();
    const current = BigInt(this.counts.get(key) ?? 0);
    const next = current - BigInt(amount);
    if (next <= 0n) this.counts.delete(key);
    else this.counts.set(key, Number(next));
  }

  /** Seconds until the counters reset. */
  resetsIn(): number {
    return (this.day + 1) * DAY - this.now();
  }

  size(): number {
    this.roll();
    return this.counts.size;
  }
}
