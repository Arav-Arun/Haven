// The read rules, with every role question answered by a real DriveRegistry's history on a local chain.
// The Arkiv side is represented by records shaped exactly as arkiv.ts reads them (block numbers plus a block→time
// clock); the live A4 script runs the same rules against entities on Arkiv.

import type { Address, Hex } from "@cloakroom/types";
import { toHex } from "viem";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { EntityInfo, FileRecord, KeyCopyRecord, RefreshRecord, RotationRecord, TombRecord } from "../src/arkiv";
import { randomBytes } from "../src/crypto";
import { deployDrive, grantRoleUntil, revokeAccess } from "../src/ens";
import { epochAt, type EpochSchedule } from "../src/epochs";
import { registryHistory, Validator, type Clock } from "../src/validator";
import { startLocalChain, type LocalChain } from "./localchain";

let chain: LocalChain;
beforeAll(async () => {
  chain = await startLocalChain();
}, 30_000);
afterAll(() => chain?.stop());

/** Arkiv blocks and their times, as BlockClock would return them. */
class TestClock implements Clock {
  readonly times = new Map<bigint, number>();
  private next = 1000n;
  at(time: number): bigint {
    const block = this.next++;
    this.times.set(block, time);
    return block;
  }
  async timesOf(blocks: Iterable<bigint>) {
    const out = new Map<bigint, number>();
    for (const b of blocks) out.set(b, this.times.get(b)!);
    return out;
  }
}

const key = (): Hex => toHex(randomBytes(32));

function entity(creator: Address, block: bigint, readonly = true): EntityInfo {
  return { key: key(), creator, owner: creator, createdAtBlock: block, expiresAtBlock: block + 1_000_000n, readonly };
}

describe("validator", () => {
  it("hides each kind of bad write and keeps the good ones", async () => {
    const owner = await chain.newWriter();
    const { registry: folder } = await deployDrive(owner.writer, {
      implementation: chain.implementation,
      driveKey: owner.address,
      mainWallet: null,
      factory: chain.factory,
    });
    const editor = await chain.newWriter();
    const viewer = await chain.newWriter();
    const manager = await chain.newWriter();
    const outsider = await chain.newWriter();
    await grantRoleUntil(owner.writer, folder, editor.address, "editor", null);
    await grantRoleUntil(owner.writer, folder, viewer.address, "viewer", null);
    await grantRoleUntil(owner.writer, folder, manager.address, "manager", null);

    // a group that is a member of the folder, and one that isn't
    const groupOwner = await chain.newWriter();
    const { registry: group } = await deployDrive(groupOwner.writer, {
      implementation: chain.implementation,
      driveKey: groupOwner.address,
      mainWallet: null,
      factory: chain.factory,
    });
    await grantRoleUntil(owner.writer, folder, group, "viewer", null);
    const groupViewer = await chain.newWriter(); // a member of the group, but not its manager
    await grantRoleUntil(groupOwner.writer, group, groupViewer.address, "viewer", null);
    const strangerOwner = await chain.newWriter();
    const { registry: strangerGroup } = await deployDrive(strangerOwner.writer, {
      implementation: chain.implementation,
      driveKey: strangerOwner.address,
      mainWallet: null,
      factory: chain.factory,
    });

    const T = await chain.now();
    await chain.warp(600); // every record time below is in the past now
    await revokeAccess(owner.writer, folder, editor.address);
    const removedAt = await chain.now();
    await chain.warp(60);

    const clock = new TestClock();
    const s1: EpochSchedule = { t0: T, epochSeconds: 60 };
    const s2: EpochSchedule = { t0: T + 420, epochSeconds: 60 };
    const rotation = (who: Address, time: number, version: number, t0: number, epochLength = 60): RotationRecord => ({
      ...entity(who, clock.at(time)),
      folder,
      version,
      t0,
      epochLength,
      name: new Uint8Array(40),
    });
    const file = (
      who: Address,
      time: number,
      version: number,
      epoch: number,
      opts: { readonly?: boolean; fileId?: string } = {},
    ): FileRecord => ({
      ...entity(who, clock.at(time), opts.readonly ?? true),
      folder,
      fileId: opts.fileId ?? toHex(randomBytes(16)).slice(2),
      version,
      epoch,
      swarmRef: key(),
      meta: new Uint8Array(60),
    });
    const refresh = (who: Address, time: number, fromGroup: Address): RefreshRecord => ({
      ...entity(who, clock.at(time)),
      folder,
      group: fromGroup,
      reason: new Uint8Array(30),
    });
    const tomb = (who: Address, time: number, fileId: string): TombRecord => ({
      ...entity(who, clock.at(time)),
      folder,
      fileId,
    });

    const rot1 = rotation(owner.address, T, 1, T);
    const rotByOutsider = rotation(outsider.address, T + 1, 1, T);
    const good1 = file(editor.address, T + 5, 1, epochAt(s1, T + 5));
    const byOutsider = file(outsider.address, T + 6, 1, epochAt(s1, T + 6));
    const byViewer = file(viewer.address, T + 7, 1, epochAt(s1, T + 7));
    const backDated = file(editor.address, T + 300, 1, 0);
    const futureVersion = file(editor.address, T + 301, 2, epochAt(s1, T + 301));
    const editable = file(editor.address, T + 302, 1, epochAt(s1, T + 302), { readonly: false });
    const groupRefresh = refresh(groupOwner.address, T + 400, group);
    const strangerRefresh = refresh(strangerOwner.address, T + 401, strangerGroup);
    const viewerRefresh = refresh(groupViewer.address, T + 402, group);
    const duringRefresh = file(editor.address, T + 410, 1, epochAt(s1, T + 410));
    const managerDuringRefresh = file(owner.address, T + 411, 1, epochAt(s1, T + 411));
    const rot2 = rotation(owner.address, T + 420, 2, T + 420);
    const rot2Duplicate = rotation(manager.address, T + 421, 2, T + 421);
    const badRotation = rotation(manager.address, T + 422, 3, T + 422, 7);
    const stale = file(editor.address, T + 430, 1, epochAt(s1, T + 430));
    const good2 = file(editor.address, T + 431, 2, epochAt(s2, T + 431));
    const tombGood1 = tomb(editor.address, T + 440, good1.fileId);
    const tombByOutsider = tomb(outsider.address, T + 441, good2.fileId);
    const reupload = file(editor.address, T + 445, 2, epochAt(s2, T + 445), { fileId: good1.fileId });
    const afterRemoval = file(editor.address, removedAt + 5, 2, epochAt(s2, removedAt + 5));

    const validator = new Validator(registryHistory(chain.public), clock);
    const reading = await validator.folder({
      folder,
      rotations: [rot2Duplicate, rot1, rotByOutsider, rot2, badRotation],
      refreshes: [groupRefresh, strangerRefresh, viewerRefresh],
      files: [good1, byOutsider, byViewer, backDated, futureVersion, editable, duringRefresh, managerDuringRefresh, stale, good2, reupload, afterRemoval],
      tombs: [tombGood1, tombByOutsider],
      malformed: 2,
    });

    // good1 was deleted by its tomb; a later upload under the same file id is a new version and shows
    expect(reading.files.map((f) => f.key)).toEqual([managerDuringRefresh.key, good2.key, reupload.key]);
    expect(reading.latestVersion).toBe(2);
    expect(reading.versions.get(2)?.key).toBe(rot2.key); // the earliest valid rotation of a version counts
    expect(reading.refreshOpen).toBe(false); // rot2 closed it

    const reasons = new Map(reading.hiddenFiles.map((h) => [h.record.key, h.reason]));
    expect(reasons).toEqual(
      new Map([
        [byOutsider.key, "no-role"],
        [byViewer.key, "no-role"],
        [afterRemoval.key, "no-role"],
        [editable.key, "not-readonly"],
        [backDated.key, "back-dated"],
        [futureVersion.key, "unknown-version"],
        [duringRefresh.key, "refresh-open"],
        [stale.key, "stale-version"],
      ]),
    );
    expect(reading.hiddenRotations.map((h) => [h.record.key, h.reason])).toEqual(
      expect.arrayContaining([
        [rotByOutsider.key, "no-role"],
        [badRotation.key, "bad-rotation"],
      ]),
    );
    expect(reading.hiddenRefreshes.map((h) => h.record.key)).toEqual([strangerRefresh.key, viewerRefresh.key]);
    expect(reading.hiddenTombs.map((h) => h.record.key)).toEqual([tombByOutsider.key]);
    // 8 files + 2 rotations + 2 refreshes + 1 tomb + 2 malformed
    expect(reading.hidden).toBe(15);
  }, 30_000);

  it("an open refresh blocks editors until a newer rotation; key copies need SHARE", async () => {
    const owner = await chain.newWriter();
    const { registry: folder } = await deployDrive(owner.writer, {
      implementation: chain.implementation,
      driveKey: owner.address,
      mainWallet: null,
      factory: chain.factory,
    });
    const editor = await chain.newWriter();
    await grantRoleUntil(owner.writer, folder, editor.address, "editor", null);
    const T = await chain.now();
    await chain.warp(300);

    const clock = new TestClock();
    const validator = new Validator(registryHistory(chain.public), clock);
    const reading = await validator.folder({
      folder,
      rotations: [{ ...entity(owner.address, clock.at(T)), folder, version: 1, t0: T, epochLength: 60, name: new Uint8Array() }],
      // the owner of the folder itself can't open a refresh: only a group's manager, for a group that is a member
      refreshes: [{ ...entity(owner.address, clock.at(T + 10)), folder, group: folder, reason: new Uint8Array() }],
      files: [],
      tombs: [],
    });
    expect(reading.refreshOpen).toBe(false);
    expect(reading.hiddenRefreshes).toHaveLength(1);

    const copy = (who: Address): KeyCopyRecord => ({
      ...entity(who, clock.at(T + 20)),
      folder,
      recipient: editor.address,
      version: 1,
      sealed: new Uint8Array(69),
    });
    const ok = copy(owner.address);
    const planted = copy(editor.address);
    const checked = await validator.shareRecords([ok, planted]);
    expect(checked.valid.map((c) => c.key)).toEqual([ok.key]);
    expect(checked.valid[0]?.createdAt).toBe(T + 20);
    expect(checked.hidden).toEqual([{ record: planted, reason: "no-role" }]);
  }, 30_000);
});
