import type { AnonFetch, AnonStatus, PrivateNetwork } from "@haven/types";
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

describe("anonTransport batching", () => {
  /** An AnonFetch whose endpoint answers each call with its method name, singly or as a batch (or refuses batches). */
  function batchAnon(opts: { refuseBatches?: boolean } = {}) {
    const posts: { isolationKey: string | null; methods: string[]; batch: boolean }[] = [];
    const make =
      (isolationKey: string | null): typeof fetch =>
      async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as { id: number; method: string } | { id: number; method: string }[];
        const calls = Array.isArray(body) ? body : [body];
        posts.push({ isolationKey, methods: calls.map((c) => c.method), batch: Array.isArray(body) });
        if (Array.isArray(body) && opts.refuseBatches) return new Response(JSON.stringify({ jsonrpc: "2.0", id: null, error: { code: -32600, message: "no batches" } }));
        const reply = (c: { id: number; method: string }) =>
          c.method === "eth_fail" ? { jsonrpc: "2.0", id: c.id, error: { code: -32000, message: "boom" } } : { jsonrpc: "2.0", id: c.id, result: c.method };
        return new Response(JSON.stringify(Array.isArray(body) ? [...calls].reverse().map(reply) : reply(calls[0]!)));
      };
    const anon: AnonFetch = {
      fetch: make(null),
      isolated: (key) => make(key),
      supportsAnyHttps: false,
      status: () => ({ network: "nox", state: "ready" }),
      onStatus: () => () => {},
      close: () => {},
    };
    return { anon, posts };
  }
  const call = (anon: AnonFetch, method: string, isolationKey?: string, url = RPC) =>
    anonTransport({ url, anon, ...(isolationKey ? { isolationKey } : {}) })({ retryCount: 0 }).request({ method: method as never });

  it("sends calls made at the same moment as one batch, and matches each answer to its call", async () => {
    const { anon, posts } = batchAnon();
    const results = await Promise.all([call(anon, "eth_a"), call(anon, "eth_b"), call(anon, "eth_c")]);
    expect(results).toEqual(["eth_a", "eth_b", "eth_c"]);
    expect(posts).toEqual([{ isolationKey: null, methods: ["eth_a", "eth_b", "eth_c"], batch: true }]);
  });

  it("never mixes isolation keys, and fails only the call that failed", async () => {
    const { anon, posts } = batchAnon();
    const [a, b, c] = await Promise.allSettled([call(anon, "eth_a", "0x1"), call(anon, "eth_fail", "0x1"), call(anon, "eth_c", "0x2")]);
    expect(a).toEqual({ status: "fulfilled", value: "eth_a" });
    expect(b.status).toBe("rejected");
    expect(c).toEqual({ status: "fulfilled", value: "eth_c" });
    expect(posts).toEqual([
      { isolationKey: "0x1", methods: ["eth_a", "eth_fail"], batch: true },
      { isolationKey: "0x2", methods: ["eth_c"], batch: false },
    ]);
  });

  it("sends transactions on their own", async () => {
    const { anon, posts } = batchAnon();
    await Promise.all([call(anon, "eth_sendRawTransaction"), call(anon, "eth_a"), call(anon, "eth_b")]);
    expect(posts).toContainEqual({ isolationKey: null, methods: ["eth_sendRawTransaction"], batch: false });
    expect(posts).toContainEqual({ isolationKey: null, methods: ["eth_a", "eth_b"], batch: true });
  });

  it("falls back to one call per request where batches are refused", async () => {
    const { anon, posts } = batchAnon({ refuseBatches: true });
    // Its own URL: an endpoint that refused a batch is remembered for the rest of the run.
    const url = "https://rpc.example/no-batches";
    expect(await Promise.all([call(anon, "eth_a", undefined, url), call(anon, "eth_b", undefined, url)])).toEqual(["eth_a", "eth_b"]);
    expect(posts.filter((p) => !p.batch).map((p) => p.methods[0]).sort()).toEqual(["eth_a", "eth_b"]);
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
