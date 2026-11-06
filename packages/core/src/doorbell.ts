// Live updates with Swarm pub/sub doorbells (add-on F4).
//
// "Shared with me", new files and refresh requests were found by polling Arkiv (on open, and every 15 minutes in the
// extension). A doorbell makes them show up within seconds: a writer "rings" after its Arkiv write, and members' apps
// hear it over a WebSocket from our Bee node. Arkiv stays the source of truth: a doorbell only says "something
// changed, check Arkiv now" (an Arkiv key and a type), and the app fetches and VALIDATES that entity as usual before
// showing anything. A forged ring leads to nothing but a rejected fetch.
//
// Swarm mechanism: GSOC (graffiti single-owner chunks). Everyone who can compute a topic derives the same signing key,
// so any of them can write the chunk at the topic's address, and a Bee node streams each write at that address to its
// WebSocket subscribers (/gsoc/subscribe/<address>). The key is "mined" so the address lands in our Bee node's
// neighbourhood, which is where GSOC messages are delivered. Clients hold no postage stamp, so a ring is signed by the
// client and stamped by our API (stampDoorbell), like uploads. PSS isn't used: it needs a Bee node per receiver.
//
// Topics hide who's talking:
//   - room doorbell:  HKDF(E_v[current epoch], "doorbell"), so only current members can compute it, and it changes every
//                     epoch with the key chain: someone whose access ended can't keep listening;
//   - inbox doorbell: HKDF(MK_S, "inbox"), one per share. The member and every manager hold the member key MK_S (the
//                     welcome note and the roster), so any manager can ring it. (The add-on spec derives it from the
//                     sharer's ephemeral ECDH secret, which only the original sharer ever holds.)
// Payloads are AES-GCM under the topic's key and always exactly 256 bytes, so their size says nothing.

import { DriveError, type Address, type Hex, type Timestamp } from "@cloakroom/types";
import { bytesToHex, concatBytes, hexToBytes, isHex, keccak256, numberToBytes } from "viem";
import { privateKeyToAccount, privateKeyToAddress } from "viem/accounts";

import { aesDecrypt, aesEncrypt, AES_OVERHEAD, hkdf, toPrivateKey, utf8 } from "./crypto";
import { deriveEpochKey, epochAt, epochEnd, type EpochKey, type EpochSchedule } from "./epochs";

// ---------------------------------------------------------------- topics

export interface DoorbellTopic {
  /** Public: the GSOC identifier. Reveals nothing without the secret it came from. */
  id: Hex;
  /** Secret: encrypts the payload. */
  key: Uint8Array;
  /** Secret: seed of the shared signing key that writes the topic's chunk. */
  signingSeed: Uint8Array;
}

function topicFrom(secret: Uint8Array): DoorbellTopic {
  return {
    id: bytesToHex(hkdf(secret, "doorbell/id")),
    key: hkdf(secret, "doorbell/key"),
    signingSeed: hkdf(secret, "doorbell/gsoc"),
  };
}

/** The room doorbell for epoch `epoch`, from E_v[epoch]. */
export function roomTopic(epochKey: Uint8Array): DoorbellTopic {
  if (epochKey.length !== 32) throw new Error("epoch key must be 32 bytes");
  return topicFrom(hkdf(epochKey, "doorbell"));
}

/**
 * The room doorbell at time `t` for someone holding `held`, or null once `t` is past their last epoch: a member whose
 * access ended can't compute the topics that come after it.
 */
export function roomTopicAt(
  held: EpochKey,
  schedule: EpochSchedule,
  t: Timestamp,
): { topic: DoorbellTopic; epoch: number; endsAt: Timestamp } | null {
  if (t < schedule.t0) return null; // the version hasn't started: nothing to listen to yet
  const epoch = epochAt(schedule, t);
  if (epoch < 0 || epoch > held.index) return null;
  return { topic: roomTopic(deriveEpochKey(held, epoch)), epoch, endsAt: epochEnd(schedule, epoch) };
}

/** One share's inbox doorbell, from its member key MK_S (held by the member and by every manager). */
export function inboxTopic(memberKey: Uint8Array): DoorbellTopic {
  if (memberKey.length !== 32) throw new Error("member key must be 32 bytes");
  return topicFrom(hkdf(memberKey, "inbox"));
}

// ---------------------------------------------------------------- payloads (always 256 bytes)

export const DOORBELL_PAYLOAD_BYTES = 256;
const PLAINTEXT_BYTES = DOORBELL_PAYLOAD_BYTES - AES_OVERHEAD;

export type DoorbellType = "file" | "member" | "refresh" | "rotation";
const TYPES: readonly DoorbellType[] = ["file", "member", "refresh", "rotation"];

export interface DoorbellEvent {
  type: DoorbellType;
  /** The Arkiv entity to fetch and validate. */
  arkivKey: Hex;
}

/** What a subscriber hands the app (the add-on's proposed LiveEvent). */
export interface LiveEvent extends DoorbellEvent {
  folder: Address;
  receivedAt: Timestamp;
}

export async function sealDoorbell(topic: DoorbellTopic, event: DoorbellEvent): Promise<Uint8Array> {
  if (!TYPES.includes(event.type) || !isHex(event.arkivKey) || event.arkivKey.length !== 66) {
    throw new Error("bad doorbell event");
  }
  const body = utf8(JSON.stringify({ t: event.type, k: event.arkivKey.toLowerCase() }));
  if (body.length + 2 > PLAINTEXT_BYTES) throw new Error("doorbell event too long");
  const padded = new Uint8Array(PLAINTEXT_BYTES); // [length u16 BE][json][zeros]
  padded[0] = body.length >> 8;
  padded[1] = body.length & 0xff;
  padded.set(body, 2);
  const sealed = await aesEncrypt(topic.key, padded, hexToBytes(topic.id));
  if (sealed.length !== DOORBELL_PAYLOAD_BYTES) throw new Error("doorbell payload size drifted");
  return sealed;
}

/** The event in a payload, or null for anything that isn't a valid ring on this topic. */
export async function openDoorbell(topic: DoorbellTopic, payload: Uint8Array): Promise<DoorbellEvent | null> {
  if (payload.length !== DOORBELL_PAYLOAD_BYTES) return null;
  try {
    const padded = await aesDecrypt(topic.key, payload, hexToBytes(topic.id));
    const length = ((padded[0] ?? 0) << 8) | (padded[1] ?? 0);
    if (length + 2 > padded.length) return null;
    const v = JSON.parse(new TextDecoder().decode(padded.subarray(2, 2 + length))) as { t?: unknown; k?: unknown };
    if (!TYPES.includes(v.t as DoorbellType) || typeof v.k !== "string" || !isHex(v.k) || v.k.length !== 66) return null;
    return { type: v.t as DoorbellType, arkivKey: v.k as Hex };
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- Swarm chunks (BMT, CAC, SOC)

const CHUNK_SIZE = 4096;
const SEGMENT = 32;

/** Swarm's binary Merkle tree root over a payload of up to 4096 bytes (zero-padded), with keccak256. */
export function bmtRoot(payload: Uint8Array): Uint8Array {
  if (payload.length > CHUNK_SIZE) throw new Error("payload larger than one chunk");
  let level: Uint8Array[] = [];
  const full = new Uint8Array(CHUNK_SIZE);
  full.set(payload);
  for (let i = 0; i < CHUNK_SIZE; i += SEGMENT) level.push(full.subarray(i, i + SEGMENT));
  while (level.length > 1) {
    const next: Uint8Array[] = [];
    for (let i = 0; i < level.length; i += 2) next.push(hexToBytes(keccak256(concatBytes([level[i]!, level[i + 1]!]))));
    level = next;
  }
  return level[0]!;
}

/** The 8-byte little-endian span that prefixes a chunk's data. */
export function span(length: number): Uint8Array {
  return numberToBytes(BigInt(length), { size: 8 }).reverse();
}

/** A content-addressed chunk's address: keccak256(span ‖ BMT root). */
export function cacAddress(payload: Uint8Array): Hex {
  return keccak256(concatBytes([span(payload.length), bmtRoot(payload)]));
}

/** A single-owner chunk's address: keccak256(identifier ‖ owner). */
export function socAddress(identifier: Hex, owner: Address): Hex {
  return keccak256(concatBytes([hexToBytes(identifier), hexToBytes(owner)]));
}

/** Leading bits two 32-byte addresses share (Swarm's proximity order). */
export function proximity(a: Hex, b: Hex): number {
  const x = hexToBytes(a);
  const y = hexToBytes(b);
  for (let i = 0; i < Math.min(x.length, y.length); i++) {
    const d = (x[i] ?? 0) ^ (y[i] ?? 0);
    if (d) return i * 8 + Math.clz32(d) - 24;
  }
  return Math.min(x.length, y.length) * 8;
}

/** Where GSOC messages must land to reach our Bee node: its overlay, and how many leading bits must match. */
export interface GsocTarget {
  overlay: Hex;
  proximity: number;
}

const gsocKeys = new Map<string, { privateKey: Hex; owner: Address; address: Hex }>();

/**
 * The topic's shared signing key, "mined" so the chunk address falls in the target's neighbourhood. Deterministic:
 * key i is HKDF(signingSeed, "gsoc/i") and the first i that fits wins, so every member finds the same key.
 */
export function gsocKey(topic: DoorbellTopic, target: GsocTarget, maxTries = 1 << 20) {
  const cacheKey = `${topic.id}/${target.overlay}/${target.proximity}`;
  const cached = gsocKeys.get(cacheKey);
  if (cached) return cached;
  for (let i = 0; i < maxTries; i++) {
    const privateKey = toPrivateKey(hkdf(topic.signingSeed, `gsoc/${i}`));
    const owner = privateKeyToAddress(privateKey);
    const address = socAddress(topic.id, owner);
    if (proximity(address, target.overlay) >= target.proximity) {
      const found = { privateKey, owner, address };
      gsocKeys.set(cacheKey, found);
      return found;
    }
  }
  throw new DriveError("UNKNOWN", "couldn't mine a doorbell key for this Bee node");
}

/** A signed single-owner chunk, ready for Bee's POST /soc/{owner}/{id}?sig=… (data is span ‖ payload). */
export interface DoorbellChunk {
  owner: Address;
  identifier: Hex;
  signature: Hex;
  data: Uint8Array;
  address: Hex;
}

/** Builds and signs the topic's chunk for one ring. The signature is EIP-191 over keccak256(id ‖ CAC address). */
export async function makeDoorbellChunk(topic: DoorbellTopic, target: GsocTarget, payload: Uint8Array): Promise<DoorbellChunk> {
  const { privateKey, owner, address } = gsocKey(topic, target);
  const cac = cacAddress(payload);
  const signature = await privateKeyToAccount(privateKey).signMessage({
    message: { raw: keccak256(concatBytes([hexToBytes(topic.id), hexToBytes(cac)])) },
  });
  return { owner, identifier: topic.id, signature, data: concatBytes([span(payload.length), payload]), address };
}

// ---------------------------------------------------------------- ringing

/** Client side: rings through our API, which holds the postage stamp (the API calls stampDoorbell). */
export async function ringViaApi(apiUrl: string, fetchImpl: typeof fetch, chunk: DoorbellChunk): Promise<void> {
  const res = await fetchImpl(`${apiUrl.replace(/\/+$/, "")}/doorbell`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ owner: chunk.owner, identifier: chunk.identifier, signature: chunk.signature, data: bytesToHex(chunk.data) }),
  });
  if (!res.ok) throw new DriveError(res.status === 429 ? "RATE_LIMITED" : "NETWORK", `doorbell: HTTP ${res.status}`);
}

/** Server side (apps/api POST /doorbell): checks the shape, then POSTs the chunk to Bee with our postage batch. */
export async function stampDoorbell(
  beeUrl: string,
  postageBatchId: string,
  chunk: { owner: string; identifier: string; signature: string; data: string },
  fetchImpl: typeof fetch = globalThis.fetch,
): Promise<void> {
  const ok =
    /^0x[0-9a-fA-F]{40}$/.test(chunk.owner) &&
    /^0x[0-9a-fA-F]{64}$/.test(chunk.identifier) &&
    /^0x[0-9a-fA-F]{130}$/.test(chunk.signature) &&
    /^0x[0-9a-fA-F]+$/.test(chunk.data) &&
    (chunk.data.length - 2) / 2 === 8 + DOORBELL_PAYLOAD_BYTES;
  if (!ok) throw new DriveError("UNKNOWN", "not a doorbell chunk");
  if (!/^(0x)?[0-9a-fA-F]{64}$/.test(postageBatchId)) throw new DriveError("UNKNOWN", "bad postage batch id");
  const strip = (h: string) => h.replace(/^0x/, "");
  const res = await fetchImpl(
    `${beeUrl.replace(/\/+$/, "")}/soc/${strip(chunk.owner)}/${strip(chunk.identifier)}?sig=${strip(chunk.signature)}`,
    {
      method: "POST",
      headers: { "content-type": "application/octet-stream", "swarm-postage-batch-id": strip(postageBatchId) },
      body: new Uint8Array(hexToBytes(chunk.data as Hex)),
    },
  );
  if (!res.ok) throw new DriveError("NETWORK", `Bee SOC upload: HTTP ${res.status}`);
}

/** Server side: our Bee node's overlay and storage depth, which clients mine their doorbell keys against. */
export async function beeTarget(beeUrl: string, fetchImpl: typeof fetch = globalThis.fetch): Promise<GsocTarget> {
  const base = beeUrl.replace(/\/+$/, "");
  const [addresses, topology] = await Promise.all([
    fetchImpl(`${base}/addresses`).then((r) => r.json() as Promise<{ overlay?: string }>),
    fetchImpl(`${base}/topology`).then((r) => r.json() as Promise<{ depth?: number }>),
  ]);
  if (!addresses.overlay || typeof topology.depth !== "number") throw new DriveError("NETWORK", "Bee node didn't report its overlay and depth");
  return { overlay: `0x${addresses.overlay.replace(/^0x/, "")}` as Hex, proximity: topology.depth };
}

// ---------------------------------------------------------------- listening

/** The WebSocket a Bee node streams a GSOC address's writes on. */
export function gsocSubscribeUrl(beeUrl: string, address: Hex): string {
  const u = new URL(`${beeUrl.replace(/\/+$/, "")}/gsoc/subscribe/${address.slice(2)}`);
  u.protocol = u.protocol === "https:" ? "wss:" : "ws:";
  return u.href;
}

/** The parts of a WebSocket a subscription uses, so Node, browsers and tests can each supply one. */
export interface DoorbellSocket {
  onmessage: ((e: { data: unknown }) => void) | null;
  onclose: ((e?: unknown) => void) | null;
  onerror: ((e?: unknown) => void) | null;
  close(): void;
}
export type OpenSocket = (url: string) => DoorbellSocket;

async function bytesOf(data: unknown): Promise<Uint8Array | null> {
  if (data instanceof Uint8Array) return data;
  if (data instanceof ArrayBuffer) return new Uint8Array(data);
  if (typeof Blob !== "undefined" && data instanceof Blob) return new Uint8Array(await data.arrayBuffer());
  return null;
}

export interface RoomSubscription {
  folder: Address;
  held: EpochKey;
  schedule: EpochSchedule;
  target: GsocTarget;
  beeUrl: string;
  onEvent: (e: LiveEvent) => void;
  /** The socket failed or closed: poll Arkiv until it's back (the app's normal refresh). Called once per outage. */
  onFallback?: (reason: string) => void;
  /** The member's access ended: no later topic can be computed. */
  onEnded?: () => void;
  openSocket?: OpenSocket;
  now?: () => Timestamp;
  /** Reconnect delay after a failure, in ms (doubles up to 60 s). */
  retryMs?: number;
}

/**
 * Listens to a room's doorbell, moving to the next topic at every epoch boundary and stopping when the member's access
 * ends. Returns stop(). Every message is decrypted with the current topic; anything else is dropped silently.
 */
export function subscribeRoom(s: RoomSubscription): () => void {
  const openSocket: OpenSocket = s.openSocket ?? ((url) => new WebSocket(url) as unknown as DoorbellSocket);
  const now = s.now ?? (() => Math.floor(Date.now() / 1000));
  let socket: DoorbellSocket | null = null;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let stopped = false;
  let degraded = false;
  let retry = s.retryMs ?? 2_000;

  const schedule = (ms: number, fn: () => void) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(fn, Math.max(0, ms));
  };

  const connect = () => {
    if (stopped) return;
    socket?.close();
    socket = null;
    const current = roomTopicAt(s.held, s.schedule, now());
    if (!current) {
      stopped = true;
      s.onEnded?.();
      return;
    }
    const { topic, endsAt } = current;
    const { address } = gsocKey(topic, s.target);
    let ws: DoorbellSocket;
    try {
      ws = openSocket(gsocSubscribeUrl(s.beeUrl, address));
    } catch (error) {
      return fail(error instanceof Error ? error.message : String(error));
    }
    socket = ws;
    ws.onmessage = (e) => {
      void (async () => {
        const bytes = await bytesOf(e.data);
        const event = bytes && (await openDoorbell(topic, bytes));
        if (!event || stopped) return;
        if (degraded) {
          degraded = false;
          retry = s.retryMs ?? 2_000;
        }
        s.onEvent({ ...event, folder: s.folder, receivedAt: now() });
      })();
    };
    const onDown = () => {
      if (socket === ws && !stopped) fail("the doorbell connection closed");
    };
    ws.onclose = onDown;
    ws.onerror = onDown;
    schedule((endsAt - now()) * 1000 + 50, connect); // the next epoch's topic
  };

  const fail = (reason: string) => {
    socket = null;
    if (!degraded) {
      degraded = true;
      s.onFallback?.(reason);
    }
    schedule(retry, connect);
    retry = Math.min(retry * 2, 60_000);
  };

  connect();
  return () => {
    stopped = true;
    if (timer) clearTimeout(timer);
    socket?.close();
    socket = null;
  };
}
