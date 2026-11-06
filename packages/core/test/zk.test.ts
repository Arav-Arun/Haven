// Add-on Z1: real Semaphore proofs over the pinned depth-5 artifacts (apps/api/zk), the writer group rebuilt from
// joins and an access history, and the validator's rules for anonymous entries.

import { readFile } from "node:fs/promises";

import type { Address, Hex } from "@haven/types";
import { getAddress, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { beforeAll, describe, expect, it, vi } from "vitest";

import type { ZkFileRecord, ZkJoinRecord } from "../src/arkiv";
import { randomBytes } from "../src/crypto";
import { ROLE_DRIVE_WRITE } from "../src/ens";
import type { AccessHistory, Clock } from "../src/validator";
import {
  checkJoins,
  checkZkFiles,
  groupRoot,
  loadZkArtifacts,
  madeBy,
  packProof,
  proveWrite,
  unpackProof,
  verifyWrite,
  writerGroups,
  zkFileMessage,
  zkIdentity,
  zkJoinTypedData,
  type ZkArtifacts,
} from "../src/zk";

const folder = getAddress(toHex(randomBytes(20)));
const key = (): Hex => toHex(randomBytes(32));

/** Who held WRITE when: [from, until) per address. Answers exactly like DriveRegistry.wasAllowedMany. */
class History implements AccessHistory {
  readonly spans = new Map<string, [number, number][]>();
  grant(a: Address, from: number, until = Number.MAX_SAFE_INTEGER) {
    this.spans.set(a.toLowerCase(), [...(this.spans.get(a.toLowerCase()) ?? []), [from, until]]);
  }
  async allowedMany(registry: Address, accounts: Address[], role: bigint, times: number[]) {
    expect(registry).toBe(folder);
    expect(role).toBe(ROLE_DRIVE_WRITE);
    return accounts.map((a, i) => (this.spans.get(a.toLowerCase()) ?? []).some(([f, u]) => times[i]! >= f && times[i]! < u));
  }
}

/** Block n is at time n. */
const clock: Clock = { timesOf: async (blocks) => new Map([...blocks].map((b) => [b, Number(b)])) };

async function join(memberKey: Hex, block: bigint, over: Partial<ZkJoinRecord> = {}): Promise<ZkJoinRecord> {
  const member = privateKeyToAccount(memberKey);
  const commitment = zkIdentity(memberKey, folder).commitment.toString();
  const sig = await member.signTypedData(zkJoinTypedData({ folder, member: member.address, commitment }));
  return { key: key(), creator: member.address, owner: member.address, createdAtBlock: block, expiresAtBlock: block + 10_000n, readonly: true, folder, member: member.address, commitment, sig, ...over };
}

const file = { folder, fileId: "f1", version: 1, epoch: 0, swarmRef: toHex(randomBytes(32)), meta: randomBytes(80) };

let files: ZkArtifacts;
beforeAll(async () => {
  files = await loadZkArtifacts((path) => readFile(new URL(`../../../apps/api${path}`, import.meta.url)).then((b) => new Uint8Array(b)));
});

describe("zk writes", () => {
  it("refuses proving files that don't match the pinned hashes", async () => {
    vi.resetModules();
    const fresh = await import("../src/zk");
    await expect(fresh.loadZkArtifacts(async () => new Uint8Array([1, 2, 3]))).rejects.toThrow(/pinned hashes/);
  });

  it("proves membership without saying which member, and binds the proof to the entry", async () => {
    const [a, b, c] = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
    const leaves = [a, b, c].map((k) => zkIdentity(k, folder).commitment);
    const root = groupRoot(leaves);
    const message = zkFileMessage(file);
    const proof = await proveWrite(zkIdentity(b, folder), leaves, message, files);

    expect(await verifyWrite(proof, { root, message })).toBe(true);
    // stored and read back: only the packed bytes are kept, the message comes from the entry's fields
    const back = unpackProof(packProof(proof), zkFileMessage(file));
    expect(await verifyWrite(back, { root, message })).toBe(true);
    // any change to the entry's fields gives another message, and the proof no longer verifies for it
    const otherMessage = zkFileMessage({ ...file, epoch: 1 });
    expect(await verifyWrite(unpackProof(packProof(proof), otherMessage), { root, message: otherMessage })).toBe(false);
    // another group's root fails
    expect(await verifyWrite(proof, { root: groupRoot(leaves.slice(0, 2)), message })).toBe(false);
    // only the writer can tell it's theirs
    expect(madeBy(zkIdentity(b, folder), proof)).toBe(true);
    expect(madeBy(zkIdentity(a, folder), proof)).toBe(false);
    // the same key gives a different identity in another folder
    expect(zkIdentity(b, getAddress(toHex(randomBytes(20)))).commitment).not.toBe(leaves[1]);
  }, 60_000);

  it("refuses to prove for someone outside the group", async () => {
    const leaves = [generatePrivateKey(), generatePrivateKey()].map((k) => zkIdentity(k, folder).commitment);
    await expect(proveWrite(zkIdentity(generatePrivateKey(), folder), leaves, 1n, files)).rejects.toThrow(/writer group/);
  });

  it("builds the writer group from signed joins and the access history", async () => {
    const history = new History();
    const [a, b, c, d] = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
    const [A, B, C, D] = [a, b, c, d].map((k) => privateKeyToAccount(k).address);
    history.grant(A!, 0);
    history.grant(B!, 0, 500); // access ends at 500
    history.grant(C!, 0);
    // D never held WRITE
    const forged = await join(c, 30n);
    const joins = [
      await join(a, 10n),
      await join(b, 20n),
      { ...forged, member: A! }, // signed by C, claims to be A
      await join(d, 40n),
      await join(c, 50n, { readonly: false }),
      await join(c, 60n),
      await join(a, 70n), // a second join by A: only the first counts
    ];
    const { writers } = await checkJoins(joins, folder, history, clock);
    expect(writers.map((w) => w.member)).toEqual([A, B, C]);

    const [early, late, before] = await writerGroups(writers, folder, history, [
      { block: 100n, time: 100 },
      { block: 600n, time: 600 },
      { block: 15n, time: 15 },
    ]);
    const id = (k: Hex) => zkIdentity(k, folder).commitment;
    expect(early).toEqual([id(a), id(b), id(c)]);
    expect(late).toEqual([id(a), id(c)]); // B's access ended
    expect(before).toEqual([id(a)]); // only A had joined by block 15
  });

  it("keeps valid anonymous entries and hides forged, tampered and out-of-group ones", async () => {
    const history = new History();
    const [a, b, gone] = [generatePrivateKey(), generatePrivateKey(), generatePrivateKey()];
    for (const k of [a, b]) history.grant(privateKeyToAccount(k).address, 0);
    history.grant(privateKeyToAccount(gone).address, 0, 150);
    const joins = [await join(a, 10n), await join(b, 11n), await join(gone, 12n)];
    const groupAt100 = [a, b, gone].map((k) => zkIdentity(k, folder).commitment);
    const groupAt200 = [a, b].map((k) => zkIdentity(k, folder).commitment);

    const entry = (block: bigint, fields: typeof file, proof: Uint8Array, readonly = true): ZkFileRecord => ({
      key: key(), creator: folder, owner: folder, createdAtBlock: block, expiresAtBlock: block + 10_000n, readonly, ...fields, swarmRef: fields.swarmRef as Hex, proof,
    });
    const good = entry(100n, file, packProof(await proveWrite(zkIdentity(a, folder), groupAt100, zkFileMessage(file), files)));
    const other = { ...file, fileId: "f2" };
    const tampered = entry(100n, { ...other, epoch: 3 }, packProof(await proveWrite(zkIdentity(b, folder), groupAt100, zkFileMessage(other), files)));
    // proved against the old group (with `gone`) but written after gone's access ended
    const stale = entry(200n, other, packProof(await proveWrite(zkIdentity(gone, folder), groupAt100, zkFileMessage(other), files)));
    const outsider = generatePrivateKey();
    const fake = [...groupAt200, zkIdentity(outsider, folder).commitment];
    const outside = entry(200n, other, packProof(await proveWrite(zkIdentity(outsider, folder), fake, zkFileMessage(other), files)));
    const garbage = entry(100n, other, randomBytes(10));
    const mutable = entry(100n, file, good.proof, false);

    const { valid, hidden } = await checkZkFiles([good, tampered, stale, outside, garbage, mutable], joins, folder, history, clock);
    expect(valid.map((v) => v.key)).toEqual([good.key]);
    expect(valid[0]!.zk.writers).toBe(3);
    const why = new Map(hidden.map((h) => [h.record.key, h.reason]));
    expect(why.get(tampered.key)).toBe("bad-proof");
    expect(why.get(stale.key)).toBe("not-a-writer");
    expect(why.get(outside.key)).toBe("not-a-writer");
    expect(why.get(garbage.key)).toBe("bad-proof");
    expect(why.get(mutable.key)).toBe("not-readonly");
  }, 120_000);
});
