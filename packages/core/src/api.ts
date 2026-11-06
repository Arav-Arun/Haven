// The formats apps/api accepts (CLOAKROOM_PLAN.md section 15), shared by the client and the server so both sides
// sign and check exactly the same bytes. Upload signing lives in swarm.ts.

import { DriveError, type Address, type Hex } from "@cloakroom/types";
import { getAddress, isAddress, isHex, recoverMessageAddress, type LocalAccount } from "viem";

import { sha256, utf8 } from "./crypto";

/** How far a signed request's time may be from the API's clock. */
export const REQUEST_WINDOW_SECONDS = 300;

// ---------------------------------------------------------------- POST /claim

export interface ClaimRequest {
  label: string;
  /** K: signs the request, and gets the everyday roles on the new drive root. */
  driveKey: Address;
  /** W, or null for passkey and "Try it" identities. */
  mainWallet: Address | null;
  /** The cloak.key record: the spending public key, uncompressed. */
  spendingPublicKey: Hex;
  time: number;
  signature: Hex;
}

export interface ClaimResponse {
  ensName: string;
  resolver: Address;
  driveRoot: Address;
  driveRootBlock: string;
  /** The relayer account, so the client can check it kept no role (verifyClaim). */
  api: Address;
}

export function claimMessage(r: Omit<ClaimRequest, "signature">): string {
  return [
    "Cloakroom claim v1",
    `label: ${r.label}`,
    `drive key: ${getAddress(r.driveKey)}`,
    `main wallet: ${r.mainWallet ? getAddress(r.mainWallet) : "none"}`,
    `cloak.key: ${r.spendingPublicKey.toLowerCase()}`,
    `time: ${r.time}`,
  ].join("\n");
}

export async function signClaim(driveKey: LocalAccount, r: Omit<ClaimRequest, "signature" | "driveKey">): Promise<ClaimRequest> {
  const body = { ...r, driveKey: driveKey.address };
  return { ...body, signature: await driveKey.signMessage({ message: claimMessage(body) }) };
}

/** API side: the request is well formed, recent, and signed by its drive key. */
export async function verifyClaimRequest(raw: unknown, now = Math.floor(Date.now() / 1000)): Promise<ClaimRequest> {
  const r = raw as Partial<ClaimRequest> | null;
  if (
    !r ||
    typeof r.label !== "string" ||
    !isAddress(r.driveKey ?? "") ||
    !(r.mainWallet === null || isAddress(r.mainWallet ?? "")) ||
    !isHex(r.spendingPublicKey) ||
    r.spendingPublicKey.length !== 132 ||
    !Number.isSafeInteger(r.time) ||
    !isHex(r.signature)
  ) {
    throw new DriveError("NOT_AUTHORIZED", "malformed claim request");
  }
  if (Math.abs(now - r.time!) > REQUEST_WINDOW_SECONDS) throw new DriveError("NOT_AUTHORIZED", "claim request too old");
  const request = r as ClaimRequest;
  let signer: Address;
  try {
    signer = await recoverMessageAddress({ message: claimMessage(request), signature: request.signature });
  } catch {
    throw new DriveError("NOT_AUTHORIZED", "unreadable claim signature");
  }
  if (getAddress(signer) !== getAddress(request.driveKey)) throw new DriveError("NOT_AUTHORIZED", "claim signature mismatch");
  return request;
}

// ---------------------------------------------------------------- POST /room (proof-of-work)

export interface RoomRequest {
  /** K_room[n]: becomes the room's only root. Nothing in the request links it to the owner. */
  roomKey: Address;
  nonce: number;
}

export interface RoomResponse {
  ensName: string;
  registry: Address;
  blockNumber: string;
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

function powHash(roomKey: Address, nonce: number): Uint8Array {
  return sha256(utf8(`cloakroom-room:${getAddress(roomKey)}:${nonce}`));
}

/** Finds a nonce whose hash has `difficulty` leading zero bits. About 2^difficulty hashes; 20 bits takes a second or two. */
export async function solveRoomPow(roomKey: Address, difficulty: number): Promise<number> {
  for (let nonce = 0; ; nonce++) {
    if (leadingZeroBits(powHash(roomKey, nonce)) >= difficulty) return nonce;
    if (nonce % 20_000 === 0) await new Promise((r) => setTimeout(r, 0)); // keep the page responsive
  }
}

export function checkRoomPow(r: RoomRequest, difficulty: number): boolean {
  return Number.isSafeInteger(r.nonce) && r.nonce >= 0 && leadingZeroBits(powHash(r.roomKey, r.nonce)) >= difficulty;
}

// ---------------------------------------------------------------- POST /drip

export interface DripRequest {
  /** K or K_room. Stealth member addresses are never dripped: their sharer funds them. */
  address: Address;
  /** A registry where `address` is the owner (driveOwner): a drive root or a room. */
  registry: Address;
}

export interface DripResponse {
  /** When the batch this request joined will be sent (unix seconds). */
  sendsAt: number;
}

// ---------------------------------------------------------------- GET /config

/** What the API tells clients about itself: public values only. */
export interface ApiInfo {
  relayer: Address;
  roomPowDifficulty: number;
  dripBatchSeconds: number;
  /** Add-on F4: our Bee node's overlay and the proximity GSOC keys are mined to; null when doorbells are off. */
  doorbell: { overlay: Hex; proximity: number } | null;
}
