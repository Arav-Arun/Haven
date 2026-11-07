// Names on the live ENSv2 deployment (HAVEN_PLAN.md sections 6, 9 and 15): the one-time app-name bootstrap
// (haven.eth, rooms.haven.eth), and the two flows the API runs for users: claiming a name (POST /claim) and
// creating an unlinked room (POST /room). The same calls are rehearsed against live Sepolia in
// contracts/test/DriveRegistry.fork.t.sol.

import { DriveError, type Address, type Hex } from "@haven/types";
import { encodeFunctionData, keccak256, namehash, stringToBytes, toHex, zeroAddress } from "viem";
import { getEnsText } from "viem/actions";
import { normalize } from "viem/ens";

import {
  ensv2,
  ethRegistrarAbi,
  liveUserRegistryAbi,
  mockTokenAbi,
  permissionedResolverAbi,
} from "./addresses";
import { randomBytes } from "./crypto";
import {
  deployProxy,
  dnsEncode,
  expectProxy,
  planDrive,
  planProxy,
  type PlannedProxy,
  randomLabel,
  registerTx,
  sendTx,
  sendTxs,
  type SepoliaReader,
  type SepoliaWriter,
} from "./ens";
import { toDriveError } from "./errors";
import { driveRegistryAbi } from "./generated";
import { ignoreSteps, type StepSink } from "./receipts";

// ---------------------------------------------------------------- roles (RegistryRolesLib, unchanged in the live code)

const admin = (roles: bigint) => roles << 128n;
export const REGISTRY_ROLES = {
  REGISTRAR: 1n << 0n,
  REGISTER_RESERVED: 1n << 4n,
  SET_PARENT: 1n << 8n,
  UNREGISTER: 1n << 12n,
  RENEW: 1n << 16n,
  SET_SUBREGISTRY: 1n << 20n,
  SET_RESOLVER: 1n << 24n,
  CAN_TRANSFER_ADMIN: admin(1n << 28n),
  UPGRADE: 1n << 124n,
} as const;

/** EACBaseRolesLib.ALL_ROLES: bit 0 of every nybble, regular and admin halves. */
export const ALL_ROLES = Array.from({ length: 64 }, (_, i) => 1n << BigInt(4 * i)).reduce((a, b) => a | b, 0n);

/** Token roles a claimed name's owner gets: point the name elsewhere, change its resolver, transfer it. */
export const NAME_OWNER_ROLES =
  REGISTRY_ROLES.SET_SUBREGISTRY |
  admin(REGISTRY_ROLES.SET_SUBREGISTRY) |
  REGISTRY_ROLES.SET_RESOLVER |
  admin(REGISTRY_ROLES.SET_RESOLVER) |
  REGISTRY_ROLES.CAN_TRANSFER_ADMIN;

/** PermissionedResolverLib (live): nobody gets these on a user's resolver, so it is frozen like the drive. */
export const RESOLVER_UPGRADE_ROLES = (1n << 124n) | (1n << 252n);
export const RESOLVER_SET_TEXT = 1n << 4n;

// ---------------------------------------------------------------- shared steps

/** A stock UserRegistry proxy (the live implementation) with every root role for `owner`. */
export async function deployUserRegistry(
  writer: SepoliaWriter,
  owner: Address,
  step: StepSink = ignoreSteps,
): Promise<Address> {
  const init = encodeFunctionData({
    abi: liveUserRegistryAbi,
    functionName: "initialize",
    args: [[{ account: owner, roleBitmap: ALL_ROLES }]],
  });
  const { proxy } = await deployProxy(
    writer,
    { implementation: ensv2.UserRegistryImpl, init, label: "Create name registry" },
    step,
  );
  return proxy;
}

/**
 * A PermissionedResolver proxy for `name` with the given text records, written during initialisation (the resolver
 * skips role checks while initialising), and every role except upgrades for `admin`. The deployer keeps nothing.
 */
export async function deployResolver(
  writer: SepoliaWriter,
  params: { name: string; admin: Address; texts: Record<string, string> },
  step: StepSink = ignoreSteps,
): Promise<Address> {
  const { proxy } = await deployProxy(writer, resolverProxyParams(params), step);
  return proxy;
}

/** Plans the same resolver deployment without sending it (see planProxy). */
export function planResolver(
  writer: SepoliaWriter,
  params: { name: string; admin: Address; texts: Record<string, string> },
): Promise<PlannedProxy> {
  return planProxy(writer, resolverProxyParams(params));
}

function resolverProxyParams(params: { name: string; admin: Address; texts: Record<string, string> }) {
  const dnsName = dnsEncode(params.name);
  const calls = Object.entries(params.texts).map(([key, value]) =>
    encodeFunctionData({ abi: permissionedResolverAbi, functionName: "setText", args: [dnsName, key, value] }),
  );
  const init = encodeFunctionData({
    abi: permissionedResolverAbi,
    functionName: "initialize",
    args: [[{ account: params.admin, roleBitmap: ALL_ROLES & ~RESOLVER_UPGRADE_ROLES }], calls],
  });
  return { implementation: ensv2.PermissionedResolverImpl, init, label: "Create resolver" };
}

export async function grantRootRoles(
  writer: SepoliaWriter,
  registry: Address,
  roleBitmap: bigint,
  account: Address,
  step: StepSink = ignoreSteps,
  label = "Grant registry role",
) {
  const data = encodeFunctionData({ abi: driveRegistryAbi, functionName: "grantRootRoles", args: [roleBitmap, account] });
  return sendTx(writer, label, registry, data, step);
}

/** Raw root roles of `account` in any EAC contract (registry or resolver). */
export async function rootRolesOf(client: SepoliaReader, contract: Address, account: Address): Promise<bigint> {
  try {
    return await client.readContract({ address: contract, abi: driveRegistryAbi, functionName: "roles", args: [0n, account] });
  } catch (error) {
    throw toDriveError(error, "roles");
  }
}

// ---------------------------------------------------------------- .eth registration (bootstrap only)

export interface EthRegistration {
  label: string;
  owner: Address;
  subregistry: Address;
  resolver: Address | null;
  /** Seconds. */
  duration: bigint;
  /** An ERC-20 the registrar's price oracle accepts (MockUSDC on Sepolia). */
  paymentToken: Address;
  /** Mint the price first (only the testnet mock tokens allow it). */
  mintPayment: boolean;
}

/** Waits until the chain's clock passes `t` (unix seconds). */
async function waitForChainTime(client: SepoliaReader, t: bigint, pollMs = 4000): Promise<void> {
  for (;;) {
    const { timestamp } = await client.getBlock();
    if (timestamp > t) return;
    await new Promise((r) => setTimeout(r, pollMs));
  }
}

/** ETHRegistrar commit–reveal: commit, wait MIN_COMMITMENT_AGE on chain time, then register (paying in the token). */
export async function registerEthName(
  writer: SepoliaWriter,
  params: EthRegistration,
  step: StepSink = ignoreSteps,
  onWait?: (seconds: number) => void,
): Promise<void> {
  const client = writer.public;
  const registrar = ensv2.ETHRegistrar;
  const available = await client.readContract({
    address: registrar,
    abi: ethRegistrarAbi,
    functionName: "isAvailable",
    args: [params.label],
  });
  if (!available) throw new DriveError("NAME_TAKEN", `${params.label}.eth is taken`);
  const [base, premium] = await client.readContract({
    address: registrar,
    abi: ethRegistrarAbi,
    functionName: "getRegisterPrice",
    args: [params.label, params.duration, params.paymentToken],
  });
  const price = base + premium;
  const me = writer.wallet.account.address;
  if (params.mintPayment) {
    const balance = await client.readContract({
      address: params.paymentToken,
      abi: mockTokenAbi,
      functionName: "balanceOf",
      args: [me],
    });
    if (balance < price) {
      const mint = encodeFunctionData({ abi: mockTokenAbi, functionName: "mint", args: [me, price - balance] });
      await sendTx(writer, "Mint test payment token", params.paymentToken, mint, step);
    }
  }
  const approve = encodeFunctionData({ abi: mockTokenAbi, functionName: "approve", args: [registrar, price] });
  await sendTx(writer, "Approve registration payment", params.paymentToken, approve, step);

  const secret = toHex(randomBytes(32));
  const resolver = params.resolver ?? zeroAddress;
  const noReferrer = toHex(new Uint8Array(32));
  const commitment = await client.readContract({
    address: registrar,
    abi: ethRegistrarAbi,
    functionName: "makeCommitment",
    args: [params.label, params.owner, secret, params.subregistry, resolver, params.duration, noReferrer],
  });
  const commitReceipt = await sendTx(
    writer,
    `Commit to ${params.label}.eth`,
    registrar,
    encodeFunctionData({ abi: ethRegistrarAbi, functionName: "commit", args: [commitment] }),
    step,
  );
  const minAge = await client.readContract({ address: registrar, abi: ethRegistrarAbi, functionName: "MIN_COMMITMENT_AGE" });
  const committedAt = (await client.getBlock({ blockNumber: commitReceipt.blockNumber })).timestamp;
  onWait?.(Number(minAge));
  await waitForChainTime(client, committedAt + minAge);
  await sendTx(
    writer,
    `Register ${params.label}.eth`,
    registrar,
    encodeFunctionData({
      abi: ethRegistrarAbi,
      functionName: "register",
      args: [
        params.label,
        params.owner,
        secret,
        params.subregistry,
        resolver,
        params.duration,
        params.paymentToken,
        noReferrer,
      ],
    }),
    step,
  );
}

/** Expiry of `<label>.eth` in the ETHRegistry. */
export async function ethNameExpiry(client: SepoliaReader, label: string): Promise<bigint> {
  try {
    return await client.readContract({
      address: ensv2.ETHRegistry,
      abi: driveRegistryAbi,
      functionName: "getExpiry",
      args: [BigInt(keccak256(stringToBytes(label)))],
    });
  } catch (error) {
    throw toDriveError(error, "getExpiry");
  }
}

// ---------------------------------------------------------------- user flows (the API runs these)

/** Labels users may claim: 3–32 of a-z, 0-9 and inner hyphens, not one of our prefixes (f-, r-, l-, g-, m-). */
export function checkUserLabel(label: string): string {
  const normalized = normalize(label);
  if (normalized !== label) throw new DriveError("UNKNOWN", "use lowercase letters, digits and hyphens");
  if (!/^[a-z0-9](?:[a-z0-9-]{1,30})[a-z0-9]$/.test(label)) {
    throw new DriveError("UNKNOWN", "names are 3–32 letters, digits or inner hyphens");
  }
  if (/^[frlgm]-/.test(label) || label === "rooms") throw new DriveError("NAME_TAKEN", "that name is reserved");
  return label;
}

export interface ClaimParams {
  /** haven.eth's registry (haven.appRegistry). */
  appRegistry: Address;
  implementation: Address;
  label: string;
  /** K: everyday roles on the drive root. */
  driveKey: Address;
  /** W: dangerous roles and the name itself; null for "Try it" identities (K then holds them). */
  mainWallet: Address | null;
  /** The haven.key text record. */
  spendingPublicKey: Hex;
  /** Unix seconds: haven.eth's own expiry, so a user name lives as long as the app name. */
  expiry: bigint;
}

export interface ClaimResult {
  ensName: string;
  resolver: Address;
  driveRoot: Address;
  driveRootBlock: bigint;
}

/**
 * POST /claim: the relayer deploys the user's resolver (with haven.key) and drive root (K everyday, W dangerous),
 * then registers the name pointing at both. It holds no role on either afterwards (verifyClaim checks that).
 */
export async function claimName(
  writer: SepoliaWriter,
  params: ClaimParams,
  step: StepSink = ignoreSteps,
): Promise<ClaimResult> {
  const label = checkUserLabel(params.label);
  const ensName = `${label}.haven.eth`;
  const owner = params.mainWallet ?? params.driveKey;
  // The three transactions go out together and land in one block (one block instead of three). The register only
  // stores the resolver and drive root addresses, and the factory's CREATE2 addresses are known before deployment.
  const resolver = await planResolver(writer, {
    name: ensName,
    admin: owner,
    texts: { "haven.key": params.spendingPublicKey },
  });
  const drive = await planDrive(writer, {
    implementation: params.implementation,
    driveKey: params.driveKey,
    mainWallet: params.mainWallet,
  });
  const register = registerTx({
    parent: params.appRegistry,
    label,
    owner,
    subregistry: drive.address,
    resolver: resolver.address,
    roleBitmap: NAME_OWNER_ROLES,
    expiry: params.expiry,
  });
  const [resolverReceipt, driveReceipt] = await sendTxs(writer, [resolver, drive, register], step);
  expectProxy(resolverReceipt!, resolver);
  expectProxy(driveReceipt!, drive);
  return { ensName, resolver: resolver.address, driveRoot: drive.address, driveRootBlock: driveReceipt!.blockNumber };
}

export interface RoomParams {
  /** rooms.haven.eth's registry (haven.roomsRegistry). */
  roomsRegistry: Address;
  implementation: Address;
  /** K_room: holds every role in the room; nothing links it to the owner's name. */
  roomKey: Address;
  expiry: bigint;
  label?: string;
}

/** POST /room: the relayer deploys the room's registry (root K_room) and registers r-<random> for it. */
export async function createRoom(
  writer: SepoliaWriter,
  params: RoomParams,
  step: StepSink = ignoreSteps,
): Promise<{ ensName: string; registry: Address; blockNumber: bigint }> {
  const label = params.label ?? randomLabel("r");
  // Both transactions in one block, as in claimName.
  const drive = await planDrive(writer, { implementation: params.implementation, driveKey: params.roomKey, mainWallet: null });
  const register = registerTx({
    parent: params.roomsRegistry,
    label,
    owner: params.roomKey,
    subregistry: drive.address,
    expiry: params.expiry,
  });
  const [driveReceipt] = await sendTxs(writer, [drive, register], step);
  expectProxy(driveReceipt!, drive);
  return { ensName: `${label}.rooms.haven.eth`, registry: drive.address, blockNumber: driveReceipt!.blockNumber };
}

/**
 * Client-side check after /claim (HAVEN_PLAN.md section 13, step 2): the API account holds no role on the resolver
 * or the drive root, the name points at both, and haven.key equals the user's own key.
 */
export async function verifyClaim(
  client: SepoliaReader,
  params: { ensName: string; resolver: Address; driveRoot: Address; api: Address; spendingPublicKey: Hex },
): Promise<void> {
  const [onResolver, onRoot] = await Promise.all([
    rootRolesOf(client, params.resolver, params.api),
    rootRolesOf(client, params.driveRoot, params.api),
  ]);
  if (onResolver !== 0n || onRoot !== 0n) throw new DriveError("NOT_AUTHORIZED", "the API kept a role after /claim");
  const published = await getEnsText(client, {
    name: normalize(params.ensName),
    key: "haven.key",
    universalResolverAddress: ensv2.UniversalResolverV2,
  });
  if (!published || published.toLowerCase() !== params.spendingPublicKey.toLowerCase()) {
    throw new DriveError("KEY_MISMATCH", "haven.key on the new name isn't this key");
  }
}

/** namehash of a name, for links (haven.link is keyed by it). */
export function nameNode(name: string): Hex {
  return namehash(normalize(name));
}
