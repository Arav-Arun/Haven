// Saved role-check passes (PassedChecks): reused without chain reads, and only kept once they can't change.
import type { Address, Hex } from "viem";
import { describe, expect, it } from "vitest";

import type { EntityInfo } from "../src/arkiv";
import { PASS_SETTLED_S, Validator, type AccessHistory, type Clock, type PassedChecks } from "../src/validator";

const REGISTRY = "0x00000000000000000000000000000000000000aa" as Address;
const now = Math.floor(Date.now() / 1000);

const record = (n: number, ageS: number, readonly = true): EntityInfo & { folder: Address; ageS: number } => ({
  key: `0x${n.toString(16).padStart(64, "0")}` as Hex,
  creator: "0x00000000000000000000000000000000000000c1" as Address,
  owner: "0x00000000000000000000000000000000000000c1" as Address,
  createdAtBlock: BigInt(n),
  expiresAtBlock: 10_000n,
  readonly,
  folder: REGISTRY,
  ageS,
});

function setup(records: ReturnType<typeof record>[]) {
  const calls = { history: 0, clock: 0 };
  const clock: Clock = {
    async timesOf(blocks) {
      calls.clock++;
      return new Map([...blocks].map((b) => [b, now - records.find((r) => r.createdAtBlock === b)!.ageS]));
    },
  };
  const history: AccessHistory = {
    async allowedMany(_registry, accounts) {
      calls.history++;
      return accounts.map(() => true);
    },
  };
  const saved = new Map<string, number>();
  const passed: PassedChecks = { get: (id) => saved.get(id), add: (id, at) => void saved.set(id, at) };
  return { calls, validator: () => new Validator(history, clock, passed), saved };
}

describe("Validator with saved passes", () => {
  it("keeps settled passes, then answers them with no chain reads, in the original order", async () => {
    const records = [record(1, 3600), record(2, 7200)];
    const { calls, validator, saved } = setup(records);
    const first = await validator().shareRecords(records);
    expect(first.valid.map((r) => r.key)).toEqual(records.map((r) => r.key));
    expect(saved.size).toBe(2);

    const before = { ...calls };
    const second = await validator().shareRecords([...records].reverse());
    expect(second.valid.map((r) => r.key)).toEqual([records[1]!.key, records[0]!.key]);
    expect(second.valid.map((r) => r.createdAt)).toEqual([now - 7200, now - 3600]);
    expect(calls).toEqual(before);
  });

  it("doesn't keep a pass for a record newer than PASS_SETTLED_S", async () => {
    const records = [record(1, 3600), record(2, PASS_SETTLED_S - 60)];
    const { validator, saved } = setup(records);
    await validator().shareRecords(records);
    expect(saved.size).toBe(1);
  });

  it("never serves a record that isn't read-only from a saved pass", async () => {
    const ok = record(1, 3600);
    const { validator, saved } = setup([ok]);
    await validator().shareRecords([ok]);
    expect(saved.size).toBe(1);
    const changed = { ...ok, readonly: false };
    const out = await validator().shareRecords([changed]);
    expect(out.valid).toEqual([]);
    expect(out.hidden.map((h) => h.reason)).toEqual(["not-readonly"]);
  });
});
