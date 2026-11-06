// Arkiv (HAVEN_PLAN.md section 10): the eight haven.* schemas, writers, paged queries, renewals and the native
// tGLM transfer that funds a stealth editor.
//
// Every entity is created READ-ONLY, so its attributes are exactly what its creator wrote at $createdAt; the validator
// (validator.ts) checks the creator's role at that time. Arkiv lets an owner hand an entity to someone else, so
// validity always goes by $creator, never $owner. Entities that managers renew also allow permissionless extension,
// so a manager can keep an editor's file entry alive without being able to change it.
//
// Every stored value is sealed by the caller (records.ts); only folder addresses, file ids, versions, epochs, week
// buckets and the Swarm reference of padded ciphertext are in the clear.

import {
  createPublicClient,
  createWalletClient,
  ExpirationTime,
  type Expiry,
  MAX_LIFETIME,
  type PublicArkivClient,
  type WalletArkivClient,
} from "@arkiv-network/sdk";
import { rabdi } from "@arkiv-network/sdk/chains";
import { and, asc, eq, exists, type Expression } from "@arkiv-network/sdk/query";
import { addr, bytes, defineSchema, str, u64, type Schema } from "@arkiv-network/sdk/schema";
import { DriveError, type AnonFetch, type Address, type Hex } from "@haven/types";
import { type Account, type Chain, getAddress, hexToBytes, isHex, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { txUrl } from "./addresses";
import { toDriveError } from "./errors";
import { ignoreSteps, type StepSink } from "./receipts";
import { normalizeRef } from "./swarm";
import { anonTransport, type RouteStep } from "./transport";

// ---------------------------------------------------------------- schemas (section 10)

export const FileSchema = defineSchema("haven.file", {
  folder: addr().indexed(),
  fileId: str().indexed(),
  version: u64().indexed(),
  epoch: u64().indexed(),
  swarmRef: str(),
  meta: bytes(),
});

export const WelcomeSchema = defineSchema("haven.welcome", {
  folder: addr().indexed(),
  bucket: u64().indexed(),
  ephemeralPub: str(),
  sealedMemberKey: bytes(),
});

export const KeyCopySchema = defineSchema("haven.keycopy", {
  folder: addr().indexed(),
  recipient: addr().indexed(),
  version: u64().indexed(),
  sealed: bytes(),
});

export const RosterSchema = defineSchema("haven.roster", {
  folder: addr().indexed(),
  version: u64().indexed(),
  managers: bytes(),
  members: bytes(),
});

/** `name` is the folder's display name, sealed with E_v[0] so every reader of version v can open it. */
export const RotationSchema = defineSchema("haven.rotation", {
  folder: addr().indexed(),
  version: u64().indexed(),
  t0: u64(),
  epochLength: u64(),
  name: bytes(),
});

/** `group` is the group folder whose manager asks for the refresh; the request counts only from its managers. */
export const RefreshSchema = defineSchema("haven.refresh", {
  folder: addr().indexed(),
  group: addr(),
  reason: bytes(),
});

export const LinkSchema = defineSchema("haven.link", {
  link: str().indexed(),
  folder: addr(),
  bundle: bytes(),
});

export const TombSchema = defineSchema("haven.tomb", {
  folder: addr().indexed(),
  fileId: str().indexed(),
});

// ---- public schemas (add-ons F1 and F3). Unlike the ones above these hold no secrets: they are meant to be read by
// anyone. Each entry carries an EIP-712 signature, and readers go by that signature, never by $creator or $owner, so
// any account may relay an entry (our API does, so users need no tGLM) and a forged one is simply ignored.

/** One step of a name's public key history: seq 0, 1, 2…, each pointing at the previous entry's Arkiv key. */
export const KeyLogSchema = defineSchema("haven.keylog", {
  ensName: str().indexed(),
  seq: u64().indexed(),
  kind: str().indexed(),
  /** Compressed secp256k1 point (0x + 66 hex), so it fits a 128-byte str. */
  spendingPublicKey: str(),
  /** For "revoke-device": the device key being revoked; otherwise NONE. */
  devicePublicKey: str(),
  /** The previous entry's Arkiv key, or NONE for seq 0. */
  prevEntryKey: str(),
  sig: bytes(),
});

/** A device signed in to a name. Expires after 90 days unless the device keeps using it. */
export const DeviceSchema = defineSchema("haven.device", {
  ensName: str().indexed(),
  deviceId: str().indexed(),
  devicePublicKey: str(),
  /** The device's label, sealed to the user (HKDF(K, "device-label")). */
  label: bytes(),
  sig: bytes(),
});

/** A published website release (F3): the sha256 of its file manifest, signed by the release key R. */
export const ReleaseSchema = defineSchema("haven.release", {
  version: str().indexed(),
  rootHash: str().indexed(),
  gitCommit: str(),
  manifestSwarmRef: str(),
  siteSwarmRef: str(),
  sig: bytes(),
});

/** A release R has withdrawn: the extension treats it as bad. */
export const UnreleaseSchema = defineSchema("haven.unrelease", {
  rootHash: str().indexed(),
  sig: bytes(),
});

/** Anyone who rebuilt a release from its commit says whether they got the same root hash. */
export const RebuildSchema = defineSchema("haven.rebuild", {
  rootHash: str().indexed(),
  matched: u64(),
});

/** Written instead of an empty string (Arkiv attributes are either set or absent). */
export const NONE = "none";

export const SCHEMA_NAMES = [
  "haven.file",
  "haven.welcome",
  "haven.keycopy",
  "haven.roster",
  "haven.rotation",
  "haven.refresh",
  "haven.link",
  "haven.tomb",
  "haven.keylog",
  "haven.device",
  "haven.release",
  "haven.unrelease",
  "haven.rebuild",
] as const;
export type SchemaName = (typeof SCHEMA_NAMES)[number];

// ---------------------------------------------------------------- clients

export type ArkivReader = PublicArkivClient<Transport, Chain>;
export type ArkivWriter = WalletArkivClient<Transport, Chain, Account>;

export interface ArkivConnection {
  /** DriveConfig.arkivRpcUrl, e.g. https://rpc.rabdi.db-chain.testnet.arkiv.network */
  rpcUrl: string;
  /**
   * The Arkiv access key, sent as the last path segment. Empty in browsers: there `rpcUrl` is our API's /arkiv-rpc
   * pass-through, which adds the key server-side (Arkiv's guidance: never ship it in a client bundle).
   */
  accessKey: string;
  anon: AnonFetch;
  isolationKey?: string;
  onRoute?: (step: RouteStep) => void;
}

/** The RPC URL with the access key, the way Arkiv's hosted endpoint takes it. */
export function arkivEndpoint(rpcUrl: string, accessKey: string): string {
  const base = rpcUrl.replace(/\/+$/, "");
  return accessKey === "" ? base : `${base}/${encodeURIComponent(accessKey)}`;
}

function chainAndTransport(connection: ArkivConnection) {
  if (!connection.rpcUrl) throw new DriveError("UNKNOWN", "no Arkiv RPC URL configured");
  return {
    chain: rabdi({ accessKey: connection.accessKey }),
    transport: anonTransport({
      url: arkivEndpoint(connection.rpcUrl, connection.accessKey),
      anon: connection.anon,
      ...(connection.isolationKey ? { isolationKey: connection.isolationKey } : {}),
      ...(connection.onRoute ? { onRoute: connection.onRoute } : {}),
    }),
  };
}

export function arkivReader(connection: ArkivConnection): ArkivReader {
  return createPublicClient(chainAndTransport(connection)) as ArkivReader;
}

export function arkivWriter(connection: ArkivConnection, privateKey: Hex): ArkivWriter {
  return createWalletClient({ ...chainAndTransport(connection), account: privateKeyToAccount(privateKey) });
}

// ---------------------------------------------------------------- records as read back

/** The entity fields the validator needs, common to every schema. */
export interface EntityInfo {
  key: Hex;
  /** Who created it: the address whose role is checked. */
  creator: Address;
  owner: Address;
  createdAtBlock: bigint;
  expiresAtBlock: bigint;
  /** Created read-only. Entities that aren't are ignored, because their attributes may have changed later. */
  readonly: boolean;
}

export interface FileRecord extends EntityInfo {
  folder: Address;
  fileId: string;
  version: number;
  epoch: number;
  swarmRef: Hex;
  meta: Uint8Array;
}

export interface WelcomeRecord extends EntityInfo {
  folder: Address;
  bucket: number;
  ephemeralPub: Hex;
  sealedMemberKey: Uint8Array;
}

export interface KeyCopyRecord extends EntityInfo {
  folder: Address;
  recipient: Address;
  version: number;
  sealed: Uint8Array;
}

export interface RosterRecord extends EntityInfo {
  folder: Address;
  version: number;
  managers: Uint8Array;
  members: Uint8Array;
}

export interface RotationRecord extends EntityInfo {
  folder: Address;
  version: number;
  t0: number;
  epochLength: number;
  name: Uint8Array;
}

export interface RefreshRecord extends EntityInfo {
  folder: Address;
  group: Address;
  reason: Uint8Array;
}

export interface LinkRecord extends EntityInfo {
  link: string;
  folder: Address;
  bundle: Uint8Array;
}

export interface TombRecord extends EntityInfo {
  folder: Address;
  fileId: string;
}

export interface KeyLogRecord extends EntityInfo {
  ensName: string;
  seq: number;
  kind: string;
  spendingPublicKey: Hex;
  devicePublicKey: string;
  prevEntryKey: string;
  sig: Hex;
}

export interface DeviceRecord extends EntityInfo {
  ensName: string;
  deviceId: string;
  devicePublicKey: Hex;
  label: Uint8Array;
  sig: Hex;
}

export interface ReleaseRecord extends EntityInfo {
  version: string;
  rootHash: Hex;
  gitCommit: string;
  manifestSwarmRef: Hex;
  siteSwarmRef: string;
  sig: Hex;
}

export interface UnreleaseRecord extends EntityInfo {
  rootHash: Hex;
  sig: Hex;
}

export interface RebuildRecord extends EntityInfo {
  rootHash: Hex;
  matched: boolean;
}

/** A query's rows plus how many matching entities didn't fit the schema (planted junk counts as hidden). */
export interface Page<R> {
  records: R[];
  malformed: number;
}

// ---------------------------------------------------------------- writes



const SECONDS_PER_BLOCK = 2;
const MAX_LIFETIME_SECONDS = Number(MAX_LIFETIME) * SECONDS_PER_BLOCK;
const RENEWED = { readonly: true, permissionlessExtension: true } as const;
const FIXED = { readonly: true, permissionlessExtension: false } as const;

/** Expires at `until` (unix seconds), or at the longest lifetime Arkiv allows when that's sooner or there's no end. */
export function expiryAt(until: number | null, now = Math.floor(Date.now() / 1000)): Expiry {
  if (until === null || until - now >= MAX_LIFETIME_SECONDS - 3600) return ExpirationTime.max();
  if (until <= now) throw new DriveError("EXPIRED", "that end date has passed");
  return ExpirationTime.atDate(new Date(until * 1000), { atLeast: ExpirationTime.fromMinutes(2) });
}

/** One week, as the welcome scan's `bucket`. */
export const WEEK_SECONDS = 7 * 24 * 3600;
export function weekBucket(unixSeconds: number): number {
  return Math.floor(unixSeconds / WEEK_SECONDS);
}

export interface CreateOp {
  schema: Schema;
  values: Record<string, unknown>;
  expiration: Expiry;
  flags: { readonly: boolean; permissionlessExtension: boolean };
}

export function fileOp(v: {
  folder: Address;
  fileId: string;
  version: number;
  epoch: number;
  swarmRef: string;
  meta: Uint8Array;
}): CreateOp {
  return {
    schema: FileSchema,
    values: {
      folder: addr(v.folder),
      fileId: str(v.fileId),
      version: u64(v.version),
      epoch: u64(v.epoch),
      swarmRef: str(normalizeRef(v.swarmRef)),
      meta: v.meta,
    },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

export function welcomeOp(v: {
  folder: Address;
  bucket: number;
  /** e·G, compressed (33 bytes), so it fits a 128-byte string attribute. */
  ephemeralPub: Hex;
  sealedMemberKey: Uint8Array;
  until: number | null;
}): CreateOp {
  return {
    schema: WelcomeSchema,
    values: {
      folder: addr(v.folder),
      bucket: u64(v.bucket),
      ephemeralPub: str(v.ephemeralPub),
      sealedMemberKey: v.sealedMemberKey,
    },
    expiration: expiryAt(v.until),
    flags: FIXED,
  };
}

export function keyCopyOp(v: {
  folder: Address;
  recipient: Address;
  version: number;
  sealed: Uint8Array;
  until: number | null;
}): CreateOp {
  return {
    schema: KeyCopySchema,
    values: { folder: addr(v.folder), recipient: addr(v.recipient), version: u64(v.version), sealed: v.sealed },
    expiration: expiryAt(v.until),
    flags: RENEWED,
  };
}

export function rosterOp(v: { folder: Address; version: number; managers: Uint8Array; members: Uint8Array }): CreateOp {
  return {
    schema: RosterSchema,
    values: { folder: addr(v.folder), version: u64(v.version), managers: v.managers, members: v.members },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

export function rotationOp(v: {
  folder: Address;
  version: number;
  t0: number;
  epochLength: number;
  name: Uint8Array;
}): CreateOp {
  return {
    schema: RotationSchema,
    values: {
      folder: addr(v.folder),
      version: u64(v.version),
      t0: u64(v.t0),
      epochLength: u64(v.epochLength),
      name: v.name,
    },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

export function refreshOp(v: { folder: Address; group: Address; reason: Uint8Array }): CreateOp {
  return {
    schema: RefreshSchema,
    values: { folder: addr(v.folder), group: addr(v.group), reason: v.reason },
    expiration: ExpirationTime.fromDays(30),
    flags: FIXED,
  };
}

export function linkOp(v: { link: string; folder: Address; bundle: Uint8Array; expiresAt: number }): CreateOp {
  return {
    schema: LinkSchema,
    values: { link: str(v.link), folder: addr(v.folder), bundle: v.bundle },
    expiration: expiryAt(v.expiresAt),
    flags: FIXED,
  };
}

export function tombOp(v: { folder: Address; fileId: string }): CreateOp {
  return {
    schema: TombSchema,
    values: { folder: addr(v.folder), fileId: str(v.fileId) },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

export function keyLogOp(v: {
  ensName: string;
  seq: number;
  kind: string;
  spendingPublicKey: string;
  devicePublicKey: string;
  prevEntryKey: string;
  sig: Hex;
}): CreateOp {
  return {
    schema: KeyLogSchema,
    values: {
      ensName: str(v.ensName),
      seq: u64(v.seq),
      kind: str(v.kind),
      spendingPublicKey: str(v.spendingPublicKey),
      devicePublicKey: str(v.devicePublicKey),
      prevEntryKey: str(v.prevEntryKey),
      sig: hexToBytes(v.sig),
    },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

export const DEVICE_DAYS = 90;

export function deviceOp(v: { ensName: string; deviceId: string; devicePublicKey: string; label: Uint8Array; sig: Hex }): CreateOp {
  return {
    schema: DeviceSchema,
    values: {
      ensName: str(v.ensName),
      deviceId: str(v.deviceId),
      devicePublicKey: str(v.devicePublicKey),
      label: v.label,
      sig: hexToBytes(v.sig),
    },
    expiration: ExpirationTime.fromDays(DEVICE_DAYS),
    flags: FIXED,
  };
}

export function releaseOp(v: {
  version: string;
  rootHash: Hex;
  gitCommit: string;
  manifestSwarmRef: Hex;
  siteSwarmRef: string;
  sig: Hex;
}): CreateOp {
  return {
    schema: ReleaseSchema,
    values: {
      version: str(v.version),
      rootHash: str(v.rootHash),
      gitCommit: str(v.gitCommit),
      manifestSwarmRef: str(v.manifestSwarmRef),
      siteSwarmRef: str(v.siteSwarmRef),
      sig: hexToBytes(v.sig),
    },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

export function unreleaseOp(v: { rootHash: Hex; sig: Hex }): CreateOp {
  return {
    schema: UnreleaseSchema,
    values: { rootHash: str(v.rootHash), sig: hexToBytes(v.sig) },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

export function rebuildOp(v: { rootHash: Hex; matched: boolean }): CreateOp {
  return {
    schema: RebuildSchema,
    values: { rootHash: str(v.rootHash), matched: u64(v.matched ? 1 : 0) },
    expiration: ExpirationTime.max(),
    flags: RENEWED,
  };
}

/** Writes several entities in ONE transaction (all or nothing), e.g. a share's welcome, key copy and roster. */
export async function writeEntities(
  writer: ArkivWriter,
  ops: readonly CreateOp[],
  label: string,
  step: StepSink = ignoreSteps,
): Promise<{ txHash: Hex; keys: Hex[] }> {
  if (ops.length === 0) throw new Error("nothing to write");
  try {
    const { txHash, createdEntities } = await writer.executeBatch({
      creates: ops.map((op) => ({
        schema: op.schema,
        values: op.values,
        expiration: op.expiration,
        flags: op.flags,
      })) as never,
    });
    step({ kind: "arkiv-tx", label, hash: txHash, explorerUrl: txUrl("arkiv", txHash), ok: true });
    return { txHash, keys: createdEntities };
  } catch (error) {
    throw toDriveError(error, label);
  }
}

const RENEW_BATCH = 50;

/** Pushes each entity's expiry to the longest Arkiv allows. Works on others' entities created with RENEWED flags. */
export async function renewEntities(
  writer: ArkivWriter,
  keys: readonly Hex[],
  step: StepSink = ignoreSteps,
): Promise<Hex[]> {
  const hashes: Hex[] = [];
  for (let i = 0; i < keys.length; i += RENEW_BATCH) {
    try {
      const { txHash } = await writer.executeBatch({
        extensions: keys.slice(i, i + RENEW_BATCH).map((entityKey) => ({ entityKey, expiration: ExpirationTime.max() })),
      });
      step({ kind: "arkiv-tx", label: "Renew entries", hash: txHash, explorerUrl: txUrl("arkiv", txHash), ok: true });
      hashes.push(txHash);
    } catch (error) {
      throw toDriveError(error, "Renew entries");
    }
  }
  return hashes;
}

/** Native tGLM transfer, e.g. from the sharer's key to a stealth editor S in the same action as the grant. */
export async function sendGlm(
  writer: ArkivWriter,
  to: Address,
  wei: bigint,
  step: StepSink = ignoreSteps,
  label = "Send tGLM for gas",
): Promise<Hex> {
  try {
    const hash = await writer.sendTransaction({ account: writer.account, chain: writer.chain, to, value: wei });
    const receipt = await writer.waitForTransactionReceipt({ hash });
    const ok = receipt.status === "success";
    step({ kind: "arkiv-tx", label, hash, explorerUrl: txUrl("arkiv", hash), ok });
    if (!ok) throw new DriveError("UNKNOWN", `${label}: reverted`);
    return hash;
  } catch (error) {
    throw toDriveError(error, label);
  }
}

// ---------------------------------------------------------------- queries

const PAGE_SIZE = 100;

interface SystemRow {
  $key: Hex;
  $creator: Hex;
  $owner: Hex;
  $createdAt: bigint;
  $expiresAt: bigint;
  $creationFlags: { readonly: boolean };
}

type ColumnValue = { value: unknown };

function info(row: SystemRow): EntityInfo {
  return {
    key: row.$key,
    creator: getAddress(row.$creator),
    owner: getAddress(row.$owner),
    createdAtBlock: row.$createdAt,
    expiresAtBlock: row.$expiresAt,
    readonly: row.$creationFlags.readonly,
  };
}

const num = (v: ColumnValue) => Number(v.value as bigint);
const text = (v: ColumnValue) => v.value as string;
const address = (v: ColumnValue) => getAddress(v.value as string);
const blob = (v: ColumnValue) => hexToBytes(v.value as Hex);
const hex = (v: ColumnValue): Hex => {
  const value = (v.value as string).toLowerCase();
  if (!isHex(value)) throw new Error("not hex");
  return value;
};

/**
 * Every entity of `schema` matching `where`, all pages, ordered by key. Pages by offset as the SDK recommends, so
 * entities that don't fit the schema are counted once (as `malformed`) and never stop the read.
 */
async function fetchAll<R>(
  reader: ArkivReader,
  schema: Schema,
  where: Expression,
  toRecord: (row: SystemRow & Record<string, ColumnValue>) => R,
): Promise<Page<R>> {
  const records: R[] = [];
  const seen = new Set<string>();
  let malformed = 0;
  let offset = 0;
  try {
    for (;;) {
      const page = await reader
        .select()
        .from(schema)
        .where(where as never)
        .orderBy(asc("$key") as never)
        .limit(PAGE_SIZE)
        .offset(offset)
        .fetch();
      for (const row of page.entities as unknown as (SystemRow & Record<string, ColumnValue>)[]) {
        if (seen.has(row.$key)) continue;
        seen.add(row.$key);
        try {
          records.push(toRecord(row));
        } catch {
          malformed++;
        }
      }
      malformed += page.skipped;
      const covered = page.entities.length + page.skipped;
      if (covered < PAGE_SIZE) break;
      offset += covered;
    }
  } catch (error) {
    throw toDriveError(error, `reading ${schema.name ?? "entities"}`);
  }
  return { records, malformed };
}

export function listFiles(reader: ArkivReader, folder: Address): Promise<Page<FileRecord>> {
  return fetchAll(reader, FileSchema, eq("folder", addr(folder)), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    fileId: text(r.fileId!),
    version: num(r.version!),
    epoch: num(r.epoch!),
    swarmRef: hex(r.swarmRef!),
    meta: blob(r.meta!),
  }));
}

/** Welcome notes from the given week buckets, across all folders (the recipient tries each one locally). */
export async function listWelcomes(reader: ArkivReader, buckets: readonly number[]): Promise<Page<WelcomeRecord>> {
  const out: Page<WelcomeRecord> = { records: [], malformed: 0 };
  for (const bucket of buckets) {
    const page = await fetchAll(reader, WelcomeSchema, eq("bucket", u64(bucket)), (r) => ({
      ...info(r),
      folder: address(r.folder!),
      bucket: num(r.bucket!),
      ephemeralPub: hex(r.ephemeralPub!),
      sealedMemberKey: blob(r.sealedMemberKey!),
    }));
    out.records.push(...page.records);
    out.malformed += page.malformed;
  }
  return out;
}

export function listKeyCopies(reader: ArkivReader, folder: Address, recipient: Address): Promise<Page<KeyCopyRecord>> {
  return fetchAll(reader, KeyCopySchema, and(eq("folder", addr(folder)), eq("recipient", addr(recipient))), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    recipient: address(r.recipient!),
    version: num(r.version!),
    sealed: blob(r.sealed!),
  }));
}

/** Every key copy in a folder, whoever it's for (the Public view counts them; their contents stay sealed). */
export function listFolderKeyCopies(reader: ArkivReader, folder: Address): Promise<Page<KeyCopyRecord>> {
  return fetchAll(reader, KeyCopySchema, eq("folder", addr(folder)), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    recipient: address(r.recipient!),
    version: num(r.version!),
    sealed: blob(r.sealed!),
  }));
}

/** Every welcome note for a folder (the Public view counts them). */
export function listFolderWelcomes(reader: ArkivReader, folder: Address): Promise<Page<WelcomeRecord>> {
  return fetchAll(reader, WelcomeSchema, eq("folder", addr(folder)), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    bucket: num(r.bucket!),
    ephemeralPub: hex(r.ephemeralPub!),
    sealedMemberKey: blob(r.sealedMemberKey!),
  }));
}

export function listRosters(reader: ArkivReader, folder: Address): Promise<Page<RosterRecord>> {
  return fetchAll(reader, RosterSchema, eq("folder", addr(folder)), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    version: num(r.version!),
    managers: blob(r.managers!),
    members: blob(r.members!),
  }));
}

export function listRotations(reader: ArkivReader, folder: Address): Promise<Page<RotationRecord>> {
  return fetchAll(reader, RotationSchema, eq("folder", addr(folder)), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    version: num(r.version!),
    t0: num(r.t0!),
    epochLength: num(r.epochLength!),
    name: blob(r.name!),
  }));
}

export function listRefreshes(reader: ArkivReader, folder: Address): Promise<Page<RefreshRecord>> {
  return fetchAll(reader, RefreshSchema, eq("folder", addr(folder)), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    group: address(r.group!),
    reason: blob(r.reason!),
  }));
}

export function listLinks(reader: ArkivReader, link: string): Promise<Page<LinkRecord>> {
  return fetchAll(reader, LinkSchema, eq("link", str(link)), (r) => ({
    ...info(r),
    link: text(r.link!),
    folder: address(r.folder!),
    bundle: blob(r.bundle!),
  }));
}

export function listTombs(reader: ArkivReader, folder: Address): Promise<Page<TombRecord>> {
  return fetchAll(reader, TombSchema, eq("folder", addr(folder)), (r) => ({
    ...info(r),
    folder: address(r.folder!),
    fileId: text(r.fileId!),
  }));
}

/** Every key-log entry claiming to be about `ensName` (forged ones included: keydir.ts sorts them out). */
export function listKeyLog(reader: ArkivReader, ensName: string): Promise<Page<KeyLogRecord>> {
  return fetchAll(reader, KeyLogSchema, eq("ensName", str(ensName)), (r) => ({
    ...info(r),
    ensName: text(r.ensName!),
    seq: num(r.seq!),
    kind: text(r.kind!),
    spendingPublicKey: hex(r.spendingPublicKey!),
    devicePublicKey: text(r.devicePublicKey!),
    prevEntryKey: text(r.prevEntryKey!),
    sig: hex(r.sig!),
  }));
}

export function listDeviceEntries(reader: ArkivReader, ensName: string): Promise<Page<DeviceRecord>> {
  return fetchAll(reader, DeviceSchema, eq("ensName", str(ensName)), (r) => ({
    ...info(r),
    ensName: text(r.ensName!),
    deviceId: text(r.deviceId!),
    devicePublicKey: hex(r.devicePublicKey!),
    label: blob(r.label!),
    sig: hex(r.sig!),
  }));
}

export function listReleases(reader: ArkivReader): Promise<Page<ReleaseRecord>> {
  return fetchAll(reader, ReleaseSchema, exists("rootHash"), (r) => ({
    ...info(r),
    version: text(r.version!),
    rootHash: hex(r.rootHash!),
    gitCommit: text(r.gitCommit!),
    manifestSwarmRef: hex(r.manifestSwarmRef!),
    siteSwarmRef: text(r.siteSwarmRef!),
    sig: hex(r.sig!),
  }));
}

export function listUnreleases(reader: ArkivReader): Promise<Page<UnreleaseRecord>> {
  return fetchAll(reader, UnreleaseSchema, exists("rootHash"), (r) => ({
    ...info(r),
    rootHash: hex(r.rootHash!),
    sig: hex(r.sig!),
  }));
}

export function listRebuilds(reader: ArkivReader, rootHash: Hex): Promise<Page<RebuildRecord>> {
  return fetchAll(reader, RebuildSchema, eq("rootHash", str(rootHash)), (r) => ({
    ...info(r),
    rootHash: hex(r.rootHash!),
    matched: num(r.matched!) === 1,
  }));
}

// ---------------------------------------------------------------- time

/**
 * Arkiv's $createdAt is a BLOCK NUMBER, not a time. The validator needs the time, so this reads each block's
 * timestamp once and caches it.
 */
export class BlockClock {
  private readonly cache = new Map<bigint, number>();

  constructor(private readonly reader: Pick<ArkivReader, "getBlock">) {}

  async timeOf(block: bigint): Promise<number> {
    const cached = this.cache.get(block);
    if (cached !== undefined) return cached;
    try {
      const { timestamp } = await this.reader.getBlock({ blockNumber: block });
      const t = Number(timestamp);
      this.cache.set(block, t);
      return t;
    } catch (error) {
      throw toDriveError(error, `time of Arkiv block ${block}`);
    }
  }

  async timesOf(blocks: Iterable<bigint>): Promise<Map<bigint, number>> {
    const out = new Map<bigint, number>();
    for (const block of new Set(blocks)) out.set(block, await this.timeOf(block));
    return out;
  }
}
