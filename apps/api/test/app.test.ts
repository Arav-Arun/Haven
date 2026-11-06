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
    expect(await res.json()).toEqual({ relayer: privateKeyToAccount(relayerKey).address, roomPowDifficulty: 16, dripBatchSeconds: 600 });
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

  it("allows any origin (no cookies anywhere)", async () => {
    const res = await api.app.request("/config", { headers: { origin: "chrome-extension://abc" } });
    expect(res.headers.get("access-control-allow-origin")).toBe("*");
  });
});
