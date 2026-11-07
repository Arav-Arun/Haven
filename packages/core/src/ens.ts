// ENS on Sepolia (HAVEN_PLAN.md section 6): reads through UniversalResolverV2 and the DriveRegistry views, and the
// everyday writes signed by K or K_room. Every write is simulated first (so a revert comes back as a named error),
// then sent, waited for, and reported as a "sepolia-tx" receipt step.
//
// Clients are passed in, so the caller picks the route: one anonTransport per isolation key (stealth address or room).

import { DriveError, type AccessVia, type Address, type Hex, type Role } from "@haven/types";
import {
  type Account,
  type Chain,
  concatBytes,
  decodeErrorResult,
  decodeFunctionResult,
  encodeFunctionData,
  getAddress,
  isAddressEqual,
  keccak256,
  type Log,
  parseEventLogs,
  type PublicClient,
  stringToBytes,
  toHex,
  type TransactionReceipt,
  type Transport,
  type WalletClient,
  zeroAddress,
} from "viem";
import { getEnsText } from "viem/actions";
import { normalize } from "viem/ens";

import { ensv2, txUrl, universalHelperAbi } from "./addresses";
import { randomBytes } from "./crypto";
import { revertCode, toDriveError } from "./errors";
import { driveRegistryAbi, verifiableFactoryAbi } from "./generated";
import { ignoreSteps, type StepSink } from "./receipts";

// ---------------------------------------------------------------- roles

const admin = (roles: bigint) => roles << 128n;

export const ROLE_REGISTRAR = 1n << 0n;
export const ROLE_DRIVE_READ = 1n << 40n;
export const ROLE_DRIVE_WRITE = 1n << 44n;
export const ROLE_DRIVE_SHARE = 1n << 48n;
export const DRIVE_ROLES = ROLE_DRIVE_READ | ROLE_DRIVE_WRITE | ROLE_DRIVE_SHARE;
export const ALL_DRIVE_ROLES = DRIVE_ROLES | admin(DRIVE_ROLES);
/** `until` meaning "no end date" (DriveRegistry.NO_END). */
export const NO_END = 2n ** 64n - 1n;

/** The bitmap granted for each role: viewers read, editors also write, managers hold every drive bit and admin bit. */
export function roleBits(role: Role): bigint {
  switch (role) {
    case "viewer":
      return ROLE_DRIVE_READ;
    case "editor":
      return ROLE_DRIVE_READ | ROLE_DRIVE_WRITE;
    case "manager":
      return ALL_DRIVE_ROLES;
  }
}

/** The highest role a bitmap carries, or null if it carries no drive role. */
export function roleOf(bits: bigint): Role | null {
  if (bits & ROLE_DRIVE_SHARE) return "manager";
  if (bits & ROLE_DRIVE_WRITE) return "editor";
  if (bits & ROLE_DRIVE_READ) return "viewer";
  return null;
}

/** Every role a bitmap carries, for the Public view. */
export function rolesIn(bits: bigint): Role[] {
  const roles: Role[] = [];
  if (bits & ROLE_DRIVE_READ) roles.push("viewer");
  if (bits & ROLE_DRIVE_WRITE) roles.push("editor");
  if (bits & ROLE_DRIVE_SHARE) roles.push("manager");
  return roles;
}

/** `until` as the contract takes it. null means no end. */
export function toUntil(until: number | null): bigint {
  if (until === null) return NO_END;
  if (!Number.isInteger(until) || until <= 0) throw new DriveError("UNKNOWN", "until must be a unix time in seconds");
  return BigInt(until);
}

export function fromUntil(until: bigint): number | null {
  return until === NO_END ? null : Number(until);
}

// ---------------------------------------------------------------- names

/** DNS wire format, as UniversalResolverV2 takes names. */
export function dnsEncode(name: string): Hex {
  const labels = normalize(name).split(".").filter((l) => l.length > 0);
  const parts: Uint8Array[] = [];
  for (const label of labels) {
    const bytes = stringToBytes(label);
    if (bytes.length > 255) throw new DriveError("UNKNOWN", "label too long");
    parts.push(new Uint8Array([bytes.length]), bytes);
  }
  parts.push(new Uint8Array([0]));
  return toHex(concatBytes(parts));
}

/** LibLabel.id: the labelhash as a uint256, which every registry accepts as `anyId`. */
export function labelId(label: string): bigint {
  return BigInt(keccak256(stringToBytes(label)));
}

const LABEL_ALPHABET = "abcdefghijklmnopqrstuvwxyz234567"; // 32 symbols, so each random byte maps without bias

/** A random label such as "f-k2x9q7mz" (f folder, r room, l link, g group, m mount). Reveals nothing, can't be guessed. */
export function randomLabel(prefix: "f" | "r" | "l" | "g" | "m", length = 10): string {
  const bytes = randomBytes(length);
  return `${prefix}-${Array.from(bytes, (b) => LABEL_ALPHABET[b & 31]).join("")}`;
}

// ---------------------------------------------------------------- clients

export type SepoliaReader = PublicClient<Transport, Chain | undefined>;

export interface SepoliaWriter {
  public: SepoliaReader;
  wallet: WalletClient<Transport, Chain, Account>;
}

// ---------------------------------------------------------------- reads

/** The haven.key text record (the recipient's spending public key), or null if the name has none. */
export async function getHavenKey(client: SepoliaReader, name: string): Promise<string | null> {
  try {
    const value = await getEnsText(client, {
      name: normalize(name),
      key: "haven.key",
      universalResolverAddress: ensv2.UniversalResolverV2,
    });
    return value === null || value === "" ? null : value;
  } catch (error) {
    throw toDriveError(error, `haven.key of ${name}`);
  }
}

/** The registry a name points to (a folder, a drive root, or rooms.haven.eth's registry), or null. */
export async function findRegistry(client: SepoliaReader, name: string): Promise<Address | null> {
  try {
    const registry = await client.readContract({
      address: ensv2.UniversalHelper,
      abi: universalHelperAbi,
      functionName: "findExactRegistry",
      args: [dnsEncode(name)],
    });
    return isAddressEqual(registry, zeroAddress) ? null : getAddress(registry);
  } catch (error) {
    throw toDriveError(error, `registry of ${name}`);
  }
}

export interface OnchainAccess {
  roles: bigint;
  from: number;
  until: number | null;
  via: AccessVia | null;
}

const VIA: (AccessVia | null)[] = [null, "owner", "direct", "parent", "group"];

/** Live access of `account` in a DriveRegistry. Expired grants read as no roles. */
export async function accessOf(client: SepoliaReader, registry: Address, account: Address): Promise<OnchainAccess> {
  try {
    const [roles, from, until, via] = await client.readContract({
      address: registry,
      abi: driveRegistryAbi,
      functionName: "accessOf",
      args: [account],
    });
    return { roles, from: Number(from), until: fromUntil(until), via: VIA[via] ?? null };
  } catch (error) {
    throw toDriveError(error, "accessOf");
  }
}

export async function driveOwner(client: SepoliaReader, registry: Address): Promise<Address> {
  try {
    return getAddress(
      await client.readContract({ address: registry, abi: driveRegistryAbi, functionName: "driveOwner" }),
    );
  } catch (error) {
    throw toDriveError(error, "driveOwner");
  }
}

/** Whether `account` held every bit of `roleBitmap` at unix time `t`, from the registry's own history. */
export async function wasAllowed(
  client: SepoliaReader,
  registry: Address,
  account: Address,
  roleBitmap: bigint,
  t: number,
): Promise<boolean> {
  return (await wasAllowedMany(client, registry, [account], roleBitmap, [t]))[0] ?? false;
}

const WAS_ALLOWED_BATCH = 100;

/** wasAllowed for many (account, time) pairs, in batches of 100 per view call. */
export async function wasAllowedMany(
  client: SepoliaReader,
  registry: Address,
  accounts: readonly Address[],
  roleBitmap: bigint,
  times: readonly number[],
): Promise<boolean[]> {
  if (accounts.length !== times.length) throw new Error("accounts and times differ in length");
  const out: boolean[] = [];
  try {
    for (let i = 0; i < accounts.length; i += WAS_ALLOWED_BATCH) {
      const batch = await client.readContract({
        address: registry,
        abi: driveRegistryAbi,
        functionName: "wasAllowedMany",
        args: [
          accounts.slice(i, i + WAS_ALLOWED_BATCH),
          roleBitmap,
          times.slice(i, i + WAS_ALLOWED_BATCH).map((t) => BigInt(Math.max(0, Math.floor(t)))),
        ],
      });
      out.push(...batch);
    }
  } catch (error) {
    throw toDriveError(error, "wasAllowedMany");
  }
  return out;
}

export interface AccessInterval {
  roles: bigint;
  from: number;
  until: number | null;
  /** When the interval was closed early (revoked or changed), or null while it is open. */
  endedAt: number | null;
}

export async function historyOf(client: SepoliaReader, registry: Address, account: Address): Promise<AccessInterval[]> {
  try {
    const intervals = await client.readContract({
      address: registry,
      abi: driveRegistryAbi,
      functionName: "historyOf",
      args: [account],
    });
    return intervals.map((i) => ({
      roles: i.roles,
      from: Number(i.from),
      until: fromUntil(i.until),
      endedAt: i.endedAt === 0n ? null : Number(i.endedAt),
    }));
  } catch (error) {
    throw toDriveError(error, "historyOf");
  }
}

/** AVAILABLE in a PermissionedRegistry (never registered, or expired). */
export async function isLabelAvailable(client: SepoliaReader, registry: Address, label: string): Promise<boolean> {
  try {
    const status = await client.readContract({
      address: registry,
      abi: driveRegistryAbi,
      functionName: "getStatus",
      args: [labelId(label)],
    });
    return status === 0;
  } catch (error) {
    throw toDriveError(error, "getStatus");
  }
}

export async function getSubregistry(client: SepoliaReader, registry: Address, label: string): Promise<Address | null> {
  try {
    const sub = await client.readContract({
      address: registry,
      abi: driveRegistryAbi,
      functionName: "getSubregistry",
      args: [label],
    });
    return isAddressEqual(sub, zeroAddress) ? null : getAddress(sub);
  } catch (error) {
    throw toDriveError(error, "getSubregistry");
  }
}

// ---------------------------------------------------------------- who controls a name (add-ons F1, F2)

/** "priya.acme.eth" → { label: "priya", parent: "acme.eth" }; null for a top-level name. */
export function splitName(name: string): { label: string; parent: string } | null {
  const i = name.indexOf(".");
  if (i <= 0 || i === name.length - 1) return null;
  return { label: name.slice(0, i), parent: name.slice(i + 1) };
}

/** A user name we issue: <label>.haven.eth (exactly three labels). */
export function isHavenUserName(name: string): boolean {
  const parts = name.split(".");
  return parts.length === 3 && parts[1] === "haven" && parts[2] === "eth" && parts[0] !== "rooms";
}

export interface NameHolding {
  /** The token owner now; null when the name is unregistered or expired. */
  owner: Address | null;
  expiry: number;
}

const REGISTERED = 2; // IPermissionedRegistry.Status: AVAILABLE 0, RESERVED 1, REGISTERED 2

/** Who holds `label` in `registry` right now (live: status, expiry and ownerOf). */
export async function holderIn(client: SepoliaReader, registry: Address, label: string): Promise<NameHolding> {
  const id = labelId(label);
  try {
    const [status, expiry, tokenId] = await Promise.all([
      client.readContract({ address: registry, abi: driveRegistryAbi, functionName: "getStatus", args: [id] }),
      client.readContract({ address: registry, abi: driveRegistryAbi, functionName: "getExpiry", args: [id] }),
      client.readContract({ address: registry, abi: driveRegistryAbi, functionName: "getTokenId", args: [id] }),
    ]);
    const live = status === REGISTERED && Number(expiry) > Math.floor(Date.now() / 1000);
    if (!live) return { owner: null, expiry: Number(expiry) };
    const owner = await client.readContract({ address: registry, abi: driveRegistryAbi, functionName: "ownerOf", args: [tokenId] });
    return { owner: isAddressEqual(owner, zeroAddress) ? null : getAddress(owner), expiry: Number(expiry) };
  } catch (error) {
    throw toDriveError(error, `holder of ${label}`);
  }
}

/**
 * The account whose signature counts for a name's public key log:
 *   <label>.haven.eth → the drive key K that owns its drive root (the key the user's app holds);
 *   any other ENSv2 name  → its current token owner in the parent's registry (a wallet).
 * null when the name doesn't exist or has expired.
 */
export async function nameController(client: SepoliaReader, name: string): Promise<Address | null> {
  const n = normalize(name);
  if (isHavenUserName(n)) {
    const root = await findRegistry(client, n);
    return root ? driveOwner(client, root) : null;
  }
  const split = splitName(n);
  if (!split) return null;
  const parentRegistry = await findRegistry(client, split.parent);
  if (!parentRegistry) return null;
  return (await holderIn(client, parentRegistry, split.label)).owner;
}

/**
 * The block a contract was deployed in, by binary search over eth_getCode (needs a provider that serves past state,
 * as Alchemy and Infura do). Used to start a log scan of someone else's registry at its first block.
 */
export async function creationBlock(client: SepoliaReader, address: Address): Promise<bigint> {
  let hi = await client.getBlockNumber({ cacheTime: 0 });
  const code = await client.getCode({ address, blockNumber: hi });
  if (!code || code === "0x") throw new DriveError("NOT_FOUND", `no contract at ${address}`);
  let lo = 0n;
  try {
    while (lo < hi) {
      const mid = (lo + hi) / 2n;
      const at = await client.getCode({ address, blockNumber: mid });
      if (at && at !== "0x") hi = mid;
      else lo = mid + 1n;
    }
  } catch (error) {
    throw toDriveError(error, "finding when a registry was created (the Sepolia RPC must serve past state)");
  }
  return lo;
}

export interface ChildName {
  label: string;
  /** The registry the label points to now, or null (expired, unregistered, or not a folder, e.g. a link). */
  registry: Address | null;
  /** The token owner at registration. */
  owner: Address;
  expiry: bigint;
  blockNumber: bigint;
}

export interface ListChildrenOptions {
  /** First block to scan: the registry's creation block, or the DriveRegistry implementation's deployment block. */
  fromBlock: bigint;
  toBlock?: bigint;
  /** Largest block range per eth_getLogs call; halved automatically when a provider refuses a range. */
  maxRange?: bigint;
}

/**
 * Child names of a registry, from its LabelRegistered events (eth_getLogs), each checked against the live
 * getSubregistry so expired or re-pointed names don't show. The latest registration of a label wins.
 */
export async function listChildren(
  client: SepoliaReader,
  registry: Address,
  options: ListChildrenOptions,
): Promise<ChildName[]> {
  const event = driveRegistryAbi.find((e) => e.type === "event" && e.name === "LabelRegistered");
  if (!event || event.type !== "event") throw new Error("LabelRegistered missing from the ABI");
  // cacheTime 0: viem otherwise reuses a block number up to one polling interval old, missing names registered since.
  const latest = options.toBlock ?? (await client.getBlockNumber({ cacheTime: 0 }));
  let range = options.maxRange ?? 50_000n;
  const logs: Log[] = [];
  let from = options.fromBlock;
  while (from <= latest) {
    const to = from + range - 1n > latest ? latest : from + range - 1n;
    try {
      logs.push(...(await client.getLogs({ address: registry, event, fromBlock: from, toBlock: to })));
      from = to + 1n;
    } catch (error) {
      if (range <= 1n) throw toDriveError(error, "listing child names");
      range /= 2n; // providers cap the range of eth_getLogs; retry the same start with a smaller one
    }
  }
  const parsed = parseEventLogs({ abi: driveRegistryAbi, eventName: "LabelRegistered", logs });
  const byLabel = new Map<string, ChildName>();
  for (const log of parsed) {
    byLabel.set(log.args.label, {
      label: log.args.label,
      registry: null,
      owner: getAddress(log.args.owner),
      expiry: log.args.expiry,
      blockNumber: log.blockNumber,
    });
  }
  const children = [...byLabel.values()];
  for (const child of children) child.registry = await getSubregistry(client, registry, child.label);
  return children;
}

// ---------------------------------------------------------------- writes

const errorAbi = [...driveRegistryAbi, ...verifiableFactoryAbi].filter((e) => e.type === "error");

/** Simulates, sends and waits for one transaction; reports it as a receipt step; throws a DriveError on failure. */
export async function sendTx(
  writer: SepoliaWriter,
  label: string,
  to: Address,
  data: Hex,
  step: StepSink,
): Promise<TransactionReceipt> {
  const account = writer.wallet.account;
  try {
    await writer.public.call({ account, to, data });
  } catch (error) {
    throw decodeRevert(error, label);
  }
  let hash: Hex;
  try {
    hash = await writer.wallet.sendTransaction({ account, chain: writer.wallet.chain, to, data });
  } catch (error) {
    throw toDriveError(error, label);
  }
  let receipt: TransactionReceipt;
  try {
    receipt = await writer.public.waitForTransactionReceipt({ hash });
  } catch (error) {
    step({ kind: "sepolia-tx", label, hash, explorerUrl: txUrl("sepolia", hash), ok: false });
    throw toDriveError(error, label);
  }
  const ok = receipt.status === "success";
  step({ kind: "sepolia-tx", label, hash, explorerUrl: txUrl("sepolia", hash), ok });
  if (!ok) throw new DriveError("UNKNOWN", `${label}: transaction reverted`);
  return receipt;
}

/** A transaction prepared but not sent yet. */
export interface PlannedTx {
  label: string;
  to: Address;
  data: Hex;
}

/**
 * Sends `txs` back to back with consecutive nonces, without waiting between them, so they can all land in the same
 * block; then waits for every receipt. Use it only when each transaction succeeds without the earlier ones' effects:
 * each is simulated and priced against the current state before any is sent (a contract address that is known in
 * advance and only stored, as in a register call, is fine). Nothing else may send from the same account meanwhile;
 * the API runs its transactions one job at a time.
 */
export async function sendTxs(
  writer: SepoliaWriter,
  txs: readonly PlannedTx[],
  step: StepSink = ignoreSteps,
): Promise<TransactionReceipt[]> {
  const account = writer.wallet.account;
  const gas: bigint[] = [];
  for (const tx of txs) {
    try {
      await writer.public.call({ account, to: tx.to, data: tx.data });
      gas.push(await writer.public.estimateGas({ account, to: tx.to, data: tx.data }));
    } catch (error) {
      throw decodeRevert(error, tx.label);
    }
  }
  const nonce = await writer.public.getTransactionCount({ address: account.address, blockTag: "pending" });
  const hashes: Hex[] = [];
  let sendError: DriveError | null = null;
  for (const [i, tx] of txs.entries()) {
    try {
      hashes.push(
        await writer.wallet.sendTransaction({
          account,
          chain: writer.wallet.chain,
          to: tx.to,
          data: tx.data,
          nonce: nonce + i,
          gas: (gas[i]! * 6n) / 5n, // the estimate plus 20%
        }),
      );
    } catch (error) {
      sendError = toDriveError(error, tx.label);
      break;
    }
  }
  // Wait for everything that went out, even after a failed send, so the receipts panel shows what happened.
  const results = await Promise.all(
    hashes.map((hash) =>
      writer.public.waitForTransactionReceipt({ hash }).then(
        (receipt) => ({ receipt, error: null }),
        (error: unknown) => ({ receipt: null, error }),
      ),
    ),
  );
  const receipts: TransactionReceipt[] = [];
  let failure: DriveError | null = null;
  for (const [i, r] of results.entries()) {
    const label = txs[i]!.label;
    const hash = hashes[i]!;
    const ok = r.receipt?.status === "success";
    step({ kind: "sepolia-tx", label, hash, explorerUrl: txUrl("sepolia", hash), ok });
    if (r.receipt) receipts.push(r.receipt);
    failure ??= r.error ? toDriveError(r.error, label) : ok ? null : new DriveError("UNKNOWN", `${label}: transaction reverted`);
  }
  if (failure ?? sendError) throw (failure ?? sendError)!;
  return receipts;
}

/** A proxy deployment, planned but not sent: `address` is where the factory will create it. */
export interface PlannedProxy extends PlannedTx {
  address: Address;
}

/**
 * Plans a VerifiableFactory proxy deployment with a random salt. The factory uses CREATE2 with
 * keccak256(sender, salt), so a simulated call from the same account returns the exact address it will get.
 */
export async function planProxy(
  writer: SepoliaWriter,
  params: { implementation: Address; init: Hex; label: string; factory?: Address },
): Promise<PlannedProxy> {
  const to = params.factory ?? ensv2.VerifiableFactory;
  const data = encodeFunctionData({
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [params.implementation, BigInt(toHex(randomBytes(32))), params.init],
  });
  let result: Hex | undefined;
  try {
    ({ data: result } = await writer.public.call({ account: writer.wallet.account, to, data }));
  } catch (error) {
    throw decodeRevert(error, params.label);
  }
  if (!result) throw new DriveError("UNKNOWN", `${params.label}: the factory returned no address`);
  const address = getAddress(decodeFunctionResult({ abi: verifiableFactoryAbi, functionName: "deployProxy", data: result }));
  return { label: params.label, to, data, address };
}

/** Checks that a sent proxy deployment created the planned address. */
export function expectProxy(receipt: TransactionReceipt, planned: PlannedProxy): void {
  const [deployed] = parseEventLogs({ abi: verifiableFactoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!deployed || !isAddressEqual(deployed.args.proxyAddress, planned.address)) {
    throw new DriveError("UNKNOWN", `${planned.label}: created at an unexpected address`);
  }
}

/** Names the custom error a simulated call reverted with, using our ABIs. */
function decodeRevert(error: unknown, label: string): DriveError {
  const data = revertData(error);
  if (data) {
    try {
      const { errorName } = decodeErrorResult({ abi: errorAbi, data });
      return new DriveError(revertCode(errorName), `${label}: ${errorName}`);
    } catch {
      // not one of ours: fall through
    }
  }
  return toDriveError(error, label);
}

/** Finds the raw revert data inside a viem error chain. */
function revertData(error: unknown): Hex | null {
  let current: unknown = error;
  for (let depth = 0; current && depth < 10; depth++) {
    const data = (current as { data?: unknown }).data;
    if (typeof data === "string" && data.startsWith("0x") && data.length >= 10) return data as Hex;
    if (data && typeof data === "object" && typeof (data as { data?: unknown }).data === "string") {
      return (data as { data: Hex }).data;
    }
    current = (current as { cause?: unknown }).cause;
  }
  return null;
}

export interface DeployDriveParams {
  /** The DriveRegistry implementation (haven.driveRegistryImpl). */
  implementation: Address;
  /** K or K_room: gets the everyday roles. */
  driveKey: Address;
  /** W, which gets the dangerous roles; null for a room (K_room then holds everything). */
  mainWallet: Address | null;
  factory?: Address;
}

/**
 * Deploys a proxy of `implementation` through the stock VerifiableFactory and runs `init` in the same transaction, so
 * nobody can initialise it first. The salt is random, so the address can't be predicted or linked.
 */
export async function deployProxy(
  writer: SepoliaWriter,
  params: { implementation: Address; init: Hex; label: string; factory?: Address },
  step: StepSink = ignoreSteps,
): Promise<{ proxy: Address; blockNumber: bigint }> {
  const salt = BigInt(toHex(randomBytes(32)));
  const data = encodeFunctionData({
    abi: verifiableFactoryAbi,
    functionName: "deployProxy",
    args: [params.implementation, salt, params.init],
  });
  const receipt = await sendTx(writer, params.label, params.factory ?? ensv2.VerifiableFactory, data, step);
  const [deployed] = parseEventLogs({ abi: verifiableFactoryAbi, eventName: "ProxyDeployed", logs: receipt.logs });
  if (!deployed) throw new DriveError("UNKNOWN", "ProxyDeployed event missing");
  return { proxy: getAddress(deployed.args.proxyAddress), blockNumber: receipt.blockNumber };
}

/** Deploys a DriveRegistry proxy (a drive root, folder, room or group), initialised atomically. */
export async function deployDrive(
  writer: SepoliaWriter,
  params: DeployDriveParams,
  step: StepSink = ignoreSteps,
): Promise<{ registry: Address; blockNumber: bigint }> {
  const { proxy, blockNumber } = await deployProxy(writer, driveProxyParams(params), step);
  return { registry: proxy, blockNumber };
}

/** Plans a DriveRegistry proxy deployment (see planProxy) without sending it. */
export function planDrive(writer: SepoliaWriter, params: DeployDriveParams): Promise<PlannedProxy> {
  return planProxy(writer, driveProxyParams(params));
}

function driveProxyParams(params: DeployDriveParams) {
  const init = encodeFunctionData({
    abi: driveRegistryAbi,
    functionName: "initializeDrive",
    args: [params.driveKey, params.mainWallet ?? zeroAddress],
  });
  return {
    implementation: params.implementation,
    init,
    label: "Create folder registry",
    ...(params.factory ? { factory: params.factory } : {}),
  };
}

export interface RegisterParams {
  /** The registry the label goes into. */
  parent: Address;
  label: string;
  /** Token owner. Registered with no token roles: the registry's root roles already govern the name. */
  owner: Address;
  subregistry: Address | null;
  resolver?: Address | null;
  roleBitmap?: bigint;
  /** Unix seconds; NO_END for a folder that lives as long as its parent. */
  expiry: bigint;
}

export async function registerName(writer: SepoliaWriter, params: RegisterParams, step: StepSink = ignoreSteps) {
  const tx = registerTx(params);
  return sendTx(writer, tx.label, tx.to, tx.data, step);
}

/** The register call as a planned transaction. It only stores the subregistry and resolver addresses, so they may be
 *  contracts that are deployed earlier in the same batch (sendTxs). */
export function registerTx(params: RegisterParams): PlannedTx {
  const data = encodeFunctionData({
    abi: driveRegistryAbi,
    functionName: "register",
    args: [
      params.label,
      params.owner,
      params.subregistry ?? zeroAddress,
      params.resolver ?? zeroAddress,
      params.roleBitmap ?? 0n,
      params.expiry,
    ],
  });
  return { label: `Register ${params.label}`, to: params.parent, data };
}

export interface CreateFolderParams {
  /** The registry the folder's label goes into: the drive root or a parent folder (K holds ROLE_REGISTRAR there). */
  parent: Address;
  implementation: Address;
  driveKey: Address;
  mainWallet: Address | null;
  label?: string;
  factory?: Address;
}

/** A folder: K deploys a DriveRegistry proxy, then registers a random label pointing at it. */
export async function createFolder(
  writer: SepoliaWriter,
  params: CreateFolderParams,
  step: StepSink = ignoreSteps,
): Promise<{ registry: Address; label: string; blockNumber: bigint }> {
  const label = params.label ?? randomLabel("f");
  const { registry, blockNumber } = await deployDrive(writer, params, step);
  await registerName(
    writer,
    { parent: params.parent, label, owner: params.driveKey, subregistry: registry, expiry: NO_END },
    step,
  );
  return { registry, label, blockNumber };
}

/** Grants a role until `until` (null = no end). Also renews or shortens an existing grant. */
export async function grantRoleUntil(
  writer: SepoliaWriter,
  registry: Address,
  account: Address,
  role: Role,
  until: number | null,
  step: StepSink = ignoreSteps,
) {
  const data = encodeFunctionData({
    abi: driveRegistryAbi,
    functionName: "grantRolesUntil",
    args: [roleBits(role), account, toUntil(until)],
  });
  return sendTx(writer, `Grant ${role}`, registry, data, step);
}

/** Removes every drive role (and admin bit) from `account` now. */
export async function revokeAccess(
  writer: SepoliaWriter,
  registry: Address,
  account: Address,
  step: StepSink = ignoreSteps,
) {
  const data = encodeFunctionData({
    abi: driveRegistryAbi,
    functionName: "revokeRootRoles",
    args: [ALL_DRIVE_ROLES, account],
  });
  return sendTx(writer, "Remove access", registry, data, step);
}

/** Frees the holder slot of an expired grant. Anyone may call it; the history stays. */
export async function sweep(writer: SepoliaWriter, registry: Address, account: Address, step: StepSink = ignoreSteps) {
  const data = encodeFunctionData({ abi: driveRegistryAbi, functionName: "sweep", args: [account] });
  return sendTx(writer, "Free an expired slot", registry, data, step);
}

/** An expiring link name `l-<random>` in a folder's registry. It points nowhere; it only carries the end date. */
export async function createLinkName(
  writer: SepoliaWriter,
  params: { folder: Address; owner: Address; expiresAt: number; label?: string },
  step: StepSink = ignoreSteps,
): Promise<{ label: string }> {
  const label = params.label ?? randomLabel("l");
  await registerName(
    writer,
    { parent: params.folder, label, owner: params.owner, subregistry: null, expiry: BigInt(params.expiresAt) },
    step,
  );
  return { label };
}

/**
 * Mount (namespace aliasing): `<label>.<my drive>` points at another folder's registry. Never for rooms, which would
 * publish a link between the room and the drive.
 */
export async function mountFolder(
  writer: SepoliaWriter,
  params: { driveRoot: Address; owner: Address; label: string; target: Address },
  step: StepSink = ignoreSteps,
) {
  return registerName(
    writer,
    { parent: params.driveRoot, label: params.label, owner: params.owner, subregistry: params.target, expiry: NO_END },
    step,
  );
}
