// apps/api (PLAN_A.md step A5; CLOAKROOM_PLAN.md section 15). A small relayer:
//   POST /claim       deploy the user's resolver (cloak.key) and drive root, register <label>.cloakroom.eth
//   POST /room        proof-of-work, then deploy a room registry for K_room and register r-<random>.rooms.cloakroom.eth
//   POST /drip        Sepolia ETH + tGLM to K or K_room only, sent in batches
//   POST /arkiv-rpc   JSON-RPC pass-through to Arkiv that adds the access key server-side
//   POST /upload      signed by a key with WRITE now; streams padded ciphertext to Bee
//   GET  /config, /health
// It logs nothing about users: only in-memory rate-limit counters, reset daily.

import {
  accessOf,
  arkivEndpoint,
  arkivWriter,
  checkRoomPow,
  checkUserLabel,
  claimName,
  cloakroom,
  createRoom,
  driveOwner,
  ensv2,
  ethNameExpiry,
  isLabelAvailable,
  MAX_UPLOAD_BYTES,
  passthroughAnon,
  requireDeployed,
  ROLE_DRIVE_WRITE,
  sendGlm,
  storeOnBee,
  verifiableFactoryAbi,
  verifyClaimRequest,
  verifyUpload,
  wasAllowed,
  type ApiInfo,
  type ClaimResponse,
  type DripRequest,
  type RoomRequest,
  type RoomResponse,
  type SepoliaWriter,
} from "@cloakroom/core";
import { DriveError, type Address, type Hex } from "@cloakroom/types";
import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import { createPublicClient, createWalletClient, getAddress, http, isAddress, isAddressEqual, type Chain, type PublicClient, type Transport } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

export interface ApiEnv {
  SEPOLIA_RPC_URL: string;
  RELAYER_PRIVATE_KEY: Hex;
  ARKIV_RPC_URL: string;
  ARKIV_ACCESS_KEY: string;
  BEE_URL: string;
  POSTAGE_BATCH_ID: string;
  ROOM_POW_DIFFICULTY: number;
  DRIP_SEPOLIA_WEI: bigint;
  DRIP_ARKIV_WEI: bigint;
  DRIP_BATCH_SECONDS: number;
}

/** Reads every setting; a missing one stops the server instead of falling back to a guess. */
export function readEnv(source: Record<string, string | undefined>): ApiEnv {
  const need = (k: string) => {
    const v = source[k];
    if (!v) throw new Error(`${k} is not set (apps/api/.env; see apps/api/.env.example)`);
    return v;
  };
  const key = need("RELAYER_PRIVATE_KEY");
  if (!/^0x[0-9a-fA-F]{64}$/.test(key)) throw new Error("RELAYER_PRIVATE_KEY must be 0x + 64 hex");
  return {
    SEPOLIA_RPC_URL: need("SEPOLIA_RPC_URL"),
    RELAYER_PRIVATE_KEY: key as Hex,
    ARKIV_RPC_URL: need("ARKIV_RPC_URL"),
    ARKIV_ACCESS_KEY: need("ARKIV_ACCESS_KEY"),
    BEE_URL: need("BEE_URL"),
    POSTAGE_BATCH_ID: need("POSTAGE_BATCH_ID"),
    ROOM_POW_DIFFICULTY: Number(need("ROOM_POW_DIFFICULTY")),
    DRIP_SEPOLIA_WEI: BigInt(need("DRIP_SEPOLIA_WEI")),
    DRIP_ARKIV_WEI: BigInt(need("DRIP_ARKIV_WEI")),
    DRIP_BATCH_SECONDS: Number(need("DRIP_BATCH_SECONDS")),
  };
}

/** The JSON-RPC methods the client's Arkiv reads and writes use. Anything else is refused. */
export const ARKIV_METHODS = new Set([
  "arkiv_query",
  "arkiv_getEntity",
  "arkiv_getBlockTiming",
  "eth_chainId",
  "eth_blockNumber",
  "eth_getBlockByNumber",
  "eth_getBalance",
  "eth_getTransactionCount",
  "eth_estimateGas",
  "eth_gasPrice",
  "eth_maxPriorityFeePerGas",
  "eth_feeHistory",
  "eth_call",
  "eth_sendRawTransaction",
  "eth_getTransactionReceipt",
  "eth_getTransactionByHash",
]);

const DAY = 86_400;
const LIMITS = { claimsPerDay: 300, roomsPerDay: 300, uploadBytesPerKeyPerDay: 512 * 1024 * 1024, arkivCallsPerMinute: 600 };

/** In-memory counters that reset on their own: the only state the API keeps. */
class Counters {
  private readonly map = new Map<string, { n: number; resetAt: number }>();
  hit(key: string, amount: number, limit: number, windowSeconds: number): boolean {
    const t = Math.floor(Date.now() / 1000);
    const c = this.map.get(key);
    if (!c || c.resetAt <= t) {
      this.map.set(key, { n: amount, resetAt: t + windowSeconds });
      return amount <= limit;
    }
    if (c.n + amount > limit) return false;
    c.n += amount;
    return true;
  }
}

/** One relayer transaction at a time, so nonces never collide. */
class Queue {
  private tail: Promise<unknown> = Promise.resolve();
  run<T>(job: () => Promise<T>): Promise<T> {
    const next = this.tail.then(job, job);
    this.tail = next.catch(() => undefined);
    return next;
  }
}

function fail(c: Context, e: unknown) {
  const code = e instanceof DriveError ? e.code : "UNKNOWN";
  const status = { NOT_AUTHORIZED: 403, NAME_TAKEN: 409, RATE_LIMITED: 429, TOO_LARGE: 413, NOT_FOUND: 404, EXPIRED: 410 }[code as string] ?? 500;
  const message = e instanceof Error ? e.message : String(e);
  if (status === 500) console.error(`[api] ${c.req.path}: ${message}`);
  return c.json({ error: { code, message } }, status as 403);
}

export function createApi(env: ApiEnv) {
  const relayer = privateKeyToAccount(env.RELAYER_PRIVATE_KEY);
  const transport = http(env.SEPOLIA_RPC_URL);
  const sepoliaClient = createPublicClient({ chain: sepolia, transport }) as PublicClient<Transport, Chain>;
  const writer: SepoliaWriter = {
    public: sepoliaClient,
    wallet: createWalletClient({ chain: sepolia, transport, account: relayer }),
  };
  const arkivRelayer = arkivWriter(
    { rpcUrl: env.ARKIV_RPC_URL, accessKey: env.ARKIV_ACCESS_KEY, anon: passthroughAnon() },
    env.RELAYER_PRIVATE_KEY,
  );
  const arkivUrl = arkivEndpoint(env.ARKIV_RPC_URL, env.ARKIV_ACCESS_KEY);
  const counters = new Counters();
  const queue = new Queue();

  // ---------------- drips: queued, then sent together every DRIP_BATCH_SECONDS
  const pending = new Map<string, Address>();
  let nextBatch = Math.floor(Date.now() / 1000) + env.DRIP_BATCH_SECONDS;
  const sendBatch = async () => {
    nextBatch = Math.floor(Date.now() / 1000) + env.DRIP_BATCH_SECONDS;
    const batch = [...pending.values()];
    pending.clear();
    for (const to of batch) {
      await queue
        .run(async () => {
          const hash = await writer.wallet.sendTransaction({ account: relayer, chain: sepolia, to, value: env.DRIP_SEPOLIA_WEI });
          await sepoliaClient.waitForTransactionReceipt({ hash });
          await sendGlm(arkivRelayer, to, env.DRIP_ARKIV_WEI);
        })
        .catch((e: unknown) => console.error(`[api] drip failed: ${e instanceof Error ? e.message : String(e)}`));
    }
  };
  const timer = setInterval(() => void sendBatch(), env.DRIP_BATCH_SECONDS * 1000);
  timer.unref?.();

  /** True if `registry` is a Cloakroom DriveRegistry proxy (made by ENS's VerifiableFactory from our implementation). */
  const isOurRegistry = async (registry: Address) => {
    try {
      const impl = await sepoliaClient.readContract({
        address: ensv2.VerifiableFactory,
        abi: verifiableFactoryAbi,
        functionName: "verifyContract",
        args: [registry],
      });
      return isAddressEqual(impl, requireDeployed("driveRegistryImpl"));
    } catch {
      return false;
    }
  };

  const app = new Hono();
  // No cookies or credentials anywhere, so any origin may call (the website, the extension, the Swarm copy).
  app.use("*", cors({ origin: "*", allowHeaders: ["content-type", "x-cloak-folder", "x-cloak-signer", "x-cloak-time", "x-cloak-signature"] }));

  app.get("/health", (c) => c.json({ ok: true }));

  app.get("/config", (c) =>
    c.json<ApiInfo>({ relayer: relayer.address, roomPowDifficulty: env.ROOM_POW_DIFFICULTY, dripBatchSeconds: env.DRIP_BATCH_SECONDS }),
  );

  app.post("/claim", async (c) => {
    try {
      const r = await verifyClaimRequest(await c.req.json());
      const label = checkUserLabel(r.label);
      if (!counters.hit(`claim:${r.driveKey}`, 1, 1, DAY)) throw new DriveError("RATE_LIMITED", "one name per key per day");
      if (!counters.hit("claims", 1, LIMITS.claimsPerDay, DAY)) throw new DriveError("RATE_LIMITED", "daily cap reached");
      const appRegistry = requireDeployed("appRegistry");
      if (!(await isLabelAvailable(sepoliaClient, appRegistry, label))) throw new DriveError("NAME_TAKEN");
      const result = await queue.run(async () =>
        claimName(writer, {
          appRegistry,
          implementation: requireDeployed("driveRegistryImpl"),
          label,
          driveKey: getAddress(r.driveKey),
          mainWallet: r.mainWallet ? getAddress(r.mainWallet) : null,
          spendingPublicKey: r.spendingPublicKey,
          expiry: await ethNameExpiry(sepoliaClient, "cloakroom"),
        }),
      );
      return c.json<ClaimResponse>({
        ensName: result.ensName,
        resolver: result.resolver,
        driveRoot: result.driveRoot,
        driveRootBlock: result.driveRootBlock.toString(),
        api: relayer.address,
      });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/room", async (c) => {
    try {
      const r = (await c.req.json()) as RoomRequest;
      if (!isAddress(r?.roomKey ?? "") || !checkRoomPow(r, env.ROOM_POW_DIFFICULTY)) {
        throw new DriveError("NOT_AUTHORIZED", "missing or wrong proof of work");
      }
      if (!counters.hit(`room:${r.roomKey}`, 1, 1, DAY)) throw new DriveError("RATE_LIMITED", "one room per key");
      if (!counters.hit("rooms", 1, LIMITS.roomsPerDay, DAY)) throw new DriveError("RATE_LIMITED", "daily cap reached");
      const room = await queue.run(async () =>
        createRoom(writer, {
          roomsRegistry: requireDeployed("roomsRegistry"),
          implementation: requireDeployed("driveRegistryImpl"),
          roomKey: getAddress(r.roomKey),
          expiry: await ethNameExpiry(sepoliaClient, "cloakroom"),
        }),
      );
      return c.json<RoomResponse>({ ensName: room.ensName, registry: room.registry, blockNumber: room.blockNumber.toString() });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/drip", async (c) => {
    try {
      const r = (await c.req.json()) as DripRequest;
      if (!isAddress(r?.address ?? "") || !isAddress(r?.registry ?? "")) throw new DriveError("NOT_AUTHORIZED", "malformed drip request");
      const address = getAddress(r.address);
      const registry = getAddress(r.registry);
      // Only the owner key of a Cloakroom registry (K of a drive root, or K_room of a room). Never a stealth member.
      if (!(await isOurRegistry(registry))) throw new DriveError("NOT_AUTHORIZED", "not a Cloakroom registry");
      const [owner, access] = await Promise.all([driveOwner(sepoliaClient, registry), accessOf(sepoliaClient, registry, address)]);
      if (!isAddressEqual(owner, address) || access.via !== "owner") throw new DriveError("NOT_AUTHORIZED", "only a registry's owner key gets gas");
      if (!pending.has(address) && !counters.hit(`drip:${address}`, 1, 1, DAY)) throw new DriveError("RATE_LIMITED", "one drip per key per day");
      pending.set(address, address);
      return c.json({ sendsAt: nextBatch });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/arkiv-rpc", async (c) => {
    try {
      if (!counters.hit("arkiv", 1, LIMITS.arkivCallsPerMinute, 60)) throw new DriveError("RATE_LIMITED");
      const body = (await c.req.json()) as { method?: string } | { method?: string }[];
      const calls = Array.isArray(body) ? body : [body];
      if (calls.length === 0 || calls.length > 50 || calls.some((x) => !x?.method || !ARKIV_METHODS.has(x.method))) {
        throw new DriveError("NOT_AUTHORIZED", "method not allowed");
      }
      const upstream = await fetch(arkivUrl, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      return new Response(upstream.body, { status: upstream.status, headers: { "content-type": "application/json" } });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/upload", async (c) => {
    try {
      const declared = Number(c.req.header("content-length") ?? "0");
      if (declared > MAX_UPLOAD_BYTES) throw new DriveError("TOO_LARGE");
      const body = new Uint8Array(await c.req.arrayBuffer());
      const auth = await verifyUpload(c.req.raw.headers, body);
      const t = Number((await sepoliaClient.getBlock()).timestamp);
      if (!(await wasAllowed(sepoliaClient, auth.folder, auth.signer, ROLE_DRIVE_WRITE, t))) {
        throw new DriveError("NOT_AUTHORIZED", "the signer can't write to this folder now");
      }
      if (!counters.hit(`upload:${auth.signer}`, body.length, LIMITS.uploadBytesPerKeyPerDay, DAY)) {
        throw new DriveError("RATE_LIMITED", "daily upload quota reached");
      }
      return c.json({ reference: await storeOnBee(env.BEE_URL, env.POSTAGE_BATCH_ID, body) });
    } catch (e) {
      return fail(c, e);
    }
  });

  return { app, relayer: relayer.address, close: () => clearInterval(timer), sendBatch, deployment: cloakroom };
}
