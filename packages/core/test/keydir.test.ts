// Add-on F1: the key log rules, with real EIP-712 signatures from fresh random keys. The records are shaped exactly as
// arkiv.ts reads them back from Arkiv; the live run (scripts/f1-live.ts) writes and reads the same entities on Arkiv.

import type { Address, Hex, KeyValueStore } from "@cloakroom/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, toHex } from "viem";
import { english, generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import type { DeviceRecord, KeyLogKind, KeyLogRecord } from "../src/arkiv";
import { randomBytes } from "../src/crypto";
import {
  assertCanShare,
  compressKey,
  keyFingerprint,
  keyInfoFrom,
  rememberKey,
  seenKey,
  signDevice,
  signKeyLogEntry,
  thisDevice,
  verifyDevices,
  verifyKeyLog,
  type VerifiedKeyLog,
} from "../src/keydir";

const NAME = "investor.cloakroom.eth";

const spendingKey = (): Hex => bytesToHex(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), false));

let block = 1000n;

interface EntryOpts {
  seq: number;
  kind: KeyLogKind;
  spendingPublicKey: Hex;
  prev: KeyLogRecord | null;
  devicePublicKey?: Hex | null;
  /** Who signs (default: K). */
  signedBy?: Hex;
  /** Who wrote the entity (default: the signer). */
  creator?: Address;
  ensName?: string;
  readonly?: boolean;
}

async function entry(k: Hex, o: EntryOpts): Promise<KeyLogRecord> {
  const unsigned = {
    ensName: o.ensName ?? NAME,
    seq: o.seq,
    kind: o.kind,
    spendingPublicKey: compressKey(o.spendingPublicKey),
    devicePublicKey: o.devicePublicKey ? compressKey(o.devicePublicKey) : null,
    prevEntryKey: o.prev?.key ?? null,
  };
  const signer = o.signedBy ?? k;
  const createdAtBlock = block++;
  return {
    ...unsigned,
    sig: await signKeyLogEntry(signer, unsigned),
    key: toHex(randomBytes(32)),
    creator: o.creator ?? privateKeyToAddress(signer),
    owner: o.creator ?? privateKeyToAddress(signer),
    createdAtBlock,
    expiresAtBlock: createdAtBlock + 7_884_000n,
    readonly: o.readonly ?? true,
  };
}

/** A K-signed chain: publish(key0), then a rotate to each further key. */
async function chain(k: Hex, keys: Hex[]): Promise<KeyLogRecord[]> {
  const out: KeyLogRecord[] = [];
  for (const [i, spendingPublicKey] of keys.entries()) {
    out.push(await entry(k, { seq: i, kind: i === 0 ? "publish" : "rotate", spendingPublicKey, prev: out[i - 1] ?? null }));
  }
  return out;
}

class MemoryStore implements KeyValueStore {
  private readonly map = new Map<string, Uint8Array>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: Uint8Array) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

function info(log: VerifiedKeyLog, ensKey: string | null, seen: Hex | null = null) {
  return keyInfoFrom({ ensName: NAME, log, malformed: 0, ensKey, seen, times: new Map() });
}

describe("key log: valid chains", () => {
  it("accepts publish → rotate → revoke-device, and the current key is the last publish or rotate", async () => {
    const k = generatePrivateKey();
    const [a, b] = [spendingKey(), spendingKey()];
    const device = spendingKey();
    const [e0, e1] = await chain(k, [a, b]);
    const e2 = await entry(k, { seq: 2, kind: "revoke-device", spendingPublicKey: b, devicePublicKey: device, prev: e1! });
    const log = await verifyKeyLog([e2, e0!, e1!], NAME, privateKeyToAddress(k));
    expect(log.entries.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(log.current).toBe(compressKey(b));
    expect(log.revokedDevices).toEqual([compressKey(device)]);
    expect(log.ignored).toBe(0);
  });

  it("an empty log has no current key, and KeyInfo refuses it with NO_CLOAK_KEY", async () => {
    const log = await verifyKeyLog([], NAME, privateKeyToAddress(generatePrivateKey()));
    expect(log.current).toBeNull();
    await expect(info(log, null)).rejects.toMatchObject({ code: "NO_CLOAK_KEY" });
  });
});

describe("key log: broken chains from K are rejected with KEY_MISMATCH", () => {
  it("a missing seq", async () => {
    const k = generatePrivateKey();
    const [e0, , e2] = await chain(k, [spendingKey(), spendingKey(), spendingKey()]);
    await expect(verifyKeyLog([e0!, e2!], NAME, privateKeyToAddress(k))).rejects.toMatchObject({ code: "KEY_MISMATCH" });
  });

  it("two entries with the same seq (a fork)", async () => {
    const k = generatePrivateKey();
    const [e0, e1] = await chain(k, [spendingKey(), spendingKey()]);
    const fork = await entry(k, { seq: 1, kind: "rotate", spendingPublicKey: spendingKey(), prev: e0! });
    await expect(verifyKeyLog([e0!, e1!, fork], NAME, privateKeyToAddress(k))).rejects.toThrow(/two entries with seq 1/);
  });

  it("a prevEntryKey that doesn't point at the previous entry", async () => {
    const k = generatePrivateKey();
    const [e0] = await chain(k, [spendingKey()]);
    const stray = await entry(k, { seq: 0, kind: "publish", spendingPublicKey: spendingKey(), prev: null });
    const e1 = await entry(k, { seq: 1, kind: "rotate", spendingPublicKey: spendingKey(), prev: stray });
    await expect(verifyKeyLog([e0!, e1], NAME, privateKeyToAddress(k))).rejects.toThrow(/doesn't point at entry 0/);
  });

  it("seq 0 that isn't a publish, and a later publish", async () => {
    const k = generatePrivateKey();
    const rotateFirst = await entry(k, { seq: 0, kind: "rotate", spendingPublicKey: spendingKey(), prev: null });
    await expect(verifyKeyLog([rotateFirst], NAME, privateKeyToAddress(k))).rejects.toMatchObject({ code: "KEY_MISMATCH" });
    const [e0] = await chain(k, [spendingKey()]);
    const again = await entry(k, { seq: 1, kind: "publish", spendingPublicKey: spendingKey(), prev: e0! });
    await expect(verifyKeyLog([e0!, again], NAME, privateKeyToAddress(k))).rejects.toMatchObject({ code: "KEY_MISMATCH" });
  });

  it("a revoke-device that quietly changes the key", async () => {
    const k = generatePrivateKey();
    const [e0] = await chain(k, [spendingKey()]);
    const sneaky = await entry(k, {
      seq: 1,
      kind: "revoke-device",
      spendingPublicKey: spendingKey(),
      devicePublicKey: spendingKey(),
      prev: e0!,
    });
    await expect(verifyKeyLog([e0!, sneaky], NAME, privateKeyToAddress(k))).rejects.toThrow(/without a rotate/);
  });
});

describe("key log: entries that aren't K's are ignored and counted", () => {
  it("a forged entry by another wallet with the same ensName", async () => {
    const k = generatePrivateKey();
    const [e0] = await chain(k, [spendingKey()]);
    const attacker = generatePrivateKey();
    const forged = await entry(k, { seq: 1, kind: "rotate", spendingPublicKey: spendingKey(), prev: e0!, signedBy: attacker });
    const log = await verifyKeyLog([e0!, forged], NAME, privateKeyToAddress(k));
    expect(log.entries).toHaveLength(1);
    expect(log.current).toBe(e0!.spendingPublicKey);
    expect(log.ignored).toBe(1);
  });

  it("K's real signature copied into someone else's entity (a replay)", async () => {
    const k = generatePrivateKey();
    const [e0, e1] = await chain(k, [spendingKey(), spendingKey()]);
    const replay = { ...e1!, key: toHex(randomBytes(32)), creator: privateKeyToAddress(generatePrivateKey()) };
    const log = await verifyKeyLog([e0!, e1!, replay], NAME, privateKeyToAddress(k));
    expect(log.entries).toHaveLength(2);
    expect(log.ignored).toBe(1);
  });

  it("a bad signature, a different name, and an entity that isn't read-only", async () => {
    const k = generatePrivateKey();
    const [e0] = await chain(k, [spendingKey()]);
    const tampered = { ...(await entry(k, { seq: 1, kind: "rotate", spendingPublicKey: spendingKey(), prev: e0! })) };
    tampered.spendingPublicKey = compressKey(spendingKey()); // changed after signing
    const otherName = await entry(k, { seq: 1, kind: "rotate", spendingPublicKey: spendingKey(), prev: e0!, ensName: "x.cloakroom.eth" });
    const mutable = await entry(k, { seq: 1, kind: "rotate", spendingPublicKey: spendingKey(), prev: e0!, readonly: false });
    const log = await verifyKeyLog([e0!, tampered, otherName, mutable], NAME, privateKeyToAddress(k));
    expect(log.entries).toHaveLength(1);
    expect(log.ignored).toBe(3);
  });

  it("KeyInfo reports ignored entries plus malformed rows, so the profile can show them", async () => {
    const k = generatePrivateKey();
    const [e0] = await chain(k, [spendingKey()]);
    const forged = await entry(k, { seq: 1, kind: "rotate", spendingPublicKey: spendingKey(), prev: e0!, signedBy: generatePrivateKey() });
    const log = await verifyKeyLog([e0!, forged], NAME, privateKeyToAddress(k));
    const result = await keyInfoFrom({ ensName: NAME, log, malformed: 2, ensKey: e0!.spendingPublicKey, seen: null, times: new Map() });
    expect(result.ignoredEntries).toBe(3);
  });
});

describe("agreement with ENS and trust on first use", () => {
  it("matches cloak.key in either point encoding; a different cloak.key blocks sharing", async () => {
    const k = generatePrivateKey();
    const key = spendingKey(); // uncompressed, as cloak.key holds it
    const log = await verifyKeyLog(await chain(k, [key]), NAME, privateKeyToAddress(k));
    const ok = await info(log, key);
    expect(ok.matchesEns).toBe(true);
    expect(() => assertCanShare(ok)).not.toThrow();
    const swapped = await info(log, spendingKey());
    expect(swapped.matchesEns).toBe(false);
    expect(() => assertCanShare(swapped)).toThrow("This name's key doesn't match its public log");
    expect((await info(log, null)).matchesEns).toBe(false);
  });

  it("a key that changed since the last share warns until confirmed", async () => {
    const storage = new MemoryStore();
    const k = generatePrivateKey();
    const [first, second] = [spendingKey(), spendingKey()];
    expect(await seenKey(storage, NAME)).toBeNull();
    await rememberKey(storage, NAME, first); // shared once, under the first key

    const log = await verifyKeyLog(await chain(k, [first, second]), NAME, privateKeyToAddress(k));
    const before = await info(log, second, await seenKey(storage, NAME));
    expect(before.changedSinceLastShare).toBe(true);
    expect(() => assertCanShare(before)).toThrow(/key changed on .* Confirm the change/);

    await rememberKey(storage, NAME, before.current); // what confirmKeyChange stores
    const after = await info(log, second, await seenKey(storage, NAME));
    expect(after.changedSinceLastShare).toBe(false);
    expect(() => assertCanShare(after)).not.toThrow();
  });
});

describe("fingerprint", () => {
  it("is 8 BIP-39 words, the same for both encodings of a key, and differs between keys", () => {
    const key = spendingKey();
    const words = keyFingerprint(key);
    expect(words).toHaveLength(8);
    for (const w of words) expect(english).toContain(w);
    expect(keyFingerprint(compressKey(key))).toEqual(words);
    expect(keyFingerprint(key)).toEqual(words);
    expect(keyFingerprint(spendingKey())).not.toEqual(words);
  });

  it("rejects something that isn't a key", () => {
    expect(() => keyFingerprint("0x1234")).toThrow();
  });
});

describe("devices", () => {
  async function deviceRecord(k: Hex, deviceId: string, devicePublicKey: Hex, signedBy = k): Promise<DeviceRecord> {
    const unsigned = { ensName: NAME, deviceId, devicePublicKey: compressKey(devicePublicKey), label: randomBytes(40) };
    const createdAtBlock = block++;
    return {
      ...unsigned,
      sig: await signDevice(signedBy, unsigned),
      key: toHex(randomBytes(32)),
      creator: privateKeyToAddress(signedBy),
      owner: privateKeyToAddress(signedBy),
      createdAtBlock,
      expiresAtBlock: createdAtBlock + 3_888_000n,
      readonly: true,
    };
  }

  it("keeps the latest entry per device, drops revoked devices, ignores forged ones", async () => {
    const k = generatePrivateKey();
    const [phone, laptop] = [spendingKey(), spendingKey()];
    const phoneOld = await deviceRecord(k, "phone", phone);
    const phoneNew = await deviceRecord(k, "phone", phone);
    const lap = await deviceRecord(k, "laptop", laptop);
    const forged = await deviceRecord(k, "evil", spendingKey(), generatePrivateKey());

    const all = await verifyDevices([phoneOld, lap, phoneNew, forged], NAME, privateKeyToAddress(k), []);
    expect(all.devices.map((d) => d.key).sort()).toEqual([phoneNew.key, lap.key].sort());
    expect(all.ignored).toBe(1);

    const afterRevoke = await verifyDevices([phoneOld, lap, phoneNew], NAME, privateKeyToAddress(k), [compressKey(laptop)]);
    expect(afterRevoke.devices.map((d) => d.deviceId)).toEqual(["phone"]);
  });

  it("this device keeps one stable id and key", async () => {
    const storage = new MemoryStore();
    const a = await thisDevice(storage);
    const b = await thisDevice(storage);
    expect(b).toEqual(a);
    expect(a.devicePublicKey).toMatch(/^0x0[23][0-9a-f]{64}$/);
    expect(await thisDevice(new MemoryStore())).not.toEqual(a);
  });
});
