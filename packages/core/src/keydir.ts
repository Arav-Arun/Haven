// Add-on F1: a public key directory and key-transparency log on Arkiv, keyed by ENS name.
//
// Sharing encrypts to the recipient's spending public key, published as the cloak.key text record. If that record, its
// resolver or our onboarding API were ever compromised, a sender would silently encrypt to an attacker. So every name
// also has an append-only log on Arkiv (cloak.keylog): seq 0, 1, 2…, each entry signed (EIP-712) by the name's
// controller and pointing at the previous entry's Arkiv key. Anyone can read it with one query and see every change.
//
// Rules (CLOAKROOM add-ons spec, F1):
//   1. Valid chain: only entries signed by the name's controller count (others are listed as ignored); seq has no gaps
//      and no duplicates; each prevEntryKey is the previous entry's key. Otherwise KEY_MISMATCH.
//   2. Agreement: the current key (last publish/rotate) must equal cloak.key when the name has that record.
//   3. Trust on first use: the first share stores the recipient's fingerprint; a later change needs a confirmation.
//   4. Fingerprint: 8 words, one per byte of keccak256(compressed key), for an in-person check.
// Device entries (cloak.device) list where a user is signed in; a revoked or expired device is not trusted.

import { DriveError, type Address, type Hex, type KeyValueStore, type Timestamp } from "@cloakroom/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  hexToBytes,
  isAddressEqual,
  keccak256,
  recoverTypedDataAddress,
  type TypedDataDomain,
} from "viem";

import { NONE, type DeviceRecord, type KeyLogRecord } from "./arkiv";
import { hkdf, utf8, aesDecrypt, aesEncrypt } from "./crypto";
import { FINGERPRINT_WORDS } from "./words";

export type KeyLogKind = "publish" | "rotate" | "revoke-device";
const KINDS: readonly string[] = ["publish", "rotate", "revoke-device"];

// ---------------------------------------------------------------- signed messages

export const KEYLOG_DOMAIN = { name: "Cloakroom", version: "1", chainId: 11155111 } as const satisfies TypedDataDomain;

export const KEYLOG_TYPES = {
  KeyLogEntry: [
    { name: "ensName", type: "string" },
    { name: "seq", type: "uint64" },
    { name: "kind", type: "string" },
    { name: "spendingPublicKey", type: "string" },
    { name: "devicePublicKey", type: "string" },
    { name: "prevEntryKey", type: "string" },
  ],
} as const;

export const DEVICE_TYPES = {
  Device: [
    { name: "ensName", type: "string" },
    { name: "deviceId", type: "string" },
    { name: "devicePublicKey", type: "string" },
    { name: "labelHash", type: "bytes32" },
  ],
} as const;

export interface UnsignedKeyLogEntry {
  ensName: string;
  seq: number;
  kind: KeyLogKind;
  spendingPublicKey: Hex;
  devicePublicKey: string;
  prevEntryKey: string;
}

export interface UnsignedDevice {
  ensName: string;
  deviceId: string;
  devicePublicKey: Hex;
  label: Hex;
}

/** What a wallet or key signs for one log entry (pass to signTypedData). */
export function keyLogTypedData(e: UnsignedKeyLogEntry) {
  return {
    domain: KEYLOG_DOMAIN,
    types: KEYLOG_TYPES,
    primaryType: "KeyLogEntry" as const,
    message: { ...e, seq: BigInt(e.seq) },
  };
}

export function deviceTypedData(d: UnsignedDevice) {
  return {
    domain: KEYLOG_DOMAIN,
    types: DEVICE_TYPES,
    primaryType: "Device" as const,
    message: { ensName: d.ensName, deviceId: d.deviceId, devicePublicKey: d.devicePublicKey, labelHash: keccak256(d.label) },
  };
}

/** Body of POST /keylog: the API relays an entry someone signed, so users need no tGLM. */
export type KeyLogRelayRequest =
  | { type: "entry"; entry: UnsignedKeyLogEntry; sig: Hex }
  | { type: "device"; device: UnsignedDevice; sig: Hex };

export interface KeyLogRelayResponse {
  entityKey: Hex;
  txHash: Hex;
}

// ---------------------------------------------------------------- keys and fingerprints

/** Any encoding of a secp256k1 public key → its compressed form (0x + 66 hex). Throws if it isn't a point. */
export function compressKey(publicKey: string): Hex {
  return bytesToHex(secp256k1.ProjectivePoint.fromHex(publicKey.replace(/^0x/, "")).toRawBytes(true));
}

export function sameKey(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false;
  try {
    return compressKey(a) === compressKey(b);
  } catch {
    return false;
  }
}

/** Eight words: one per byte of keccak256(compressed key). The same on every device and every app. */
export function fingerprint(publicKey: string): string[] {
  const digest = hexToBytes(keccak256(hexToBytes(compressKey(publicKey))));
  return Array.from(digest.slice(0, 8), (b) => FINGERPRINT_WORDS[b]!);
}

export function fingerprintText(publicKey: string): string {
  return fingerprint(publicKey).join(" ");
}

/** A short public id for a device key: the first 8 bytes of keccak256(compressed key), in hex. */
export function deviceIdOf(devicePublicKey: string): string {
  return keccak256(hexToBytes(compressKey(devicePublicKey))).slice(2, 18);
}

// ---------------------------------------------------------------- checking a log

export interface CheckedKeyLog {
  /** The valid chain, seq 0…n. Empty when the name has no valid entries. */
  chain: KeyLogRecord[];
  /** Entries signed by anyone other than the controller, or malformed: shown as forged, never used. */
  ignored: KeyLogRecord[];
  /** Why the chain is broken, or null. A broken chain means KEY_MISMATCH. */
  problem: string | null;
}

async function signerOf(r: KeyLogRecord): Promise<Address | null> {
  if (!KINDS.includes(r.kind)) return null;
  try {
    compressKey(r.spendingPublicKey);
    return await recoverTypedDataAddress({
      ...keyLogTypedData({
        ensName: r.ensName,
        seq: r.seq,
        kind: r.kind as KeyLogKind,
        spendingPublicKey: r.spendingPublicKey,
        devicePublicKey: r.devicePublicKey,
        prevEntryKey: r.prevEntryKey,
      }),
      signature: r.sig,
    });
  } catch {
    return null;
  }
}

/** Everything the signature covers, as one string: two records with equal content are copies of one signed entry. */
function signedContent(r: KeyLogRecord): string {
  return [r.ensName, r.seq, r.kind, r.spendingPublicKey, r.devicePublicKey, r.prevEntryKey].join("|").toLowerCase();
}

/** Rule 1. `controller` is the name's controller now (ens.ts nameController); null means nothing can be valid. */
export async function checkKeyLog(records: readonly KeyLogRecord[], controller: Address | null): Promise<CheckedKeyLog> {
  const signed: KeyLogRecord[] = [];
  const ignored: KeyLogRecord[] = [];
  for (const r of records) {
    const signer = await signerOf(r);
    if (controller && signer && isAddressEqual(signer, controller)) signed.push(r);
    else ignored.push(r);
  }
  signed.sort((a, b) => a.seq - b.seq || Number(a.createdAtBlock - b.createdAtBlock) || a.key.localeCompare(b.key));
  // Entries are relayed (POST /keylog), so anyone can write a byte-for-byte copy of an entry the controller signed.
  // Copies of one signed entry are the same entry: keep the copy the next entry points at (or the earliest), and set
  // the rest aside, so a copy can't make a name's log look forked. Two DIFFERENT signed entries for one seq can only
  // come from the controller, and still break the chain below.
  const pointedAt = new Set(signed.map((r) => r.prevEntryKey.toLowerCase()));
  const kept = new Map<string, KeyLogRecord>(); // seq + signed content → the copy that counts
  for (const r of signed) {
    const id = `${r.seq}|${signedContent(r)}`;
    const held = kept.get(id);
    if (!held) kept.set(id, r);
    else if (!pointedAt.has(held.key.toLowerCase()) && pointedAt.has(r.key.toLowerCase())) {
      ignored.push(held);
      kept.set(id, r);
    } else ignored.push(r);
  }
  signed.splice(0, signed.length, ...[...kept.values()].sort((a, b) => a.seq - b.seq || Number(a.createdAtBlock - b.createdAtBlock)));
  let problem: string | null = null;
  for (let i = 0; i < signed.length && !problem; i++) {
    const r = signed[i]!;
    if (r.seq !== i) problem = r.seq < i ? `two entries claim seq ${r.seq}` : `seq ${i} is missing`;
    else if (i === 0 && r.prevEntryKey !== NONE) problem = "seq 0 points at an earlier entry";
    else if (i === 0 && r.kind !== "publish") problem = "seq 0 isn't a publish";
    else if (i > 0 && r.prevEntryKey.toLowerCase() !== signed[i - 1]!.key.toLowerCase()) problem = `seq ${i} doesn't point at seq ${i - 1}`;
  }
  return { chain: problem ? [] : signed, ignored, problem };
}

/** The current spending key: the last publish or rotate entry. */
export function currentKey(chain: readonly KeyLogRecord[]): Hex | null {
  for (let i = chain.length - 1; i >= 0; i--) {
    const r = chain[i]!;
    if (r.kind === "publish" || r.kind === "rotate") return compressKey(r.spendingPublicKey);
  }
  return null;
}

/** Device keys the log has revoked (compressed). */
export function revokedDevices(chain: readonly KeyLogRecord[]): Set<Hex> {
  const out = new Set<Hex>();
  for (const r of chain) {
    if (r.kind !== "revoke-device") continue;
    try {
      out.add(compressKey(r.devicePublicKey));
    } catch {
      // a malformed device key revokes nothing
    }
  }
  return out;
}

/** The next entry to append after `chain`. */
export function nextEntry(
  chain: readonly KeyLogRecord[],
  e: { ensName: string; kind: KeyLogKind; spendingPublicKey: string; devicePublicKey?: string },
): UnsignedKeyLogEntry {
  const last = chain[chain.length - 1];
  return {
    ensName: e.ensName,
    seq: chain.length,
    kind: e.kind,
    spendingPublicKey: compressKey(e.spendingPublicKey),
    devicePublicKey: e.devicePublicKey ? compressKey(e.devicePublicKey) : NONE,
    prevEntryKey: last ? last.key : NONE,
  };
}

/** Rule 2: does the log's current key equal the cloak.key record? "none" when the name has no record. */
export function ensAgreement(logKey: Hex | null, cloakKey: string | null): "match" | "mismatch" | "none" {
  if (!cloakKey) return "none";
  return logKey && sameKey(logKey, cloakKey) ? "match" : "mismatch";
}

// ---------------------------------------------------------------- devices

export interface DeviceCheck {
  record: DeviceRecord;
  trusted: boolean;
  why: "ok" | "revoked" | "expired" | "bad signature";
}

/** Device entries signed by the controller, latest per device; revoked (in the log) or expired ones aren't trusted. */
export async function checkDevices(
  records: readonly DeviceRecord[],
  controller: Address | null,
  chain: readonly KeyLogRecord[],
  headBlock: bigint,
): Promise<DeviceCheck[]> {
  const revoked = revokedDevices(chain);
  const latest = new Map<string, DeviceCheck>();
  for (const r of records) {
    let signer: Address | null = null;
    try {
      if (r.deviceId !== deviceIdOf(r.devicePublicKey)) throw new Error("id");
      signer = await recoverTypedDataAddress({
        ...deviceTypedData({ ensName: r.ensName, deviceId: r.deviceId, devicePublicKey: r.devicePublicKey, label: bytesToHex(r.label) }),
        signature: r.sig,
      });
    } catch {
      signer = null;
    }
    const valid = !!controller && !!signer && isAddressEqual(signer, controller);
    const why: DeviceCheck["why"] = !valid
      ? "bad signature"
      : revoked.has(compressKey(r.devicePublicKey))
        ? "revoked"
        : r.expiresAtBlock <= headBlock
          ? "expired"
          : "ok";
    const check: DeviceCheck = { record: r, trusted: why === "ok", why };
    if (!valid) continue;
    const prev = latest.get(r.deviceId);
    if (!prev || prev.record.createdAtBlock < r.createdAtBlock) latest.set(r.deviceId, check);
  }
  return [...latest.values()];
}

const deviceLabelKey = (driveKey: Hex) => hkdf(hexToBytes(driveKey), "device-label");

export function sealDeviceLabel(driveKey: Hex, deviceId: string, label: string): Promise<Uint8Array> {
  return aesEncrypt(deviceLabelKey(driveKey), utf8(label.slice(0, 64)), utf8(`cloak.device/${deviceId}`));
}

export async function openDeviceLabel(driveKey: Hex, deviceId: string, sealed: Uint8Array): Promise<string> {
  try {
    return new TextDecoder().decode(await aesDecrypt(deviceLabelKey(driveKey), sealed, utf8(`cloak.device/${deviceId}`)));
  } catch {
    return "Unknown device";
  }
}

// ---------------------------------------------------------------- trust on first use (rule 3)

const TOFU_KEY = "tofu";

interface TofuEntry {
  key: Hex;
  at: Timestamp;
}

/** Remembers the key each recipient had the first time this user shared with them (kept in local storage only). */
export class KeyMemory {
  constructor(private readonly store: KeyValueStore) {}

  private async all(): Promise<Record<string, TofuEntry>> {
    const raw = await this.store.get(TOFU_KEY);
    return raw ? (JSON.parse(new TextDecoder().decode(raw)) as Record<string, TofuEntry>) : {};
  }

  async get(ensName: string): Promise<TofuEntry | null> {
    return (await this.all())[ensName.toLowerCase()] ?? null;
  }

  async remember(ensName: string, key: Hex, at: Timestamp): Promise<void> {
    const all = await this.all();
    all[ensName.toLowerCase()] = { key: compressKey(key), at };
    await this.store.set(TOFU_KEY, utf8(JSON.stringify(all)));
  }

  /** True when this user shared with the name before, under a different key. */
  async changed(ensName: string, key: Hex | null): Promise<boolean> {
    const seen = await this.get(ensName);
    return !!seen && !!key && !sameKey(seen.key, key);
  }
}

/** The error share() throws for each failed rule, with the words the UI shows. */
export function keyProblem(ensName: string, why: "broken" | "mismatch" | "missing" | "changed", detail?: string): DriveError {
  switch (why) {
    case "broken":
      return new DriveError("KEY_MISMATCH", `${ensName}'s public key log is broken (${detail ?? "invalid"}), so it can't be trusted.`);
    case "mismatch":
      return new DriveError("KEY_MISMATCH", "This name's key doesn't match its public log.");
    case "missing":
      return new DriveError("NO_CLOAK_KEY", `${ensName} has no public key log yet, so nothing can be shared with it.`);
    case "changed":
      return new DriveError("KEY_MISMATCH", `${ensName}'s key changed${detail ? ` on ${detail}` : ""}. Compare fingerprints, then confirm the change.`);
  }
}

