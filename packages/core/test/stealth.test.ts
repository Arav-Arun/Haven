import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes, type Address } from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { randomBytes } from "../src/crypto";
import { chainHead, deriveEpochKey } from "../src/epochs";
import { openKeyCopy, sealKeyCopy } from "../src/keycopies";
import { deriveKeys, ownSealKey, randomMaterial } from "../src/keys";
import { createWelcome, openWelcome } from "../src/stealth";

const folder: Address = "0x00000000000000000000000000000000000000f1";
const otherFolder: Address = "0x00000000000000000000000000000000000000f2";

describe("welcome notes", () => {
  it("round-trip: the recipient opens MK_S and gets the key of the address that was granted", async () => {
    for (let i = 0; i < 10; i++) {
      const recipient = deriveKeys(randomMaterial());
      const created = await createWelcome({ recipientSpendingPublicKey: recipient.spendingPublicKey, folder });
      const opened = await openWelcome({ spendingPrivateKey: recipient.spendingPrivateKey, folder, note: created.note });
      expect(opened).not.toBeNull();
      expect(opened!.memberKey).toEqual(created.memberKey);
      expect(opened!.stealthAddress).toBe(created.stealthAddress);
      expect(privateKeyToAddress(opened!.stealthPrivateKey)).toBe(created.stealthAddress);
    }
  });

  it("a wrong key, another folder or a tampered note doesn't match", async () => {
    const recipient = deriveKeys(randomMaterial());
    const stranger = deriveKeys(randomMaterial());
    const { note } = await createWelcome({ recipientSpendingPublicKey: recipient.spendingPublicKey, folder });

    expect(await openWelcome({ spendingPrivateKey: stranger.spendingPrivateKey, folder, note })).toBeNull();
    expect(
      await openWelcome({ spendingPrivateKey: recipient.spendingPrivateKey, folder: otherFolder, note }),
    ).toBeNull();
    const tampered = { ...note, sealedMemberKey: note.sealedMemberKey.slice() };
    tampered.sealedMemberKey[20]! ^= 1;
    expect(
      await openWelcome({ spendingPrivateKey: recipient.spendingPrivateKey, folder, note: tampered }),
    ).toBeNull();
    expect(
      await openWelcome({
        spendingPrivateKey: recipient.spendingPrivateKey,
        folder,
        note: { ...note, ephemeralPublicKey: "0x04deadbeef" },
      }),
    ).toBeNull();
  });

  it("scanning many notes finds exactly your own, and each share uses a fresh address", async () => {
    const people = Array.from({ length: 5 }, () => deriveKeys(randomMaterial()));
    const notes = await Promise.all(
      people.flatMap((p) => [0, 1].map(() => createWelcome({ recipientSpendingPublicKey: p.spendingPublicKey, folder }))),
    );
    expect(new Set(notes.map((n) => n.stealthAddress)).size).toBe(notes.length);
    for (const [i, person] of people.entries()) {
      const mine = [];
      for (const [j, n] of notes.entries()) {
        if (await openWelcome({ spendingPrivateKey: person.spendingPrivateKey, folder, note: n.note })) mine.push(j);
      }
      expect(mine).toEqual([2 * i, 2 * i + 1]);
    }
  });

  it("accepts a compressed cloak.key and refuses an invalid one with NO_CLOAK_KEY", async () => {
    const recipient = deriveKeys(randomMaterial());
    const compressed = bytesToHex(secp256k1.getPublicKey(hexToBytes(recipient.spendingPrivateKey), true));
    const created = await createWelcome({ recipientSpendingPublicKey: compressed, folder });
    const opened = await openWelcome({ spendingPrivateKey: recipient.spendingPrivateKey, folder, note: created.note });
    expect(opened?.stealthAddress).toBe(created.stealthAddress);
    await expect(createWelcome({ recipientSpendingPublicKey: "0x1234", folder })).rejects.toMatchObject({
      code: "NO_CLOAK_KEY",
    });
  });
});

describe("key copies", () => {
  it("a member opens their epoch key; a manager opens the folder secret; nothing else opens them", async () => {
    const memberKey = randomBytes(32);
    const fs = randomBytes(32);
    const e7 = deriveEpochKey(chainHead(fs), 7);

    const forMember = await sealKeyCopy(memberKey, folder, { kind: "epoch", version: 2, index: 7, key: e7 });
    expect(await openKeyCopy(memberKey, folder, 2, forMember)).toEqual({ kind: "epoch", version: 2, index: 7, key: e7 });

    const owner = deriveKeys(randomMaterial());
    const own = ownSealKey(owner.driveKey, folder);
    const forOwner = await sealKeyCopy(own, folder, { kind: "secret", version: 2, key: fs });
    expect(await openKeyCopy(own, folder, 2, forOwner)).toEqual({ kind: "secret", version: 2, key: fs });

    await expect(openKeyCopy(randomBytes(32), folder, 2, forMember)).rejects.toThrow();
    await expect(openKeyCopy(memberKey, otherFolder, 2, forMember)).rejects.toThrow();
    await expect(openKeyCopy(memberKey, folder, 3, forMember)).rejects.toThrow();
    await expect(sealKeyCopy(memberKey, folder, { kind: "epoch", version: 1, index: 9_999, key: e7 })).rejects.toThrow();
  });
});
