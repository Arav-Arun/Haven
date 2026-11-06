// Live first-hour checks after the bootstrap (PLAN_A A1 checks 3 and 4, and the A2 demo proxy), with gas per step.
//   check 3: POST /claim's onchain part — the relayer deploys a resolver with haven.key and a drive root and registers
//            the name; the API keeps no role; haven.key reads back through UniversalResolverV2 (verifyClaim).
//   check 4: namespace aliasing (a mount resolves names below it like the canonical path) and an expired subname
//            that stops resolving.
//   A2 demo: grant until +90 s → wasAllowed true → time passes → false, the interval still readable; neither K nor W
//            can upgrade.
// Fresh random keys for the user; the relayer funds K (as the API's drip will). Takes about two minutes (waits for
// the grant and the link to end on chain time).
//
// Run: pnpm --filter @haven/core a1   (after `bootstrap`)

import type { Address, Hex } from "@haven/types";
import { decodeErrorResult, encodeFunctionData, parseEther } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { ensv2 } from "../src/addresses";
import {
  accessOf,
  createFolder,
  findRegistry,
  historyOf,
  randomLabel,
  registerName,
  grantRoleUntil,
  ROLE_DRIVE_READ,
  ROLE_DRIVE_WRITE,
  wasAllowed,
} from "../src/ens";
import { driveRegistryAbi } from "../src/generated";
import { deriveKeys, randomMaterial } from "../src/keys";
import { claimName, ethNameExpiry, verifyClaim } from "../src/naming";
import {
  check,
  envKey,
  flushLogs,
  isRehearsal,
  log,
  readDeployment,
  sepoliaReader,
  sepoliaWriter,
  stepLogger,
} from "./lib";

const reader = sepoliaReader();
const deployment = readDeployment().haven as Record<string, Address | undefined>;
const implementation = deployment.driveRegistryImpl;
const appRegistry = deployment.appRegistry;
if (!implementation || !appRegistry) throw new Error("run `pnpm --filter @haven/core bootstrap` first");

const relayerKey = envKey("RELAYER_PRIVATE_KEY");
const relayer = privateKeyToAccount(relayerKey).address;
const relayerWriter = sepoliaWriter(relayerKey);
const DRIP = parseEther(process.env.A1_DRIP_ETH ?? "0.01");

async function chainNow(): Promise<number> {
  return Number((await reader.getBlock()).timestamp);
}
async function waitUntil(t: number) {
  if (isRehearsal) {
    // Local fork only: blocks come only with transactions, so move the clock and mine one.
    await reader.request({ method: "evm_increaseTime" as never, params: [t - (await chainNow()) + 1] as never });
    await reader.request({ method: "evm_mine" as never, params: [] as never });
  }
  while ((await chainNow()) <= t) await new Promise((r) => setTimeout(r, 3000));
}

log(`# A1 checks 3 and 4, A2 demo, ${new Date().toISOString()}`);

// ---------------------------------------------------------------- check 3
log();
log("## Check 3: claim a name (resolver with haven.key, drive root), API keeps no role");
const user = deriveKeys(randomMaterial());
const kKey: Hex = user.driveKey;
const K = user.driveAddress;
const wKey = generatePrivateKey();
const W = privateKeyToAccount(wKey).address;
const label = `check-${randomLabel("f", 6).slice(2)}`;
const claim = await claimName(
  relayerWriter,
  {
    appRegistry,
    implementation,
    label,
    driveKey: K,
    mainWallet: W,
    spendingPublicKey: user.spendingPublicKey,
    expiry: await ethNameExpiry(reader, "haven"),
  },
  stepLogger("relayer"),
);
await flushLogs();
log(`- ${claim.ensName}: resolver ${claim.resolver}, drive root ${claim.driveRoot}`);
try {
  await verifyClaim(reader, { ...claim, api: relayer, spendingPublicKey: user.spendingPublicKey });
  check("API holds no role on the resolver or the drive root, and haven.key reads back through UniversalResolverV2", true);
} catch (error) {
  check("verifyClaim", false, String(error));
}
check("the registry walk finds the drive root", (await findRegistry(reader, claim.ensName)) === claim.driveRoot);
check("K holds the drive root as owner", (await accessOf(reader, claim.driveRoot, K)).via === "owner");

// The API's drip, so K can pay for its own writes.
const drip = await relayerWriter.wallet.sendTransaction({ to: K, value: DRIP });
await reader.waitForTransactionReceipt({ hash: drip });
log(`- relayer: drip to K — https://sepolia.etherscan.io/tx/${drip}`);
const kWriter = sepoliaWriter(kKey);

// ---------------------------------------------------------------- check 4
log();
log("## Check 4: aliasing through a mount; an expired subname stops resolving");
const folder = await createFolder(
  kWriter,
  { parent: claim.driveRoot, implementation, driveKey: K, mainWallet: W },
  stepLogger("K"),
);
const sub = await createFolder(kWriter, { parent: folder.registry, implementation, driveKey: K, mainWallet: W }, stepLogger("K"));
const mount = randomLabel("m", 8);
await registerName(
  kWriter,
  { parent: claim.driveRoot, label: mount, owner: K, subregistry: folder.registry, expiry: 2n ** 64n - 1n },
  stepLogger("K"),
);
const linkEnds = (await chainNow()) + 90;
const link = randomLabel("l", 8);
await registerName(
  kWriter,
  { parent: folder.registry, label: link, owner: K, subregistry: sub.registry, expiry: BigInt(linkEnds) },
  stepLogger("K"),
);

// ---------------------------------------------------------------- A2 demo, sharing the wait
const S = privateKeyToAccount(generatePrivateKey()).address;
const grantEnds = (await chainNow()) + 90;
await grantRoleUntil(kWriter, folder.registry, S, "editor", grantEnds, stepLogger("K"));
const during = await chainNow();
await flushLogs();

const canonical = `${sub.label}.${folder.label}.${claim.ensName}`;
const aliased = `${sub.label}.${mount}.${claim.ensName}`;
const linkName = `${link}.${folder.label}.${claim.ensName}`;
check("the mount resolves to the folder", (await findRegistry(reader, `${mount}.${claim.ensName}`)) === folder.registry);
check(
  "a name below the mount resolves like the canonical path",
  (await findRegistry(reader, aliased)) === sub.registry && (await findRegistry(reader, canonical)) === sub.registry,
);
check("the live link resolves", (await findRegistry(reader, linkName)) === sub.registry);
check("A2: S may write during the grant", await wasAllowed(reader, folder.registry, S, ROLE_DRIVE_WRITE, during));

log(`- waiting for the link and the grant to end (chain time ${Math.max(linkEnds, grantEnds)})…`);
await waitUntil(Math.max(linkEnds, grantEnds));
const after = await chainNow();
check("check 4: the expired link stops resolving", (await findRegistry(reader, linkName)) === null);
check("A2: after the end, S holds no roles", (await accessOf(reader, folder.registry, S)).roles === 0n);
check("A2: wasAllowed is false now", !(await wasAllowed(reader, folder.registry, S, ROLE_DRIVE_READ, after)));
check("A2: wasAllowed during the grant is still true", await wasAllowed(reader, folder.registry, S, ROLE_DRIVE_WRITE, during));
const history = await historyOf(reader, folder.registry, S);
check("A2: the interval is still readable", history.length === 1 && history[0]!.until === grantEnds, JSON.stringify(history, (_, v) => (typeof v === "bigint" ? v.toString() : v)));

for (const [who, account] of [
  ["K", K],
  ["W", W],
] as const) {
  let reverted = "";
  try {
    await reader.call({
      account,
      to: folder.registry,
      data: encodeFunctionData({ abi: driveRegistryAbi, functionName: "upgradeToAndCall", args: [ensv2.UserRegistryImpl, "0x"] }),
    });
  } catch (error) {
    // viem nests the revert data at different depths per error type: walk the cause chain, as ens.ts does.
    let data: Hex | undefined;
    for (let e: unknown = error, depth = 0; e && !data && depth < 10; e = (e as { cause?: unknown }).cause, depth++) {
      const d = (e as { data?: unknown }).data;
      if (typeof d === "string" && d.startsWith("0x") && d.length >= 10) data = d as Hex;
      else if (d && typeof (d as { data?: unknown }).data === "string") data = (d as { data: Hex }).data;
    }
    try {
      reverted = data ? decodeErrorResult({ abi: driveRegistryAbi, data }).errorName : String(error).slice(0, 80);
    } catch {
      reverted = String(error).slice(0, 80);
    }
  }
  check(`A2: ${who} can't upgrade the folder`, reverted === "UpgradesDisabled", reverted || "did not revert");
}

await flushLogs();
log();
log(process.exitCode ? "RESULT: FAIL" : "RESULT: PASS");
