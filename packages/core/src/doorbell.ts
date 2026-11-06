// Add-on F4: live updates with Swarm pub/sub (GSOC, "graffiti" single-owner chunks).
//
// A doorbell only says "something changed in this folder, check Arkiv now". It never carries data that must be
// trusted: the receiver fetches the named Arkiv entity and runs the normal validator before showing anything, so a
// forged ring leads only to a rejected fetch.
//
// Topic: HKDF(E_v[epoch], "doorbell/<folder>"). Only current members can compute it, and it changes every epoch with
// the key chain, so a member whose access ended can't keep listening.
//
// GSOC: everyone who knows the topic derives the same chunk key. A Bee node only hears writes to addresses in its own
// neighbourhood, so the key is "mined": the first HKDF(topic, "gsoc/<i>") whose chunk address shares `proximity`
// leading bits with our Bee node's overlay. Writers and listeners mine the same way and land on the same address.
//
// Payload: { type, arkivKey }, sealed with AES-256-GCM under HKDF(topic, "payload") and padded so the chunk payload is
// always exactly 256 bytes: outsiders learn nothing from its size.

import type { Address, Hex } from "@haven/types";
import { bytesToHex, concatBytes, hexToBytes, isAddress, isAddressEqual, keccak256, recoverMessageAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { aesDecrypt, aesEncrypt, AES_OVERHEAD, hkdf, toPrivateKey, utf8 } from "./crypto";

export type DoorbellType = "file" | "member" | "refresh" | "rotation";
const TYPES: readonly DoorbellType[] = ["file", "member", "refresh", "rotation"];

export const DOORBELL_PAYLOAD_BYTES = 256;
const SPAN_BYTES = 8;
const CHUNK_BYTES = 4096;
const SEGMENT = 32;

export interface DoorbellEvent {
  type: DoorbellType;
  arkivKey: Hex;
}

/** What the API's /config says about our Bee node, so every client mines the same addresses. */
export interface DoorbellConfig {
  overlay: Hex;
  proximity: number;
}

// ---------------------------------------------------------------- topic and keys

export function doorbellTopic(epochKey: Uint8Array, folder: Address): Uint8Array {
  return hkdf(epochKey, `doorbell/${folder.toLowerCase()}`);
}

/** Leading bits two 32-byte addresses share. */
export function proximity(a: Uint8Array, b: Uint8Array): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const x = a[i]! ^ b[i]!;
    if (x !== 0) return i * 8 + Math.clz32(x) - 24;
  }
  return Math.min(a.length, b.length) * 8;
}

export interface GsocKey {
  privateKey: Hex;
  owner: Address;
  /** SOC identifier: 32 bytes. */
  id: Hex;
  /** keccak256(id ‖ owner): where the chunk lives, and what a listener subscribes to. */
  address: Hex;
}

export function socAddress(id: Hex, owner: Address): Hex {
  return keccak256(concatBytes([hexToBytes(id), hexToBytes(owner)]));
}

const MAX_MINING_TRIES = 1 << 20;

/** The GSOC key for a topic, mined towards `config.overlay`. Deterministic: every member gets the same one. */
export function mineGsocKey(topic: Uint8Array, config: DoorbellConfig): GsocKey {
  const id = bytesToHex(hkdf(topic, "gsoc-id"));
  const overlay = hexToBytes(config.overlay);
  for (let i = 0; i < MAX_MINING_TRIES; i++) {
    const privateKey = toPrivateKey(hkdf(topic, `gsoc/${i}`));
    const owner = privateKeyToAccount(privateKey).address;
    const address = socAddress(id, owner);
    if (proximity(hexToBytes(address), overlay) >= config.proximity) return { privateKey, owner, id, address };
  }
  throw new Error(`no GSOC key within ${MAX_MINING_TRIES} tries at proximity ${config.proximity}`);
}

// ---------------------------------------------------------------- payload

const payloadKey = (topic: Uint8Array) => hkdf(topic, "payload");

export async function sealDoorbell(topic: Uint8Array, address: Hex, event: DoorbellEvent): Promise<Uint8Array> {
  if (!TYPES.includes(event.type)) throw new Error("unknown doorbell type");
  const body = utf8(JSON.stringify({ t: event.type, k: event.arkivKey.toLowerCase(), n: Date.now() }));
  const room = DOORBELL_PAYLOAD_BYTES - AES_OVERHEAD;
  if (body.length + 2 > room) throw new Error("doorbell payload too long");
  const padded = new Uint8Array(room);
  padded[0] = body.length >> 8;
  padded[1] = body.length & 0xff;
  padded.set(body, 2);
  const sealed = await aesEncrypt(payloadKey(topic), padded, hexToBytes(address));
  if (sealed.length !== DOORBELL_PAYLOAD_BYTES) throw new Error("doorbell payload isn't 256 bytes");
  return sealed;
}

/** Opens a payload; null when it isn't for this topic, was tampered with, or isn't well formed. */
export async function openDoorbell(topic: Uint8Array, address: Hex, sealed: Uint8Array): Promise<DoorbellEvent | null> {
  // Bee may deliver the chunk with its 8-byte span in front; try both.
  for (const data of [sealed, sealed.subarray(SPAN_BYTES)]) {
    if (data.length !== DOORBELL_PAYLOAD_BYTES) continue;
    try {
      const padded = await aesDecrypt(payloadKey(topic), data, hexToBytes(address));
      const length = (padded[0]! << 8) | padded[1]!;
      const v = JSON.parse(new TextDecoder().decode(padded.subarray(2, 2 + length))) as { t?: string; k?: string };
      if (!TYPES.includes(v.t as DoorbellType) || typeof v.k !== "string" || !/^0x[0-9a-f]{64}$/.test(v.k)) return null;
      return { type: v.t as DoorbellType, arkivKey: v.k as Hex };
    } catch {
      // not this form
    }
  }
  return null;
}

// ---------------------------------------------------------------- Swarm chunk (BMT) and SOC signature

/** Swarm's binary Merkle tree hash of up to 4096 bytes (zero-padded), then keccak256(span ‖ root). */
export function cacAddress(span: Uint8Array, payload: Uint8Array): Hex {
  if (payload.length > CHUNK_BYTES) throw new Error("chunk payload over 4096 bytes");
  let level = new Uint8Array(CHUNK_BYTES);
  level.set(payload);
  while (level.length > SEGMENT) {
    const next = new Uint8Array(level.length / 2);
    for (let i = 0; i < level.length; i += 2 * SEGMENT) {
      next.set(hexToBytes(keccak256(level.subarray(i, i + 2 * SEGMENT))), i / 2);
    }
    level = next;
  }
  return keccak256(concatBytes([span, level]));
}

export function spanOf(length: number): Uint8Array {
  const span = new Uint8Array(SPAN_BYTES);
  new DataView(span.buffer).setBigUint64(0, BigInt(length), true);
  return span;
}

/** POST /doorbell body: a signed SOC the API stamps with our postage batch and hands to Bee. */
export interface DoorbellRing {
  owner: Address;
  id: Hex;
  sig: Hex;
  /** span ‖ payload, hex. */
  data: Hex;
}

/** Signs a SOC the way Bee checks it: an EIP-191 signature over keccak256(id ‖ cacAddress). */
export async function signRing(key: GsocKey, payload: Uint8Array): Promise<DoorbellRing> {
  const span = spanOf(payload.length);
  const digest = keccak256(concatBytes([hexToBytes(key.id), hexToBytes(cacAddress(span, payload))]));
  const sig = await privateKeyToAccount(key.privateKey).signMessage({ message: { raw: hexToBytes(digest) } });
  return { owner: key.owner, id: key.id, sig, data: bytesToHex(concatBytes([span, payload])) };
}

/** Checks a ring before stamping it: right size, and signed by `owner`. */
export async function checkRing(ring: DoorbellRing): Promise<boolean> {
  if (!isAddress(ring.owner) || !/^0x[0-9a-fA-F]{64}$/.test(ring.id) || !/^0x[0-9a-fA-F]{130}$/.test(ring.sig)) return false;
  const data = hexToBytes(ring.data);
  if (data.length !== SPAN_BYTES + DOORBELL_PAYLOAD_BYTES) return false;
  const span = data.subarray(0, SPAN_BYTES);
  if (new DataView(span.buffer, span.byteOffset, SPAN_BYTES).getBigUint64(0, true) !== BigInt(DOORBELL_PAYLOAD_BYTES)) return false;
  const digest = keccak256(concatBytes([hexToBytes(ring.id), hexToBytes(cacAddress(span, data.subarray(SPAN_BYTES)))]));
  try {
    const signer = await recoverMessageAddress({ message: { raw: hexToBytes(digest) }, signature: ring.sig });
    return isAddressEqual(signer, ring.owner);
  } catch {
    return false;
  }
}
