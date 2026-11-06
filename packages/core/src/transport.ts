// JSON-RPC over Anon-RPC (HAVEN_PLAN.md section 12).
// A viem `custom` transport that POSTs every request through AnonFetch, under an isolation key when given (one per
// stealth address and per room, so the network can't link your shares), and reports the route of each call for the
// receipts panel. Person B's @haven/platform supplies the real AnonFetch; passthroughAnon() is for Node and tests.

import type { AnonFetch, AnonStatus, KeyValueStore, ReceiptStep } from "@haven/types";
import { custom, HttpRequestError, RpcRequestError, type CustomTransport } from "viem";

export type RouteStep = Extract<ReceiptStep, { kind: "route" }>;

export interface AnonTransportOptions {
  /** The JSON-RPC endpoint (Sepolia or Arkiv). */
  url: string;
  anon: AnonFetch;
  /** Calls under different keys must not be linkable: use the stealth address or the room key's address. */
  isolationKey?: string;
  /** Receives one route step per JSON-RPC call. */
  onRoute?: (step: RouteStep) => void;
}

/**
 * Whether the private network can carry a request to `url` at all. Anon-RPC's TLS tunnels reach https hosts by name
 * on port 443 only, so a local `http://localhost:8787` (a developer's own API) has to go direct, and is labelled so.
 */
export function anonCanReach(url: string): boolean {
  try {
    const u = new URL(url);
    const local = ["localhost", "127.0.0.1", "[::1]", "::1"].includes(u.hostname) || u.hostname.endsWith(".localhost") || u.hostname.endsWith(".internal");
    return u.protocol === "https:" && (u.port === "" || u.port === "443") && !local;
  } catch {
    return false;
  }
}

/** True when the call actually goes through the private network. */
export function isAnonymous(status: AnonStatus): boolean {
  return status.network !== "off" && status.state !== "off";
}

export function anonTransport(options: AnonTransportOptions): CustomTransport {
  let nextId = 0;
  return custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        const reachable = anonCanReach(options.url);
        const send = !reachable
          ? globalThis.fetch.bind(globalThis)
          : options.isolationKey
            ? options.anon.isolated(options.isolationKey)
            : options.anon.fetch;
        const status = options.anon.status();
        options.onRoute?.({
          kind: "route",
          label: method,
          route: reachable && isAnonymous(status) ? "anon" : "direct",
          network: status.network,
          ...(options.isolationKey ? { isolationKey: options.isolationKey } : {}),
        });

        const body = { jsonrpc: "2.0" as const, id: ++nextId, method, params };
        let response: Response;
        try {
          response = await send(options.url, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          });
        } catch (cause) {
          throw new HttpRequestError({ url: options.url, body, cause: cause as Error, details: String(cause) });
        }
        if (!response.ok) {
          throw new HttpRequestError({
            url: options.url,
            body,
            status: response.status,
            details: await response.text().catch(() => response.statusText),
          });
        }
        const payload = (await response.json()) as { result?: unknown; error?: { code: number; message: string } };
        if (payload.error) throw new RpcRequestError({ body, error: payload.error, url: options.url });
        return payload.result;
      },
    },
    { retryCount: 0 },
  );
}

/** AnonFetch that is plain fetch (network "off"). Routes show as "direct". For the Node e2e script and tests. */
export function passthroughAnon(fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis)): AnonFetch {
  const status: AnonStatus = { network: "off", state: "off" };
  return {
    fetch: fetchImpl,
    isolated: () => fetchImpl,
    supportsAnyHttps: true,
    status: () => status,
    onStatus: () => () => {},
    close: () => {},
  };
}

/** In-memory KeyValueStore for Node and tests. Stores copies, so callers can't mutate stored values. */
export function memoryStore(): KeyValueStore {
  const map = new Map<string, Uint8Array>();
  return {
    async get(key) {
      const value = map.get(key);
      return value ? value.slice() : null;
    },
    async set(key, value) {
      map.set(key, value.slice());
    },
    async delete(key) {
      map.delete(key);
    },
  };
}
