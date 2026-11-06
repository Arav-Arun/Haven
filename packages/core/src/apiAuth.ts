// Request formats for the API (CLOAKROOM_PLAN.md section 15), shared by the client (step A6) and apps/api, so both sides
// sign and verify exactly the same text. Every request is signed (EIP-191) by the key it concerns and carries the time,
// so it can't be replayed later or made on someone else's behalf. /room also carries a proof of work.
// (Uploads use the signed format in swarm.ts.)

import { DriveError, type Address, type Hex } from "@cloakroom/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import { getAddress, isAddress, isHex, type LocalAccount, recoverMessageAddress, toHex } from "viem";

import { sha256, utf8 } from "./crypto";

/** How far a signed request's time may be from the API's clock. */
export const API_WINDOW_SECONDS = 300;

export interface ClaimRequest {
  label: string;
  driveKey: Address;
  mainWallet: Address | null;
  spendingPublicKey: Hex;
  time: number;
  signature: Hex;
}

export interface RoomRequest {
  roomKey: Address;
  time: number;
  /** Proof of work: sha256(powChallenge(roomKey, time) ‖ nonce) starts with `difficulty` zero bits. */
  nonce: string;
  signature: Hex;
}

export type DripKind = "drive" | "room";

export interface DripRequest {
  /** K or K_room: the drive owner asking for gas. */
  key: Address;
  /** Its drive root or room registry. */
  registry: Address;
  /** The registry's label under cloakroom.eth ("alice") or rooms.cloakroom.eth ("r-…"). */
  label: string;
  kind: DripKind;
  time: number;
  signature: Hex;
}

export function claimMessage(r: Omit<ClaimRequest, "signature">): string {
  return [
    "Cloakroom claim v1",
    `name: ${r.label}.cloakroom.eth`,
    `drive key: ${getAddress(r.driveKey)}`,
    `main wallet: ${r.mainWallet ? getAddress(r.mainWallet) : "none"}`,
    `cloak.key: ${r.spendingPublicKey.toLowerCase()}`,
    `time: ${r.time}`,
  ].join("\n");
}

export function roomMessage(r: Omit<RoomRequest, "signature">): string {
  return ["Cloakroom room v1", `room key: ${getAddress(r.roomKey)}`, `time: ${r.time}`, `nonce: ${r.nonce}`].join("\n");
}

export function dripMessage(r: Omit<DripRequest, "signature">): string {
  return [
    "Cloakroom drip v1",
    `key: ${getAddress(r.key)}`,
    `registry: ${getAddress(r.registry)}`,
    `name: ${r.kind === "room" ? `${r.label}.rooms.cloakroom.eth` : `${r.label}.cloakroom.eth`}`,
    `time: ${r.time}`,
  ].join("\n");
}

const now = () => Math.floor(Date.now() / 1000);

export async function signClaim(drive: LocalAccount, r: Omit<ClaimRequest, "signature" | "driveKey" | "time">, time = now()) {
  const body = { ...r, driveKey: drive.address, time };
  return { ...body, signature: await drive.signMessage({ message: claimMessage(body) }) } satisfies ClaimRequest;
}

export async function signRoom(room: LocalAccount, nonce: string, time: number): Promise<RoomRequest> {
  const body = { roomKey: room.address, time, nonce };
  return { ...body, signature: await room.signMessage({ message: roomMessage(body) }) };
}

export async function signDrip(owner: LocalAccount, r: Omit<DripRequest, "signature" | "key" | "time">, time = now()) {
  const body = { ...r, key: owner.address, time };
  return { ...body, signature: await owner.signMessage({ message: dripMessage(body) }) } satisfies DripRequest;
}

// ---------------------------------------------------------------- proof of work (POST /room)

export function powChallenge(roomKey: Address, time: number): string {
  return `cloakroom-room-pow|${getAddress(roomKey)}|${time}|`;
}

function leadingZeroBits(hash: Uint8Array): number {
  let bits = 0;
  for (const byte of hash) {
    if (byte === 0) {
      bits += 8;
      continue;
    }
    return bits + Math.clz32(byte) - 24;
  }
  return bits;
}

export function powBits(roomKey: Address, time: number, nonce: string): number {
  return leadingZeroBits(sha256(utf8(powChallenge(roomKey, time) + nonce)));
}

/** Client side: finds a nonce. About 2^difficulty hashes; yields to the event loop so a page stays responsive. */
export async function solvePow(roomKey: Address, time: number, difficulty: number): Promise<string> {
  for (let n = 0; ; n++) {
    const nonce = n.toString(36);
    if (powBits(roomKey, time, nonce) >= difficulty) return nonce;
    if (n % 20_000 === 0) await new Promise((r) => setTimeout(r, 0));
  }
}

// ---------------------------------------------------------------- server-side checks

function fresh(time: unknown, at: number): number {
  if (typeof time !== "number" || !Number.isSafeInteger(time) || Math.abs(at - time) > API_WINDOW_SECONDS) {
    throw new DriveError("NOT_AUTHORIZED", "request time missing or too far from now");
  }
  return time;
}

function address(value: unknown, field: string): Address {
  if (typeof value !== "string" || !isAddress(value)) throw new DriveError("UNKNOWN", `${field} must be an address`);
  return getAddress(value);
}

async function signedBy(message: string, signature: unknown, expected: Address): Promise<void> {
  if (typeof signature !== "string" || !isHex(signature)) throw new DriveError("NOT_AUTHORIZED", "missing signature");
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message, signature });
  } catch {
    throw new DriveError("NOT_AUTHORIZED", "unreadable signature");
  }
  if (getAddress(signer) !== expected) throw new DriveError("NOT_AUTHORIZED", "signature is not from that key");
}

/** True for an uncompressed secp256k1 public key (0x04…, 65 bytes), the format of cloak.key. */
export function isSpendingPublicKey(value: unknown): value is Hex {
  if (typeof value !== "string" || !/^0x04[0-9a-fA-F]{128}$/.test(value)) return false;
  try {
    secp256k1.ProjectivePoint.fromHex(value.slice(2)).assertValidity();
    return true;
  } catch {
    return false;
  }
}

export async function verifyClaimRequest(body: Record<string, unknown>, at = now()): Promise<ClaimRequest> {
  const time = fresh(body.time, at);
  const driveKey = address(body.driveKey, "driveKey");
  const mainWallet = body.mainWallet === null || body.mainWallet === undefined ? null : address(body.mainWallet, "mainWallet");
  if (typeof body.label !== "string") throw new DriveError("UNKNOWN", "label must be a string");
  if (!isSpendingPublicKey(body.spendingPublicKey)) {
    throw new DriveError("UNKNOWN", "spendingPublicKey must be an uncompressed secp256k1 public key");
  }
  const request = { label: body.label, driveKey, mainWallet, spendingPublicKey: body.spendingPublicKey, time };
  await signedBy(claimMessage(request), body.signature, driveKey);
  return { ...request, signature: body.signature as Hex };
}

export async function verifyRoomRequest(body: Record<string, unknown>, difficulty: number, at = now()): Promise<RoomRequest> {
  const time = fresh(body.time, at);
  const roomKey = address(body.roomKey, "roomKey");
  if (typeof body.nonce !== "string" || body.nonce.length > 32) throw new DriveError("UNKNOWN", "nonce must be a short string");
  if (powBits(roomKey, time, body.nonce) < difficulty) throw new DriveError("NOT_AUTHORIZED", "proof of work too weak");
  const request = { roomKey, time, nonce: body.nonce };
  await signedBy(roomMessage(request), body.signature, roomKey);
  return { ...request, signature: body.signature as Hex };
}

export async function verifyDripRequest(body: Record<string, unknown>, at = now()): Promise<DripRequest> {
  const time = fresh(body.time, at);
  const key = address(body.key, "key");
  const registry = address(body.registry, "registry");
  if (body.kind !== "drive" && body.kind !== "room") throw new DriveError("UNKNOWN", "kind must be drive or room");
  if (typeof body.label !== "string" || !/^[a-z0-9-]{1,64}$/.test(body.label)) throw new DriveError("UNKNOWN", "bad label");
  const request = { key, registry, label: body.label, kind: body.kind as DripKind, time };
  await signedBy(dripMessage(request), body.signature, key);
  return { ...request, signature: body.signature as Hex };
}

/** A short, unlinkable id for counters: rate limits key on this, never on the raw address. */
export function counterKey(scope: string, value: string): string {
  return toHex(sha256(utf8(`${scope}|${value.toLowerCase()}`))).slice(2, 18);
}
