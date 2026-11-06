// Add-ons F1–F4: the pure rules (no network). Live behaviour is covered by scripts/e2e.ts once deployed.

import type { Address, Hex } from "@cloakroom/types";
import { bytesToHex, hexToBytes, namehash, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { describe, expect, it } from "vitest";

import { type DeviceRecord, type KeyLogRecord, type RebuildRecord, type ReleaseRecord, type UnreleaseRecord } from "../src/arkiv";
import { utf8 } from "../src/crypto";
import {
  cacAddress,
  checkRing,
  DOORBELL_PAYLOAD_BYTES,
  doorbellTopic,
  mineGsocKey,
  openDoorbell,
  proximity,
  sealDoorbell,
  signRing,
  spanOf,
} from "../src/doorbell";
import { chainHead, deriveEpochKey } from "../src/epochs";
import {
  checkDevices,
  checkKeyLog,
  compressKey,
  currentKey,
  deviceIdOf,
  deviceTypedData,
  ensAgreement,
  fingerprint,
  KeyMemory,
  keyLogTypedData,
  nextEntry,
  type UnsignedKeyLogEntry,
} from "../src/keydir";
import { sealRoster, openRoster, type RosterMember } from "../src/records";
import {
  buildManifest,
  compareWithManifest,
  manifestMatches,
  manifestPath,
  matchingRebuilds,
  releaseTypedData,
  rootHashOf,
  trustedReleases,
  unreleaseTypedData,
} from "../src/release";
import { overCap, planSync, type SubtreeHolder } from "../src/subtree";
import { memoryStore } from "../src/transport";
import { FINGERPRINT_WORDS } from "../src/words";

const pubOf = (k: Hex) => bytesToHex(secp256k1.getPublicKey(hexToBytes(k), false));
const key = (n: number): Hex => `0x${n.toString(16).padStart(64, "0")}`;

let block = 100n;
function record<T extends object>(fields: T, creator: Address, k = key(Number(block))): T & KeyLogRecord {
  block += 1n;
  return { key: k, creator, owner: creator, createdAtBlock: block, expiresAtBlock: block + 1_000_000n, readonly: true, ...fields } as T & KeyLogRecord;
}

async function entry(signer: Hex, e: UnsignedKeyLogEntry, k?: Hex): Promise<KeyLogRecord> {
  const sig = await privateKeyToAccount(signer).signTypedData(keyLogTypedData(e));
  return record({ ...e, sig }, privateKeyToAccount(signer).address, k);
}

describe("F1 key log", () => {
  const K = generatePrivateKey();
  const controller = privateKeyToAccount(K).address;
  const spend1 = pubOf(generatePrivateKey());
  const spend2 = pubOf(generatePrivateKey());
  const name = "investor.cloakroom.eth";

  async function validChain() {
    const e0 = await entry(K, nextEntry([], { ensName: name, kind: "publish", spendingPublicKey: spend1 }));
    const e1 = await entry(K, nextEntry([e0], { ensName: name, kind: "rotate", spendingPublicKey: spend2 }));
    return [e0, e1];
  }

  it("accepts a valid chain and takes the last publish/rotate as current", async () => {
    const chain = await validChain();
    const c = await checkKeyLog(chain, controller);
    expect(c.problem).toBeNull();
    expect(c.chain).toHaveLength(2);
    expect(currentKey(c.chain)).toBe(compressKey(spend2));
  });

  it("rejects a missing seq, a broken prevEntryKey, a bad signature and a wrong signer", async () => {
    const [e0, e1] = await validChain();
    const gap = await entry(K, { ...nextEntry([e0!, e1!], { ensName: name, kind: "rotate", spendingPublicKey: spend1 }), seq: 3 });
    expect((await checkKeyLog([e0!, e1!, gap], controller)).problem).toMatch(/seq 2 is missing/);

    const broken = await entry(K, { ...nextEntry([e0!], { ensName: name, kind: "rotate", spendingPublicKey: spend2 }), prevEntryKey: key(999) });
    expect((await checkKeyLog([e0!, broken], controller)).problem).toMatch(/doesn't point/);

    const tampered = { ...e1!, spendingPublicKey: compressKey(spend1) };
    const t = await checkKeyLog([e0!, tampered], controller);
    expect(t.ignored).toContain(tampered);
    expect(t.chain).toHaveLength(1);

    const forged = await entry(generatePrivateKey(), nextEntry([e0!], { ensName: name, kind: "rotate", spendingPublicKey: spend1 }));
    const f = await checkKeyLog([e0!, e1!, forged], controller);
    expect(f.problem).toBeNull();
    expect(f.ignored).toEqual([forged]);
    expect(currentKey(f.chain)).toBe(compressKey(spend2));

    expect((await checkKeyLog([e0!, e1!], null)).chain).toEqual([]);
  });

  it("blocks sharing when the log doesn't match cloak.key", () => {
    expect(ensAgreement(compressKey(spend1), spend1)).toBe("match");
    expect(ensAgreement(compressKey(spend1), spend2)).toBe("mismatch");
    expect(ensAgreement(compressKey(spend1), null)).toBe("none");
    expect(ensAgreement(null, spend1)).toBe("mismatch");
  });

  it("warns when a key changed since the last share (trust on first use)", async () => {
    const memory = new KeyMemory(memoryStore());
    expect(await memory.changed(name, compressKey(spend1))).toBe(false);
    await memory.remember(name, spend1, 1);
    expect(await memory.changed(name, compressKey(spend1))).toBe(false);
    expect(await memory.changed(name.toUpperCase(), compressKey(spend2))).toBe(true);
  });

  it("gives eight words from a frozen list of 256", () => {
    expect(new Set(FINGERPRINT_WORDS).size).toBe(256);
    const fp = fingerprint(spend1);
    expect(fp).toHaveLength(8);
    expect(fingerprint(compressKey(spend1))).toEqual(fp);
    expect(fingerprint(spend2)).not.toEqual(fp);
  });

  it("doesn't trust an expired or revoked device", async () => {
    const dk = generatePrivateKey();
    const devicePublicKey = compressKey(pubOf(dk));
    const d = { ensName: name, deviceId: deviceIdOf(devicePublicKey), devicePublicKey, label: toHex(utf8("sealed")) };
    const sig = await privateKeyToAccount(K).signTypedData(deviceTypedData(d));
    const rec = (expiresAtBlock: bigint): DeviceRecord => ({
      key: key(5000),
      creator: controller,
      owner: controller,
      createdAtBlock: 10n,
      expiresAtBlock,
      readonly: true,
      ensName: name,
      deviceId: d.deviceId,
      devicePublicKey,
      label: utf8("sealed"),
      sig,
    });
    const chain = await validChain();
    expect((await checkDevices([rec(500n)], controller, chain, 100n))[0]!.trusted).toBe(true);
    expect((await checkDevices([rec(50n)], controller, chain, 100n))[0]!.why).toBe("expired");
    const revoke = await entry(K, nextEntry(chain, { ensName: name, kind: "revoke-device", spendingPublicKey: spend2, devicePublicKey }));
    expect((await checkDevices([rec(500n)], controller, [...chain, revoke], 100n))[0]!.why).toBe("revoked");
    expect(await checkDevices([rec(500n)], privateKeyToAccount(generatePrivateKey()).address, chain, 100n)).toEqual([]);
  });
});

describe("F2 subtree sync", () => {
  const holder = (name: string, controller: Address, hasKey = true): SubtreeHolder => ({ name, controller, key: hasKey ? compressKey(pubOf(generatePrivateKey())) : null });
  const a1 = privateKeyToAccount(generatePrivateKey()).address;
  const a2 = privateKeyToAccount(generatePrivateKey()).address;
  const member = (label: string, holderAddr: Address, rule = "acme.eth"): RosterMember => ({
    address: privateKeyToAccount(generatePrivateKey()).address,
    memberKey: new Uint8Array(32),
    role: "viewer",
    until: null,
    hiddenFromMembers: false,
    label,
    via: "direct",
    rule,
    holder: holderAddr,
  });
  const rule = { parent: "acme.eth", role: "viewer" as const, until: null, excluded: [] as string[], hideFromMembers: false, syncedAt: 0 };

  it("adds a new subname holder and skips names without a key", () => {
    const plan = planSync(rule, [], [holder("priya.acme.eth", a1), holder("raj.acme.eth", a2, false)]);
    expect(plan.add.map((h) => h.name)).toEqual(["priya.acme.eth"]);
    expect(plan.remove).toEqual([]);
  });

  it("removes a revoked subname, an excluded one, and re-shares after a transfer", () => {
    const priya = member("priya.acme.eth", a1);
    const raj = member("raj.acme.eth", a2);
    // revoked: priya.acme.eth no longer exists
    expect(planSync(rule, [priya, raj], [holder("raj.acme.eth", a2)]).remove).toEqual([priya]);
    // excluded
    expect(planSync({ ...rule, excluded: ["raj.acme.eth"] }, [priya, raj], [holder("priya.acme.eth", a1), holder("raj.acme.eth", a2)]).remove).toEqual([raj]);
    // transferred: raj.acme.eth now controlled by someone else
    const newOwner = privateKeyToAccount(generatePrivateKey()).address;
    const t = planSync(rule, [priya, raj], [holder("priya.acme.eth", a1), holder("raj.acme.eth", newOwner)]);
    expect(t.remove).toEqual([raj]);
    expect(t.add.map((h) => h.controller)).toEqual([newOwner]);
    // members added by hand or by another rule are left alone
    expect(planSync(rule, [member("bob.cloakroom.eth", a1, "other.eth")], []).remove).toEqual([]);
  });

  it("refuses more than 14 people", () => {
    const many = Array.from({ length: 13 }, (_, i) => member(`p${i}.acme.eth`, a1));
    expect(overCap(many, [], 1)).toBe(false);
    expect(overCap(many, [], 2)).toBe(true);
    expect(overCap(many, many.slice(0, 2), 3)).toBe(false);
  });

  it("keeps the rule out of every public byte: the sealed roster has neither the parent name nor its namehash", async () => {
    const folder = privateKeyToAccount(generatePrivateKey()).address;
    const rk = new Uint8Array(32).fill(9);
    const roster = { managers: [], members: [member("priya.acme.eth", a1)], subtrees: [rule] };
    const sealed = await sealRoster(rk, folder, 1, roster);
    const all = new TextDecoder("latin1").decode(new Uint8Array([...sealed.managers, ...sealed.members]));
    expect(all.includes("acme")).toBe(false);
    const nh = hexToBytes(namehash("acme.eth"));
    const hex = bytesToHex(new Uint8Array([...sealed.managers, ...sealed.members]));
    expect(hex.includes(bytesToHex(nh).slice(2))).toBe(false);
    const opened = await openRoster(rk, folder, 1, sealed);
    expect(opened.subtrees).toEqual([rule]);
    expect(opened.members[0]!.rule).toBe("acme.eth");
    // a roster written before F2 (managers as a plain list) still opens
    const old = await sealRoster(rk, folder, 2, { managers: [], members: [] });
    expect((await openRoster(rk, folder, 2, old)).subtrees).toBeUndefined();
  });
});

describe("F4 doorbells", () => {
  const folder = "0x2222222222222222222222222222222222222222" as Address;
  const head = chainHead(new Uint8Array(32).fill(3));
  const config = { overlay: `0x${"5a".repeat(32)}` as Hex, proximity: 6 };

  it("pads every payload to exactly 256 bytes and opens it with the same topic only", async () => {
    const topic = doorbellTopic(deriveEpochKey(head, 10), folder);
    const g = mineGsocKey(topic, config);
    for (const type of ["file", "member", "refresh", "rotation"] as const) {
      const sealed = await sealDoorbell(topic, g.address, { type, arkivKey: key(77) });
      expect(sealed.length).toBe(DOORBELL_PAYLOAD_BYTES);
      expect(await openDoorbell(topic, g.address, sealed)).toEqual({ type, arkivKey: key(77) });
      // also with Bee's span in front
      expect(await openDoorbell(topic, g.address, new Uint8Array([...spanOf(256), ...sealed]))).toEqual({ type, arkivKey: key(77) });
    }
    const other = doorbellTopic(deriveEpochKey(head, 11), folder);
    expect(await openDoorbell(other, g.address, await sealDoorbell(topic, g.address, { type: "file", arkivKey: key(1) }))).toBeNull();
  });

  it("changes topic every epoch, and an ended member can't derive later ones", () => {
    const t10 = doorbellTopic(deriveEpochKey(head, 10), folder);
    const t11 = doorbellTopic(deriveEpochKey(head, 11), folder);
    expect(toHex(t10)).not.toBe(toHex(t11));
    // a member whose copy is E[10] can derive E[10] and below, never E[11]
    const held = { index: 10, key: deriveEpochKey(head, 10) };
    expect(toHex(deriveEpochKey(held, 10))).toBe(toHex(deriveEpochKey(head, 10)));
    expect(() => deriveEpochKey(held, 11)).toThrow();
  });

  it("mines the same key for everyone, near the node's overlay", () => {
    const topic = doorbellTopic(deriveEpochKey(head, 4), folder);
    const a = mineGsocKey(topic, config);
    expect(mineGsocKey(topic, config)).toEqual(a);
    expect(proximity(hexToBytes(a.address), hexToBytes(config.overlay))).toBeGreaterThanOrEqual(6);
  });

  it("signs a SOC Bee accepts, and a forged one is refused", async () => {
    const topic = doorbellTopic(deriveEpochKey(head, 4), folder);
    const g = mineGsocKey(topic, config);
    const payload = await sealDoorbell(topic, g.address, { type: "file", arkivKey: key(5) });
    const ring = await signRing(g, payload);
    expect(await checkRing(ring)).toBe(true);
    expect(await checkRing({ ...ring, owner: privateKeyToAccount(generatePrivateKey()).address })).toBe(false);
    expect(await checkRing({ ...ring, data: `${ring.data.slice(0, -2)}00` as Hex })).toBe(false);
    // BMT: a known vector, an all-zero 4096-byte payload with span 0 (same as bee-js's makeChunkedFile of no data)
    expect(cacAddress(spanOf(0), new Uint8Array(0))).toBe("0xb34ca8c22b9e982354f9c7f50b470d66db428d880c8a904d5fe4ec9713171526");
  });
});

describe("F3 release manifests", () => {
  const files = [
    { path: "index.html", bytes: utf8("<html>hello</html>") },
    { path: "_next/static/chunks/main.js", bytes: utf8("console.log(1)") },
    { path: "styles.css", bytes: utf8("body{}") },
    { path: "icon.png", bytes: new Uint8Array([1, 2, 3]) },
  ];
  const meta = { version: "1.0.0", gitCommit: "abc123", publicEnv: { NEXT_PUBLIC_X: "1" } };

  it("builds the same root hash from the same files, whatever their order", () => {
    const a = buildManifest(files, meta);
    const b = buildManifest([...files].reverse(), meta);
    expect(rootHashOf(a)).toBe(rootHashOf(b));
    expect(Object.keys(a.files)).not.toContain("icon.png");
  });

  it("finds a one-byte edit, and a file from another origin", () => {
    const m = buildManifest(files, meta);
    const loaded = new Map<string, string | null>([
      ["index.html", m.files["index.html"]!],
      ["_next/static/chunks/main.js", buildManifest([{ path: "x.js", bytes: utf8("console.log(2)") }], meta).files["x.js"]!],
    ]);
    expect(compareWithManifest(loaded, m)).toEqual(["_next/static/chunks/main.js"]);
    loaded.set("https://evil.example/x.js", null);
    expect(compareWithManifest(loaded, m)).toContain("https://evil.example/x.js");
    expect(manifestMatches(utf8(JSON.stringify(m)), rootHashOf(m))).toEqual(m);
    expect(manifestMatches(utf8(JSON.stringify({ ...m, version: "2" })), rootHashOf(m))).toBeNull();
  });

  it("maps page URLs to exported files", () => {
    const o = "https://app.cloakroom.test";
    expect(manifestPath(`${o}/`, o)).toBe("index.html");
    expect(manifestPath(`${o}/drive/?x=1#y`, o)).toBe("drive/index.html");
    expect(manifestPath(`${o}/u`, o)).toBe("u/index.html");
    expect(manifestPath(`${o}/_next/static/a.js`, o)).toBe("_next/static/a.js");
    expect(manifestPath("https://other.test/a.js", o)).toBeNull();
  });

  it("trusts only R's releases, not revoked ones, and counts independent rebuilds", async () => {
    const R = generatePrivateKey();
    const signer = privateKeyToAccount(R).address;
    const m = buildManifest(files, meta);
    const base = { version: "1.0.0", rootHash: rootHashOf(m), gitCommit: "abc123", manifestSwarmRef: key(1), siteSwarmRef: key(2).slice(2) };
    const info = (n: bigint, creator: Address) => ({ key: key(Number(n)), creator, owner: creator, createdAtBlock: n, expiresAtBlock: n + 99n, readonly: true });
    const good: ReleaseRecord = { ...info(1n, signer), ...base, sig: await privateKeyToAccount(R).signTypedData(releaseTypedData(base)) };
    const fake: ReleaseRecord = { ...info(2n, signer), ...base, version: "9", sig: await privateKeyToAccount(generatePrivateKey()).signTypedData(releaseTypedData({ ...base, version: "9" })) };
    expect(await trustedReleases([good, fake], [], signer)).toEqual([good]);
    const revoke: UnreleaseRecord = { ...info(3n, signer), rootHash: base.rootHash, sig: await privateKeyToAccount(R).signTypedData(unreleaseTypedData(base.rootHash)) };
    expect(await trustedReleases([good], [revoke], signer)).toEqual([]);
    const someone = privateKeyToAccount(generatePrivateKey()).address;
    const rebuilds: RebuildRecord[] = [
      { ...info(4n, someone), rootHash: base.rootHash, matched: true },
      { ...info(5n, someone), rootHash: base.rootHash, matched: true },
      { ...info(6n, signer), rootHash: base.rootHash, matched: true },
      { ...info(7n, privateKeyToAccount(generatePrivateKey()).address), rootHash: base.rootHash, matched: false },
    ];
    expect(matchingRebuilds(rebuilds, signer)).toBe(1);
  });
});

