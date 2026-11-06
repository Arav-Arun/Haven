// One-time Sepolia setup (PLAN_A A1 check 1 and the A2 deploy). Idempotent: each step checks the chain and
// contracts/deployments/sepolia.json first, so a partial run resumes where it stopped.
//   1. DriveRegistry implementation: deployed from contracts/out with viem, then verified on Etherscan with
//      `forge verify-contract` when ETHERSCAN_API_KEY is set.
//   2. haven.eth through ETHRegistrar (commit, wait, register; paid in MockUSDC, which anyone can mint on Sepolia):
//      owner = deployer, subregistry = a stock UserRegistry, resolver = a PermissionedResolver (contenthash later).
//   3. rooms.haven.eth: another stock UserRegistry under haven.eth.
//   4. The relayer (API key) gets ROLE_REGISTRAR on both registries and nothing else.
// Every address is recorded in contracts/deployments/sepolia.json as soon as it exists, then `gen` runs.
// The deployer moves the names to a team Safe later (HAVEN_PLAN.md section 6).
//
// Run: pnpm --filter @haven/core bootstrap
// Needs: SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY and RELAYER_PRIVATE_KEY (both funded with Sepolia ETH);
// optional ETHERSCAN_API_KEY.

import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

import type { Address, Hex } from "@haven/types";
import { type Abi, encodeAbiParameters, formatEther, getAddress, isAddressEqual, parseAbiParameters } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import { ensv2 } from "../src/addresses";
import { findRegistry, registerName } from "../src/ens";
import { driveRegistryAbi } from "../src/generated";
import {
  ALL_ROLES,
  deployResolver,
  deployUserRegistry,
  ethNameExpiry,
  grantRootRoles,
  REGISTRY_ROLES,
  registerEthName,
  rootRolesOf,
} from "../src/naming";
import {
  check,
  envKey,
  flushLogs,
  isRehearsal,
  log,
  readDeployment,
  recordDeployment,
  repoRoot,
  sepoliaReader,
  sepoliaWriter,
  stepLogger,
} from "./lib";

const APP_LABEL = "haven";
const APP_NAME = `${APP_LABEL}.eth`;
const ROOMS_NAME = `rooms.${APP_NAME}`;
const DURATION = 365n * 24n * 3600n;

const reader = sepoliaReader();
const deployerKey = envKey("DEPLOYER_PRIVATE_KEY");
const deployer = privateKeyToAccount(deployerKey).address;
const relayer = privateKeyToAccount(envKey("RELAYER_PRIVATE_KEY")).address;
const writer = sepoliaWriter(deployerKey);
const step = stepLogger("deployer", reader);
const recorded = () => readDeployment().haven as Record<string, string | number | undefined>;

log(`# Sepolia bootstrap, ${new Date().toISOString()}`);
if ((await reader.getChainId()) !== 11155111) throw new Error("SEPOLIA_RPC_URL is not Sepolia");
log(`- deployer ${deployer}: ${formatEther(await reader.getBalance({ address: deployer }))} ETH`);
log(`- relayer ${relayer}: ${formatEther(await reader.getBalance({ address: relayer }))} ETH`);

/** Rehearsal only (anvil fork): advance the clock and mine a block. */
async function fastForward(seconds: number) {
  await reader.request({ method: "evm_increaseTime" as never, params: [seconds] as never });
  await reader.request({ method: "evm_mine" as never, params: [] as never });
}

// ---- 1. DriveRegistry implementation
log();
log("## 1. DriveRegistry implementation");
if (!recorded().driveRegistryImpl) {
  const contracts = resolve(repoRoot, "contracts");
  const build = spawnSync("forge", ["build"], { cwd: contracts, stdio: ["ignore", "ignore", "inherit"] });
  if (build.status !== 0) throw new Error("forge build failed");
  const artifact = JSON.parse(readFileSync(resolve(contracts, "out/DriveRegistry.sol/DriveRegistry.json"), "utf8")) as {
    abi: Abi;
    bytecode: { object: Hex };
  };
  // Same wiring check as the fork test, against the live chain, before spending gas.
  const liveLabelStore = await reader.readContract({
    address: ensv2.UserRegistryImpl,
    abi: driveRegistryAbi,
    functionName: "LABEL_STORE",
  });
  if (!isAddressEqual(liveLabelStore, ensv2.LabelStore)) throw new Error("LabelStore differs from ENS's");
  // The implementation's namer (who may give it a reverse name) is the deployer, the way ENS's own UserRegistryImpl
  // names ENS's owner account. Proxies don't inherit it: each is initialised separately.
  // Deployed with viem, not forge script: gas comes from the node's own estimate. Sepolia now charges about 1,542 gas
  // per byte of deployed code (about 31.6M gas for this contract); forge's local simulation prices it with the
  // project's Cancun rules and runs the deploy out of gas.
  const hash = await writer.wallet.deployContract({
    abi: artifact.abi,
    bytecode: artifact.bytecode.object,
    args: [ensv2.LabelStore, deployer],
  });
  const receipt = await reader.waitForTransactionReceipt({ hash });
  if (receipt.status !== "success" || !receipt.contractAddress) throw new Error(`deploy failed: ${hash}`);
  const impl = getAddress(receipt.contractAddress);
  recordDeployment({ driveRegistryImpl: impl, driveRegistryImplBlock: Number(receipt.blockNumber) });
  log(`- deployed ${impl} in block ${receipt.blockNumber} — gas ${receipt.gasUsed} — https://sepolia.etherscan.io/tx/${hash}`);

  if (process.env.ETHERSCAN_API_KEY && !isRehearsal) {
    const args = encodeAbiParameters(parseAbiParameters("address, address"), [ensv2.LabelStore, deployer]);
    const verify = spawnSync(
      "forge",
      ["verify-contract", impl, "src/DriveRegistry.sol:DriveRegistry", "--chain", "sepolia", "--constructor-args", args, "--watch"],
      // The API key reaches forge through the environment only, never the command line.
      { cwd: contracts, env: { ...process.env, ETHERSCAN_API_KEY: process.env.ETHERSCAN_API_KEY }, encoding: "utf8" },
    );
    const out = `${verify.stdout}${verify.stderr}`;
    log(`- Etherscan: ${/Pass - Verified|already verified/i.test(out) ? "verified" : `not confirmed (${out.trim().split("\n").at(-1)})`}`);
  } else {
    log(`- Etherscan: skipped (${isRehearsal ? "rehearsal" : "no ETHERSCAN_API_KEY"})`);
  }
} else {
  log(`- already deployed: ${recorded().driveRegistryImpl}`);
}

// ---- 2. haven.eth
log();
log(`## 2. ${APP_NAME}`);
let appRegistry = recorded().appRegistry as Address | undefined;
if (!appRegistry) {
  appRegistry = await deployUserRegistry(writer, deployer, step);
  recordDeployment({ appRegistry });
}
let appResolver = recorded().appResolver as Address | undefined;
if (!appResolver) {
  appResolver = await deployResolver(writer, { name: APP_NAME, admin: deployer, texts: {} }, step);
  recordDeployment({ appResolver });
}
const appFound = await findRegistry(reader, APP_NAME);
if (appFound && isAddressEqual(appFound, appRegistry)) {
  log(`- ${APP_NAME} already points at ${appRegistry}`);
} else {
  await registerEthName(
    writer,
    {
      label: APP_LABEL,
      owner: deployer,
      subregistry: appRegistry,
      resolver: appResolver,
      duration: DURATION,
      paymentToken: ensv2.MockUSDC,
      mintPayment: true,
    },
    step,
    (seconds) => {
      log(`- waiting ${seconds}s of chain time between commit and register…`);
      // Rehearsal on a local fork only: move the fork's clock instead of waiting for blocks that won't come.
      if (isRehearsal) void fastForward(seconds + 5);
    },
  );
}

// ---- 3. rooms.haven.eth
log();
log(`## 3. ${ROOMS_NAME}`);
let roomsRegistry = recorded().roomsRegistry as Address | undefined;
if (!roomsRegistry) {
  roomsRegistry = await deployUserRegistry(writer, deployer, step);
  recordDeployment({ roomsRegistry });
}
const roomsFound = await findRegistry(reader, ROOMS_NAME);
if (roomsFound && isAddressEqual(roomsFound, roomsRegistry)) {
  log(`- ${ROOMS_NAME} already points at ${roomsRegistry}`);
} else {
  await registerName(
    writer,
    {
      parent: appRegistry,
      label: "rooms",
      owner: deployer,
      subregistry: roomsRegistry,
      expiry: await ethNameExpiry(reader, APP_LABEL),
    },
    step,
  );
}

// ---- 4. the relayer: ROLE_REGISTRAR on both, nothing else
log();
log("## 4. Relayer");
for (const [name, registry] of [
  [APP_NAME, appRegistry],
  [ROOMS_NAME, roomsRegistry],
] as const) {
  if ((await rootRolesOf(reader, registry, relayer)) === 0n) {
    await grantRootRoles(writer, registry, REGISTRY_ROLES.REGISTRAR, relayer, step, `Relayer: registrar of ${name}`);
  }
}
recordDeployment({ relayer, deployer });

// ---- checks
await flushLogs();
log();
log("## Checks");
check(`${APP_NAME} resolves to its registry`, (await findRegistry(reader, APP_NAME)) === appRegistry);
check(`${ROOMS_NAME} resolves to its registry`, (await findRegistry(reader, ROOMS_NAME)) === roomsRegistry);
for (const [name, registry] of [
  [APP_NAME, appRegistry],
  [ROOMS_NAME, roomsRegistry],
] as const) {
  check(`relayer holds exactly ROLE_REGISTRAR on ${name}`, (await rootRolesOf(reader, registry, relayer)) === REGISTRY_ROLES.REGISTRAR);
  check(`deployer holds every role on ${name}`, (await rootRolesOf(reader, registry, deployer)) === ALL_ROLES);
}
log(`- ${APP_NAME} expires ${new Date(Number(await ethNameExpiry(reader, APP_LABEL)) * 1000).toISOString()}`);

if (!isRehearsal) {
  const gen = spawnSync("pnpm", ["--filter", "@haven/core", "gen"], { cwd: repoRoot, stdio: "inherit" });
  if (gen.status !== 0) process.exitCode = 1;
}
log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
