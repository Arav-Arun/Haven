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

type RpcBody = { jsonrpc: "2.0"; id: number; method: string; params?: unknown };
type RpcReply = { id?: number; result?: unknown; error?: { code: number; message: string } };

/** One JSON-RPC call: a POST of its own. */
async function sendOne(send: typeof fetch, url: string, body: RpcBody): Promise<unknown> {
  let response: Response;
  try {
    response = await send(url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  } catch (cause) {
    throw new HttpRequestError({ url, body, cause: cause as Error, details: String(cause) });
  }
  if (!response.ok) {
    throw new HttpRequestError({ url, body, status: response.status, details: await response.text().catch(() => response.statusText) });
  }
  const payload = (await response.json()) as RpcReply;
  if (payload.error) throw new RpcRequestError({ body, error: payload.error, url });
  return payload.result;
}

/** Calls that change something go alone: a batch that fails is retried call by call, which only reads may be. */
const SENDS = new Set(["eth_sendRawTransaction", "eth_sendTransaction"]);
/** At most this many calls per batch (the Haven API's Arkiv pass-through takes up to 50). */
const MAX_BATCH = 20;
/**
 * How long a call waits for others to join its batch. viem's multicall batching hands over its eth_call a timer tick
 * after the reads around it, so 0 would split them; a few ms is nothing next to a round trip through a mixnet.
 */
const BATCH_WAIT_MS = 8;
/** Endpoints that answered a batch with something other than a list: they get one call per request from then on. */
const unbatched = new Set<string>();

/**
 * Calls made at the same moment for one endpoint, through one route and isolation key, leave as one JSON-RPC batch:
 * one round trip through the private network instead of one per call. A page's reads mostly start together (a folder's
 * seven Arkiv queries, a list's block times and role checks), so this is most of the waiting on a mixnet. Calls under
 * different isolation keys never share a batch, so batching links nothing the network couldn't already link.
 */
class Batcher {
  private waiting: { body: RpcBody; resolve: (v: unknown) => void; reject: (e: unknown) => void }[] = [];
  private scheduled = false;

  constructor(
    private readonly send: typeof fetch,
    private readonly url: string,
  ) {}

  call(body: RpcBody): Promise<unknown> {
    return new Promise((resolve, reject) => {
      this.waiting.push({ body, resolve, reject });
      if (this.scheduled) return;
      this.scheduled = true;
      setTimeout(() => this.flush(), BATCH_WAIT_MS);
    });
  }

  private flush() {
    this.scheduled = false;
    const all = this.waiting;
    this.waiting = [];
    for (let i = 0; i < all.length; i += MAX_BATCH) void this.sendBatch(all.slice(i, i + MAX_BATCH));
  }

  private async sendBatch(calls: Batcher["waiting"]) {
    const alone = (c: Batcher["waiting"][number]) => sendOne(this.send, this.url, c.body).then(c.resolve, c.reject);
    if (calls.length === 1 || unbatched.has(this.url)) {
      await Promise.all(calls.map(alone));
      return;
    }
    // Ids are given here: calls from different clients share a batch, and their own ids may repeat.
    const bodies = calls.map((c, i) => ({ ...c.body, id: i + 1 }));
    let replies: RpcReply[];
    try {
      const response = await this.send(this.url, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(bodies) });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const payload = (await response.json()) as unknown;
      if (!Array.isArray(payload)) {
        unbatched.add(this.url);
        throw new Error("this endpoint doesn't take batches");
      }
      replies = payload as RpcReply[];
    } catch {
      // Reads only, so each can simply be asked again on its own.
      await Promise.all(calls.map(alone));
      return;
    }
    const byId = new Map(replies.map((r) => [r.id, r]));
    await Promise.all(
      calls.map(async (c, i) => {
        const reply = byId.get(i + 1);
        if (!reply) return alone(c); // left out of the answer: asked again on its own
        if (reply.error) c.reject(new RpcRequestError({ body: c.body, error: reply.error, url: this.url }));
        else c.resolve(reply.result);
      }),
    );
  }
}

const batchers = new WeakMap<AnonFetch, Map<string, Batcher>>();

function batcherFor(anon: AnonFetch, route: string, url: string, send: typeof fetch): Batcher {
  let byRoute = batchers.get(anon);
  if (!byRoute) batchers.set(anon, (byRoute = new Map()));
  const id = `${route}\n${url}`;
  let b = byRoute.get(id);
  if (!b) byRoute.set(id, (b = new Batcher(send, url)));
  return b;
}

/** A provider saying it's overloaded or rationing us: worth trying the next endpoint. */
const RATIONED = /rate limit|limit exceeded|usage limit|too many requests|over quota|capacity/i;

/** Whether a failed call should move on to the next endpoint (rationed, failing or unreachable), not be returned. */
function tryNext(error: unknown): boolean {
  if (error instanceof HttpRequestError) return error.status === undefined || error.status === 429 || error.status >= 500 || RATIONED.test(error.details ?? "");
  const message = error instanceof Error ? error.message : String(error);
  return RATIONED.test(message);
}

/**
 * `url` may list several endpoints, comma-separated, best first. A call moves to the next one only when an endpoint
 * is rate-limiting, failing (5xx) or unreachable; a real answer, an error included, is returned as it is. The last
 * endpoint that worked is tried first next time.
 */
export function anonTransport(options: AnonTransportOptions): CustomTransport {
  let nextId = 0;
  const urls = options.url
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  let preferred = 0;
  return custom(
    {
      async request({ method, params }: { method: string; params?: unknown }) {
        let last: unknown = new Error("no RPC endpoint configured");
        for (let k = 0; k < urls.length; k++) {
          const i = (preferred + k) % urls.length;
          const url = urls[i]!;
          const reachable = anonCanReach(url);
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

          const body: RpcBody = { jsonrpc: "2.0", id: ++nextId, method, params };
          try {
            const result = SENDS.has(method)
              ? await sendOne(send, url, body)
              : await batcherFor(options.anon, !reachable ? "direct" : `anon:${options.isolationKey ?? ""}`, url, send).call(body);
            preferred = i;
            return result;
          } catch (error) {
            last = error;
            if (k === urls.length - 1 || !tryNext(error)) throw error;
          }
        }
        throw last;
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
