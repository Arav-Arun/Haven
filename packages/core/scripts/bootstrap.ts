// One-time Sepolia setup (CLOAKROOM_PLAN.md section 6, "Names"), as rehearsed in contracts/test/DriveRegistry.fork.t.sol:
//   1. deploy the DriveRegistry implementation (skipped if contracts/deployments/sepolia.json already has one);
//   2. register cloakroom.eth through ENSv2's ETHRegistrar (paid in the testnet MockUSDC, minted free), pointing at a
//      fresh stock UserRegistry: the app registry, where user names live;
//   3. register rooms.cloakroom.eth in it, pointing at a second UserRegistry: where unlinked rooms live;
//   4. give the API's relayer ROLE_REGISTRAR on both, and nothing else;
//   5. record every address in contracts/deployments/sepolia.json and regenerate src/generated.ts.
// Each step checks what's already on chain, so a failed run can be re-run.
//
// Run:  cd contracts && forge build && cd .. && pnpm --filter @cloakroom/core bootstrap
// Needs (repo-root .env or apps/api/.env): SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY (Sepolia ETH), RELAYER_PRIVATE_KEY
// (only its address is used here).

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Address, Hex, ReceiptStep } from "@cloakroom/types";
import { createPublicClient, createWalletClient, formatEther, getAddress, http, isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  deployUserRegistry,
  driveRegistryAbi,
  ensv2,
  ethNameExpiry,
  findRegistry,
  grantRootRoles,
  registerEthName,
  registerName,
  REGISTRY_ROLES,
  rootRolesOf,
  type SepoliaWriter,
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
for (const file of [resolve(root, ".env"), resolve(root, "apps/api/.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
function env(name: string): Hex | string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (repo-root .env or apps/api/.env)`);
  return v;
}
const deployerKey = env("DEPLOYER_PRIVATE_KEY");
const relayerKey = env("RELAYER_PRIVATE_KEY");
if (!isHex(deployerKey) || !isHex(relayerKey)) throw new Error("private keys must be 0x-hex");

const deployer = privateKeyToAccount(deployerKey);
const relayer = privateKeyToAccount(relayerKey).address;
const transport = http(env("SEPOLIA_RPC_URL"));
const client = createPublicClient({ chain: sepolia, transport });
const writer: SepoliaWriter = { public: client, wallet: createWalletClient({ chain: sepolia, transport, account: deployer }) };
const log = (step: ReceiptStep) => {
  if (step.kind === "sepolia-tx") console.log(`  ${step.ok ? "ok" : "FAILED"}  ${step.label}  ${step.explorerUrl}`);
};

const deploymentPath = resolve(root, "contracts/deployments/sepolia.json");
const deployment = JSON.parse(readFileSync(deploymentPath, "utf8")) as { cloakroom: Record<string, string | number> };
const save = () => writeFileSync(deploymentPath, `${JSON.stringify(deployment, null, 2)}\n`);

console.log(`deployer ${deployer.address}: ${formatEther(await client.getBalance({ address: deployer.address }))} Sepolia ETH`);
console.log(`relayer  ${relayer}`);

// 1. The DriveRegistry implementation.
if (!deployment.cloakroom.driveRegistryImpl) {
  const artifactPath = resolve(root, "contracts/out/DriveRegistry.sol/DriveRegistry.json");
  if (!existsSync(artifactPath)) throw new Error("run `forge build` in contracts/ first");
  const artifact = JSON.parse(readFileSync(artifactPath, "utf8")) as { bytecode: { object: Hex } };
  console.log("1. Deploying the DriveRegistry implementation");
  const hash = await writer.wallet.deployContract({
    abi: driveRegistryAbi,
    bytecode: artifact.bytecode.object,
    // The implementation's namer is the deployer, as in contracts/script/DeployDriveRegistry.s.sol.
    args: [ensv2.LabelStore, deployer.address],
  });
  const receipt = await client.waitForTransactionReceipt({ hash });
  if (!receipt.contractAddress || receipt.status !== "success") throw new Error(`deploy failed: ${hash}`);
  deployment.cloakroom.driveRegistryImpl = receipt.contractAddress;
  deployment.cloakroom.driveRegistryImplBlock = Number(receipt.blockNumber);
  deployment.cloakroom.driveRegistryImplTx = hash;
  save();
  console.log(`  ok  ${receipt.contractAddress}  https://sepolia.etherscan.io/tx/${hash}`);
} else {
  console.log(`1. DriveRegistry implementation already deployed: ${deployment.cloakroom.driveRegistryImpl}`);
}

// 2. cloakroom.eth and its app registry.
let appRegistry = (await findRegistry(client, "cloakroom.eth")) as Address | null;
if (!appRegistry) {
  console.log("2. Registering cloakroom.eth (commit, wait, register)");
  appRegistry = await deployUserRegistry(writer, deployer.address, log);
  await registerEthName(
    writer,
    {
      label: "cloakroom",
      owner: deployer.address,
      subregistry: appRegistry,
      resolver: null,
      duration: 365n * 24n * 3600n,
      paymentToken: ensv2.MockUSDC,
      mintPayment: true,
    },
    log,
    (s) => console.log(`  waiting ${s} s for the commitment to age`),
  );
} else {
  console.log(`2. cloakroom.eth already points at ${appRegistry}`);
}
deployment.cloakroom.appRegistry = getAddress(appRegistry);
save();

// 3. rooms.cloakroom.eth.
let roomsRegistry = (await findRegistry(client, "rooms.cloakroom.eth")) as Address | null;
if (!roomsRegistry) {
  console.log("3. Registering rooms.cloakroom.eth");
  roomsRegistry = await deployUserRegistry(writer, deployer.address, log);
  await registerName(
    writer,
    { parent: appRegistry, label: "rooms", owner: deployer.address, subregistry: roomsRegistry, expiry: await ethNameExpiry(client, "cloakroom") },
    log,
  );
} else {
  console.log(`3. rooms.cloakroom.eth already points at ${roomsRegistry}`);
}
deployment.cloakroom.roomsRegistry = getAddress(roomsRegistry);
save();

// 4. The relayer: ROLE_REGISTRAR on both registries, nothing else.
for (const [name, registry] of [["cloakroom.eth", appRegistry], ["rooms.cloakroom.eth", roomsRegistry]] as const) {
  const roles = await rootRolesOf(client, registry, relayer);
  if (roles & REGISTRY_ROLES.REGISTRAR) console.log(`4. relayer already registrar on ${name}`);
  else {
    console.log(`4. Granting the relayer ROLE_REGISTRAR on ${name}`);
    await grantRootRoles(writer, registry, REGISTRY_ROLES.REGISTRAR, relayer, log, `Relayer may register names in ${name}`);
  }
}

// 5. Regenerate the addresses the apps read.
execFileSync("pnpm", ["--filter", "@cloakroom/core", "gen"], { cwd: root, stdio: "inherit" });
console.log("\nDone. contracts/deployments/sepolia.json now has:");
console.log(JSON.stringify(deployment.cloakroom, null, 2));
console.log(
  `\nVerify the implementation on Etherscan:\n  cd contracts && forge verify-contract ${deployment.cloakroom.driveRegistryImpl} src/DriveRegistry.sol:DriveRegistry ` +
    `--chain sepolia --constructor-args $(cast abi-encode "f(address,address)" ${ensv2.LabelStore} ${deployer.address}) --etherscan-api-key "$ETHERSCAN_API_KEY"`,
);
