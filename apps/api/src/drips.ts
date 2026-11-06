// POST /drip's sender (CLOAKROOM_PLAN.md sections 8 and 9): gas for K or K_room only, queued and sent in one batch
// every DRIP_INTERVAL_SECONDS in a shuffled order, so the timing of a transfer doesn't point back at the request.
// Never below the relayer's balance floor; within a daily budget per chain; a key that already has enough gets nothing.

import { sendGlm, type ArkivWriter, type SepoliaWriter } from "@cloakroom/core";
import type { Address } from "@cloakroom/types";
import { getBalance } from "viem/actions";

import { DailyCounters } from "./limits";

export interface DripSettings {
  sepoliaWei: bigint;
  arkivWei: bigint;
  intervalSeconds: number;
  /** The relayer never goes below this on either chain. */
  floorWei: bigint;
  /** Per chain, per UTC day. */
  dailyBudgetWei: bigint;
}

export interface DripResult {
  sepolia: number;
  arkiv: number;
  skipped: number;
}

export class DripQueue {
  private readonly pending = new Set<Address>();
  private readonly budget: DailyCounters;
  private timer: ReturnType<typeof setInterval> | null = null;
  private flushing: Promise<DripResult> | null = null;
  private nextAt: number;

  constructor(
    private readonly sepolia: SepoliaWriter,
    private readonly arkiv: ArkivWriter | null,
    private readonly settings: DripSettings,
    private readonly now: () => number,
  ) {
    this.budget = new DailyCounters(now);
    this.nextAt = now() + settings.intervalSeconds;
  }

  enqueue(key: Address): { sendsBy: number } {
    this.pending.add(key);
    return { sendsBy: this.nextAt };
  }

  get size(): number {
    return this.pending.size;
  }

  start() {
    if (this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.settings.intervalSeconds * 1000);
    this.timer.unref?.();
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Sends everything queued, one key after another in random order. Safe to call while a flush runs. */
  flush(): Promise<DripResult> {
    if (!this.flushing) {
      this.flushing = this.sendAll().finally(() => {
        this.flushing = null;
        this.nextAt = this.now() + this.settings.intervalSeconds;
      });
    }
    return this.flushing;
  }

  private async sendAll(): Promise<DripResult> {
    const keys = [...this.pending];
    this.pending.clear();
    for (let i = keys.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [keys[i], keys[j]] = [keys[j]!, keys[i]!];
    }
    const result: DripResult = { sepolia: 0, arkiv: 0, skipped: 0 };
    for (const key of keys) {
      try {
        if (await this.sendSepolia(key)) result.sepolia++;
        else result.skipped++;
        if (this.arkiv && (await this.sendArkiv(this.arkiv, key))) result.arkiv++;
      } catch {
        result.skipped++; // a failed transfer is retried only if the key asks again
      }
    }
    return result;
  }

  private async sendSepolia(key: Address): Promise<boolean> {
    const amount = this.settings.sepoliaWei;
    if (amount === 0n) return false;
    const client = this.sepolia.public;
    if ((await client.getBalance({ address: key })) >= amount) return false;
    const own = await client.getBalance({ address: this.sepolia.wallet.account.address });
    if (own - amount < this.settings.floorWei) return false;
    if (!this.budget.take("sepolia", amount, this.settings.dailyBudgetWei)) return false;
    const hash = await this.sepolia.wallet.sendTransaction({ to: key, value: amount });
    await client.waitForTransactionReceipt({ hash });
    return true;
  }

  private async sendArkiv(arkiv: ArkivWriter, key: Address): Promise<boolean> {
    const amount = this.settings.arkivWei;
    if (amount === 0n) return false;
    if ((await getBalance(arkiv, { address: key })) >= amount) return false;
    const own = await getBalance(arkiv, { address: arkiv.account.address });
    if (own - amount < this.settings.floorWei) return false;
    if (!this.budget.take("arkiv", amount, this.settings.dailyBudgetWei)) return false;
    await sendGlm(arkiv, key, amount);
    return true;
  }
}
