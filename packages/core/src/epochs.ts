// Epoch keys by key regression (HAVEN_PLAN.md section 7).
//
// Each folder version v has a random secret FS_v, a start time t0 and an epoch length L.
//   E[N]   = HKDF(FS_v, "chain")
//   E[i-1] = SHA-256(E[i])
// Epoch i covers [t0 + i·L, t0 + (i+1)·L). Holding E[j] lets you compute every E[i] with i ≤ j (hash forward), but
// no E[j+1], since that would mean inverting SHA-256. A member with access until T gets E[j] for the last epoch that
// ends at or before T, so files written after T use keys they can't compute. No transaction is needed.

import { DriveError, type Timestamp } from "@haven/types";

import { hkdf, sha256 } from "./crypto";

/** N: epochs per folder version. 8,760 one-hour epochs ≈ one year; in demo mode, one-minute epochs ≈ six days. */
export const EPOCHS = 8_760;
export const EPOCH_SECONDS = 3_600;
export const DEMO_EPOCH_SECONDS = 60;

export function epochSecondsFor(demoMode: boolean): number {
  return demoMode ? DEMO_EPOCH_SECONDS : EPOCH_SECONDS;
}

/** The timing of one folder version (stored in its haven.rotation entity). */
export interface EpochSchedule {
  t0: Timestamp;
  epochSeconds: number;
}

/** An epoch key together with its index: holding it gives every key with a lower or equal index. */
export interface EpochKey {
  index: number;
  key: Uint8Array;
}

// ---------------------------------------------------------------- keys

/** E[N], the top of the chain. Only managers (who hold FS_v) can compute it. */
export function chainHead(folderSecret: Uint8Array): EpochKey {
  if (folderSecret.length !== 32) throw new Error("folder secret must be 32 bytes");
  return { index: EPOCHS, key: hkdf(folderSecret, "chain") };
}

/** E[i] from a held E[j], for i ≤ j. Asking for a later epoch is refused: it can't be computed. */
export function deriveEpochKey(held: EpochKey, i: number): Uint8Array {
  if (!Number.isInteger(i) || i < 0 || i > EPOCHS) throw new RangeError(`epoch index out of range: ${i}`);
  if (i > held.index) {
    throw new DriveError("NOT_AUTHORIZED", `epoch ${i} is after your access ended (epoch ${held.index})`);
  }
  let key = held.key;
  for (let n = held.index; n > i; n--) key = sha256(key);
  return key;
}

/** The key managers seal the roster with (HAVEN_PLAN.md section 7, "Member key"). */
export function rosterKey(folderSecret: Uint8Array): Uint8Array {
  return hkdf(folderSecret, "managers");
}

// ---------------------------------------------------------------- time

/** The epoch that contains time t. Can exceed N, which means the version is used up and needs a new one. */
export function epochAt(schedule: EpochSchedule, t: Timestamp): number {
  assertSchedule(schedule);
  if (t < schedule.t0) throw new RangeError(`time ${t} is before the version started (${schedule.t0})`);
  return Math.floor((t - schedule.t0) / schedule.epochSeconds);
}

export function epochStart(schedule: EpochSchedule, i: number): Timestamp {
  return schedule.t0 + i * schedule.epochSeconds;
}

/** Exclusive end of epoch i. */
export function epochEnd(schedule: EpochSchedule, i: number): Timestamp {
  return schedule.t0 + (i + 1) * schedule.epochSeconds;
}

/** True once time t is past the last epoch of this version: writers must rotate to a new version first. */
export function isExhausted(schedule: EpochSchedule, t: Timestamp): boolean {
  return epochAt(schedule, t) > EPOCHS;
}

/**
 * The epoch index a member with access until `until` gets: the last epoch that ends at or before `until`.
 * `null` until means no end: they get E[N]. Returns null if no epoch ends by `until` (it falls inside epoch 0):
 * that member gets no key for this version, losing at most one epoch, never gaining one.
 */
export function epochIndexForUntil(schedule: EpochSchedule, until: Timestamp | null): number | null {
  assertSchedule(schedule);
  if (until === null) return EPOCHS;
  const i = Math.floor((until - schedule.t0) / schedule.epochSeconds) - 1;
  if (i < 0) return null;
  return Math.min(i, EPOCHS);
}

/** The key to put in a member's key copy for this version, or null if they get none. */
export function epochKeyFor(
  head: EpochKey,
  schedule: EpochSchedule,
  until: Timestamp | null,
): EpochKey | null {
  const index = epochIndexForUntil(schedule, until);
  if (index === null) return null;
  return { index, key: deriveEpochKey(head, index) };
}

/**
 * Read rule: an entry claiming `epoch` but created at `createdAt` is plausible only if the claim is within one epoch
 * of the creation time. That stops back-dating a write into an epoch an expired member still holds.
 */
export function isEpochPlausible(schedule: EpochSchedule, epoch: number, createdAt: Timestamp): boolean {
  if (createdAt < schedule.t0) return false;
  return Math.abs(epochAt(schedule, createdAt) - epoch) <= 1;
}

function assertSchedule(s: EpochSchedule): void {
  if (!Number.isInteger(s.epochSeconds) || s.epochSeconds <= 0) throw new RangeError("epochSeconds must be > 0");
  if (!Number.isInteger(s.t0) || s.t0 < 0) throw new RangeError("t0 must be a unix time in seconds");
}
