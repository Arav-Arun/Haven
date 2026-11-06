// Add-on F4: doorbell topics, 256-byte payloads, Swarm chunk encoding, key mining, and the subscriber's epoch handling,
// with a socket double standing in for Bee's WebSocket. The live run checks the chunk encoding against a real Bee node.

import type { Hex } from "@cloakroom/types";
import { concatBytes, hexToBytes, keccak256, recoverMessageAddress, toHex } from "viem";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { randomBytes, utf8 } from "../src/crypto";
import {
  bmtRoot,
  cacAddress,
  DOORBELL_PAYLOAD_BYTES,
  gsocKey,
  gsocSubscribeUrl,
  inboxTopic,
  makeDoorbellChunk,
  openDoorbell,
  proximity,
  roomTopic,
  roomTopicAt,
  sealDoorbell,
  socAddress,
  stampDoorbell,
  subscribeRoom,
  type DoorbellSocket,
  type LiveEvent,
} from "../src/doorbell";
import { chainHead, deriveEpochKey, type EpochSchedule } from "../src/epochs";

const arkivKey = (): Hex => toHex(randomBytes(32));
const SCHEDULE: EpochSchedule = { t0: 1_800_000_000, epochSeconds: 60 };
const TARGET = { overlay: toHex(randomBytes(32)), proximity: 4 };

describe("topics", () => {
  it("a member holding E[j] can compute every topic up to epoch j and none after", () => {
    const head = chainHead(randomBytes(32));
    const held = { index: 5, key: deriveEpochKey(head, 5) };
    const at = (epoch: number) => SCHEDULE.t0 + epoch * SCHEDULE.epochSeconds + 1;
    for (let e = 0; e <= 5; e++) {
      expect(roomTopicAt(held, SCHEDULE, at(e))!.topic.id).toBe(roomTopic(deriveEpochKey(head, e)).id);
    }
    expect(roomTopicAt(held, SCHEDULE, at(6))).toBeNull();
    expect(roomTopicAt(held, SCHEDULE, SCHEDULE.t0 - 10)).toBeNull();
  });

  it("changes every epoch, and the room and inbox doorbells never collide", () => {
    const head = chainHead(randomBytes(32));
    const ids = new Set(Array.from({ length: 10 }, (_, e) => roomTopic(deriveEpochKey(head, e)).id));
    expect(ids.size).toBe(10);
    const mk = randomBytes(32);
    expect(inboxTopic(mk).id).toBe(inboxTopic(new Uint8Array(mk)).id); // member and manager compute the same
    expect(ids.has(inboxTopic(mk).id)).toBe(false);
  });
});

describe("payloads", () => {
  it("are exactly 256 bytes and round-trip", async () => {
    const topic = roomTopic(randomBytes(32));
    for (const type of ["file", "member", "refresh", "rotation"] as const) {
      const key = arkivKey();
      const sealed = await sealDoorbell(topic, { type, arkivKey: key });
      expect(sealed.length).toBe(DOORBELL_PAYLOAD_BYTES);
      expect(await openDoorbell(topic, sealed)).toEqual({ type, arkivKey: key });
    }
  });

  it("anything else on the topic is dropped: another topic's ring, a tampered byte, random bytes, wrong sizes", async () => {
    const topic = roomTopic(randomBytes(32));
    const sealed = await sealDoorbell(topic, { type: "file", arkivKey: arkivKey() });
    expect(await openDoorbell(roomTopic(randomBytes(32)), sealed)).toBeNull();
    const tampered = new Uint8Array(sealed);
    tampered[100]! ^= 1;
    expect(await openDoorbell(topic, tampered)).toBeNull();
    expect(await openDoorbell(topic, randomBytes(256))).toBeNull();
    expect(await openDoorbell(topic, sealed.subarray(0, 255))).toBeNull();
    await expect(sealDoorbell(topic, { type: "file", arkivKey: "0x12" })).rejects.toThrow();
  });
});

describe("Swarm chunks", () => {
  it("an empty chunk has Swarm's well-known address", () => {
    expect(cacAddress(new Uint8Array())).toBe("0xb34ca8c22b9e982354f9c7f50b470d66db428d880c8a904d5fe4ec9713171526");
  });

  it("the BMT root depends on every byte and on nothing past the payload", () => {
    const a = randomBytes(300);
    const b = new Uint8Array(a);
    b[299]! ^= 1;
    expect(toHex(bmtRoot(a))).not.toBe(toHex(bmtRoot(b)));
    expect(cacAddress(a)).not.toBe(cacAddress(concatBytes([a, new Uint8Array(1)]))); // the span covers the length
    expect(() => bmtRoot(new Uint8Array(4097))).toThrow();
  });

  it("proximity counts shared leading bits", () => {
    const zero = toHex(new Uint8Array(32));
    expect(proximity(zero, zero)).toBe(256);
    expect(proximity(zero, toHex(new Uint8Array([0x80, ...new Uint8Array(31)])))).toBe(0);
    expect(proximity(zero, toHex(new Uint8Array([0x01, ...new Uint8Array(31)])))).toBe(7);
    expect(proximity(zero, toHex(new Uint8Array([0, 0x10, ...new Uint8Array(30)])))).toBe(11);
  });

  it("every member mines the same key, landing in the target's neighbourhood", () => {
    const topic = roomTopic(randomBytes(32));
    const a = gsocKey(topic, TARGET);
    const b = gsocKey({ ...topic, key: new Uint8Array(topic.key), signingSeed: new Uint8Array(topic.signingSeed) }, TARGET);
    expect(b.owner).toBe(a.owner);
    expect(a.address).toBe(socAddress(topic.id, a.owner));
    expect(proximity(a.address, TARGET.overlay)).toBeGreaterThanOrEqual(TARGET.proximity);
  });

  it("a ring is a signed single-owner chunk Bee can check: EIP-191 over keccak256(id ‖ CAC address)", async () => {
    const topic = roomTopic(randomBytes(32));
    const payload = await sealDoorbell(topic, { type: "file", arkivKey: arkivKey() });
    const chunk = await makeDoorbellChunk(topic, TARGET, payload);
    expect(chunk.data.length).toBe(8 + DOORBELL_PAYLOAD_BYTES);
    expect(chunk.data.subarray(0, 8)).toEqual(new Uint8Array([0, 1, 0, 0, 0, 0, 0, 0])); // 256, little-endian
    const digest = keccak256(concatBytes([hexToBytes(topic.id), hexToBytes(cacAddress(payload))]));
    expect(await recoverMessageAddress({ message: { raw: digest }, signature: chunk.signature })).toBe(chunk.owner);
  });

  it("the API posts the chunk to Bee's SOC endpoint with its stamp, and refuses anything that isn't a doorbell", async () => {
    const topic = roomTopic(randomBytes(32));
    const chunk = await makeDoorbellChunk(topic, TARGET, await sealDoorbell(topic, { type: "member", arkivKey: arkivKey() }));
    const calls: { url: string; init: RequestInit }[] = [];
    const fakeFetch = (async (url: string, init: RequestInit) => {
      calls.push({ url, init });
      return new Response("{}", { status: 201 });
    }) as unknown as typeof fetch;
    const batch = "ab".repeat(32);
    const wire = { owner: chunk.owner, identifier: chunk.identifier, signature: chunk.signature, data: toHex(chunk.data) };
    await stampDoorbell("https://bee.example/", batch, wire, fakeFetch);
    expect(calls[0]!.url).toBe(
      `https://bee.example/soc/${chunk.owner.slice(2)}/${chunk.identifier.slice(2)}?sig=${chunk.signature.slice(2)}`,
    );
    expect((calls[0]!.init.headers as Record<string, string>)["swarm-postage-batch-id"]).toBe(batch);
    await expect(stampDoorbell("https://bee.example", batch, { ...wire, data: toHex(utf8("big".repeat(200))) }, fakeFetch)).rejects.toThrow();
  });

  it("subscribes over wss for an https node", () => {
    expect(gsocSubscribeUrl("https://bee.example/", `0x${"0f".repeat(32)}`)).toBe(`wss://bee.example/gsoc/subscribe/${"0f".repeat(32)}`);
  });
});

/** Bee's WebSocket, played by the test: it records which address each socket listens on. */
class Sockets {
  readonly open: { url: string; socket: DoorbellSocket }[] = [];
  readonly factory = (url: string): DoorbellSocket => {
    const socket: DoorbellSocket = { onmessage: null, onclose: null, onerror: null, close: () => (this.open.find((o) => o.socket === socket)!.url = "closed") };
    this.open.push({ url, socket });
    return socket;
  };
  last() {
    return this.open[this.open.length - 1]!;
  }
}

describe("subscribeRoom", () => {
  let clock = 0;
  beforeEach(() => {
    vi.useFakeTimers();
    clock = SCHEDULE.t0 + 5;
  });
  afterEach(() => vi.useRealTimers());

  function setup(heldIndex = 100) {
    const head = chainHead(randomBytes(32));
    const held = { index: heldIndex, key: deriveEpochKey(head, heldIndex) };
    const sockets = new Sockets();
    const events: LiveEvent[] = [];
    const fallbacks: string[] = [];
    let ended = false;
    const stop = subscribeRoom({
      folder: "0x000000000000000000000000000000000000dEaD",
      held,
      schedule: SCHEDULE,
      target: TARGET,
      beeUrl: "https://bee.example",
      onEvent: (e) => events.push(e),
      onFallback: (r) => fallbacks.push(r),
      onEnded: () => (ended = true),
      openSocket: sockets.factory,
      now: () => clock,
      retryMs: 1000,
    });
    const topicFor = (epoch: number) => roomTopic(deriveEpochKey(head, epoch));
    return { sockets, events, fallbacks, stop, topicFor, isEnded: () => ended };
  }

  const tick = async (ms: number) => {
    clock += ms / 1000;
    await vi.advanceTimersByTimeAsync(ms);
  };

  it("hands the app each valid ring with its folder, and drops forged ones", async () => {
    const { sockets, events, topicFor, stop } = setup();
    const topic = topicFor(0);
    expect(sockets.last().url).toBe(gsocSubscribeUrl("https://bee.example", gsocKey(topic, TARGET).address));
    const key = arkivKey();
    sockets.last().socket.onmessage!({ data: await sealDoorbell(topic, { type: "file", arkivKey: key }) });
    sockets.last().socket.onmessage!({ data: randomBytes(256) });
    sockets.last().socket.onmessage!({ data: await sealDoorbell(topicFor(1), { type: "file", arkivKey: arkivKey() }) });
    // decryption runs on WebCrypto, outside the fake timers: wait for it
    await vi.waitFor(() => expect(events).toHaveLength(1));
    await tick(10);
    expect(events).toEqual([{ type: "file", arkivKey: key, folder: "0x000000000000000000000000000000000000dEaD", receivedAt: SCHEDULE.t0 + 5 }]);
    stop();
  });

  it("moves to the next epoch's topic at the boundary, and stops after the member's last epoch", async () => {
    const { sockets, topicFor, isEnded } = setup(1);
    expect(sockets.last().url).toContain(gsocKey(topicFor(0), TARGET).address.slice(2));
    await tick(60_000);
    expect(sockets.last().url).toContain(gsocKey(topicFor(1), TARGET).address.slice(2));
    expect(sockets.open[0]!.url).toBe("closed");
    await tick(60_000);
    expect(isEnded()).toBe(true);
    expect(sockets.open.length).toBe(2);
  });

  it("falls back once when the socket drops, then reconnects", async () => {
    const { sockets, fallbacks, events, topicFor, stop } = setup();
    sockets.last().socket.onclose!();
    sockets.open[0]!.socket.onclose!(); // repeated close events count once
    expect(fallbacks).toHaveLength(1);
    await tick(1000);
    expect(sockets.open.length).toBe(2);
    sockets.last().socket.onmessage!({ data: await sealDoorbell(topicFor(0), { type: "refresh", arkivKey: arkivKey() }) });
    await vi.waitFor(() => expect(events.map((e) => e.type)).toEqual(["refresh"]));
    stop();
  });
});
