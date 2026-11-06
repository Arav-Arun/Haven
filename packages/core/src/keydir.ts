// Public key directory and key transparency log (add-on F1).
//
// Sharing encrypts to a recipient's spending public key, read from the cloak.key text record on their name. If that
// name, its resolver or our onboarding API were compromised, a sender would silently encrypt to an attacker. So every
// name also has a PUBLIC, append-only key log on Arkiv (cloak.keylog), signed by the name's drive key K:
//   - anyone, in any app, can read a name's current key and every past change;
//   - a swap shows up as a new log entry, a log that disagrees with cloak.key, or a key that changed since we last
//     shared with that name (trust on first use, kept on this device only);
//   - two people can compare an 8-word fingerprint in person.
// Devices are listed the same way (cloak.device), expire after 90 days, and can be revoked through the log.
//
// Who counts as K: the driveOwner() of the registry the name points to (its drive root). Entries from anyone else
// are ignored and counted, so a profile page can show "N forged entries ignored". Limits: whoever controls the name
// can point it at a new drive root and start a new log; trust on first use and the fingerprint are what catch that.

import { DriveError, type Address, type Hex, type KeyValueStore, type Timestamp } from "@cloakroom/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  hexToBytes,
  isAddressEqual,
  keccak256,
  recoverTypedDataAddress,
} from "viem";
import { english, privateKeyToAddress, signTypedData } from "viem/accounts";
import { normalize } from "viem/ens";

import {
  ARKIV_SECONDS_PER_BLOCK,
  type ArkivReader,
  type ArkivWriter,
  type DeviceRecord,
  deviceOp,
  type KeyLogKind,
  type KeyLogRecord,
  keyLogOp,
  listDevices,
  listKeyLog,
  writeEntities,
} from "./arkiv";
import { aesDecrypt, aesEncrypt, hkdf, randomBytes, toPrivateKey, utf8 } from "./crypto";
import { driveOwner, findRegistry, getCloakKey, type SepoliaReader } from "./ens";
import { ignoreSteps, type StepSink } from "./receipts";

// ---------------------------------------------------------------- shapes (proposed additions to @cloakroom/types)

export interface KeyLogEntry {
  seq: number;
  kind: KeyLogKind;
  spendingPublicKey: Hex;
  at: Timestamp;
  arkivKey: Hex;
}

export interface KeyInfo {
  ensName: string;
  /** Compressed spending public key from the log. */
  current: Hex;
  fingerprint: string[];
  history: KeyLogEntry[];
  /** The log's current key equals the cloak.key text record. Sharing is refused when false. */
  matchesEns: boolean;
  /** This device shared with the name before, under a different key. Sharing needs confirmKeyChange first. */
  changedSinceLastShare: boolean;
  /** Entries claiming this name that don't count: signed or written by someone other than K, or malformed. */
  ignoredEntries: number;
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
  lastSeen: Timestamp;
  expiresAt: Timestamp;
}

// ---------------------------------------------------------------- keys and fingerprints

/** A secp256k1 public key in either form → compressed (0x02/0x03 + 32 bytes), the form the log stores. */
export function compressKey(publicKey: Hex | string): Hex {
  try {
    return bytesToHex(secp256k1.ProjectivePoint.fromHex(publicKey.replace(/^0x/, "")).toRawBytes(true));
  } catch {
    throw new DriveError("KEY_MISMATCH", "not a valid public key");
  }
}

export function sameKey(a: Hex | string, b: Hex | string): boolean {
  try {
    return compressKey(a) === compressKey(b);
  } catch {
    return false;
  }
}

export const FINGERPRINT_WORDS = 8;

/**
 * 8 words from the public BIP-39 English list, 11 bits each: the first 88 bits of keccak256(compressed key).
 * The add-on spec says "first 4 bytes"; 32 bits can be matched by brute force in seconds, so this uses 88 bits,
 * which is what 8 words of an 11-bit list hold anyway.
 */
export function keyFingerprint(publicKey: Hex | string): string[] {
  const digest = hexToBytes(keccak256(compressKey(publicKey)));
  let bits = 0n;
  for (const byte of digest.subarray(0, 11)) bits = (bits << 8n) | BigInt(byte);
  const words: string[] = [];
  for (let i = FINGERPRINT_WORDS - 1; i >= 0; i--) words.push(english[Number((bits >> BigInt(i * 11)) & 2047n)]!);
  return words;
}

// ---------------------------------------------------------------- signatures (EIP-712)

export const KEYDIR_DOMAIN = { name: "Cloakroom", version: "1", chainId: 11155111 } as const;

const KEYLOG_TYPES = {
  KeyLogEntry: [
    { name: "ensName", type: "string" },
    { name: "seq", type: "uint64" },
    { name: "kind", type: "string" },
    { name: "spendingPublicKey", type: "bytes" },
    { name: "devicePublicKey", type: "bytes" },
    { name: "prevEntryKey", type: "bytes" },
  ],
} as const;

const DEVICE_TYPES = {
  Device: [
    { name: "ensName", type: "string" },
    { name: "deviceId", type: "string" },
    { name: "devicePublicKey", type: "bytes" },
    { name: "label", type: "bytes" },
  ],
} as const;

export interface UnsignedKeyLogEntry {
  ensName: string;
  seq: number;
  kind: KeyLogKind;
  spendingPublicKey: Hex;
  devicePublicKey: Hex | null;
  prevEntryKey: Hex | null;
}

function keyLogMessage(e: UnsignedKeyLogEntry) {
  return {
    ensName: e.ensName,
    seq: BigInt(e.seq),
    kind: e.kind,
    spendingPublicKey: e.spendingPublicKey,
    devicePublicKey: e.devicePublicKey ?? "0x",
    prevEntryKey: e.prevEntryKey ?? "0x",
  } as const;
}

export function signKeyLogEntry(driveKey: Hex, entry: UnsignedKeyLogEntry): Promise<Hex> {
  return signTypedData({
    privateKey: driveKey,
    domain: KEYDIR_DOMAIN,
    types: KEYLOG_TYPES,
    primaryType: "KeyLogEntry",
    message: keyLogMessage(entry),
  });
}

async function keyLogSigner(entry: UnsignedKeyLogEntry & { sig: Hex }): Promise<Address | null> {
  try {
    return await recoverTypedDataAddress({
      domain: KEYDIR_DOMAIN,
      types: KEYLOG_TYPES,
      primaryType: "KeyLogEntry",
      message: keyLogMessage(entry),
      signature: entry.sig,
    });
  } catch {
    return null;
  }
}

interface UnsignedDevice {
  ensName: string;
  deviceId: string;
  devicePublicKey: Hex;
  label: Uint8Array;
}

function deviceMessage(d: UnsignedDevice) {
  return { ensName: d.ensName, deviceId: d.deviceId, devicePublicKey: d.devicePublicKey, label: bytesToHex(d.label) };
}

export function signDevice(driveKey: Hex, device: UnsignedDevice): Promise<Hex> {
  return signTypedData({
    privateKey: driveKey,
    domain: KEYDIR_DOMAIN,
    types: DEVICE_TYPES,
    primaryType: "Device",
    message: deviceMessage(device),
  });
}

async function deviceSigner(device: UnsignedDevice & { sig: Hex }): Promise<Address | null> {
  try {
    return await recoverTypedDataAddress({
      domain: KEYDIR_DOMAIN,
      types: DEVICE_TYPES,
      primaryType: "Device",
      message: deviceMessage(device),
      signature: device.sig,
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- verifying a log

export interface VerifiedKeyLog {
  /** The valid chain, seq 0, 1, 2… */
  entries: KeyLogRecord[];
  /** Compressed key of the last publish or rotate entry, or null for an empty log. */
  current: Hex | null;
  /** Device keys revoked through the log (compressed). */
  revokedDevices: Hex[];
  /** Entries that don't count: another signer or writer, a different name, not read-only. */
  ignored: number;
}

const broken = (why: string) => new DriveError("KEY_MISMATCH", `This name's public key log is broken: ${why}`);

/**
 * Rule 1 of F1. Keeps the entries that K both signed and wrote (read-only), then requires a clean chain: seq 0, 1, 2…
 * with no gap or fork, each prevEntryKey pointing at the previous entry, seq 0 a "publish", later entries a "rotate" or
 * "revoke-device". Anything else from K throws KEY_MISMATCH; anything from anyone else is only counted in `ignored`.
 */
export async function verifyKeyLog(
  records: readonly KeyLogRecord[],
  ensName: string,
  signer: Address,
): Promise<VerifiedKeyLog> {
  const name = normalize(ensName);
  const mine: KeyLogRecord[] = [];
  let ignored = 0;
  for (const r of records) {
    const by = r.readonly && r.ensName === name && isAddressEqual(r.creator, signer) ? await keyLogSigner(r) : null;
    if (by && isAddressEqual(by, signer)) mine.push(r);
    else ignored++;
  }
  mine.sort((a, b) => a.seq - b.seq);

  const entries: KeyLogRecord[] = [];
  const revokedDevices: Hex[] = [];
  let current: Hex | null = null;
  for (const [i, r] of mine.entries()) {
    if (r.seq !== i) throw broken(r.seq < i ? `two entries with seq ${r.seq}` : `seq ${i} is missing`);
    const prev = entries[i - 1];
    if (prev ? r.prevEntryKey?.toLowerCase() !== prev.key.toLowerCase() : r.prevEntryKey !== null) {
      throw broken(`entry ${i} doesn't point at entry ${i - 1}`);
    }
    if ((i === 0) !== (r.kind === "publish")) throw broken(`entry ${i} can't be a "${r.kind}"`);
    const key = compressKey(r.spendingPublicKey);
    if (r.kind === "revoke-device") {
      if (!r.devicePublicKey) throw broken(`entry ${i} revokes no device`);
      if (current === null || key !== current) throw broken(`entry ${i} changes the key without a rotate`);
      revokedDevices.push(compressKey(r.devicePublicKey));
    } else {
      current = key;
    }
    entries.push(r);
  }
  return { entries, current, revokedDevices, ignored };
}

// ---------------------------------------------------------------- trust on first use (this device only)

const SEEN_PREFIX = "keydir/seen/";

export async function seenKey(storage: KeyValueStore, ensName: string): Promise<Hex | null> {
  const bytes = await storage.get(SEEN_PREFIX + normalize(ensName));
  return bytes ? bytesToHex(bytes) : null;
}

/** Records the key we share to. Called on every share, and by confirmKeyChange. */
export async function rememberKey(storage: KeyValueStore, ensName: string, publicKey: Hex): Promise<void> {
  await storage.set(SEEN_PREFIX + normalize(ensName), hexToBytes(compressKey(publicKey)));
}

// ---------------------------------------------------------------- lookups

export interface KeyDirReaders {
  sepolia: SepoliaReader;
  arkiv: ArkivReader;
  /** Arkiv block → unix time (BlockClock). */
  clock: { timesOf(blocks: Iterable<bigint>): Promise<Map<bigint, number>> };
  storage: KeyValueStore;
}

/** K for a name: the owner of the drive root the name points to. NOT_FOUND if the name has no drive. */
export async function nameSigner(sepolia: SepoliaReader, ensName: string): Promise<Address> {
  const registry = await findRegistry(sepolia, ensName);
  if (!registry) throw new DriveError("NOT_FOUND", `${ensName} has no Cloakroom drive`);
  return driveOwner(sepolia, registry);
}

/** Builds KeyInfo from a verified log. Pure, so the rules are testable without a network. */
export async function keyInfoFrom(params: {
  ensName: string;
  log: VerifiedKeyLog;
  malformed: number;
  ensKey: string | null;
  seen: Hex | null;
  times: Map<bigint, number>;
}): Promise<KeyInfo> {
  const { log } = params;
  if (!log.current) throw new DriveError("NO_CLOAK_KEY", `${params.ensName} has no public key log yet`);
  return {
    ensName: normalize(params.ensName),
    current: log.current,
    fingerprint: keyFingerprint(log.current),
    history: log.entries.map((e) => ({
      seq: e.seq,
      kind: e.kind,
      spendingPublicKey: compressKey(e.spendingPublicKey),
      at: params.times.get(e.createdAtBlock) ?? 0,
      arkivKey: e.key,
    })),
    matchesEns: params.ensKey !== null && sameKey(params.ensKey, log.current),
    changedSinceLastShare: params.seen !== null && !sameKey(params.seen, log.current),
    ignoredEntries: log.ignored + params.malformed,
  };
}

/** The F1 lookup: drive root → K → log on Arkiv → verified chain → compared with cloak.key and with what we saw. */
export async function lookupKey(readers: KeyDirReaders, ensName: string): Promise<KeyInfo> {
  const name = normalize(ensName);
  const signer = await nameSigner(readers.sepolia, name);
  const page = await listKeyLog(readers.arkiv, name);
  const log = await verifyKeyLog(page.records, name, signer);
  const [ensKey, seen, times] = await Promise.all([
    getCloakKey(readers.sepolia, name),
    seenKey(readers.storage, name),
    readers.clock.timesOf(log.entries.map((e) => e.createdAtBlock)),
  ]);
  return keyInfoFrom({ ensName: name, log, malformed: page.malformed, ensKey, seen, times });
}

/** Rules 2 and 3: refuse to share to a key that disagrees with ENS, or that changed until the user confirms. */
export function assertCanShare(info: KeyInfo): void {
  if (!info.matchesEns) throw new DriveError("KEY_MISMATCH", "This name's key doesn't match its public log");
  if (info.changedSinceLastShare) {
    const last = [...info.history].reverse().find((e) => e.kind !== "revoke-device");
    const when = last?.at ? new Date(last.at * 1000).toISOString().slice(0, 10) : "an unknown date";
    throw new DriveError("KEY_MISMATCH", `${info.ensName}'s key changed on ${when}. Confirm the change before sharing.`);
  }
}

/** The user checked the new fingerprint (ideally in person): trust the current key from now on. */
export async function confirmKeyChange(readers: KeyDirReaders, ensName: string): Promise<void> {
  const info = await lookupKey(readers, ensName);
  await rememberKey(readers.storage, ensName, info.current);
}

// ---------------------------------------------------------------- writing the log (by K)

export interface KeyDirWriter {
  arkiv: ArkivWriter;
  /** K. The Arkiv writer must be K's account, since only entries K wrote count. */
  driveKey: Hex;
  step?: StepSink;
}

function assertWriterIsK(w: KeyDirWriter): void {
  if (!isAddressEqual(w.arkiv.account.address, privateKeyToAddress(w.driveKey))) {
    throw new DriveError("NOT_AUTHORIZED", "key log entries must be written by the drive key");
  }
}

/** Appends one entry after `log` (as verified just before). Returns the new entry's Arkiv key. */
export async function appendKeyLog(
  w: KeyDirWriter,
  ensName: string,
  log: VerifiedKeyLog,
  entry: { kind: KeyLogKind; spendingPublicKey?: Hex; devicePublicKey?: Hex },
): Promise<Hex> {
  assertWriterIsK(w);
  const seq = log.entries.length;
  if ((seq === 0) !== (entry.kind === "publish")) throw new DriveError("UNKNOWN", `a "${entry.kind}" can't be entry ${seq}`);
  const spending = entry.kind === "revoke-device" ? log.current : entry.spendingPublicKey && compressKey(entry.spendingPublicKey);
  if (!spending) throw new DriveError("UNKNOWN", "no spending key for the entry");
  if (entry.kind === "revoke-device" && !entry.devicePublicKey) throw new DriveError("UNKNOWN", "no device to revoke");
  const unsigned: UnsignedKeyLogEntry = {
    ensName: normalize(ensName),
    seq,
    kind: entry.kind,
    spendingPublicKey: spending,
    devicePublicKey: entry.devicePublicKey ? compressKey(entry.devicePublicKey) : null,
    prevEntryKey: log.entries.at(-1)?.key ?? null,
  };
  const sig = await signKeyLogEntry(w.driveKey, unsigned);
  const label = entry.kind === "publish" ? "Publish key to the public log" : `Key log: ${entry.kind}`;
  const { keys } = await writeEntities(w.arkiv, [keyLogOp({ ...unsigned, sig })], label, w.step ?? ignoreSteps);
  return keys[0]!;
}

/**
 * Rule 5, onboarding: makes the log agree with this identity. Writes seq 0 "publish" for a new name, a "rotate" if the
 * log's key differs, and nothing if it already matches. Call after claimName and on sign-in.
 */
export async function ensureKeyPublished(
  w: KeyDirWriter,
  reader: ArkivReader,
  ensName: string,
  spendingPublicKey: Hex,
): Promise<{ written: Hex | null }> {
  const name = normalize(ensName);
  const page = await listKeyLog(reader, name);
  const log = await verifyKeyLog(page.records, name, privateKeyToAddress(w.driveKey));
  if (log.current && sameKey(log.current, spendingPublicKey)) return { written: null };
  const kind = log.current ? "rotate" : "publish";
  return { written: await appendKeyLog(w, name, log, { kind, spendingPublicKey }) };
}

// ---------------------------------------------------------------- devices

const DEVICE_STORE_KEY = "keydir/device";

/** This device's own key and id, made once and kept in the (encrypted) KeyValueStore. */
export async function thisDevice(storage: KeyValueStore): Promise<{ deviceId: string; devicePublicKey: Hex }> {
  let secret = await storage.get(DEVICE_STORE_KEY);
  if (!secret) {
    secret = randomBytes(32);
    await storage.set(DEVICE_STORE_KEY, secret);
  }
  const privateKey = toPrivateKey(hkdf(secret, "device-key"));
  return {
    deviceId: bytesToHex(hkdf(secret, "device-id", 8)).slice(2),
    devicePublicKey: bytesToHex(secp256k1.getPublicKey(hexToBytes(privateKey), true)),
  };
}

const labelKey = (driveKey: Hex) => hkdf(hexToBytes(driveKey), "device-label");

/** Writes (or renews) this device's cloak.device entry. The label is sealed so only the user can read it. */
export async function registerDevice(
  w: KeyDirWriter,
  storage: KeyValueStore,
  ensName: string,
  label: string,
): Promise<Hex> {
  assertWriterIsK(w);
  const { deviceId, devicePublicKey } = await thisDevice(storage);
  const device = {
    ensName: normalize(ensName),
    deviceId,
    devicePublicKey,
    label: await aesEncrypt(labelKey(w.driveKey), utf8(label), utf8(deviceId)),
  };
  const sig = await signDevice(w.driveKey, device);
  const { keys } = await writeEntities(w.arkiv, [deviceOp({ ...device, sig })], "Register this device", w.step ?? ignoreSteps);
  return keys[0]!;
}

/** The latest valid entry per device, minus revoked ones. Expired entries are already gone from Arkiv. */
export async function verifyDevices(
  records: readonly DeviceRecord[],
  ensName: string,
  signer: Address,
  revoked: readonly Hex[],
): Promise<{ devices: DeviceRecord[]; ignored: number }> {
  const name = normalize(ensName);
  const latest = new Map<string, DeviceRecord>();
  let ignored = 0;
  for (const r of records) {
    const by = r.readonly && r.ensName === name && isAddressEqual(r.creator, signer) ? await deviceSigner(r) : null;
    if (!by || !isAddressEqual(by, signer)) {
      ignored++;
      continue;
    }
    const before = latest.get(r.deviceId);
    if (!before || r.createdAtBlock > before.createdAtBlock) latest.set(r.deviceId, r);
  }
  const devices = [...latest.values()].filter((d) => !revoked.some((k) => sameKey(k, d.devicePublicKey)));
  return { devices, ignored };
}

/** The user's own devices, labels decrypted (needs K). */
export async function myDevices(
  readers: Pick<KeyDirReaders, "arkiv" | "clock">,
  driveKey: Hex,
  ensName: string,
): Promise<DeviceInfo[]> {
  const name = normalize(ensName);
  const signer = privateKeyToAddress(driveKey);
  const [devicePage, logPage] = await Promise.all([listDevices(readers.arkiv, name), listKeyLog(readers.arkiv, name)]);
  const log = await verifyKeyLog(logPage.records, name, signer);
  const { devices } = await verifyDevices(devicePage.records, name, signer, log.revokedDevices);
  const times = await readers.clock.timesOf(devices.map((d) => d.createdAtBlock));
  const out: DeviceInfo[] = [];
  for (const d of devices) {
    const lastSeen = times.get(d.createdAtBlock) ?? 0;
    let label = "Unnamed device";
    try {
      label = new TextDecoder().decode(await aesDecrypt(labelKey(driveKey), d.label, utf8(d.deviceId)));
    } catch {
      // sealed under another key: keep the placeholder name
    }
    out.push({
      deviceId: d.deviceId,
      label,
      lastSeen,
      expiresAt: lastSeen + Number(d.expiresAtBlock - d.createdAtBlock) * ARKIV_SECONDS_PER_BLOCK,
    });
  }
  return out.sort((a, b) => b.lastSeen - a.lastSeen);
}

/** Revokes a device through the log, so every reader stops trusting it at once (not only after its 90 days). */
export async function revokeDevice(w: KeyDirWriter, reader: ArkivReader, ensName: string, deviceId: string): Promise<Hex> {
  const name = normalize(ensName);
  const signer = privateKeyToAddress(w.driveKey);
  const [devicePage, logPage] = await Promise.all([listDevices(reader, name), listKeyLog(reader, name)]);
  const log = await verifyKeyLog(logPage.records, name, signer);
  const { devices } = await verifyDevices(devicePage.records, name, signer, log.revokedDevices);
  const device = devices.find((d) => d.deviceId === deviceId);
  if (!device) throw new DriveError("NOT_FOUND", "no such device");
  return appendKeyLog(w, name, log, { kind: "revoke-device", devicePublicKey: device.devicePublicKey });
}
