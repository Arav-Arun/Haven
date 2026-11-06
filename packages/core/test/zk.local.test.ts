// Add-on Z1 end to end on a local chain: the writer group comes from a real DriveRegistry's history, and anonymous
// entries go through Validator.folder with every file rule (version, epoch, refresh) applied after the proof.

import { readFile } from "node:fs/promises";

import type { Address, Hex } from "@haven/types";
import { toHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EntityInfo, RotationRecord, ZkFileRecord, ZkJoinRecord } from "../src/arkiv";
import { randomBytes } from "../src/crypto";
import { deployDrive, grantRoleUntil, revokeAccess } from "../src/ens";
import { epochAt, type EpochSchedule } from "../src/epochs";
import { registryHistory, Validator, type Clock } from "../src/validator";
import { loadZkArtifacts, packProof, proveWrite, zkFileMessage, zkIdentity, zkJoinTypedData, type ZkArtifacts } from "../src/zk";
import { startLocalChain, type LocalChain } from "./localchain";

let chain: LocalChain;
let files: ZkArtifacts;
beforeAll(async () => {
  chain = await startLocalChain();
  files = await loadZkArtifacts((path) => readFile(new URL(`../../../apps/api${path}`, import.meta.url)).then((b) => new Uint8Array(b)));
}, 30_000);
afterAll(() => chain?.stop());

class TestClock implements Clock {
  readonly times = new Map<bigint, number>();
  private next = 1000n;
  at(time: number): bigint {
    const block = this.next++;
    this.times.set(block, time);
    return block;
  }
  async timesOf(blocks: Iterable<bigint>) {
    return new Map([...blocks].map((b) => [b, this.times.get(b)!]));
  }
}

const key = (): Hex => toHex(randomBytes(32));
const relayer = privateKeyToAccount(`0x${"11".repeat(32)}`).address;
const entity = (creator: Address, block: bigint): EntityInfo => ({ key: key(), creator, owner: creator, createdAtBlock: block, expiresAtBlock: block + 1_000_000n, readonly: true });

describe("anonymous writes on a real registry", () => {
  it("counts a proved entry from a current writer, and hides it once that writer is removed", async () => {
    const owner = await chain.newWriter();
    const { registry: folder } = await deployDrive(owner.writer, { implementation: chain.implementation, driveKey: owner.address, mainWallet: null, factory: chain.factory });
    const editor = await chain.newWriter();
    const viewer = await chain.newWriter();
    await grantRoleUntil(owner.writer, folder, editor.address, "editor", null);
    await grantRoleUntil(owner.writer, folder, viewer.address, "viewer", null);
    const T = await chain.now();
    await chain.warp(600);
    await revokeAccess(owner.writer, folder, editor.address);
    const removedAt = await chain.now();
    await chain.warp(60);

    const clock = new TestClock();
    const schedule: EpochSchedule = { t0: T, epochSeconds: 60 };
    const rotation: RotationRecord = { ...entity(owner.address, clock.at(T)), folder, version: 1, t0: T, epochLength: 60, name: new Uint8Array(40) };
    const join = async (w: { key: Hex; address: Address }, time: number): Promise<ZkJoinRecord> => {
      const commitment = zkIdentity(w.key, folder).commitment.toString();
      const sig = await privateKeyToAccount(w.key).signTypedData(zkJoinTypedData({ folder, member: w.address, commitment }));
      return { ...entity(relayer, clock.at(time)), folder, member: w.address, commitment, sig };
    };
    // the viewer's join doesn't count: viewers can't write
    const joins = [await join(owner, T + 1), await join(editor, T + 2), await join(viewer, T + 3)];
    const group = [owner, editor].map((w) => zkIdentity(w.key, folder).commitment);

    const anonymous = async (w: { key: Hex }, time: number, opts: { epoch?: number } = {}): Promise<ZkFileRecord> => {
      const fields = { folder, fileId: toHex(randomBytes(16)).slice(2), version: 1, epoch: opts.epoch ?? epochAt(schedule, time), swarmRef: key(), meta: randomBytes(60) };
      const proof = await proveWrite(zkIdentity(w.key, folder), group, zkFileMessage(fields), files);
      return { ...entity(relayer, clock.at(time)), ...fields, proof: packProof(proof) };
    };
    const good = await anonymous(editor, T + 10);
    const backDated = await anonymous(editor, T + 300, { epoch: 0 });
    const afterRemoval = await anonymous(owner, removedAt + 5); // proved against a group that still had the editor

    const reading = await new Validator(registryHistory(chain.public), clock).folder({
      folder,
      rotations: [rotation],
      refreshes: [],
      files: [],
      tombs: [],
      zk: { files: [good, backDated, afterRemoval], joins },
    });
    expect(reading.files.map((f) => f.key)).toEqual([good.key]);
    expect(reading.files[0]!.zk?.writers).toBe(2);
    expect(reading.files[0]!.creator).toBe(relayer);
    const why = new Map(reading.hiddenFiles.map((h) => [h.record.key, h.reason]));
    expect(why.get(backDated.key)).toBe("back-dated");
    expect(why.get(afterRemoval.key)).toBe("not-a-writer");
  }, 120_000);
});
