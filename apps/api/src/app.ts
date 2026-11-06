// apps/api (PLAN_A.md step A5; HAVEN_PLAN.md section 15). A small relayer:
//   POST /claim       deploy the user's resolver (haven.key) and drive root, register <label>.haven.eth
//   POST /room        proof-of-work, then deploy a room registry for K_room and register r-<random>.rooms.haven.eth
//   POST /drip        Sepolia ETH + tGLM to K or K_room only, sent in batches
//   POST /arkiv-rpc   JSON-RPC pass-through to Arkiv that adds the access key server-side
//   POST /upload      signed by a key with WRITE now; streams padded ciphertext to Bee
//   GET  /bytes/:ref  read-only Swarm gateway (the Bee node itself stays private)
//   POST /keylog      add-on F1: relays a signed public key-log or device entry to Arkiv (the signature is checked)
//   POST /doorbell    add-on F4: stamps a signed GSOC chunk and hands it to Bee (main.ts proxies the subscriptions)
//   POST /zk/join     add-on Z1: relays a writer's signed Semaphore commitment for a folder
//   POST /zk/upload   add-on Z1: an upload authorised by a zero-knowledge proof instead of a signer
//   POST /zk/file     add-on Z1: relays an anonymous file entry once its proof checks out
//   GET  /zk/:file    add-on Z1: the circuit's proving files (pinned by hash in @haven/core)
//   GET  /config, /health
// It logs nothing about users: only in-memory rate-limit counters, reset daily.

import {
  accessOf,
  arkivEndpoint,
  BlockClock,
  checkJoins,
  currentWriterGroup,
  isCommitment,
  listZkJoins,
  normalizeRef,
  readZkUpload,
  registryHistory,
  unpackProof,
  verifyWrite,
  ZK_ARTIFACTS,
  ZK_HEADERS,
  zkFileMessage,
  zkFileOp,
  zkJoinOp,
  zkJoinTypedData,
  type SemaphoreProof,
  type ZkFileRequest,
  type ZkFileResponse,
  type ZkJoinRequest,
  type ZkJoinResponse,
  arkivReader,
  arkivWriter,
  checkDevices,
  checkKeyLog,
  checkRing,
  compressKey,
  deviceIdOf,
  deviceOp,
  deviceTypedData,
  keyLogOp,
  keyLogTypedData,
  listDeviceEntries,
  listKeyLog,
  nameController,
  NONE,
  writeEntities,
  type DoorbellRing,
  type KeyLogRelayRequest,
  type KeyLogRelayResponse,
  checkRoomPow,
  checkUserLabel,
  claimName,
  haven,
  createRoom,
  driveOwner,
  getSubregistry,
  driveRegistryAbi,
  getHavenKey,
  creationBlock,
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
} from "@haven/core";
import { DriveError, type Address, type Hex } from "@haven/types";
import { readFile } from "node:fs/promises";

import { Hono, type Context } from "hono";
import { cors } from "hono/cors";
import {
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToBytes,
  http,
  isAddress,
  isAddressEqual,
  isHex,
  recoverTypedDataAddress,
  type Chain,
  type PublicClient,
  type Transport,
} from "viem";
import { normalize } from "viem/ens";
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
  /** Add-on F4: leading bits a doorbell's chunk address must share with our Bee node's overlay; null turns doorbells off. */
  DOORBELL_PROXIMITY: number | null;
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
    // Empty while a new Bee node is still syncing: everything else works, and uploads say storage isn't ready yet.
    POSTAGE_BATCH_ID: source.POSTAGE_BATCH_ID ?? "",
    ROOM_POW_DIFFICULTY: Number(need("ROOM_POW_DIFFICULTY")),
    DRIP_SEPOLIA_WEI: BigInt(need("DRIP_SEPOLIA_WEI")),
    DRIP_ARKIV_WEI: BigInt(need("DRIP_ARKIV_WEI")),
    DRIP_BATCH_SECONDS: Number(need("DRIP_BATCH_SECONDS")),
    // Optional on purpose: empty means "no live updates", and clients fall back to re-reading Arkiv every 30 s.
    DOORBELL_PROXIMITY: source.DOORBELL_PROXIMITY ? Number(source.DOORBELL_PROXIMITY) : null,
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
const LIMITS = {
  claimsPerDay: 100,
  // Every drip costs the relayer DRIP_SEPOLIA_WEI and DRIP_ARKIV_WEI. Without a total, a script making fresh keys could
  // empty the relayer in a day and stop sign-ups for everyone; with it, the most a day can cost is known in advance.
  dripsPerDay: 60,
  // Drips are small (DRIP_SEPOLIA_WEI), so a busy key, one sharing with several managers, may ask a few times a day.
  dripsPerKeyPerDay: 5,
  roomsPerDay: 150,
  uploadBytesPerKeyPerDay: 512 * 1024 * 1024,
  // Every page reads Arkiv a few dozen times through this pass-through; shared by all users.
  arkivCallsPerMinute: 3000,
  keylogPerNamePerDay: 30,
  keylogPerDay: 3000,
  ringsPerAddressPerHour: 240,
  ringsPerDay: 50_000,
  zkJoinsPerFolderPerDay: 100,
  zkUploadBytesPerFolderPerDay: 512 * 1024 * 1024,
  zkFilesPerFolderPerDay: 2000,
};

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
  const status =
    { NOT_AUTHORIZED: 403, NAME_TAKEN: 409, RATE_LIMITED: 429, TOO_LARGE: 413, NOT_FOUND: 404, EXPIRED: 410, KEY_MISMATCH: 409, NETWORK: 503 }[code as string] ?? 500;
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
  const arkiv = arkivReader({ rpcUrl: env.ARKIV_RPC_URL, accessKey: env.ARKIV_ACCESS_KEY, anon: passthroughAnon() });
  const counters = new Counters();
  // One queue per chain: each chain has its own nonces, so an Arkiv write never waits behind a Sepolia receipt.
  const queue = new Queue();
  const arkivQueue = new Queue();
  const history = registryHistory(sepoliaClient);
  const arkivClock = new BlockClock(arkiv);

  // ---------------- drips: queued, then sent together every DRIP_BATCH_SECONDS
  const pending = new Map<string, Address>();
  let nextBatch = Math.floor(Date.now() / 1000) + env.DRIP_BATCH_SECONDS;
  const sendBatch = async () => {
    nextBatch = Math.floor(Date.now() / 1000) + env.DRIP_BATCH_SECONDS;
    const batch = [...pending.values()];
    pending.clear();
    for (const to of batch) {
      const failed = (e: unknown) => console.error(`[api] drip failed: ${e instanceof Error ? e.message : String(e)}`);
      // Both chains at once: the Arkiv gas no longer waits for the Sepolia receipt.
      void arkivQueue.run(() => sendGlm(arkivRelayer, to, env.DRIP_ARKIV_WEI)).catch(failed);
      await queue
        .run(async () => {
          const hash = await writer.wallet.sendTransaction({ account: relayer, chain: sepolia, to, value: env.DRIP_SEPOLIA_WEI });
          await sepoliaClient.waitForTransactionReceipt({ hash });
        })
        .catch(failed);
    }
  };
  const timer = setInterval(() => void sendBatch(), env.DRIP_BATCH_SECONDS * 1000);
  timer.unref?.();

  /** True if `registry` is a Haven DriveRegistry proxy (made by ENS's VerifiableFactory from our implementation). */
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
  app.use("*", cors({ origin: "*", exposeHeaders: ["content-length"], allowHeaders: ["content-type", "x-haven-folder", "x-haven-signer", "x-haven-time", "x-haven-signature", ZK_HEADERS.proof] }));

  app.get("/health", (c) => c.json({ ok: true }));

  // Our Bee node's overlay, read from Bee itself the first time a client asks (so doorbell keys are mined towards it).
  let overlay: Hex | null = null;
  const doorbell = async (): Promise<ApiInfo["doorbell"]> => {
    if (env.DOORBELL_PROXIMITY === null) return null;
    if (!overlay) {
      try {
        const res = await fetch(`${env.BEE_URL.replace(/\/+$/, "")}/addresses`, { signal: AbortSignal.timeout(5000) });
        const body = (await res.json()) as { overlay?: string };
        if (res.ok && body.overlay && /^[0-9a-f]{64}$/i.test(body.overlay)) overlay = `0x${body.overlay.toLowerCase()}`;
      } catch {
        // Bee unreachable: report doorbells as off rather than guess an overlay
      }
    }
    return overlay ? { overlay, proximity: env.DOORBELL_PROXIMITY } : null;
  };

  app.get("/config", async (c) =>
    c.json<ApiInfo>({
      relayer: relayer.address,
      roomPowDifficulty: env.ROOM_POW_DIFFICULTY,
      dripBatchSeconds: env.DRIP_BATCH_SECONDS,
      doorbell: await doorbell(),
    }),
  );

  // ---------------- add-on F1: public key log relay. The entry's EIP-712 signature is what makes it valid, so relaying
  // adds no trust in us: we only refuse what readers would ignore anyway, so the log stays clean.
  app.post("/keylog", async (c) => {
    try {
      const r = (await c.req.json()) as KeyLogRelayRequest;
      const name = r?.type === "entry" ? r.entry?.ensName : r?.type === "device" ? r.device?.ensName : undefined;
      if (typeof name !== "string" || name.length > 100 || normalize(name) !== name) throw new DriveError("NOT_AUTHORIZED", "malformed name");
      if (!isHex(r.sig) || hexToBytes(r.sig).length !== 65) throw new DriveError("NOT_AUTHORIZED", "malformed signature");
      if (!counters.hit(`keylog:${name}`, 1, LIMITS.keylogPerNamePerDay, DAY)) throw new DriveError("RATE_LIMITED", "too many entries for this name today");
      if (!counters.hit("keylog", 1, LIMITS.keylogPerDay, DAY)) throw new DriveError("RATE_LIMITED", "daily cap reached");
      const controller = await nameController(sepoliaClient, name);
      if (!controller) throw new DriveError("NOT_FOUND", `${name} isn't registered`);
      const [page, head] = await Promise.all([listKeyLog(arkiv, name), arkiv.getBlockNumber()]);
      const checked = await checkKeyLog(page.records, controller);
      if (checked.problem) throw new DriveError("KEY_MISMATCH", `the log for ${name} is broken: ${checked.problem}`);
      let op;
      if (r.type === "entry") {
        const e = r.entry;
        if (!["publish", "rotate", "revoke-device"].includes(e.kind) || !Number.isSafeInteger(e.seq)) throw new DriveError("NOT_AUTHORIZED", "malformed entry");
        if (compressKey(e.spendingPublicKey) !== e.spendingPublicKey) throw new DriveError("NOT_AUTHORIZED", "spendingPublicKey must be compressed");
        if (e.devicePublicKey !== NONE && compressKey(e.devicePublicKey) !== e.devicePublicKey) throw new DriveError("NOT_AUTHORIZED", "devicePublicKey must be compressed");
        const signer = await recoverTypedDataAddress({ ...keyLogTypedData(e), signature: r.sig });
        if (!isAddressEqual(signer, controller)) throw new DriveError("NOT_AUTHORIZED", "not signed by the name's controller");
        const last = checked.chain[checked.chain.length - 1];
        if (e.seq !== checked.chain.length || e.prevEntryKey.toLowerCase() !== (last ? last.key.toLowerCase() : NONE)) {
          throw new DriveError("KEY_MISMATCH", `the next entry for ${name} is seq ${checked.chain.length}`);
        }
        if (e.seq === 0 && e.kind !== "publish") throw new DriveError("NOT_AUTHORIZED", "seq 0 must be a publish");
        op = keyLogOp({ ...e, sig: r.sig });
      } else {
        const d = r.device;
        if (d.deviceId !== deviceIdOf(d.devicePublicKey) || compressKey(d.devicePublicKey) !== d.devicePublicKey) throw new DriveError("NOT_AUTHORIZED", "malformed device");
        if (!isHex(d.label) || hexToBytes(d.label).length > 256) throw new DriveError("NOT_AUTHORIZED", "label too long");
        const signer = await recoverTypedDataAddress({ ...deviceTypedData(d), signature: r.sig });
        if (!isAddressEqual(signer, controller)) throw new DriveError("NOT_AUTHORIZED", "not signed by the name's controller");
        const devices = await checkDevices((await listDeviceEntries(arkiv, name)).records, controller, checked.chain, head);
        if (devices.some((x) => x.record.deviceId === d.deviceId && x.why === "revoked")) throw new DriveError("NOT_AUTHORIZED", "that device was revoked");
        op = deviceOp({ ...d, label: hexToBytes(d.label), sig: r.sig });
      }
      const { txHash, keys } = await arkivQueue.run(() => writeEntities(arkivRelayer, [op], "Key log entry"));
      return c.json<KeyLogRelayResponse>({ entityKey: keys[0]!, txHash });
    } catch (e) {
      return fail(c, e);
    }
  });

  // ---------------- add-on F4: doorbells. The ring is a signed SOC of exactly 8 + 256 bytes; we can't tell which folder
  // it's for (that's the point), so it is rate-limited by chunk owner and stamped with our batch.
  app.post("/doorbell", async (c) => {
    try {
      if (env.DOORBELL_PROXIMITY === null) throw new DriveError("NOT_FOUND", "live updates are off on this server");
      storageReady();
      const ring = (await c.req.json()) as DoorbellRing;
      if (!(await checkRing(ring))) throw new DriveError("NOT_AUTHORIZED", "malformed or unsigned doorbell");
      if (!counters.hit(`ring:${ring.owner.toLowerCase()}`, 1, LIMITS.ringsPerAddressPerHour, 3600)) throw new DriveError("RATE_LIMITED");
      if (!counters.hit("rings", 1, LIMITS.ringsPerDay, DAY)) throw new DriveError("RATE_LIMITED", "daily cap reached");
      const url = `${env.BEE_URL.replace(/\/+$/, "")}/soc/${ring.owner.slice(2).toLowerCase()}/${ring.id.slice(2).toLowerCase()}?sig=${ring.sig.slice(2)}`;
      const res = await fetch(url, {
        method: "POST",
        headers: { "content-type": "application/octet-stream", "swarm-postage-batch-id": env.POSTAGE_BATCH_ID },
        body: new Uint8Array(hexToBytes(ring.data)),
      });
      if (!res.ok) throw new DriveError("NETWORK", `Bee refused the doorbell: HTTP ${res.status}`);
      return c.json({ ok: true });
    } catch (e) {
      return fail(c, e);
    }
  });

  // Claims and rooms wait for a Sepolia receipt (often 15-30 s). A private network may drop a reply that slow (Nox waits
  // 20 s), so the same signed request can arrive again: it gets the job already running or done, never a second one.
  const claimJobs = new Map<string, Promise<ClaimResponse>>();
  const roomJobs = new Map<string, Promise<RoomResponse>>();
  const remember = <T>(jobs: Map<string, Promise<T>>, key: string, job: Promise<T>) => {
    jobs.set(key, job);
    job.catch(() => jobs.delete(key));
    if (jobs.size > 1000) jobs.delete(jobs.keys().next().value!);
    return job;
  };

  /** A claim already on chain for `driveKey`: its drive root is owned by K and haven.key is this public key. */
  const existingClaim = async (appRegistry: Address, label: string, driveKey: Address, spendingPublicKey: Hex): Promise<ClaimResponse | null> => {
    const driveRoot = await getSubregistry(sepoliaClient, appRegistry, label);
    if (!driveRoot || !isAddressEqual(await driveOwner(sepoliaClient, driveRoot), driveKey)) return null;
    const ensName = `${label}.haven.eth`;
    const published = await getHavenKey(sepoliaClient, ensName);
    if (!published || published.toLowerCase() !== spendingPublicKey.toLowerCase()) return null;
    const resolver = getAddress(
      await sepoliaClient.readContract({ address: appRegistry, abi: driveRegistryAbi, functionName: "getResolver", args: [label] }),
    );
    return { ensName, resolver, driveRoot, driveRootBlock: (await creationBlock(sepoliaClient, driveRoot)).toString(), api: relayer.address };
  };

  app.post("/claim", async (c) => {
    try {
      const r = await verifyClaimRequest(await c.req.json());
      const label = checkUserLabel(r.label);
      const driveKey = getAddress(r.driveKey);
      const running = claimJobs.get(driveKey);
      if (running) return c.json<ClaimResponse>(await running);
      const appRegistry = requireDeployed("appRegistry");
      if (!(await isLabelAvailable(sepoliaClient, appRegistry, label))) {
        // Taken. If it was taken by this same key with this same public key (an earlier claim whose reply was lost),
        // hand back that claim, read from the chain, instead of refusing the user their own name.
        const mine = await existingClaim(appRegistry, label, driveKey, r.spendingPublicKey);
        if (mine) return c.json<ClaimResponse>(mine);
        throw new DriveError("NAME_TAKEN");
      }
      if (!counters.hit(`claim:${r.driveKey}`, 1, 1, DAY)) throw new DriveError("RATE_LIMITED", "one name per key per day");
      if (!counters.hit("claims", 1, LIMITS.claimsPerDay, DAY)) throw new DriveError("RATE_LIMITED", "daily cap reached");
      const job = remember(
        claimJobs,
        driveKey,
        (async (): Promise<ClaimResponse> => {
          const result = await queue.run(async () =>
            claimName(writer, {
              appRegistry,
              implementation: requireDeployed("driveRegistryImpl"),
              label,
              driveKey,
              mainWallet: r.mainWallet ? getAddress(r.mainWallet) : null,
              spendingPublicKey: r.spendingPublicKey,
              expiry: await ethNameExpiry(sepoliaClient, "haven"),
            }),
          );
          return {
            ensName: result.ensName,
            resolver: result.resolver,
            driveRoot: result.driveRoot,
            driveRootBlock: result.driveRootBlock.toString(),
            api: relayer.address,
          };
        })(),
      );
      return c.json<ClaimResponse>(await job);
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
      const roomKey = getAddress(r.roomKey);
      const running = roomJobs.get(roomKey);
      if (running) return c.json<RoomResponse>(await running);
      if (!counters.hit(`room:${r.roomKey}`, 1, 1, DAY)) throw new DriveError("RATE_LIMITED", "one room per key");
      if (!counters.hit("rooms", 1, LIMITS.roomsPerDay, DAY)) throw new DriveError("RATE_LIMITED", "daily cap reached");
      // The room's key needs Arkiv gas for its first records: send it now, alongside the Sepolia transaction, so it
      // has usually arrived by the time the room exists (the app then skips waiting for a drip).
      void arkivQueue.run(() => sendGlm(arkivRelayer, roomKey, env.DRIP_ARKIV_WEI)).catch((e: unknown) =>
        console.error(`[api] room gas failed: ${e instanceof Error ? e.message : String(e)}`),
      );
      const job = remember(
        roomJobs,
        roomKey,
        (async (): Promise<RoomResponse> => {
          const room = await queue.run(async () =>
            createRoom(writer, {
              roomsRegistry: requireDeployed("roomsRegistry"),
              implementation: requireDeployed("driveRegistryImpl"),
              roomKey,
              expiry: await ethNameExpiry(sepoliaClient, "haven"),
            }),
          );
          return { ensName: room.ensName, registry: room.registry, blockNumber: room.blockNumber.toString() };
        })(),
      );
      return c.json<RoomResponse>(await job);
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
      // Only the owner key of a Haven registry (K of a drive root, or K_room of a room). Never a stealth member.
      if (!(await isOurRegistry(registry))) throw new DriveError("NOT_AUTHORIZED", "not a Haven registry");
      const [owner, access] = await Promise.all([driveOwner(sepoliaClient, registry), accessOf(sepoliaClient, registry, address)]);
      if (!isAddressEqual(owner, address) || access.via !== "owner") throw new DriveError("NOT_AUTHORIZED", "only a registry's owner key gets gas");
      if (!pending.has(address)) {
        // The per-key check comes first, so a key asking again can't use up everyone's daily total.
        if (!counters.hit(`drip:${address}`, 1, LIMITS.dripsPerKeyPerDay, DAY)) throw new DriveError("RATE_LIMITED", "this key has had its free gas for today");
        if (!counters.hit("drips", 1, LIMITS.dripsPerDay, DAY)) throw new DriveError("RATE_LIMITED", "today's free test gas is used up; try again tomorrow");
      }
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

  // Read-only Swarm gateway: the Bee node itself stays private (anyone who could reach its API could spend our
  // postage batch). Only padded ciphertext lives there; nothing is logged.
  const bytes = async (c: Context, method: "GET" | "HEAD") => {
    const ref = c.req.param("ref") ?? "";
    if (!/^[0-9a-f]{64}([0-9a-f]{64})?$/i.test(ref)) return c.json({ error: { code: "NOT_FOUND", message: "not a Swarm reference" } }, 404);
    const upstream = await fetch(`${env.BEE_URL.replace(/\/+$/, "")}/bytes/${ref}`, { method });
    const headers = new Headers({ "content-type": "application/octet-stream", "cache-control": "public, max-age=31536000, immutable" });
    const length = upstream.headers.get("content-length");
    if (length) headers.set("content-length", length);
    return new Response(method === "HEAD" ? null : upstream.body, { status: upstream.status, headers });
  };
  app.get("/bytes/:ref", (c) => bytes(c, "GET"));
  app.on("HEAD", "/bytes/:ref", (c) => bytes(c, "HEAD"));

  const storageReady = () => {
    if (!env.POSTAGE_BATCH_ID) throw new DriveError("NETWORK", "File storage is still being set up. Try uploading again in a few minutes.");
  };

  app.post("/upload", async (c) => {
    try {
      storageReady();
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

  // ---------------- add-on Z1: anonymous writes. A proof counts only against the folder's writer group right now (the
  // same group every reader rebuilds), and each nullifier is accepted once, so a proof can't be replayed.
  const nullifiers = new Map<string, number>();
  const spend = (proof: SemaphoreProof) => {
    const t = Math.floor(Date.now() / 1000);
    if (nullifiers.size > 50_000) for (const [n, at] of nullifiers) if (at < t - DAY) nullifiers.delete(n);
    if (nullifiers.has(proof.nullifier)) throw new DriveError("NOT_AUTHORIZED", "that proof was already used");
    nullifiers.set(proof.nullifier, t);
  };
  const checkGroupProof = async (folder: Address, proof: SemaphoreProof) => {
    if (!(await isOurRegistry(folder))) throw new DriveError("NOT_FOUND", "not a Haven folder");
    const t = Number((await sepoliaClient.getBlock()).timestamp);
    const group = await currentWriterGroup(arkiv, history, arkivClock, folder, t);
    if (BigInt(proof.merkleTreeRoot) !== group.root) throw new DriveError("NOT_AUTHORIZED", "this folder's writer group changed; try again");
    if (!(await verifyWrite(proof, { root: group.root, message: BigInt(proof.message) }))) throw new DriveError("NOT_AUTHORIZED", "the proof doesn't verify");
  };

  app.post("/zk/join", async (c) => {
    try {
      const r = (await c.req.json()) as ZkJoinRequest;
      if (!isAddress(r?.folder) || !isAddress(r.member) || typeof r.commitment !== "string" || !isCommitment(r.commitment)) {
        throw new DriveError("NOT_AUTHORIZED", "malformed join");
      }
      if (!isHex(r.sig) || hexToBytes(r.sig).length !== 65) throw new DriveError("NOT_AUTHORIZED", "malformed signature");
      const folder = getAddress(r.folder);
      const member = getAddress(r.member);
      const signer = await recoverTypedDataAddress({ ...zkJoinTypedData({ folder, member, commitment: r.commitment }), signature: r.sig });
      if (!isAddressEqual(signer, member)) throw new DriveError("NOT_AUTHORIZED", "not signed by the member");
      if (!(await isOurRegistry(folder))) throw new DriveError("NOT_FOUND", "not a Haven folder");
      const t = Number((await sepoliaClient.getBlock()).timestamp);
      if (!(await wasAllowed(sepoliaClient, folder, member, ROLE_DRIVE_WRITE, t))) throw new DriveError("NOT_AUTHORIZED", "the member can't write to this folder now");
      const { writers } = await checkJoins((await listZkJoins(arkiv, folder)).records, folder, history, arkivClock);
      const joined = writers.find((w) => isAddressEqual(w.member, member));
      if (joined) return c.json<ZkJoinResponse>({ entityKey: joined.key, txHash: null });
      if (!counters.hit(`zkjoin:${folder}`, 1, LIMITS.zkJoinsPerFolderPerDay, DAY)) throw new DriveError("RATE_LIMITED", "too many joins for this folder today");
      const { txHash, keys } = await arkivQueue.run(() => writeEntities(arkivRelayer, [zkJoinOp({ folder, member, commitment: r.commitment, sig: r.sig })], "Writer group join"));
      return c.json<ZkJoinResponse>({ entityKey: keys[0]!, txHash });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/zk/upload", async (c) => {
    try {
      storageReady();
      const declared = Number(c.req.header("content-length") ?? "0");
      if (declared > MAX_UPLOAD_BYTES) throw new DriveError("TOO_LARGE");
      const body = new Uint8Array(await c.req.arrayBuffer());
      const { folder, proof } = readZkUpload(c.req.raw.headers, body);
      await checkGroupProof(folder, proof);
      spend(proof);
      if (!counters.hit(`zkupload:${folder}`, body.length, LIMITS.zkUploadBytesPerFolderPerDay, DAY)) {
        throw new DriveError("RATE_LIMITED", "daily upload quota reached for this folder");
      }
      return c.json({ reference: await storeOnBee(env.BEE_URL, env.POSTAGE_BATCH_ID, body) });
    } catch (e) {
      return fail(c, e);
    }
  });

  app.post("/zk/file", async (c) => {
    try {
      const r = (await c.req.json()) as ZkFileRequest;
      if (!isAddress(r?.folder) || typeof r.fileId !== "string" || !/^[0-9a-f]{32}$/.test(r.fileId)) throw new DriveError("NOT_AUTHORIZED", "malformed entry");
      if (!Number.isSafeInteger(r.version) || r.version < 1 || !Number.isSafeInteger(r.epoch) || r.epoch < 0) throw new DriveError("NOT_AUTHORIZED", "malformed entry");
      if (!isHex(r.meta) || hexToBytes(r.meta).length > 1024 || !isHex(r.proof) || typeof r.swarmRef !== "string") throw new DriveError("NOT_AUTHORIZED", "malformed entry");
      let fields;
      let proof: SemaphoreProof;
      try {
        fields = { folder: getAddress(r.folder), fileId: r.fileId, version: r.version, epoch: r.epoch, swarmRef: normalizeRef(r.swarmRef), meta: hexToBytes(r.meta) };
        proof = unpackProof(hexToBytes(r.proof), zkFileMessage(fields));
      } catch {
        throw new DriveError("NOT_AUTHORIZED", "malformed entry or proof");
      }
      await checkGroupProof(fields.folder, proof);
      spend(proof);
      if (!counters.hit(`zkfile:${fields.folder}`, 1, LIMITS.zkFilesPerFolderPerDay, DAY)) throw new DriveError("RATE_LIMITED", "too many entries for this folder today");
      const { txHash, keys } = await arkivQueue.run(() => writeEntities(arkivRelayer, [zkFileOp({ ...fields, proof: hexToBytes(r.proof) })], "Anonymous file entry"));
      return c.json<ZkFileResponse>({ entityKey: keys[0]!, txHash });
    } catch (e) {
      return fail(c, e);
    }
  });

  const zkFiles = new Map<string, Promise<Uint8Array>>();
  app.get("/zk/:file", async (c) => {
    const artifact = Object.values(ZK_ARTIFACTS).find((a) => a.path === `/zk/${c.req.param("file")}`);
    if (!artifact) return c.json({ error: { code: "NOT_FOUND", message: "no such file" } }, 404);
    const name = artifact.path.slice("/zk/".length);
    let bytes = zkFiles.get(name);
    if (!bytes) {
      bytes = readFile(new URL(`../zk/${name}`, import.meta.url)).then((b) => new Uint8Array(b));
      bytes.catch(() => zkFiles.delete(name));
      zkFiles.set(name, bytes);
    }
    return c.body((await bytes) as Uint8Array<ArrayBuffer>, 200, {
      "content-type": name.endsWith(".wasm") ? "application/wasm" : "application/octet-stream",
      "cache-control": "public, max-age=31536000, immutable",
    });
  });

  return { app, relayer: relayer.address, close: () => clearInterval(timer), sendBatch, deployment: haven, doorbellsOn: env.DOORBELL_PROXIMITY !== null };
}
