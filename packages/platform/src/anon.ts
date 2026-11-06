import type { AnonFetch, AnonStatus, PrivateNetwork } from "@haven/types";
import { networkInfo } from "./networks";

/** Minimal shape shared by the web and extension harness workers. */
export interface HarnessWorker {
  ready: Promise<void>;
  fetch: (input: string | URL | Request, init?: RequestInit & { anonOptions?: Record<string, unknown> }) => Promise<Response>;
  close(): void;
}

export interface HarnessInit {
  address: string;
  config?: Record<string, unknown>;
  iframeUrl?: string;
  preExisting: { rpcProvider: { request(args: { method: string; params?: unknown[] }): Promise<unknown> } };
}

export type WorkerFactory = (init: HarnessInit) => Promise<HarnessWorker>;

export interface CreateAnonFetchOptions {
  platform: "web" | "extension";
  network: PrivateNetwork;
  /**
   * Plain RPC for the chain the worker specifier lives on (NETWORKS[network].chainId), used once to
   * read the specifier. Required for every network except "off"; it comes from app configuration.
   */
  bootstrapRpcUrl?: string;
  /** Web only: our own bootstrap page, needed under a strict CSP (anon-rpc browser-harness README). */
  iframeUrl?: string;
  /**
   * An HTTPS URL that is not a JSON-RPC endpoint (e.g. `${beeUrl}/health`). Once the worker is ready
   * we fetch it through the worker; `supportsAnyHttps` becomes true only if that real request succeeds.
   */
  probeUrl?: string;
  /** Tor only: "host:port:key" gateway entries from configuration. */
  torGateways?: string[];
  /** Tests inject a fake worker here. */
  workerFactory?: WorkerFactory;
}

/** A JSON-RPC provider over plain fetch. Used only to read the specifier contract. */
export function jsonRpcProvider(url: string) {
  let id = 0;
  return {
    async request({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> {
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
      });
      const body = (await res.json()) as { result?: unknown; error?: { message?: string } };
      if (body.error) throw new Error(body.error.message ?? "RPC error");
      return body.result;
    },
  };
}

const defaultFactory = (platform: "web" | "extension"): WorkerFactory => async (init) => {
  if (platform === "web") {
    const { AnonRpcWorker } = await import("@anon-rpc/browser-harness");
    return new AnonRpcWorker(init as never) as unknown as HarnessWorker;
  }
  const { AnonRpcWorker } = await import("@anon-rpc/browser-extension-harness");
  return new AnonRpcWorker(init as never) as unknown as HarnessWorker;
};

/**
 * Returns the AnonFetch the frozen interface expects. Calls made before the worker is ready are
 * queued by the harness. If the worker fails, calls reject: they never fall back to plain fetch.
 */
/** How long the worker may take to load before calls through it fail instead of waiting. */
const START_TIMEOUT_MS = 45_000;

export function createAnonFetch(opts: CreateAnonFetchOptions): AnonFetch {
  const listeners = new Set<(s: AnonStatus) => void>();
  const onStatus = (l: (s: AnonStatus) => void) => {
    listeners.add(l);
    return () => void listeners.delete(l);
  };
  const info = networkInfo(opts.network);
  let status: AnonStatus = info
    ? { network: opts.network, state: "connecting" }
    : { network: "off", state: "off", detail: "Private network is off" };
  const setStatus = (next: AnonStatus) => {
    status = next;
    for (const l of listeners) l(next);
  };

  if (!info) {
    const plain = globalThis.fetch.bind(globalThis);
    return {
      fetch: plain,
      isolated: () => plain,
      // Nothing is routed, so nothing goes through a worker. Callers label every request "direct".
      supportsAnyHttps: false,
      status: () => status,
      onStatus,
      close: () => undefined,
    };
  }

  const fail = (detail: string): AnonFetch => {
    setStatus({ network: opts.network, state: "failed", detail });
    const refuse = (async () => {
      throw new Error(detail);
    }) as unknown as typeof fetch;
    return { fetch: refuse, isolated: () => refuse, supportsAnyHttps: false, status: () => status, onStatus, close: () => undefined };
  };
  if (!opts.bootstrapRpcUrl) return fail(`No bootstrap RPC configured for chain ${info.chainId}`);
  if (opts.network === "tor" && !opts.torGateways?.length) return fail("Tor needs gateways in configuration");

  const factory = opts.workerFactory ?? defaultFactory(opts.platform);
  const workerPromise = factory({
    address: info.specifier,
    config: opts.network === "tor" ? { gateways: opts.torGateways } : undefined,
    iframeUrl: opts.iframeUrl,
    preExisting: { rpcProvider: jsonRpcProvider(opts.bootstrapRpcUrl) },
  });

  let anyHttps = false;
  workerPromise
    .then(async (w) => {
      await w.ready;
      setStatus({ network: opts.network, state: "ready", detail: info.label });
      if (!opts.probeUrl) return;
      try {
        const res = await w.fetch(opts.probeUrl, { method: "GET" });
        anyHttps = res.ok;
      } catch {
        anyHttps = false;
      }
      setStatus({
        network: opts.network,
        state: "ready",
        detail: `${info.label}: ${anyHttps ? "routes all requests" : "routes JSON-RPC only"}`,
      });
    })
    .catch((e: unknown) => setStatus({ network: opts.network, state: "failed", detail: e instanceof Error ? e.message : String(e) }));

  // A worker that never loads (its iframe blocked, a network that never answers) must not leave every call waiting
  // for ever: after START_TIMEOUT_MS calls fail with a reason, and the status says so.
  let started = false;
  void workerPromise.then(() => (started = true), () => undefined);
  const startDeadline = new Promise<never>((_, reject) =>
    setTimeout(() => {
      if (started) return;
      const detail = "The private network didn't start. Reload the page, or pick another network in Settings.";
      setStatus({ network: opts.network, state: "failed", detail });
      reject(new Error(detail));
    }, START_TIMEOUT_MS),
  );
  startDeadline.catch(() => undefined);

  // The mixnet's exits are a small shared pool, and now and then none is free ("No exit offers TLS tunnels") or a relay
  // is too slow. A request is tried again a couple of times; if it still can't go privately, it goes direct, and the
  // status says so (so receipts mark it "direct") until a private request gets through again.
  let degraded = false;
  const plain = globalThis.fetch.bind(globalThis);
  // Only "no exit" failures: the request was never sent, so trying again (or direct) can't make anything happen twice.
  // A timeout may have reached the server, so it is not retried here (the client repeats only the calls that are safe).
  const transient = (e: unknown) => /no ?tunnel|no exit|NoTunnelExit/i.test(e instanceof Error ? `${e.name} ${e.message}` : String(e));
  const routed = (isolationKey?: string): typeof fetch =>
    (async (input: RequestInfo | URL, init?: RequestInit) => {
      const worker = await Promise.race([workerPromise, startDeadline]);
      const anonInit = isolationKey ? { ...init, anonOptions: { isolationKey } } : init;
      let last: unknown;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const res = await worker.fetch(input as string | URL | Request, anonInit);
          if (degraded) {
            degraded = false;
            setStatus({ network: opts.network, state: "ready", detail: info.label });
          }
          return res;
        } catch (e) {
          last = e;
          if (!transient(e)) throw e;
          await new Promise((ok) => setTimeout(ok, 1000 * (attempt + 1)));
        }
      }
      degraded = true;
      setStatus({
        network: opts.network,
        state: "failed",
        detail: `No private-network exit is free right now, so requests go direct until one is (${last instanceof Error ? last.message : String(last)})`,
      });
      return plain(input as string | URL | Request, init);
    }) as typeof fetch;

  return {
    fetch: routed(),
    isolated: (key: string) => routed(key),
    get supportsAnyHttps() {
      return anyHttps;
    },
    status: () => status,
    onStatus,
    close: () => {
      void workerPromise.then((w) => w.close()).catch(() => undefined);
      setStatus({ network: opts.network, state: "failed", detail: "closed" });
    },
  };
}
