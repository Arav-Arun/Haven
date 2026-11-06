// Add-on F1 "Done when", live on Sepolia + Arkiv: a new name has a public key log readable with the README query, the
// share dialog's lookup shows its fingerprint, and a forged entry (another wallet, same ensName) is ignored and counted.
// Also: device registration and revocation, and trust on first use catching a key change.
//
// Every identity is fresh and random; nothing is pre-seeded. The relayer plays POST /claim (step A5's job) and drips
// tGLM to K, as the API will.
//
// Run: pnpm --filter @cloakroom/core f1
// Needs (repo-root .env and apps/api/.env): SEPOLIA_RPC_URL, RELAYER_PRIVATE_KEY (Sepolia ETH, tGLM, ROLE_REGISTRAR on
// cloakroom.eth), ARKIV_RPC_URL, ARKIV_ACCESS_KEY; and in contracts/deployments/sepolia.json:
// cloakroom.driveRegistryImpl and cloakroom.appRegistry.

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Hex, KeyValueStore, ReceiptStep } from "@cloakroom/types";
import { asc, eq } from "@arkiv-network/sdk/query";
import { str } from "@arkiv-network/sdk/schema";
import { createPublicClient, createWalletClient, formatEther, isHex, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  appendKeyLog,
  arkivReader,
  arkivWriter,
  assertCanShare,
  BlockClock,
  claimName,
  deriveKeys,
  ensureKeyPublished,
  KeyLogSchema,
  keyLogOp,
  listKeyLog,
  lookupKey,
  myDevices,
  passthroughAnon,
  randomBytes,
  randomMaterial,
  registerDevice,
  rememberKey,
  requireDeployed,
  revokeDevice,
  sendGlm,
  signKeyLogEntry,
  verifyKeyLog,
  writeEntities,
  type SepoliaWriter,
} from "../src/index";
import { anonTransport } from "../src/transport";

// ---------------------------------------------------------------- env

const here = dirname(fileURLToPath(import.meta.url));
for (const file of [resolve(here, "../../../.env"), resolve(here, "../../../apps/api/.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (repo-root .env or apps/api/.env)`);
  return value;
}

const SEPOLIA_RPC_URL = env("SEPOLIA_RPC_URL");
const ARKIV_RPC_URL = env("ARKIV_RPC_URL");
const ARKIV_ACCESS_KEY = env("ARKIV_ACCESS_KEY");
const relayerKey = env("RELAYER_PRIVATE_KEY");
if (!isHex(relayerKey)) throw new Error("RELAYER_PRIVATE_KEY must be 0x-hex");
const DRIP_ARKIV_WEI = BigInt(process.env.DRIP_ARKIV_WEI || parseEther("0.02"));
const implementation = requireDeployed("driveRegistryImpl");
const appRegistry = requireDeployed("appRegistry");

// ---------------------------------------------------------------- output

const log = (line = "") => console.log(line);
const stepLogger = (actor: string) => (step: ReceiptStep) => {
  if (step.kind === "sepolia-tx" || step.kind === "arkiv-tx") {
    log(`- ${actor}: ${step.label} — ${step.ok ? "ok" : "FAILED"} — ${step.explorerUrl}`);
  }
};
function check(label: string, ok: boolean, detail = "") {
  log(`- ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}
async function rejects(promise: Promise<unknown>): Promise<string | null> {
  try {
    await promise;
    return null;
  } catch (error) {
    return error instanceof Error ? error.message : String(error);
  }
}

/** A device's KeyValueStore for this run (the apps use @cloakroom/platform's encrypted IndexedDB store). */
class RunStore implements KeyValueStore {
  private readonly map = new Map<string, Uint8Array>();
  async get(key: string) {
    return this.map.get(key) ?? null;
  }
  async set(key: string, value: Uint8Array) {
    this.map.set(key, value);
  }
  async delete(key: string) {
    this.map.delete(key);
  }
}

// ---------------------------------------------------------------- clients

const anon = passthroughAnon();
const sepoliaPublic = createPublicClient({ chain: sepolia, transport: anonTransport({ url: SEPOLIA_RPC_URL, anon }) });
const relayerSepolia: SepoliaWriter = {
  public: sepoliaPublic,
  wallet: createWalletClient({
    chain: sepolia,
    transport: anonTransport({ url: SEPOLIA_RPC_URL, anon }),
    account: privateKeyToAccount(relayerKey),
  }),
};
const reader = arkivReader({ rpcUrl: ARKIV_RPC_URL, accessKey: ARKIV_ACCESS_KEY, anon });
const arkivAs = (key: Hex) => arkivWriter({ rpcUrl: ARKIV_RPC_URL, accessKey: ARKIV_ACCESS_KEY, anon }, key);
const clock = new BlockClock(reader);

// ---------------------------------------------------------------- run

const relayer = privateKeyToAccount(relayerKey);
log(`# F1 live run, ${new Date().toISOString()}`);
log();
log("## Preflight");
log(`- relayer ${relayer.address}: ${formatEther(await sepoliaPublic.getBalance({ address: relayer.address }))} Sepolia ETH, ` +
  `${formatEther(await reader.getBalance({ address: relayer.address }))} tGLM`);

// 1. A new user claims a name, as POST /claim will do it, then publishes seq 0 (what claimName in the client will do).
log();
log("## 1. Claim a name and publish its key");
const alice = deriveKeys(randomMaterial());
const label = `keys${Array.from(randomBytes(4), (b) => b.toString(16).padStart(2, "0")).join("")}`;
const { ensName } = await claimName(
  relayerSepolia,
  {
    appRegistry,
    implementation,
    label,
    driveKey: alice.driveAddress,
    mainWallet: null,
    spendingPublicKey: alice.spendingPublicKey,
    expiry: BigInt(Math.floor(Date.now() / 1000) + 365 * 24 * 3600),
  },
  stepLogger("relayer"),
);
log(`- claimed ${ensName}; K = ${alice.driveAddress}`);
await sendGlm(arkivAs(relayerKey), alice.driveAddress, DRIP_ARKIV_WEI, stepLogger("relayer"), "Drip tGLM to K");
const aliceWriter = { arkiv: arkivAs(alice.driveKey), driveKey: alice.driveKey, step: stepLogger("K") };
const { written } = await ensureKeyPublished(aliceWriter, reader, ensName, alice.spendingPublicKey);
check("seq 0 written", written !== null, written ?? "");
check("a second ensureKeyPublished writes nothing", (await ensureKeyPublished(aliceWriter, reader, ensName, alice.spendingPublicKey)).written === null);

// 2. The README query, exactly as any other app would run it.
log();
log("## 2. The README query");
const readme = await reader
  .select()
  .from(KeyLogSchema)
  .where(eq("ensName", str(ensName)) as never)
  .orderBy(asc("seq") as never)
  .fetch();
check("the public log is readable with the README query", readme.entities.length === 1, `${readme.entities.length} entity`);

// 3. Someone else plants a forged rotate for the same name.
log();
log("## 3. A forged entry from another wallet");
const mallory = deriveKeys(randomMaterial());
await sendGlm(arkivAs(relayerKey), mallory.driveAddress, DRIP_ARKIV_WEI, stepLogger("relayer"), "Fund the attacker");
const existing = (await listKeyLog(reader, ensName)).records;
const forgedEntry = {
  ensName,
  seq: 1,
  kind: "rotate" as const,
  spendingPublicKey: mallory.spendingPublicKey,
  devicePublicKey: null,
  prevEntryKey: existing[0]!.key,
};
await writeEntities(
  arkivAs(mallory.driveKey),
  [keyLogOp({ ...forgedEntry, sig: await signKeyLogEntry(mallory.driveKey, forgedEntry) })],
  "Forged rotate",
  stepLogger("attacker"),
);

// 4. A sender (Bob, another device) looks the name up, as the share dialog does.
log();
log("## 4. Lookup from a sender's device");
const bobStore = new RunStore();
const bobReaders = { sepolia: sepoliaPublic, arkiv: reader, clock, storage: bobStore };
const seen = await lookupKey(bobReaders, ensName);
log(`- fingerprint: ${seen.fingerprint.join(" ")}`);
check("current key is Alice's", seen.current === (await verifyKeyLog(existing, ensName, alice.driveAddress)).current);
check("matches cloak.key", seen.matchesEns);
check("the forged entry is ignored and counted", seen.ignoredEntries >= 1 && seen.history.length === 1, `${seen.ignoredEntries} ignored`);
check("sharing is allowed", (await rejects(Promise.resolve().then(() => assertCanShare(seen)))) === null);
await rememberKey(bobStore, ensName, seen.current); // Bob shares once

// 5. Devices: register two, revoke one through the log.
log();
log("## 5. Devices");
const phone = new RunStore();
const laptop = new RunStore();
await registerDevice(aliceWriter, phone, ensName, "Phone");
await registerDevice(aliceWriter, laptop, ensName, "Laptop");
const devices = await myDevices({ arkiv: reader, clock }, alice.driveKey, ensName);
check("both devices listed with their sealed labels", devices.map((d) => d.label).sort().join(",") === "Laptop,Phone");
const laptopId = devices.find((d) => d.label === "Laptop")!.deviceId;
await revokeDevice(aliceWriter, reader, ensName, laptopId);
const afterRevoke = await myDevices({ arkiv: reader, clock }, alice.driveKey, ensName);
check("the revoked device is gone", afterRevoke.map((d) => d.label).join(",") === "Phone");

// 6. Alice's key changes (a real rotate by K). Bob's next lookup warns; cloak.key now disagrees until it's updated.
log();
log("## 6. A real rotate is caught by trust on first use");
const newKey = deriveKeys(randomMaterial()).spendingPublicKey;
const current = await verifyKeyLog((await listKeyLog(reader, ensName)).records, ensName, alice.driveAddress);
await appendKeyLog(aliceWriter, ensName, current, { kind: "rotate", spendingPublicKey: newKey });
const after = await lookupKey(bobReaders, ensName);
check("Bob sees the key changed since his last share", after.changedSinceLastShare);
check("the log no longer matches cloak.key, so sharing is refused", !after.matchesEns);
const refusal = await rejects(Promise.resolve().then(() => assertCanShare(after)));
check("assertCanShare refuses", refusal !== null, refusal ?? "");
log(`- history: ${after.history.map((e) => `${e.seq}:${e.kind}`).join(" → ")}`);
