import type { AnonFetch, AnonStatus, PrivateNetwork } from "@cloakroom/types";
import { createPublicClient } from "viem";
import { sepolia } from "viem/chains";
import { describe, expect, it } from "vitest";

import { anonTransport, memoryStore, passthroughAnon, type RouteStep } from "../src/transport";

const RPC = "https://rpc.example/sepolia";

/** An AnonFetch that answers JSON-RPC from a table and records how each request was sent. */
function fakeAnon(network: PrivateNetwork, answer: (method: string) => Response) {
  const sent: { url: string; isolationKey: string | null; method: string }[] = [];
  const make =
    (isolationKey: string | null): typeof fetch =>
    async (input, init) => {
      const body = JSON.parse(String(init?.body)) as { method: string; id: number };
      sent.push({ url: String(input), isolationKey, method: body.method });
      return answer(body.method);
    };
  const status: AnonStatus = { network, state: network === "off" ? "off" : "ready" };
  const anon: AnonFetch = {
    fetch: make(null),
    isolated: (key) => make(key),
    supportsAnyHttps: false,
    status: () => status,
    onStatus: () => () => {},
    close: () => {},
  };
  return { anon, sent };
}

const ok = (result: unknown) => new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, result }));

describe("anonTransport", () => {
  it("sends JSON-RPC through the isolated fetch and records an anon route", async () => {
    const { anon, sent } = fakeAnon("nym", () => ok("0x10"));
    const routes: RouteStep[] = [];
    const client = createPublicClient({
      chain: sepolia,
      transport: anonTransport({ url: RPC, anon, isolationKey: "0xStealth", onRoute: (s) => routes.push(s) }),
    });
    expect(await client.getBlockNumber({ cacheTime: 0 })).toBe(16n);
    expect(sent).toEqual([{ url: RPC, isolationKey: "0xStealth", method: "eth_blockNumber" }]);
    expect(routes).toEqual([
      { kind: "route", label: "eth_blockNumber", route: "anon", network: "nym", isolationKey: "0xStealth" },
    ]);
  });

  it("without an isolation key uses the shared fetch; with the network off, routes show as direct", async () => {
    const { anon, sent } = fakeAnon("off", () => ok("0x1"));
    const routes: RouteStep[] = [];
    const client = createPublicClient({ transport: anonTransport({ url: RPC, anon, onRoute: (s) => routes.push(s) }) });
    await client.getChainId();
    expect(sent[0]?.isolationKey).toBeNull();
    expect(routes[0]).toEqual({ kind: "route", label: "eth_chainId", route: "direct", network: "off" });
  });

  it("surfaces JSON-RPC errors and HTTP failures as errors", async () => {
    const rpcError = fakeAnon("nym", () =>
      new Response(JSON.stringify({ jsonrpc: "2.0", id: 1, error: { code: -32000, message: "execution reverted" } })),
    );
    await expect(
      createPublicClient({ transport: anonTransport({ url: RPC, anon: rpcError.anon }) }).getChainId(),
    ).rejects.toThrow(/execution reverted/);

    const httpError = fakeAnon("nym", () => new Response("bad gateway", { status: 502 }));
    await expect(
      createPublicClient({ transport: anonTransport({ url: RPC, anon: httpError.anon }) }).getChainId(),
    ).rejects.toThrow(/502|bad gateway/i);
  });
});

describe("Node adapters", () => {
  it("passthroughAnon is plain fetch with the network off", () => {
    const f = (async () => ok(1)) as unknown as typeof fetch;
    const anon = passthroughAnon(f);
    expect(anon.fetch).toBe(f);
    expect(anon.isolated("k")).toBe(f);
    expect(anon.status()).toEqual({ network: "off", state: "off" });
  });

  it("memoryStore stores copies", async () => {
    const store = memoryStore();
    const value = new Uint8Array([1, 2, 3]);
    await store.set("k", value);
    value[0] = 9;
    const got = await store.get("k");
    expect(got).toEqual(new Uint8Array([1, 2, 3]));
    got![1] = 9;
    expect(await store.get("k")).toEqual(new Uint8Array([1, 2, 3]));
    await store.delete("k");
    expect(await store.get("k")).toBeNull();
  });
});
