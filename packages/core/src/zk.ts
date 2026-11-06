// Add-on Z1: anonymous writes with zero-knowledge proofs (Semaphore v4: Groth16 over BN254).
//
// A haven.file entry is signed by the writer's member address, so anyone can see which member wrote which file. Here a
// writer proves "I'm one of this folder's writers" without saying which one:
//   1. Join: each writer derives a Semaphore identity from the key it holds for the folder (S, K or K_room; for a
//      stealth member only the member knows S's key, not the sharer) and publishes the commitment in a haven.zkjoin
//      entry, EIP-712 signed by its member address. Our API relays it, so joining needs no gas.
//   2. The writer group of a folder at time t is the commitments of valid joins whose member held WRITE at t
//      (DriveRegistry.wasAllowed), in join order. Every reader rebuilds it from Arkiv and Sepolia, so nobody keeps a
//      tree up to date: removal or an end date drops a writer by itself.
//   3. Write: a haven.zkfile entry carries a proof whose message is the hash of the entry's fields and whose Merkle root
//      is the writer group's root. Our API checks it and relays the entry, so its $creator is the API. The Swarm upload
//      is authorised the same way, with no signer header.
//   4. Read: an entry counts only if its proof verifies, its message matches its fields and its root is the writer
//      group's root at its creation time. Then the usual version, epoch and refresh rules apply, as for an editor who
//      doesn't manage the folder.
// Each proof uses a fresh random scope, so its nullifier links nothing. The writer alone can recognise its own entries
// by recomputing the nullifier. Still visible: which member addresses joined (they already hold WRITE onchain), the
// group size, timing, and to our API the IP of a request that isn't routed through Anon-RPC.

import { generateProof, Group, Identity, verifyProof, type SemaphoreProof } from "@semaphore-protocol/core";
import { DriveError, type Address, type Hex } from "@haven/types";
import { poseidon2 } from "poseidon-lite/poseidon2";
import {
  bytesToBigInt,
  bytesToHex,
  encodeAbiParameters,
  getAddress,
  hexToBigInt,
  hexToBytes,
  isAddress,
  isAddressEqual,
  isHex,
  keccak256,
  numberToBytes,
  numberToHex,
  parseAbiParameters,
  recoverTypedDataAddress,
  toHex,
} from "viem";

import { listZkJoins, type ArkivReader, type ZkFileRecord, type ZkJoinRecord } from "./arkiv";
import { equalBytes, hkdf, randomBytes, sha256 } from "./crypto";
import { ROLE_DRIVE_WRITE } from "./ens";
import { KEYLOG_DOMAIN } from "./keydir";
import { PAD_BUCKETS } from "./padding";
import { normalizeRef } from "./swarm";
import type { AccessHistory, Clock, Hidden } from "./validator";

// ---------------------------------------------------------------- constants

/** Every proof is made for a tree of depth 5, so it hides the group size up to 32 writers. */
export const ZK_DEPTH = 5;
export const ZK_MAX_WRITERS = 2 ** ZK_DEPTH;
/** With fewer writers in the group, a proof wouldn't hide who wrote. */
export const ZK_MIN_WRITERS = 2;

/**
 * The circuit's proving files, served by our API (apps/api/zk) and checked against these hashes before use. They are
 * Semaphore's published 4.13.0 artifacts for depth 5, whose verification key ships inside @semaphore-protocol/proof.
 */
export const ZK_ARTIFACTS = {
  wasm: { path: "/zk/semaphore-5.wasm", sha256: "0x74ee373fc66bf81ca89de52602b555f16ef0e54c0e36e5b69c6e109d146acfb5" },
  zkey: { path: "/zk/semaphore-5.zkey", sha256: "0xa1431c24dc49e98d07d48e7bdacc002875bcb02a799d9156c6aa6bcbe0838926" },
} as const;

export const ZK_HEADERS = {
  folder: "x-haven-folder",
  time: "x-haven-time",
  proof: "x-haven-zk-proof",
} as const;

/** How far an anonymous upload's time may be from the API's clock. */
export const ZK_UPLOAD_WINDOW_SECONDS = 300;

const SNARK_FIELD = 21888242871839275222246405745257275088548364400416034343698204186575808495617n;
/** depth (1 byte) ‖ root ‖ nullifier ‖ scope ‖ 8 proof points, 32 bytes each. */
const PACKED_BYTES = 1 + 32 * 11;

// ---------------------------------------------------------------- identity and joins

/** The writer's Semaphore identity for one folder, from the key it holds there (S, K or K_room). */
export function zkIdentity(folderKey: Hex, folder: Address): Identity {
  return new Identity(hkdf(hexToBytes(folderKey), `haven/zk-identity/${getAddress(folder)}`));
}

export function isCommitment(value: string): boolean {
  if (!/^[1-9][0-9]{0,77}$/.test(value)) return false;
  return BigInt(value) < SNARK_FIELD;
}

/** What the member address signs to put its commitment in a folder's writer group. */
export function zkJoinTypedData(j: { folder: Address; member: Address; commitment: string }) {
  return {
    domain: KEYLOG_DOMAIN,
    types: {
      ZkJoin: [
        { name: "folder", type: "address" },
        { name: "member", type: "address" },
        { name: "commitment", type: "uint256" },
      ],
    },
    primaryType: "ZkJoin" as const,
    message: { folder: getAddress(j.folder), member: getAddress(j.member), commitment: BigInt(j.commitment) },
  };
}

/** POST /zk/join */
export interface ZkJoinRequest {
  folder: Address;
  member: Address;
  commitment: string;
  sig: Hex;
}

export interface ZkJoinResponse {
  entityKey: Hex;
  /** null when the member had already joined. */
  txHash: Hex | null;
}

/** A writer in a folder's group: its first valid join. */
export interface ZkWriter {
  key: Hex;
  member: Address;
  commitment: bigint;
  createdAtBlock: bigint;
}

async function signedByMember(j: ZkJoinRecord): Promise<boolean> {
  try {
    const signer = await recoverTypedDataAddress({ ...zkJoinTypedData(j), signature: j.sig });
    return isAddressEqual(signer, j.member);
  } catch {
    return false;
  }
}

/**
 * The joins that count: read-only, for this folder, signed by their member, who held WRITE when the join was created.
 * Only a member's first valid join counts, and each commitment once. Oldest first.
 */
export async function checkJoins(
  records: ZkJoinRecord[],
  folder: Address,
  history: AccessHistory,
  clock: Clock,
): Promise<{ writers: ZkWriter[]; hidden: number }> {
  const candidates: ZkJoinRecord[] = [];
  for (const j of records) {
    if (j.readonly && isAddressEqual(j.folder, folder) && isCommitment(j.commitment) && (await signedByMember(j))) candidates.push(j);
  }
  const times = await clock.timesOf(candidates.map((j) => j.createdAtBlock));
  const allowed = candidates.length
    ? await history.allowedMany(folder, candidates.map((j) => j.member), ROLE_DRIVE_WRITE, candidates.map((j) => times.get(j.createdAtBlock)!))
    : [];
  const ordered = candidates
    .filter((_, i) => allowed[i] === true)
    .sort((a, b) => (a.createdAtBlock === b.createdAtBlock ? (a.key < b.key ? -1 : 1) : a.createdAtBlock < b.createdAtBlock ? -1 : 1));
  const members = new Set<string>();
  const commitments = new Set<string>();
  const writers: ZkWriter[] = [];
  for (const j of ordered) {
    if (members.has(j.member.toLowerCase()) || commitments.has(j.commitment)) continue;
    members.add(j.member.toLowerCase());
    commitments.add(j.commitment);
    writers.push({ key: j.key, member: j.member, commitment: BigInt(j.commitment), createdAtBlock: j.createdAtBlock });
  }
  return { writers, hidden: records.length - writers.length };
}

/**
 * The writer group (leaves, in join order) at each point: writers that had joined by `block` (null: any) and held
 * WRITE at `time`. One wasAllowedMany call for all points.
 */
export async function writerGroups(
  writers: ZkWriter[],
  folder: Address,
  history: AccessHistory,
  points: { block: bigint | null; time: number }[],
): Promise<bigint[][]> {
  const asks: { point: number; writer: ZkWriter }[] = [];
  points.forEach((p, point) => {
    for (const writer of writers) if (p.block === null || writer.createdAtBlock <= p.block) asks.push({ point, writer });
  });
  const answers = asks.length
    ? await history.allowedMany(folder, asks.map((a) => a.writer.member), ROLE_DRIVE_WRITE, asks.map((a) => points[a.point]!.time))
    : [];
  const out = points.map(() => [] as bigint[]);
  asks.forEach((a, i) => {
    if (answers[i] === true) out[a.point]!.push(a.writer.commitment);
  });
  return out;
}

/** The Merkle root of a writer group (Semaphore's LeanIMT), 0 for an empty group. */
export function groupRoot(leaves: bigint[]): bigint {
  return leaves.length === 0 ? 0n : new Group(leaves).root;
}

/** A folder's writers and group right now (or at `time`), straight from Arkiv and the registry's history. */
export async function currentWriterGroup(
  reader: ArkivReader,
  history: AccessHistory,
  clock: Clock,
  folder: Address,
  time: number,
): Promise<{ writers: ZkWriter[]; leaves: bigint[]; root: bigint }> {
  const { writers } = await checkJoins((await listZkJoins(reader, folder)).records, folder, history, clock);
  const [leaves] = await writerGroups(writers, folder, history, [{ block: null, time }]);
  return { writers, leaves: leaves!, root: groupRoot(leaves!) };
}

// ---------------------------------------------------------------- messages (what a proof is about)

const abiHash = (types: string, values: readonly unknown[]): bigint =>
  hexToBigInt(keccak256(encodeAbiParameters(parseAbiParameters(types), values as never)));

/** A file entry's fields, as the proof's message: changing any of them breaks the proof. */
export function zkFileMessage(v: { folder: Address; fileId: string; version: number; epoch: number; swarmRef: string; meta: Uint8Array }): bigint {
  return abiHash("string, address, string, uint64, uint64, bytes, bytes32", [
    "haven.zkfile v1",
    getAddress(v.folder),
    v.fileId,
    BigInt(v.version),
    BigInt(v.epoch),
    normalizeRef(v.swarmRef),
    keccak256(v.meta),
  ]);
}

/** An anonymous upload: the folder, the exact body (its SHA-256) and the time. */
export function zkUploadMessage(v: { folder: Address; bodySha256: Hex; time: number }): bigint {
  return abiHash("string, address, bytes32, uint64", ["haven.zkupload v1", getAddress(v.folder), v.bodySha256, BigInt(v.time)]);
}

// ---------------------------------------------------------------- proofs

export interface ZkArtifacts {
  wasm: Uint8Array;
  zkey: Uint8Array;
}

let artifacts: Promise<ZkArtifacts> | null = null;

/** The proving files, fetched once with `get` (path → bytes) and checked against ZK_ARTIFACTS' hashes. */
export function loadZkArtifacts(get: (path: string) => Promise<Uint8Array>): Promise<ZkArtifacts> {
  artifacts ??= (async () => {
    const [wasm, zkey] = await Promise.all([get(ZK_ARTIFACTS.wasm.path), get(ZK_ARTIFACTS.zkey.path)]);
    for (const [bytes, want] of [
      [wasm, ZK_ARTIFACTS.wasm.sha256],
      [zkey, ZK_ARTIFACTS.zkey.sha256],
    ] as const) {
      if (!equalBytes(sha256(bytes), hexToBytes(want))) throw new DriveError("UNKNOWN", "the proving files don't match their pinned hashes");
    }
    return { wasm, zkey };
  })();
  artifacts.catch(() => (artifacts = null));
  return artifacts;
}

/** Proves that `identity` is in the group `leaves`, about `message`, with a fresh random scope. */
export async function proveWrite(identity: Identity, leaves: bigint[], message: bigint, files: ZkArtifacts): Promise<SemaphoreProof> {
  if (!leaves.includes(identity.commitment)) throw new DriveError("NOT_AUTHORIZED", "You aren't in this folder's writer group yet.");
  if (leaves.length > ZK_MAX_WRITERS) throw new DriveError("UNKNOWN", `Anonymous writes support up to ${ZK_MAX_WRITERS} writers per folder.`);
  const scope = bytesToBigInt(randomBytes(32));
  // snarkjs reads in-memory files as well as paths or URLs; the type only names strings.
  return generateProof(identity, new Group(leaves), message, scope, ZK_DEPTH, files as unknown as { wasm: string; zkey: string });
}

const verified = new Map<string, Promise<boolean>>();

/** The proof is valid, for depth ZK_DEPTH, about `message`, against the group with root `root`. */
export async function verifyWrite(proof: SemaphoreProof, expect: { root: bigint; message: bigint }): Promise<boolean> {
  if (proof.merkleTreeDepth !== ZK_DEPTH) return false;
  if (BigInt(proof.merkleTreeRoot) !== expect.root || BigInt(proof.message) !== expect.message) return false;
  const id = JSON.stringify(proof);
  let result = verified.get(id);
  if (!result) {
    result = verifyProof(proof).catch(() => false);
    verified.set(id, result);
  }
  return result;
}

/** True if `identity` made this proof (its nullifier is Poseidon(hash(scope), secret)). */
export function madeBy(identity: Identity, proof: Pick<SemaphoreProof, "scope" | "nullifier">): boolean {
  const scopeHash = hexToBigInt(keccak256(numberToHex(BigInt(proof.scope), { size: 32 }))) >> 8n;
  return poseidon2([scopeHash, identity.secretScalar]) === BigInt(proof.nullifier);
}

export function packProof(p: SemaphoreProof): Uint8Array {
  const out = new Uint8Array(PACKED_BYTES);
  out[0] = p.merkleTreeDepth;
  [p.merkleTreeRoot, p.nullifier, p.scope, ...p.points].forEach((v, i) => out.set(numberToBytes(BigInt(v), { size: 32 }), 1 + 32 * i));
  return out;
}

/** The proof stored with an entry; its message is recomputed from the entry's fields, never stored. */
export function unpackProof(bytes: Uint8Array, message: bigint): SemaphoreProof {
  if (bytes.length !== PACKED_BYTES) throw new Error("not a packed proof");
  const word = (i: number) => bytesToBigInt(bytes.subarray(1 + 32 * i, 33 + 32 * i)).toString();
  return {
    merkleTreeDepth: bytes[0]!,
    merkleTreeRoot: word(0) as SemaphoreProof["merkleTreeRoot"],
    nullifier: word(1) as SemaphoreProof["nullifier"],
    scope: word(2) as SemaphoreProof["scope"],
    message: message.toString() as SemaphoreProof["message"],
    points: Array.from({ length: 8 }, (_, i) => word(3 + i)) as SemaphoreProof["points"],
  };
}

// ---------------------------------------------------------------- relayed writes

/** POST /zk/file: a file entry and its proof; the API checks both and writes the entry. */
export interface ZkFileRequest {
  folder: Address;
  fileId: string;
  version: number;
  epoch: number;
  swarmRef: Hex;
  meta: Hex;
  proof: Hex;
}

export interface ZkFileResponse {
  entityKey: Hex;
  txHash: Hex;
}

export function zkUploadHeaders(folder: Address, time: number, proof: SemaphoreProof): Record<string, string> {
  return { [ZK_HEADERS.folder]: getAddress(folder), [ZK_HEADERS.time]: String(time), [ZK_HEADERS.proof]: bytesToHex(packProof(proof)) };
}

/**
 * API side of an anonymous upload: the headers' shape, the time window, the size and the proof's message. The caller
 * must still check the proof against the folder's current writer group (verifyWrite) and refuse a reused nullifier.
 */
export function readZkUpload(
  headers: { get(name: string): string | null },
  body: Uint8Array,
  now = Math.floor(Date.now() / 1000),
): { folder: Address; time: number; proof: SemaphoreProof } {
  const folder = headers.get(ZK_HEADERS.folder) ?? "";
  const time = Number(headers.get(ZK_HEADERS.time));
  const packed = headers.get(ZK_HEADERS.proof) ?? "";
  if (!isAddress(folder) || !Number.isSafeInteger(time) || !isHex(packed)) throw new DriveError("NOT_AUTHORIZED", "missing or malformed upload proof");
  if (Math.abs(now - time) > ZK_UPLOAD_WINDOW_SECONDS) throw new DriveError("NOT_AUTHORIZED", "upload proof too old");
  if (body.length > PAD_BUCKETS[PAD_BUCKETS.length - 1]!) throw new DriveError("TOO_LARGE", "upload too large");
  const message = zkUploadMessage({ folder: getAddress(folder), bodySha256: toHex(sha256(body)), time });
  try {
    return { folder: getAddress(folder), time, proof: unpackProof(hexToBytes(packed), message) };
  } catch {
    throw new DriveError("NOT_AUTHORIZED", "malformed upload proof");
  }
}

// ---------------------------------------------------------------- reading

/** What a reader learns from a valid anonymous entry. */
export interface ZkWriteInfo {
  root: bigint;
  nullifier: bigint;
  scope: bigint;
  /** How many writers the group had when the entry was written: the entry could be any of them. */
  writers: number;
}

/**
 * The anonymous file entries that count: read-only, for this folder, and with a valid proof about their own fields
 * against the writer group at their creation time. The version, epoch and refresh rules run afterwards (validator.ts).
 */
export async function checkZkFiles(
  records: ZkFileRecord[],
  joins: ZkJoinRecord[],
  folder: Address,
  history: AccessHistory,
  clock: Clock,
): Promise<{ valid: (ZkFileRecord & { createdAt: number; zk: ZkWriteInfo })[]; hidden: Hidden<ZkFileRecord>[] }> {
  const valid: (ZkFileRecord & { createdAt: number; zk: ZkWriteInfo })[] = [];
  const hidden: Hidden<ZkFileRecord>[] = [];
  if (records.length === 0) return { valid, hidden };
  const candidates: { record: ZkFileRecord; proof: SemaphoreProof }[] = [];
  for (const record of records) {
    if (!record.readonly) {
      hidden.push({ record, reason: "not-readonly" });
      continue;
    }
    try {
      if (!isAddressEqual(record.folder, folder)) throw new Error("other folder");
      candidates.push({ record, proof: unpackProof(record.proof, zkFileMessage(record)) });
    } catch {
      hidden.push({ record, reason: "bad-proof" });
    }
  }
  const { writers } = await checkJoins(joins, folder, history, clock);
  const times = await clock.timesOf(candidates.map((c) => c.record.createdAtBlock));
  const groups = await writerGroups(
    writers,
    folder,
    history,
    candidates.map((c) => ({ block: c.record.createdAtBlock, time: times.get(c.record.createdAtBlock)! })),
  );
  for (const [i, { record, proof }] of candidates.entries()) {
    const leaves = groups[i]!;
    const root = groupRoot(leaves);
    if (BigInt(proof.merkleTreeRoot) !== root) {
      hidden.push({ record, reason: "not-a-writer" });
      continue;
    }
    if (!(await verifyWrite(proof, { root, message: BigInt(proof.message) }))) {
      hidden.push({ record, reason: "bad-proof" });
      continue;
    }
    valid.push({
      ...record,
      createdAt: times.get(record.createdAtBlock)!,
      zk: { root, nullifier: BigInt(proof.nullifier), scope: BigInt(proof.scope), writers: leaves.length },
    });
  }
  return { valid, hidden };
}

export type { SemaphoreProof };
