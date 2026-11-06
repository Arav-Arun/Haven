// The API end to end on a real local chain: the compiled DriveRegistry and UserRegistry, the VerifiableFactory placed
// at its Sepolia address, and the live PermissionedResolver bytecode copied from Sepolia to its address (so /claim runs
// the same code it will run in production). A local HTTP server stands in for Bee. Every request is made over HTTP
// through the Hono app; nothing in the API is replaced.

import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import {
  ALL_ROLES,
  driveOwner,
  encryptPadded,
  ensv2,
  getSubregistry,
  grantRoleUntil,
  deployDrive,
  permissionedResolverAbi,
  randomBytes,
  REGISTRY_ROLES,
  rootRolesOf,
  signClaim,
  signDrip,
  signRoom,
  signUpload,
  solvePow,
  uploadHeaders,
  dnsEncode,
  deriveKeys,
  randomMaterial,
  driveRegistryAbi,
} from "@cloakroom/core";
import type { Address, Hex } from "@cloakroom/types";
import { createPublicClient, decodeAbiParameters, encodeFunctionData, http, namehash, parseEther, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { startLocalChain, type LocalChain } from "../../../packages/core/test/localchain";
import { createApp, type ApiConfig } from "../src/app";
import { DripQueue } from "../src/drips";

let chain: LocalChain;
let bee: Server;
let beeUrl: string;
const stored = new Map<string, Uint8Array>();
const BATCH = "a".repeat(64);
let liveResolver = false;
let relayer: Awaited<ReturnType<LocalChain["newWriter"]>>;
let deployer: Awaited<ReturnType<LocalChain["newWriter"]>>;
let appRegistry: Address;
let roomsRegistry: Address;
const EXPIRY = 2_000_000_000n;

async function setCode(address: Address, code: Hex) {
  await chain.public.request({ method: "anvil_setCode" as never, params: [address, code] as never });
}

async function userRegistry(owner: Address): Promise<Address> {
  const impl = await chain.deploy("UserRegistry.sol", "UserRegistry", [chain.labelStore, chain.namer]);
  const init = encodeFunctionData({
    abi: [{ type: "function", name: "initialize", inputs: [{ type: "address" }, { type: "uint256" }], outputs: [], stateMutability: "nonpayable" }],
    functionName: "initialize",
    args: [owner, ALL_ROLES],
  });
  const data = encodeFunctionData({
    abi: [{ type: "function", name: "deployProxy", inputs: [{ type: "address" }, { type: "uint256" }, { type: "bytes" }], outputs: [{ type: "address" }], stateMutability: "nonpayable" }],
    functionName: "deployProxy",
    args: [impl, BigInt(toHex(randomBytes(32))), init],
  });
  const hash = await deployer.writer.wallet.sendTransaction({ to: ensv2.VerifiableFactory, data });
  const receipt = await chain.public.waitForTransactionReceipt({ hash });
  const log = receipt.logs.find((l) => l.address.toLowerCase() === ensv2.VerifiableFactory.toLowerCase());
  return `0x${log!.topics[2]!.slice(26)}` as Address;
}

beforeAll(async () => {
  chain = await startLocalChain();
  // The factory at its Sepolia address (it has no state), so the API's default paths run unchanged.
  await setCode(ensv2.VerifiableFactory, (await chain.public.getCode({ address: chain.factory }))!);
  try {
    const sepoliaClient = createPublicClient({ chain: sepolia, transport: http("https://ethereum-sepolia-rpc.publicnode.com", { timeout: 10_000 }) });
    const code = await sepoliaClient.getCode({ address: ensv2.PermissionedResolverImpl });
    if (code && code.length > 2) {
      await setCode(ensv2.PermissionedResolverImpl, code);
      liveResolver = true;
    }
  } catch {
    liveResolver = false;
  }
  deployer = await chain.newWriter();
  relayer = await chain.newWriter();
  appRegistry = await userRegistry(deployer.address);
  roomsRegistry = await userRegistry(deployer.address);
  for (const registry of [appRegistry, roomsRegistry]) {
    const data = encodeFunctionData({ abi: driveRegistryAbi, functionName: "grantRootRoles", args: [REGISTRY_ROLES.REGISTRAR, relayer.address] });
    await chain.public.waitForTransactionReceipt({ hash: await deployer.writer.wallet.sendTransaction({ to: registry, data }) });
  }

  bee = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      if (req.method === "POST" && req.url === "/bytes" && req.headers["swarm-postage-batch-id"] === BATCH) {
        const reference = toHex(randomBytes(32)).slice(2);
        stored.set(reference, new Uint8Array(Buffer.concat(chunks)));
        res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ reference }));
      } else res.writeHead(400).end();
    });
  });
  await new Promise<void>((ok) => bee.listen(0, "127.0.0.1", ok));
  beeUrl = `http://127.0.0.1:${(bee.address() as AddressInfo).port}`;
}, 60_000);

afterAll(() => {
  chain?.stop();
  bee?.close();
});

function makeApp(overrides: Partial<ApiConfig> = {}, drip: Partial<ConstructorParameters<typeof DripQueue>[2]> = {}) {
  const now = () => Math.floor(Date.now() / 1000);
  const drips = new DripQueue(
    relayer.writer,
    null,
    { sepoliaWei: parseEther("0.01"), arkivWei: 0n, intervalSeconds: 600, floorWei: parseEther("1"), dailyBudgetWei: parseEther("1"), ...drip },
    now,
  );
  const app = createApp({
    relayer: relayer.writer,
    implementation: chain.implementation,
    appRegistry,
    roomsRegistry,
    nameExpiry: async () => EXPIRY,
    drips,
    bee: { url: beeUrl, batchId: BATCH },
    powDifficulty: 8,
    caps: { claimsPerDay: 10, roomsPerDay: 10, uploadBytesPerKey: 10 * 1024 * 1024, uploadBytesPerDay: 64 * 1024 * 1024 },
    now,
    ...overrides,
  });
  const post = (path: string, body: unknown) =>
    app.request(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  return { app, drips, post };
}

async function roomRequest(key = privateKeyToAccount(generatePrivateKey()), difficulty = 8) {
  const time = Math.floor(Date.now() / 1000);
  return { key, body: await signRoom(key, await solvePow(key.address, time, difficulty), time) };
}

describe("GET /health", () => {
  it("answers with the relayer and what is configured", async () => {
    const res = await makeApp().app.request("/health");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, relayer: relayer.address, uploads: true, powDifficulty: 8 });
  });
});

describe("POST /room and /drip", () => {
  it("creates a room for a fresh key, then drips gas to that key only, in the batch", async () => {
    const { post, drips } = makeApp();
    const { key, body } = await roomRequest();
    const res = await post("/room", body);
    expect(res.status).toBe(200);
    const room = (await res.json()) as { ensName: string; registry: Address; steps: { kind: string; ok: boolean }[] };
    expect(room.ensName).toMatch(/^r-[a-z2-7]{10}\.rooms\.cloakroom\.eth$/);
    expect(room.steps.every((s) => s.kind === "sepolia-tx" && s.ok)).toBe(true);
    expect(await driveOwner(chain.public, room.registry)).toBe(key.address);
    const label = room.ensName.split(".")[0]!;
    expect(await getSubregistry(chain.public, roomsRegistry, label)).toBe(room.registry);
    expect(await rootRolesOf(chain.public, room.registry, relayer.address)).toBe(0n);

    // the same key can't make a second room
    expect((await post("/room", (await roomRequest(key)).body)).status).toBe(429);

    const drip = await signDrip(key, { registry: room.registry, label, kind: "room" });
    const queued = await post("/drip", drip);
    expect(queued.status).toBe(200);
    expect(await queued.json()).toMatchObject({ queued: true });
    expect(drips.size).toBe(1);
    const before = await chain.public.getBalance({ address: key.address });
    expect(await drips.flush()).toEqual({ sepolia: 1, arkiv: 0, skipped: 0 });
    expect((await chain.public.getBalance({ address: key.address })) - before).toBe(parseEther("0.01"));
    expect((await post("/drip", await signDrip(key, { registry: room.registry, label, kind: "room" }))).status).toBe(429);
  });

  it("refuses weak proof of work, someone else's signature, stale requests and the daily cap", async () => {
    const { post } = makeApp({ caps: { claimsPerDay: 10, roomsPerDay: 1, uploadBytesPerKey: 1, uploadBytesPerDay: 1 } });
    const strong = await roomRequest();
    expect((await post("/room", { ...strong.body, roomKey: privateKeyToAccount(generatePrivateKey()).address })).status).toBe(403);
    expect((await post("/room", { ...strong.body, time: strong.body.time - 600 })).status).toBe(403);
    // honestly signed, with real work, but ten minutes old
    const oldTime = Math.floor(Date.now() / 1000) - 600;
    const oldKey = privateKeyToAccount(generatePrivateKey());
    const old = await signRoom(oldKey, await solvePow(oldKey.address, oldTime, 8), oldTime);
    expect((await post("/room", old)).status).toBe(403);
    const ok = await post("/room", strong.body);
    expect(ok.status).toBe(200);
    expect((await post("/room", (await roomRequest()).body)).status).toBe(429);
    const res = await makeApp({ powDifficulty: 30 }).post("/room", (await roomRequest()).body);
    expect(res.status).toBe(403);
    expect(await res.json()).toMatchObject({ error: "NOT_AUTHORIZED" });
  });

  it("drips only to the owner of a registry registered under cloakroom.eth or rooms.cloakroom.eth, above the floor", async () => {
    const { post, drips } = makeApp({}, { floorWei: parseEther("1000") });
    const { key, body } = await roomRequest();
    const room = (await (await post("/room", body)).json()) as { ensName: string; registry: Address };
    const label = room.ensName.split(".")[0]!;
    const stranger = privateKeyToAccount(generatePrivateKey());
    expect((await post("/drip", await signDrip(stranger, { registry: room.registry, label, kind: "room" }))).status).toBe(403);
    const loose = (await deployDrive(relayer.writer, { implementation: chain.implementation, driveKey: key.address, mainWallet: null })).registry;
    expect((await post("/drip", await signDrip(key, { registry: loose, label, kind: "room" }))).status).toBe(403);
    expect((await post("/drip", await signDrip(key, { registry: room.registry, label, kind: "drive" }))).status).toBe(403);
    // queued, but the relayer is below its floor, so nothing is sent
    expect((await post("/drip", await signDrip(key, { registry: room.registry, label, kind: "room" }))).status).toBe(200);
    expect(await drips.flush()).toEqual({ sepolia: 0, arkiv: 0, skipped: 1 });
  });
});

describe("POST /upload", () => {
  it("stores padded ciphertext signed by a current editor; refuses viewers, unpadded bodies and over-quota", async () => {
    const { app } = makeApp({ caps: { claimsPerDay: 1, roomsPerDay: 1, uploadBytesPerKey: 64 * 1024, uploadBytesPerDay: 1024 * 1024 } });
    const owner = await chain.newWriter();
    const { registry: folder } = await deployDrive(owner.writer, { implementation: chain.implementation, driveKey: owner.address, mainWallet: null });
    const editor = privateKeyToAccount(generatePrivateKey());
    const viewer = privateKeyToAccount(generatePrivateKey());
    await grantRoleUntil(owner.writer, folder, editor.address, "editor", null);
    await grantRoleUntil(owner.writer, folder, viewer.address, "viewer", null);

    const upload = async (who: typeof editor, body: Uint8Array) =>
      app.request("/upload", {
        method: "POST",
        headers: { "content-type": "application/octet-stream", ...uploadHeaders(await signUpload(who, folder, body)) },
        body: Buffer.from(body),
      });
    const blob = await encryptPadded(randomBytes(32), randomBytes(1000));
    const ok = await upload(editor, blob);
    expect(ok.status).toBe(201);
    const { reference } = (await ok.json()) as { reference: string };
    expect(stored.get(reference.slice(2))).toEqual(blob);

    expect((await upload(viewer, blob)).status).toBe(403);
    expect((await upload(editor, randomBytes(1000))).status).toBe(413);
    expect((await upload(editor, blob)).status).toBe(429); // 64 KiB per key per day, already used
  });
});

describe("POST /claim", () => {
  it("deploys the resolver with cloak.key and the drive root, registers the name, and keeps no role", async (ctx) => {
    if (!liveResolver) ctx.skip(); // needs the live resolver bytecode from Sepolia
    const { post } = makeApp();
    const user = deriveKeys(randomMaterial());
    const drive = privateKeyToAccount(user.driveKey);
    const W = privateKeyToAccount(generatePrivateKey()).address;
    const label = `alice${Date.now() % 100000}`;
    const res = await post("/claim", await signClaim(drive, { label, mainWallet: W, spendingPublicKey: user.spendingPublicKey }));
    expect(res.status).toBe(200);
    const claim = (await res.json()) as { ensName: string; resolver: Address; driveRoot: Address; relayer: Address };
    expect(claim.ensName).toBe(`${label}.cloakroom.eth`);
    expect(await getSubregistry(chain.public, appRegistry, label)).toBe(claim.driveRoot);
    expect(await driveOwner(chain.public, claim.driveRoot)).toBe(drive.address);
    expect(await rootRolesOf(chain.public, claim.resolver, relayer.address)).toBe(0n);
    expect(await rootRolesOf(chain.public, claim.driveRoot, relayer.address)).toBe(0n);
    const textCall = encodeFunctionData({ abi: permissionedResolverAbi, functionName: "text", args: [namehash(claim.ensName), "cloak.key"] });
    const answer = await chain.public.readContract({
      address: claim.resolver,
      abi: permissionedResolverAbi,
      functionName: "resolve",
      args: [dnsEncode(claim.ensName), textCall],
    });
    expect(decodeAbiParameters([{ type: "string" }], answer)[0]).toBe(user.spendingPublicKey);

    // taken now; and one name per drive key
    expect((await post("/claim", await signClaim(drive, { label, mainWallet: W, spendingPublicKey: user.spendingPublicKey }))).status).toBe(409);
    expect((await post("/claim", await signClaim(drive, { label: `${label}x`, mainWallet: W, spendingPublicKey: user.spendingPublicKey }))).status).toBe(429);
  });

  it("refuses bad labels, reserved prefixes, malformed keys and signatures from another key", async () => {
    const { post } = makeApp();
    const user = deriveKeys(randomMaterial());
    const drive = privateKeyToAccount(user.driveKey);
    const base = { mainWallet: null, spendingPublicKey: user.spendingPublicKey };
    expect((await post("/claim", await signClaim(drive, { ...base, label: "Al" }))).status).toBe(400);
    expect((await post("/claim", await signClaim(drive, { ...base, label: "r-room" }))).status).toBe(409);
    expect((await post("/claim", await signClaim(drive, { ...base, label: "fine-name", spendingPublicKey: "0x04ab" }))).status).toBe(400);
    const signed = await signClaim(drive, { ...base, label: "fine-name" });
    expect((await post("/claim", { ...signed, driveKey: privateKeyToAccount(generatePrivateKey()).address })).status).toBe(403);
    expect((await post("/claim", "not json")).status).toBe(400);
    const stale = await signClaim(drive, { ...base, label: "fine-name" }, Math.floor(Date.now() / 1000) - 600);
    expect((await post("/claim", stale)).status).toBe(403);
  });
});
