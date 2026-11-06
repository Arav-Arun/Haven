// Add-on F2: the team-sharing rules. The planner and the runner are tested with the same share/removeMember shapes the
// client passes in; the live listing (listSubtreeHolders) reads Sepolia and the F1 key log in the live run.

import type { Address, Hex, ShareOptions } from "@cloakroom/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import fc from "fast-check";
import { bytesToHex, hexToBytes, namehash, toHex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { randomBytes, utf8 } from "../src/crypto";
import { compressKey } from "../src/keydir";
import { openRoster, sealRoster, type SubtreeRuleState } from "../src/records";
import {
  assertFits,
  dissolveSubtree,
  excludeFromRule,
  isDirectSubname,
  planSubtreeSync,
  previewSubtree,
  SUBTREE_CAP,
  syncSubtree,
  type SubnameHolder,
} from "../src/subtree";

const PARENT = "acme.eth";
const addr = (): Address => privateKeyToAddress(generatePrivateKey());
const key = (): Hex => compressKey(bytesToHex(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true)));

function rule(over: Partial<SubtreeRuleState> = {}): SubtreeRuleState {
  return {
    parent: PARENT,
    registry: addr(),
    role: "viewer",
    until: null,
    hideFromMembers: true,
    excluded: [],
    members: [],
    labels: [],
    scannedTo: 100,
    createdAt: 1_800_000_000,
    lastSyncedAt: 0,
    ...over,
  };
}

const holder = (label: string, k: Hex | null = key(), owner: Address = addr()): SubnameHolder => ({
  ensName: `${label}.${PARENT}`,
  owner,
  key: k,
});

/** What a member entry looks like after a share to `h` went to stealth address `address`. */
const memberOf = (h: SubnameHolder, address: Address = addr()) => ({
  ensName: h.ensName,
  address,
  owner: h.owner,
  key: h.key!,
  since: 1,
});

describe("planSubtreeSync", () => {
  it("adding a subname → the next sync shares with it", () => {
    const priya = holder("priya");
    const plan = planSubtreeSync(rule(), [priya], SUBTREE_CAP);
    expect(plan.add).toEqual([priya]);
    expect(plan.remove).toEqual([]);
  });

  it("an unchanged member is kept", () => {
    const priya = holder("priya");
    const plan = planSubtreeSync(rule({ members: [memberOf(priya)] }), [priya], SUBTREE_CAP);
    expect(plan).toEqual({ add: [], remove: [], skipped: [] });
  });

  it("a revoked or expired subname (gone from the live list) → removed", () => {
    const priya = holder("priya");
    const plan = planSubtreeSync(rule({ members: [memberOf(priya)] }), [], SUBTREE_CAP);
    expect(plan.remove.map((r) => r.reason)).toEqual(["gone"]);
  });

  it("excluding a name → removed, and never re-added", () => {
    const raj = holder("raj");
    const r = excludeFromRule(rule({ members: [memberOf(raj)] }), raj.ensName);
    const plan = planSubtreeSync(r, [raj], SUBTREE_CAP);
    expect(plan.remove.map((x) => x.reason)).toEqual(["excluded"]);
    expect(plan.add).toEqual([]);
  });

  it("a transfer → the old holder is removed and the new holder is shared fresh", () => {
    const before = holder("priya");
    const after = { ...before, owner: addr(), key: key() };
    const plan = planSubtreeSync(rule({ members: [memberOf(before)] }), [after], SUBTREE_CAP);
    expect(plan.remove.map((x) => x.reason)).toEqual(["transferred"]);
    expect(plan.add).toEqual([after]);
  });

  it("a new key, or a key log that stopped checking out, removes the old share", () => {
    const priya = holder("priya");
    const rotated = planSubtreeSync(rule({ members: [memberOf(priya)] }), [{ ...priya, key: key() }], SUBTREE_CAP);
    expect(rotated.remove.map((x) => x.reason)).toEqual(["key-changed"]);
    expect(rotated.add).toHaveLength(1);
    const broken = planSubtreeSync(rule({ members: [memberOf(priya)] }), [{ ...priya, key: null }], SUBTREE_CAP);
    expect(broken.remove.map((x) => x.reason)).toEqual(["no-key"]);
    expect(broken.skipped).toEqual([{ ensName: priya.ensName, reason: "no-key" }]);
  });

  it("names without a Cloakroom key are skipped, not shared with", () => {
    const plan = planSubtreeSync(rule(), [holder("nokey", null)], SUBTREE_CAP);
    expect(plan.add).toEqual([]);
    expect(plan.skipped).toEqual([{ ensName: "nokey.acme.eth", reason: "no-key" }]);
  });

  it("only direct subnames of the parent count", () => {
    expect(isDirectSubname("priya.acme.eth", PARENT)).toBe(true);
    expect(isDirectSubname("a.priya.acme.eth", PARENT)).toBe(false);
    expect(isDirectSubname("priya.notacme.eth", PARENT)).toBe(false);
    expect(isDirectSubname("acme.eth", PARENT)).toBe(false);
    const plan = planSubtreeSync(rule(), [{ ...holder("x"), ensName: "a.b.acme.eth" }, { ...holder("y"), ensName: "y.other.eth" }], SUBTREE_CAP);
    expect(plan.add).toEqual([]);
  });

  it("never adds past the capacity; the rest wait with reason cap", () => {
    const holders = Array.from({ length: 20 }, (_, i) => holder(`p${String(i).padStart(2, "0")}`));
    const plan = planSubtreeSync(rule(), holders, SUBTREE_CAP);
    expect(plan.add).toHaveLength(14);
    expect(plan.skipped.filter((s) => s.reason === "cap")).toHaveLength(6);
    // other members of the folder take slots too
    expect(planSubtreeSync(rule(), holders, 3).add).toHaveLength(3);
  });
});

describe("creating a rule", () => {
  it("more than 14 people with keys is refused with a clear message", () => {
    const holders = Array.from({ length: 15 }, (_, i) => holder(`m${i}`));
    const preview = previewSubtree(holders, PARENT);
    expect(preview).toMatchObject({ found: 15, withKey: 15 });
    expect(() => assertFits(preview.withKey, SUBTREE_CAP)).toThrow(/Use several rooms, or split the team/);
    expect(() => assertFits(14, SUBTREE_CAP)).not.toThrow();
  });

  it("the preview counts names with no Cloakroom key", () => {
    const preview = previewSubtree([holder("a"), holder("b", null), holder("c", null)], PARENT);
    expect(preview).toEqual({ found: 3, withKey: 1, withoutKey: ["b.acme.eth", "c.acme.eth"] });
  });
});

/** The client's share and removeMember, as a sync sees them: each share goes to a fresh random address. */
function fakeFolder() {
  const holders = new Set<Address>();
  const removed = new Set<Address>();
  const shares: { ensName: string; opts: ShareOptions }[] = [];
  return {
    holders,
    removed,
    shares,
    share: async (ensName: string, opts: ShareOptions) => {
      shares.push({ ensName, opts });
      const address = addr();
      holders.add(address);
      return { address };
    },
    removeMember: async (address: Address) => {
      holders.delete(address);
      removed.add(address);
    },
  };
}

describe("syncSubtree", () => {
  it("removes before it adds, shares with the rule's role and end date, and records the new state", async () => {
    const order: string[] = [];
    const folder = fakeFolder();
    const old = holder("old");
    const r = rule({ role: "editor", until: 1_900_000_000, members: [memberOf(old)] });
    const fresh = holder("new");
    const { rule: next, plan } = await syncSubtree(r, {
      listHolders: async () => ({ holders: [fresh], labels: ["new", "old"], scannedTo: 555 }),
      share: async (n, o) => {
        order.push(`share ${n}`);
        return folder.share(n, o);
      },
      removeMember: async (a) => {
        order.push("remove");
        await folder.removeMember(a);
      },
      capacity: SUBTREE_CAP,
      now: () => 42,
    });
    expect(order).toEqual(["remove", "share new.acme.eth"]);
    expect(folder.shares[0]!.opts).toEqual({ role: "editor", until: 1_900_000_000, hideFromMembers: true });
    expect(plan.remove.map((x) => x.reason)).toEqual(["gone"]);
    expect(next.members.map((m) => m.ensName)).toEqual(["new.acme.eth"]);
    expect(next).toMatchObject({ labels: ["new", "old"], scannedTo: 555, lastSyncedAt: 42 });
  });

  it("keeps a member whose removal failed, and asks a manager to refresh once", async () => {
    const [a, b] = [holder("a"), holder("b")];
    const refresh: string[] = [];
    const denied = Object.assign(new Error("no"), { code: "NOT_AUTHORIZED" });
    const result = await syncSubtree(rule({ members: [memberOf(a), memberOf(b)] }), {
      listHolders: async () => ({ holders: [], labels: [], scannedTo: 1 }),
      share: async () => ({ address: addr() }),
      removeMember: async () => {
        throw denied;
      },
      requestRefresh: async (why) => void refresh.push(why),
      capacity: SUBTREE_CAP,
      now: () => 1,
    });
    expect(result.rule.members).toHaveLength(2);
    expect(result.errors).toHaveLength(2);
    expect(result.refreshRequested).toBe(true);
    expect(refresh).toHaveLength(1);
  });

  it("dissolving a rule removes everyone it shared with", async () => {
    const folder = fakeFolder();
    const members = [memberOf(holder("a")), memberOf(holder("b"))];
    const { remaining } = await dissolveSubtree(rule({ members }), folder.removeMember);
    expect(remaining).toEqual([]);
    expect([...folder.removed].sort()).toEqual(members.map((m) => m.address).sort());
  });
});

describe("property: a sync always leaves exactly the people who should have access", () => {
  // A team of 6 possible labels. Each step changes ENS (register, expire, transfer, new key, key log breaks) or the
  // rule (exclude), then a sync runs. After every sync, every member must be a live, non-excluded holder under the
  // same owner and key; everyone who lost their place must have been removed (removeMember is what refreshes the
  // folder's keys, so files written after it are locked to them); and the folder never holds more than capacity.
  const LABELS = ["a", "b", "c", "d", "e", "f"] as const;
  const step = fc.record({
    label: fc.constantFrom(...LABELS),
    what: fc.constantFrom("register", "expire", "transfer", "rotate", "break-key", "exclude"),
  });

  it("holds over random sequences of team changes", async () => {
    await fc.assert(
      fc.asyncProperty(fc.array(step, { minLength: 1, maxLength: 25 }), fc.integer({ min: 1, max: 6 }), async (steps, capacity) => {
        const ens = new Map<string, SubnameHolder>();
        const folder = fakeFolder();
        let r = rule();
        const everRemovedNames = new Map<Address, string>();
        for (const s of steps) {
          const name = `${s.label}.${PARENT}`;
          const current = ens.get(name);
          if (s.what === "register" && !current) ens.set(name, holder(s.label));
          if (s.what === "expire") ens.delete(name);
          if (s.what === "transfer" && current) ens.set(name, { ...current, owner: addr(), key: key() });
          if (s.what === "rotate" && current) ens.set(name, { ...current, key: key() });
          if (s.what === "break-key" && current) ens.set(name, { ...current, key: null });
          if (s.what === "exclude") r = excludeFromRule(r, name);

          const before = new Map(r.members.map((m) => [m.address, m.ensName]));
          r = (
            await syncSubtree(r, {
              listHolders: async () => ({ holders: [...ens.values()], labels: [], scannedTo: 0 }),
              share: folder.share,
              removeMember: folder.removeMember,
              capacity,
              now: () => 0,
            })
          ).rule;

          for (const m of r.members) {
            const live = ens.get(m.ensName);
            expect(live).toBeDefined();
            expect(r.excluded).not.toContain(m.ensName);
            expect(live!.owner).toBe(m.owner);
            expect(live!.key).toBe(m.key);
            expect(folder.holders.has(m.address)).toBe(true);
          }
          for (const [address, ensName] of before) {
            if (!r.members.some((m) => m.address === address)) {
              expect(folder.removed.has(address)).toBe(true);
              everRemovedNames.set(address, ensName);
            }
          }
          expect(r.members.length).toBeLessThanOrEqual(capacity);
          expect(folder.holders.size).toBe(r.members.length);
        }
        // A removed stealth address is never handed access again: re-joining gets a fresh one.
        for (const address of everRemovedNames.keys()) expect(folder.holders.has(address)).toBe(false);
      }),
      { numRuns: 300 },
    );
  });
});

describe("privacy: the team name stays sealed", () => {
  it("the sealed roster holding a rule contains neither the parent name nor its namehash", async () => {
    const rosterKey = randomBytes(32);
    const folder = addr();
    const priya = holder("priya");
    const roster = {
      managers: [],
      members: [],
      subtrees: [rule({ members: [memberOf(priya)], labels: ["priya"] })],
    };
    const sealed = await sealRoster(rosterKey, folder, 1, roster);
    const haystack = toHex(new Uint8Array([...sealed.managers, ...sealed.members]));
    for (const needle of [utf8("acme"), utf8("priya"), hexToBytes(namehash(PARENT))]) {
      expect(haystack.includes(toHex(needle).slice(2))).toBe(false);
    }
    expect(await openRoster(rosterKey, folder, 1, sealed)).toEqual(roster);
  });

  it("a share sends the chain-facing side nothing but the subname itself (for the ENS lookup) and the options", async () => {
    const folder = fakeFolder();
    await syncSubtree(rule(), {
      listHolders: async () => ({ holders: [holder("priya")], labels: [], scannedTo: 0 }),
      share: folder.share,
      removeMember: folder.removeMember,
      capacity: SUBTREE_CAP,
      now: () => 0,
    });
    expect(folder.shares).toEqual([{ ensName: "priya.acme.eth", opts: { role: "viewer", until: null, hideFromMembers: true } }]);
  });

  it("rosters written before F2 (a bare manager array) still open", async () => {
    const rosterKey = randomBytes(32);
    const folder = addr();
    const plain = { managers: [], members: [] };
    expect(await openRoster(rosterKey, folder, 3, await sealRoster(rosterKey, folder, 3, plain))).toEqual(plain);
  });
});
