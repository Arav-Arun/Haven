import { doorbellTopic, mineGsocKey, sealDoorbell, sha256, signRing, ZK_ARTIFACTS, zkIdentity, zkJoinTypedData } from "@haven/core";
import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, describe, expect, it } from "vitest";

import { createApi, readEnv } from "../src/app";

// Requests that are refused before any network call. Nothing here reaches Sepolia, Arkiv or Bee
// (the URLs point at a closed local port).
const relayerKey = generatePrivateKey();
const api = createApi(
  readEnv({
    SEPOLIA_RPC_URL: "http://127.0.0.1:9",
    RELAYER_PRIVATE_KEY: relayerKey,
    ARKIV_RPC_URL: "http://127.0.0.1:9",
    ARKIV_ACCESS_KEY: "test-only",
    BEE_URL: "http://127.0.0.1:9",
    POSTAGE_BATCH_ID: "00".repeat(32),
    ROOM_POW_DIFFICULTY: "16",
    DRIP_SEPOLIA_WEI: "1",
    DRIP_ARKIV_WEI: "1",
    DRIP_BATCH_SECONDS: "600",
  }),
);
afterAll(() => api.close());

const post = (path: string, body: unknown, headers: Record<string, string> = {}) =>
  api.app.request(path, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });

describe("api", () => {
  it("refuses to start with a missing setting", () => {
    expect(() => readEnv({})).toThrow(/is not set/);
  });

  it("serves its public config and health", async () => {
    const res = await api.app.request("/config");
    expect(await res.json()).toEqual({ relayer: privateKeyToAccount(relayerKey).address, roomPowDifficulty: 16, dripBatchSeconds: 600, doorbell: null });
    expect((await api.app.request("/health")).status).toBe(200);
  });

  it("refuses unsigned claims, rooms without proof of work, and drips for malformed addresses", async () => {
    expect((await post("/claim", { label: "alice" })).status).toBe(403);
    expect((await post("/room", { roomKey: privateKeyToAccount(generatePrivateKey()).address, nonce: 1 })).status).toBe(403);
    expect((await post("/drip", { address: "0x1", registry: "0x2" })).status).toBe(403);
  });

  it("forwards only allowlisted Arkiv methods", async () => {
    const res = await post("/arkiv-rpc", { jsonrpc: "2.0", id: 1, method: "debug_traceTransaction", params: [] });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_AUTHORIZED");
  });

  it("refuses uploads without a valid signature", async () => {
    const res = await api.app.request("/upload", { method: "POST", body: new Uint8Array(65536) });
    expect(res.status).toBe(403);
  });

  it("refuses malformed key-log entries before touching the network", async () => {
    const entry = { ensName: "Alice.haven.eth", seq: 0, kind: "publish", spendingPublicKey: "0x02", devicePublicKey: "none", prevEntryKey: "none" };
    expect((await post("/keylog", { type: "entry", entry, sig: "0x00" })).status).toBe(403); // not a normalized name
    expect((await post("/keylog", { type: "entry", entry: { ...entry, ensName: "alice.haven.eth" }, sig: "0x00" })).status).toBe(403); // bad signature
    expect((await post("/keylog", { type: "nonsense" })).status).toBe(403);
  });

  it("has doorbells off when DOORBELL_PROXIMITY is empty, and refuses forged rings when on", async () => {
    expect((await post("/doorbell", {})).status).toBe(404);
    const on = createApi(
      readEnv({
        SEPOLIA_RPC_URL: "http://127.0.0.1:9",
        RELAYER_PRIVATE_KEY: relayerKey,
        ARKIV_RPC_URL: "http://127.0.0.1:9",
        ARKIV_ACCESS_KEY: "test-only",
        BEE_URL: "http://127.0.0.1:9",
        POSTAGE_BATCH_ID: "00".repeat(32),
        ROOM_POW_DIFFICULTY: "16",
        DRIP_SEPOLIA_WEI: "1",
        DRIP_ARKIV_WEI: "1",
        DRIP_BATCH_SECONDS: "600",
        DOORBELL_PROXIMITY: "4",
      }),
    );
    try {
      const topic = doorbellTopic(new Uint8Array(32).fill(7), "0x1111111111111111111111111111111111111111");
      const key = mineGsocKey(topic, { overlay: `0x${"ab".repeat(32)}`, proximity: 4 });
      const ring = await signRing(key, await sealDoorbell(topic, key.address, { type: "file", arkivKey: `0x${"cd".repeat(32)}` }));
      const forged = { ...ring, owner: privateKeyToAccount(generatePrivateKey()).address };
      const res = await on.app.request("/doorbell", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(forged) });
      expect(res.status).toBe(403);
      const tooLong = { ...ring, data: `${ring.data}00` };
      expect((await on.app.request("/doorbell", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(tooLong) })).status).toBe(403);
      // (Bee isn't reachable from tests, so /config still reports doorbells as off)
      expect(((await (await on.app.request("/config")).json()) as { doorbell: unknown }).doorbell).toBeNull();
    } finally {
      on.close();
    }
  });

  it("allows any origin (no cookies anywhere)", async () => {
    const res = await api.app.request("/config", { headers: { origin: "chrome-extension://abc" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});

describe("swarm gateway", () => {
  it("refuses anything that isn't a Swarm reference", async () => {
    expect((await api.app.request("/bytes/not-a-ref")).status).toBe(404);
    expect((await api.app.request("/bytes/../../stamps")).status).toBe(404);
  });
});

describe("anonymous writes (add-on Z1)", () => {
  const folder = "0x1111111111111111111111111111111111111111";

  it("serves the pinned proving files and nothing else", async () => {
    for (const a of Object.values(ZK_ARTIFACTS)) {
      const res = await api.app.request(a.path);
      expect(res.status).toBe(200);
      expect(res.headers.get("cache-control")).toContain("immutable");
      expect(toHex(sha256(new Uint8Array(await res.arrayBuffer())))).toBe(a.sha256);
    }
    expect((await api.app.request("/zk/semaphore-6.zkey")).status).toBe(404);
    expect((await api.app.request("/zk/..%2Fpackage.json")).status).toBe(404);
  });

  it("refuses malformed or unsigned joins before touching the network", async () => {
    const member = privateKeyToAccount(generatePrivateKey());
    const commitment = zkIdentity(generatePrivateKey(), folder).commitment.toString();
    expect((await post("/zk/join", { folder, member: member.address, commitment: "0", sig: "0x00" })).status).toBe(403);
    // signed by someone else
    const other = privateKeyToAccount(generatePrivateKey());
    const sig = await other.signTypedData(zkJoinTypedData({ folder, member: member.address, commitment }));
    const res = await post("/zk/join", { folder, member: member.address, commitment, sig });
    expect(res.status).toBe(403);
    expect(((await res.json()) as { error: { message: string } }).error.message).toMatch(/not signed by the member/);
  });

  it("refuses uploads and entries without a well-formed proof", async () => {
    expect((await api.app.request("/zk/upload", { method: "POST", body: new Uint8Array(65536) })).status).toBe(403);
    const stale = { "x-haven-folder": folder, "x-haven-time": "1", "x-haven-zk-proof": "0x00" };
    expect((await api.app.request("/zk/upload", { method: "POST", headers: stale, body: new Uint8Array(65536) })).status).toBe(403);
    const entry = { folder, fileId: "00".repeat(16), version: 1, epoch: 0, swarmRef: `0x${"ab".repeat(32)}`, meta: "0x00", proof: "0x00" };
    expect((await post("/zk/file", entry)).status).toBe(403);
    expect((await post("/zk/file", { ...entry, fileId: "../x" })).status).toBe(403);
  });
});
