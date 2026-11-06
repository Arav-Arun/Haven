// Receipts: what each action did, step by step, for the receipts panel (DriveClient.onReceipt).
// Writers in ens.ts, arkiv.ts and swarm.ts take a StepSink and report every transaction, upload, check and route.

import type { DriveErrorCode, Receipt, ReceiptStep } from "@haven/types";
import { DriveError } from "@haven/types";

import { randomBytes } from "./crypto";

export type StepSink = (step: ReceiptStep) => void;

export const ignoreSteps: StepSink = () => {};

export type ReceiptListener = (receipt: Receipt) => void;

/** One running action. Every change emits a fresh copy of the receipt to the listeners. */
export class ReceiptRun {
  private readonly receipt: Receipt;

  constructor(
    action: string,
    private readonly emit: (receipt: Receipt) => void,
  ) {
    const id = Array.from(randomBytes(8), (b) => b.toString(16).padStart(2, "0")).join("");
    this.receipt = { id, action, startedAt: Math.floor(Date.now() / 1000), steps: [], done: false };
    this.publish();
  }

  /** Bound, so it can be passed straight to a writer as its StepSink. */
  readonly step: StepSink = (step) => {
    this.receipt.steps.push(step);
    this.publish();
  };

  finish(error?: unknown): Receipt {
    this.receipt.done = true;
    if (error !== undefined) this.receipt.error = errorCode(error);
    this.publish();
    return this.snapshot();
  }

  snapshot(): Receipt {
    return { ...this.receipt, steps: [...this.receipt.steps] };
  }

  private publish(): void {
    this.emit(this.snapshot());
  }
}

export class Receipts {
  private readonly listeners = new Set<ReceiptListener>();

  on(listener: ReceiptListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(action: string): ReceiptRun {
    return new ReceiptRun(action, (receipt) => {
      for (const listener of this.listeners) listener(receipt);
    });
  }

  /** Runs `body` as one receipt: finished on success, finished with the error code on failure. */
  async run<T>(action: string, body: (step: StepSink) => Promise<T>): Promise<T> {
    const run = this.start(action);
    try {
      const result = await body(run.step);
      run.finish();
      return result;
    } catch (error) {
      run.finish(error);
      throw error;
    }
  }
}

function errorCode(error: unknown): DriveErrorCode {
  return error instanceof DriveError ? error.code : "UNKNOWN";
}
