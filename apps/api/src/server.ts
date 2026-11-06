// Entry point: configuration from the environment (Fly secrets in production), then serve.
// Addresses come from @cloakroom/core (contracts/deployments/sepolia.json); the API refuses to start without them.

import {
  arkivWriter,
  ethNameExpiry,
  passthroughAnon,
  requireDeployed,
  type SepoliaWriter,
} from "@cloakroom/core";
import { serve } from "@hono/node-server";
import { createPublicClient, createWalletClient, http, isHex, parseEther } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import { createApp } from "./app";
import { DripQueue } from "./drips";

function env(name: string, fallback?: string): string {
  const value = process.env[name] || fallback;
  if (value === undefined || value === "") throw new Error(`${name} is not set`);
  return value;
}
const optional = (name: string) => process.env[name] || null;

const relayerKey = env("RELAYER_PRIVATE_KEY");
if (!isHex(relayerKey) || relayerKey.length !== 66) throw new Error("RELAYER_PRIVATE_KEY must be 0x + 64 hex");
const account = privateKeyToAccount(relayerKey);
const transport = http(env("SEPOLIA_RPC_URL"));
const relayer: SepoliaWriter = {
  public: createPublicClient({ chain: sepolia, transport }),
  wallet: createWalletClient({ chain: sepolia, transport, account }),
};

const arkivKey = optional("ARKIV_ACCESS_KEY");
const arkiv = arkivKey
  ? arkivWriter({ rpcUrl: env("ARKIV_RPC_URL", "https://rpc.rabdi.db-chain.testnet.arkiv.network"), accessKey: arkivKey, anon: passthroughAnon() }, relayerKey)
  : null;

const now = () => Math.floor(Date.now() / 1000);
const drips = new DripQueue(
  relayer,
  arkiv,
  {
    sepoliaWei: BigInt(env("DRIP_SEPOLIA_WEI", parseEther("0.005").toString())),
    arkivWei: BigInt(env("DRIP_ARKIV_WEI", parseEther("0.05").toString())),
    intervalSeconds: Number(env("DRIP_INTERVAL_SECONDS", "600")),
    floorWei: BigInt(env("RELAYER_FLOOR_WEI", parseEther("0.05").toString())),
    dailyBudgetWei: BigInt(env("DRIP_DAILY_BUDGET_WEI", parseEther("0.5").toString())),
  },
  now,
);

const beeUrl = optional("BEE_URL");
const batchId = optional("POSTAGE_BATCH_ID");

const app = createApp({
  relayer,
  implementation: requireDeployed("driveRegistryImpl"),
  appRegistry: requireDeployed("appRegistry"),
  roomsRegistry: requireDeployed("roomsRegistry"),
  nameExpiry: () => ethNameExpiry(relayer.public, "cloakroom"),
  drips,
  bee: beeUrl && batchId ? { url: beeUrl, batchId } : null,
  powDifficulty: Number(env("ROOM_POW_DIFFICULTY", "20")),
  caps: {
    claimsPerDay: Number(env("CLAIM_DAILY_CAP", "100")),
    roomsPerDay: Number(env("ROOM_DAILY_CAP", "200")),
    uploadBytesPerKey: Number(env("UPLOAD_QUOTA_BYTES", String(256 * 1024 * 1024))),
    uploadBytesPerDay: Number(env("UPLOAD_DAILY_BYTES", String(4 * 1024 * 1024 * 1024))),
  },
  now,
});

drips.start();
const port = Number(env("PORT", "8787"));
serve({ fetch: app.fetch, port, hostname: "0.0.0.0" });
console.log(`cloakroom api on :${port} — relayer ${account.address}${arkiv ? "" : " (Arkiv drips off)"}${beeUrl ? "" : " (uploads off)"}`);
