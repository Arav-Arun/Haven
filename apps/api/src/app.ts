// The Cloakroom API (CLOAKROOM_PLAN.md section 15). It holds one key, the relayer, which has ROLE_REGISTRAR on
// cloakroom.eth's and rooms.cloakroom.eth's registries and nothing else. Every endpoint can be done without it: users
// with their own .eth name and gas don't need /claim, /room or /drip, and any Bee node takes uploads.
//   POST /claim   deploy the user's resolver (cloak.key) and drive root, register <label>.cloakroom.eth
//   POST /room    register r-<random>.rooms.cloakroom.eth for a fresh K_room (proof of work + daily cap)
//   POST /drip    gas for K or K_room only, batched every 10 minutes
//   POST /upload  padded ciphertext → Bee, signed by a key holding WRITE on the folder now
//   GET  /health
// No request is logged. The only state is the daily counters in limits.ts.

import {
  claimName,
  counterKey,
  createRoom,
  driveOwner,
  getSubregistry,
  isLabelAvailable,
  MAX_UPLOAD_BYTES,
  PAD_BUCKETS,
  ROLE_DRIVE_WRITE,
  storeOnBee,
  checkUserLabel,
  verifyClaimRequest,
  verifyDripRequest,
  verifyRoomRequest,
  verifyUpload,
  wasAllowed,
  type SepoliaWriter,
} from "@cloakroom/core";
import { DriveError, type Address, type DriveErrorCode, type ReceiptStep } from "@cloakroom/types";
import { Hono, type Context } from "hono";
import { bodyLimit } from "hono/body-limit";
import { cors } from "hono/cors";
import { isAddressEqual } from "viem";

import type { DripQueue } from "./drips";
import { DailyCounters } from "./limits";

export interface ApiConfig {
  relayer: SepoliaWriter;
  implementation: Address;
  appRegistry: Address;
  roomsRegistry: Address;
  /** Expiry for new names: cloakroom.eth's own expiry. */
  nameExpiry: () => Promise<bigint>;
  drips: DripQueue;
  bee: { url: string; batchId: string; fetch?: typeof fetch } | null;
  powDifficulty: number;
  caps: { claimsPerDay: number; roomsPerDay: number; uploadBytesPerKey: number; uploadBytesPerDay: number };
  now?: () => number;
}

const STATUS: Record<DriveErrorCode, number> = {
  NOT_SIGNED_IN: 401,
  WALLET_NOT_SUPPORTED: 400,
  KEY_MISMATCH: 400,
  NAME_TAKEN: 409,
  NO_CLOAK_KEY: 400,
  NOT_AUTHORIZED: 403,
  EXPIRED: 400,
  REFRESH_PENDING: 409,
  TOO_LARGE: 413,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  NETWORK: 502,
  UNKNOWN: 400,
};

function fail(c: Context, error: unknown) {
  const e = error instanceof DriveError ? error : new DriveError("UNKNOWN", "request failed");
  return c.json({ error: e.code, message: e.message }, STATUS[e.code] as 400);
}

const limited = (what: string) => new DriveError("RATE_LIMITED", `${what} limit reached for today`);

async function jsonBody(c: Context): Promise<Record<string, unknown>> {
  try {
    const body = await c.req.json();
    if (body && typeof body === "object" && !Array.isArray(body)) return body as Record<string, unknown>;
  } catch {
    // fall through
  }
  throw new DriveError("UNKNOWN", "expected a JSON object");
}

/** Transactions the relayer sent for a request, so the client can check each one. */
function collect() {
  const steps: ReceiptStep[] = [];
  return { steps, step: (s: ReceiptStep) => void steps.push(s) };
}

export function createApp(config: ApiConfig): Hono {
  const now = config.now ?? (() => Math.floor(Date.now() / 1000));
  const counters = new DailyCounters(now);
  const reader = config.relayer.public;
  const relayer = config.relayer.wallet.account.address;
  const app = new Hono();

  app.use("*", cors({ origin: "*", allowMethods: ["GET", "POST"], allowHeaders: ["content-type", "x-cloak-folder", "x-cloak-signer", "x-cloak-time", "x-cloak-signature"] }));

  app.get("/health", (c) =>
    c.json({
      ok: true,
      relayer,
      appRegistry: config.appRegistry,
      roomsRegistry: config.roomsRegistry,
      uploads: config.bee !== null,
      powDifficulty: config.powDifficulty,
      dripsQueued: config.drips.size,
    }),
  );

  app.post("/claim", bodyLimit({ maxSize: 4096 }), async (c) => {
    try {
      const request = await verifyClaimRequest(await jsonBody(c), now());
      const label = checkUserLabel(request.label);
      if (!(await isLabelAvailable(reader, config.appRegistry, label))) {
        throw new DriveError("NAME_TAKEN", `${label}.cloakroom.eth is taken`);
      }
      const perKey = counterKey("claim", request.driveKey);
      if (!counters.take(perKey, 1, 1)) throw limited("one name per drive key");
      if (!counters.take("claims", 1, config.caps.claimsPerDay)) {
        counters.give(perKey, 1);
        throw limited("names");
      }
      const { steps, step } = collect();
      try {
        const result = await claimName(
          config.relayer,
          {
            appRegistry: config.appRegistry,
            implementation: config.implementation,
            label,
            driveKey: request.driveKey,
            mainWallet: request.mainWallet,
            spendingPublicKey: request.spendingPublicKey,
            expiry: await config.nameExpiry(),
          },
          step,
        );
        return c.json({ ...result, driveRootBlock: result.driveRootBlock.toString(), relayer, steps });
      } catch (error) {
        counters.give(perKey, 1);
        counters.give("claims", 1);
        throw error;
      }
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/room", bodyLimit({ maxSize: 2048 }), async (c) => {
    try {
      const request = await verifyRoomRequest(await jsonBody(c), config.powDifficulty, now());
      const perKey = counterKey("room", request.roomKey);
      if (!counters.take(perKey, 1, 1)) throw limited("one room per room key");
      if (!counters.take("rooms", 1, config.caps.roomsPerDay)) {
        counters.give(perKey, 1);
        throw limited("rooms");
      }
      const { steps, step } = collect();
      try {
        const room = await createRoom(
          config.relayer,
          {
            roomsRegistry: config.roomsRegistry,
            implementation: config.implementation,
            roomKey: request.roomKey,
            expiry: await config.nameExpiry(),
          },
          step,
        );
        return c.json({ ...room, blockNumber: room.blockNumber.toString(), steps });
      } catch (error) {
        counters.give(perKey, 1);
        counters.give("rooms", 1);
        throw error;
      }
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post("/drip", bodyLimit({ maxSize: 2048 }), async (c) => {
    try {
      const request = await verifyDripRequest(await jsonBody(c), now());
      const parent = request.kind === "room" ? config.roomsRegistry : config.appRegistry;
      if (request.kind === "room" && !/^r-[a-z2-7]{6,}$/.test(request.label)) throw new DriveError("NOT_AUTHORIZED", "not a room label");
      const registered = await getSubregistry(reader, parent, request.label);
      if (!registered || !isAddressEqual(registered, request.registry)) {
        throw new DriveError("NOT_AUTHORIZED", "that registry isn't a Cloakroom drive or room");
      }
      let owner: Address;
      try {
        owner = await driveOwner(reader, request.registry);
      } catch {
        throw new DriveError("NOT_AUTHORIZED", "not a Cloakroom registry");
      }
      if (!isAddressEqual(owner, request.key)) throw new DriveError("NOT_AUTHORIZED", "only the drive or room key gets gas");
      if (!counters.take(counterKey("drip", request.key), 1, 1)) throw limited("one drip per key");
      return c.json({ queued: true, ...config.drips.enqueue(request.key) });
    } catch (error) {
      return fail(c, error);
    }
  });

  app.post(
    "/upload",
    bodyLimit({ maxSize: MAX_UPLOAD_BYTES, onError: (c) => fail(c, new DriveError("TOO_LARGE", "upload too large")) }),
    async (c) => {
      try {
        if (!config.bee) throw new DriveError("NETWORK", "uploads are not configured");
        const body = new Uint8Array(await c.req.arrayBuffer());
        if (!(PAD_BUCKETS as readonly number[]).includes(body.length)) {
          throw new DriveError("TOO_LARGE", "only padded ciphertext of a bucket size is accepted");
        }
        const auth = await verifyUpload(c.req.raw.headers, body, now());
        const t = Number((await reader.getBlock()).timestamp);
        let allowed = false;
        try {
          allowed = await wasAllowed(reader, auth.folder, auth.signer, ROLE_DRIVE_WRITE, t);
        } catch {
          allowed = false; // not a DriveRegistry
        }
        if (!allowed) throw new DriveError("NOT_AUTHORIZED", "the signer can't write to that folder now");
        const perKey = counterKey("upload", auth.signer);
        if (!counters.take(perKey, body.length, config.caps.uploadBytesPerKey)) throw limited("upload quota");
        if (!counters.take("upload-bytes", body.length, config.caps.uploadBytesPerDay)) {
          counters.give(perKey, body.length);
          throw limited("storage budget");
        }
        try {
          const reference = await storeOnBee(config.bee.url, config.bee.batchId, body, config.bee.fetch);
          return c.json({ reference }, 201);
        } catch (error) {
          counters.give(perKey, body.length);
          counters.give("upload-bytes", body.length);
          throw error instanceof DriveError ? error : new DriveError("NETWORK", "Bee upload failed");
        }
      } catch (error) {
        return fail(c, error);
      }
    },
  );

  app.notFound((c) => c.json({ error: "NOT_FOUND" }, 404));
  app.onError((_error, c) => c.json({ error: "UNKNOWN" }, 500));
  return app;
}
