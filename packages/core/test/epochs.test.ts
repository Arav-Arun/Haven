import fc from "fast-check";
import { describe, expect, it } from "vitest";

import { equalBytes, sha256 } from "../src/crypto";
import {
  chainHead,
  deriveEpochKey,
  epochAt,
  epochEnd,
  epochIndexForUntil,
  epochKeyFor,
  EPOCHS,
  epochSecondsFor,
  isEpochPlausible,
  isExhausted,
  rosterKey,
  type EpochSchedule,
} from "../src/epochs";

const secret = fc.uint8Array({ minLength: 32, maxLength: 32 });

describe("key regression", () => {
  it("a holder of E[j] can derive E[i] for every i ≤ j and never E[j+1]", () => {
    fc.assert(
      fc.property(secret, fc.integer({ min: 0, max: 150 }), (fs, j) => {
        const head = chainHead(fs);
        // Reference chain straight from the spec, E[i-1] = SHA-256(E[i]), walking down from E[j+1].
        const reference: Uint8Array[] = [];
        reference[j + 1] = deriveEpochKey(head, j + 1);
        for (let i = j + 1; i > 0; i--) reference[i - 1] = sha256(reference[i]!);
        expect(deriveEpochKey(head, 0)).toEqual(reference[0]);
        const held = { index: j, key: reference[j]! };
        for (let i = 0; i <= j; i++) expect(deriveEpochKey(held, i)).toEqual(reference[i]);
        // the API refuses to go up…
        expect(() => deriveEpochKey(held, j + 1)).toThrow(expect.objectContaining({ code: "NOT_AUTHORIZED" }));
        // …because E[j+1] is a SHA-256 preimage of E[j], and nothing the holder can compute equals it
        expect(sha256(reference[j + 1]!)).toEqual(reference[j]);
        for (let i = 0; i <= j; i++) expect(equalBytes(deriveEpochKey(held, i), reference[j + 1]!)).toBe(false);
      }),
      { numRuns: 40 },
    );
  });

  it("works at the top of the chain and keeps folders independent", () => {
    const head = chainHead(new Uint8Array(32).fill(1));
    expect(head.index).toBe(EPOCHS);
    const top = { index: EPOCHS - 1, key: deriveEpochKey(head, EPOCHS - 1) };
    expect(deriveEpochKey(top, 0)).toEqual(deriveEpochKey(head, 0));
    expect(() => deriveEpochKey(top, EPOCHS)).toThrow();
    expect(chainHead(new Uint8Array(32).fill(2)).key).not.toEqual(head.key);
    expect(rosterKey(new Uint8Array(32).fill(1))).not.toEqual(head.key);
    expect(() => deriveEpochKey(head, EPOCHS + 1)).toThrow(RangeError);
    expect(() => chainHead(new Uint8Array(16))).toThrow();
  });
});

describe("epoch maths", () => {
  const schedule = fc.record({
    t0: fc.integer({ min: 1_700_000_000, max: 1_900_000_000 }),
    epochSeconds: fc.constantFrom(epochSecondsFor(true), epochSecondsFor(false)),
  });

  it("a member's key is for the last epoch that ends at or before their end, and nothing written after it", () => {
    fc.assert(
      fc.property(schedule, fc.integer({ min: -100_000, max: 40_000_000 }), fc.nat(10_000_000), (s, offset, later) => {
        const until = s.t0 + offset;
        const index = epochIndexForUntil(s, until);
        if (index === null) {
          expect(epochEnd(s, 0)).toBeGreaterThan(until); // no epoch ends by `until`
          return;
        }
        expect(epochEnd(s, index)).toBeLessThanOrEqual(until);
        if (index < EPOCHS) expect(epochEnd(s, index + 1)).toBeGreaterThan(until);
        // any file written at or after `until` is in a later epoch than the one they hold
        const written = Math.max(until, s.t0) + later;
        expect(epochAt(s, written)).toBeGreaterThan(index);
      }),
    );
  });

  it("no end date gets E[N]; an end inside epoch 0 gets nothing", () => {
    const s: EpochSchedule = { t0: 1_800_000_000, epochSeconds: 60 };
    expect(epochIndexForUntil(s, null)).toBe(EPOCHS);
    expect(epochIndexForUntil(s, s.t0 + 59)).toBeNull();
    expect(epochIndexForUntil(s, s.t0 + 60)).toBe(0);
    expect(epochIndexForUntil(s, s.t0 + 119)).toBe(0);
    expect(epochIndexForUntil(s, s.t0 + 10 ** 9)).toBe(EPOCHS);
    const head = chainHead(new Uint8Array(32).fill(7));
    expect(epochKeyFor(head, s, s.t0 + 30)).toBeNull();
    expect(epochKeyFor(head, s, s.t0 + 125)).toEqual({ index: 1, key: deriveEpochKey(head, 1) });
  });

  it("epochAt, exhaustion, and the read rule against back-dating", () => {
    const s: EpochSchedule = { t0: 1_800_000_000, epochSeconds: 60 };
    expect(epochAt(s, s.t0)).toBe(0);
    expect(epochAt(s, s.t0 + 61)).toBe(1);
    expect(() => epochAt(s, s.t0 - 1)).toThrow(RangeError);
    expect(isExhausted(s, epochEnd(s, EPOCHS) - 1)).toBe(false);
    expect(isExhausted(s, epochEnd(s, EPOCHS))).toBe(true);
    expect(isEpochPlausible(s, 10, s.t0 + 10 * 60 + 5)).toBe(true);
    expect(isEpochPlausible(s, 9, s.t0 + 10 * 60 + 5)).toBe(true);
    expect(isEpochPlausible(s, 8, s.t0 + 10 * 60 + 5)).toBe(false);
    expect(isEpochPlausible(s, 0, s.t0 - 1)).toBe(false);
    expect(() => epochAt({ t0: s.t0, epochSeconds: 0 }, s.t0)).toThrow(RangeError);
  });
});
