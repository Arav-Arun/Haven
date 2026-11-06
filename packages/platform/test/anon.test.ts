import { describe, expect, it, vi } from "vitest";
import { createAnonFetch, NETWORKS, type HarnessInit } from "../src";

const BOOT = "https://bootstrap.invalid/";

function fakeWorker(opts: { fail?: boolean; probeOk?: boolean } = {}) {
  const calls: { input: unknown; init: unknown }[] = [];
  let seenInit: HarnessInit | undefined;
  const factory = async (init: HarnessInit) => {
    seenInit = init;
    return {
      ready: opts.fail ? Promise.reject(new Error("bootstrap failed")) : Promise.resolve(),
      fetch: async (input: unknown, init?: unknown) => {
        calls.push({ input, init });
        if (String(input).endsWith("/health")) return new Response("", { status: opts.probeOk ? 200 : 502 });
        return new Response("ok");
      },
      close: vi.fn(),
    };
  };
  return { factory, calls, init: () => seenInit };
}

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("createAnonFetch", () => {
  it("routes through the worker with the right specifier and goes ready", async () => {
    const w = fakeWorker();
    const anon = createAnonFetch({ platform: "web", network: "nox", bootstrapRpcUrl: BOOT, workerFactory: w.factory });
    expect(anon.status().state).toBe("connecting");
    const res = await anon.fetch("https://rpc.example/", { method: "POST", body: "{}" });
    expect(await res.text()).toBe("ok");
    expect(w.init()?.address).toBe(NETWORKS.nox.specifier);
    await tick();
    expect(anon.status().state).toBe("ready");
  });

  it("measures supportsAnyHttps with a real request instead of assuming it", async () => {
    const ok = fakeWorker({ probeOk: true });
    const a = createAnonFetch({ platform: "web", network: "nym", bootstrapRpcUrl: BOOT, probeUrl: "https://bee.example/health", workerFactory: ok.factory });
    expect(a.supportsAnyHttps).toBe(false);
    await tick();
    await tick();
    expect(a.supportsAnyHttps).toBe(true);

    const bad = fakeWorker({ probeOk: false });
    const b = createAnonFetch({ platform: "web", network: "nym", bootstrapRpcUrl: BOOT, probeUrl: "https://bee.example/health", workerFactory: bad.factory });
    await tick();
    await tick();
    expect(b.supportsAnyHttps).toBe(false);
    expect(b.status().detail).toContain("JSON-RPC only");
  });

  it("passes the isolation key only on isolated fetches", async () => {
    const w = fakeWorker();
    const anon = createAnonFetch({ platform: "web", network: "nym", bootstrapRpcUrl: BOOT, workerFactory: w.factory });
    await anon.fetch("https://a/");
    await anon.isolated("0xabc")("https://b/", { method: "POST" });
    expect(w.calls[0]?.init).toBeUndefined();
    expect(w.calls[1]?.init).toMatchObject({ method: "POST", anonOptions: { isolationKey: "0xabc" } });
  });

  it("reports failure instead of falling back to plain fetch", async () => {
    const w = fakeWorker({ fail: true });
    const anon = createAnonFetch({ platform: "web", network: "nym", bootstrapRpcUrl: BOOT, workerFactory: w.factory });
    const states: string[] = [];
    anon.onStatus((s) => states.push(s.state));
    await tick();
    expect(states).toContain("failed");
  });

  it("refuses to start without configuration rather than guessing", async () => {
    const noBoot = createAnonFetch({ platform: "web", network: "nym" });
    expect(noBoot.status().state).toBe("failed");
    await expect(noBoot.fetch("https://x/")).rejects.toThrow(/bootstrap RPC/);
    const tor = createAnonFetch({ platform: "web", network: "tor", bootstrapRpcUrl: BOOT });
    expect(tor.status()).toMatchObject({ state: "failed", detail: expect.stringContaining("gateways") });
  });

  it("passes configured Tor gateways to the worker", async () => {
    const w = fakeWorker();
    createAnonFetch({ platform: "web", network: "tor", bootstrapRpcUrl: BOOT, torGateways: ["1.2.3.4:1:key"], workerFactory: w.factory });
    await tick();
    expect(w.init()?.config).toEqual({ gateways: ["1.2.3.4:1:key"] });
  });

  it("off mode uses plain fetch and says so", () => {
    const anon = createAnonFetch({ platform: "web", network: "off" });
    expect(anon.status()).toMatchObject({ network: "off", state: "off" });
    expect(anon.supportsAnyHttps).toBe(false);
  });
});
