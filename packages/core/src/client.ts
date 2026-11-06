// createDriveClient (PLAN_A.md step A6): the frozen DriveClient, built from the pieces in this package.
//
// Who signs what:
//   K          (from the seed)   own drive: folders, groups, links, mounts; drips from the API
//   K_room[n]  (from the seed)   each unlinked room; nothing links it to K or W
//   S          (stealth)         a folder someone shared with you; funded by the sharer
// Every Sepolia and Arkiv read goes through Anon-RPC (DriveConfig.anon), isolated per stealth address and per room.
// Every Arkiv entity is checked by the Validator before it counts.

import {
  DriveError,
  type AccessVia,
  type Address,
  type DriveClient,
  type DriveConfig,
  type FileEntry,
  type Folder,
  type FolderKind,
  type Hex,
  type Identity,
  type IncomingShare,
  type Member,
  type PublicView,
  type Receipt,
  type Role,
  type ShareLink,
  type ShareOptions,
  type SignInSource,
  type Timestamp,
} from "@cloakroom/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  createPublicClient,
  createWalletClient,
  getAddress,
  hexToBytes,
  isAddress,
  isAddressEqual,
  parseEther,
  parseEventLogs,
  toHex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";
import { normalize } from "viem/ens";

import { EXPLORERS, requireDeployed, cloakroom } from "./addresses";
import { signClaim, solveRoomPow, type ApiInfo, type ClaimResponse, type DripResponse, type RoomResponse } from "./api";
import {
  arkivReader,
  arkivWriter,
  BlockClock,
  deviceOp,
  fileOp,
  listDeviceEntries,
  listKeyLog,
  keyCopyOp,
  linkOp,
  listFiles as arkivListFiles,
  listFolderKeyCopies,
  listFolderWelcomes,
  listKeyCopies,
  listLinks,
  listRefreshes,
  listRosters,
  listRotations,
  listTombs,
  listWelcomes,
  rosterOp,
  rotationOp,
  sendGlm,
  tombOp,
  weekBucket,
  welcomeOp,
  writeEntities,
  type ArkivReader,
  type ArkivWriter,
  type CreateOp,
  type FileRecord,
  type RosterRecord,
} from "./arkiv";
import { randomBytes, toPrivateKey, utf8 } from "./crypto";
import { doorbellTopic, mineGsocKey, openDoorbell, sealDoorbell, signRing, type DoorbellConfig, type DoorbellEvent, type GsocKey } from "./doorbell";
import type {
  CloakroomClient,
  DeviceInfo,
  KeyInfo,
  LiveEvent,
  LiveStatus,
  SignTypedData,
  SubtreePreview,
  SubtreeRule,
} from "./extras";
import {
  checkDevices,
  checkKeyLog,
  compressKey,
  currentKey,
  deviceIdOf,
  deviceTypedData,
  ensAgreement,
  fingerprint,
  fingerprintText,
  KeyMemory,
  keyLogTypedData,
  keyProblem,
  nextEntry,
  openDeviceLabel,
  sameKey,
  sealDeviceLabel,
  type KeyLogRelayRequest,
  type KeyLogRelayResponse,
} from "./keydir";
import { listSubtreeHolders, overCap, planSync, type SubtreeHolder } from "./subtree";
import {
  accessOf,
  createFolder as ensCreateFolder,
  createLinkName,
  driveOwner,
  findRegistry,
  getCloakKey,
  grantRoleUntil,
  isCloakroomUserName,
  isLabelAvailable,
  labelId,
  listChildren,
  mountFolder,
  nameController,
  randomLabel,
  revokeAccess,
  roleOf,
  rolesIn,
  type ChildName,
  type SepoliaReader,
  type SepoliaWriter,
} from "./ens";
import {
  chainHead,
  deriveEpochKey,
  epochAt,
  epochEnd,
  epochKeyFor,
  epochSecondsFor,
  isExhausted,
  rosterKey,
  type EpochKey,
  type EpochSchedule,
} from "./epochs";
import { toDriveError } from "./errors";
import { driveRegistryAbi } from "./generated";
import { openKeyCopy, sealKeyCopy, type KeyCopy } from "./keycopies";
import {
  assertMatchesPublished,
  deriveKeys,
  exportSeed as encodeSeed,
  importSeed,
  keyMaterialFrom,
  ownSealKey,
  roomKey,
  signInMessage as buildSignInMessage,
  type IdentityKeys,
} from "./keys";
import { checkUserLabel, nameNode, verifyClaim } from "./naming";
import { decryptPadded, encryptPadded, MAX_FILE_BYTES } from "./padding";
import { Receipts, type StepSink } from "./receipts";
import {
  newFileId,
  openFileMeta,
  openFolderName,
  openLinkBundle,
  openRoster,
  sealFileMeta,
  sealFolderName,
  sealLinkBundle,
  sealRoster,
  type FileMeta,
  type Roster,
  type RosterMember,
  type SubtreeRuleData,
} from "./records";
import { createWelcome, openWelcome } from "./stealth";
import { downloadEncrypted, downloadFolderBlobs, uploadEncrypted, type SwarmConfig } from "./swarm";
import { anonTransport, isAnonymous, type RouteStep } from "./transport";
import { registryHistory, scheduleOf, Validator, type FolderReading } from "./validator";

// ---------------------------------------------------------------- constants

/** tGLM the sharer sends a new editor or manager's stealth address, so it can write file entries. */
const MEMBER_TGLM = parseEther("0.005");
/** Sepolia ETH the sharer sends a new manager's stealth address, so it can grant and revoke. */
const MANAGER_ETH = parseEther("0.003");
/** Below this, an editor or manager shows "needs gas", and maintain() tops them up. */
const LOW_TGLM = parseEther("0.001");
/** The least a key needs before the client sends a transaction with it. */
const MIN_ETH = parseEther("0.0003");
const MIN_TGLM = parseEther("0.0003");
/** How many weeks of welcome notes "Shared with me" scans on a first look. */
const WELCOME_WEEKS = 8;
const STORE = { seed: "seed", name: "name", shares: "shares", rooms: "rooms", device: "device", tofu: "tofu", synced: "subtree-sync" } as const;
/** A device entry is renewed when it has less than this left (it lasts 90 days). */
const DEVICE_RENEW_SECONDS = 30 * 86_400;
/** How often "live" folders are re-read when no Swarm subscription is open. */
const POLL_SECONDS = 30;
/** Arkiv allows about this many creates per transaction comfortably within half a block's gas. */
const OPS_PER_TX = 16;

// ---------------------------------------------------------------- small helpers

const now = () => Math.floor(Date.now() / 1000);
const normName = (name: string) => normalize(name.trim().toLowerCase());

/** "Chrome on macOS": a rough, local-only label for this device (sealed before it's stored). */
function deviceLabel(): string {
  const ua = (globalThis.navigator?.userAgent ?? "").toLowerCase();
  if (!ua) return "Command line";
  const browser = ua.includes("edg/") ? "Edge" : ua.includes("firefox") ? "Firefox" : ua.includes("chrome") ? "Chrome" : ua.includes("safari") ? "Safari" : "Browser";
  const os = ua.includes("android") ? "Android" : ua.includes("iphone") || ua.includes("ipad") ? "iOS" : ua.includes("mac os") ? "macOS" : ua.includes("windows") ? "Windows" : ua.includes("linux") ? "Linux" : "";
  const ext = typeof (globalThis as { chrome?: { runtime?: { id?: string } } }).chrome?.runtime?.id === "string" && !globalThis.document ? " (extension)" : "";
  return `${browser}${os ? ` on ${os}` : ""}${ext}`;
}
const lower = (a: string) => a.toLowerCase();
const json = (v: unknown) => utf8(JSON.stringify(v));
const parse = <T>(b: Uint8Array | null): T | null => (b ? (JSON.parse(new TextDecoder().decode(b)) as T) : null);

function compressed(uncompressed: Hex): Hex {
  return bytesToHex(secp256k1.ProjectivePoint.fromHex(uncompressed.slice(2)).toRawBytes(true));
}

/** The registered owner name of a folder name: f-x.alice.cloakroom.eth → alice.cloakroom.eth. */
function ownerNameOf(ensName: string): string | null {
  const parts = ensName.split(".");
  if (parts.length < 3 || ensName.endsWith(".rooms.cloakroom.eth")) return null;
  return parts.slice(-3).join(".");
}

function kindOf(ensName: string): FolderKind {
  if (ensName.endsWith(".rooms.cloakroom.eth")) return "room";
  return ensName.startsWith("g-") ? "group" : "drive";
}

/** What a folder's sealed name carries, so members learn where it sits without scanning the chain. */
interface FolderInfo {
  d: string; // display name
  e: string; // ENS name
  p: Address | null; // parent folder registry (null at the top)
}

/** A key the user holds for one folder. */
interface Holding {
  folder: Address;
  /** K, K_room[n] or the stealth key S. */
  key: Hex;
  address: Address;
  /** Opens this holder's key copies: ownSealKey(key, folder), or MK_S for a share. */
  seal: Uint8Array;
  source: "own" | "room" | "share";
  ensName?: string;
}

interface StoredShare {
  folder: Address;
  sk: Hex;
  mk: Hex;
  seen: number;
}

interface FolderKeys {
  reading: FolderReading;
  /** Version → my key copy (an epoch key, or the folder secret for managers). */
  copies: Map<number, KeyCopy>;
  info: FolderInfo | null;
  displayName: string;
}

/** The key that opens epoch `epoch` of `version`, from my copies, or null if I can't compute it. */
function epochKeyFrom(copies: Map<number, KeyCopy>, version: number, epoch: number): Uint8Array | null {
  const copy = copies.get(version);
  if (!copy) return null;
  try {
    if (copy.kind === "secret") return deriveEpochKey(chainHead(copy.key), epoch);
    if (epoch > copy.index) return null;
    return deriveEpochKey({ index: copy.index, key: copy.key }, epoch);
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- the client

class Client implements CloakroomClient {
  private readonly receipts = new Receipts();
  private readonly clock: BlockClock;
  private keys: IdentityKeys | null = null;
  private ensName: string | null = null;
  private driveRoot: Address | null = null;
  private readonly holdings = new Map<string, Holding>();
  private readonly fileCache = new Map<string, { record: FileRecord & { createdAt: number }; meta: FileMeta | null }>();
  private readonly direct = new Set<string>();
  private apiInfo: ApiInfo | null = null;
  private childCache = new Map<string, { at: number; children: ChildName[] }>();
  private readonly keyMemory: KeyMemory;
  private readonly gsocKeys = new Map<string, GsocKey>();

  constructor(private readonly cfg: DriveConfig) {
    this.keyMemory = new KeyMemory(cfg.storage);
    for (const [k, v] of Object.entries({
      appOrigin: cfg.appOrigin,
      apiUrl: cfg.apiUrl,
      beeUrl: cfg.beeUrl,
      sepoliaRpcUrl: cfg.sepoliaRpcUrl,
      arkivRpcUrl: cfg.arkivRpcUrl,
    })) {
      if (!v) throw new DriveError("UNKNOWN", `DriveConfig.${k} is missing`);
    }
    this.clock = new BlockClock(this.arkiv());
  }

  // ------------------------------------------------------------ transports

  /** Route steps for receipts: one row per (network, route, isolation) per action, and a record of direct calls. */
  private routeSink(what: string, step?: StepSink) {
    const seen = new Set<string>();
    return (r: RouteStep) => {
      if (r.route === "direct") this.direct.add(`${what} (${r.label})`);
      if (!step) return;
      const id = `${r.route}:${r.isolationKey ?? ""}`;
      if (seen.has(id)) return;
      seen.add(id);
      step({ ...r, label: `${what}${r.isolationKey ? ", isolated" : ""}` });
    };
  }

  private sepolia(step?: StepSink, isolationKey?: string): SepoliaReader {
    return createPublicClient({
      chain: sepolia,
      transport: anonTransport({
        url: this.cfg.sepoliaRpcUrl,
        anon: this.cfg.anon,
        ...(isolationKey ? { isolationKey } : {}),
        onRoute: this.routeSink("Sepolia lookups", step),
      }),
    }) as SepoliaReader;
  }

  private sepoliaWriter(key: Hex, step?: StepSink, isolationKey?: string): SepoliaWriter {
    return {
      public: this.sepolia(step, isolationKey),
      wallet: createWalletClient({
        chain: sepolia,
        account: privateKeyToAccount(key),
        transport: anonTransport({
          url: this.cfg.sepoliaRpcUrl,
          anon: this.cfg.anon,
          ...(isolationKey ? { isolationKey } : {}),
          onRoute: this.routeSink("Sepolia transactions", step),
        }),
      }),
    };
  }

  private arkiv(step?: StepSink, isolationKey?: string): ArkivReader {
    return arkivReader({
      rpcUrl: this.cfg.arkivRpcUrl,
      accessKey: this.cfg.arkivAccessKey,
      anon: this.cfg.anon,
      ...(isolationKey ? { isolationKey } : {}),
      onRoute: this.routeSink("Arkiv lookups", step),
    });
  }

  private arkivWriter(key: Hex, step?: StepSink, isolationKey?: string): ArkivWriter {
    return arkivWriter(
      {
        rpcUrl: this.cfg.arkivRpcUrl,
        accessKey: this.cfg.arkivAccessKey,
        anon: this.cfg.anon,
        ...(isolationKey ? { isolationKey } : {}),
        onRoute: this.routeSink("Arkiv transactions", step),
      },
      key,
    );
  }

  private validator(step?: StepSink, isolationKey?: string) {
    return new Validator(registryHistory(this.sepolia(step, isolationKey)), this.clock);
  }

  private swarm(): SwarmConfig {
    return { apiUrl: this.cfg.apiUrl, beeUrl: this.cfg.beeUrl, anon: this.cfg.anon };
  }

  /** Calls our API: through the private network when it carries any HTTPS request, otherwise direct (and said so). */
  private async api<T>(path: string, body: unknown, step?: StepSink, method: "GET" | "POST" = "POST"): Promise<T> {
    const anon = this.cfg.anon;
    const routed = anon.supportsAnyHttps && isAnonymous(anon.status());
    const label = `Cloakroom API ${path}`;
    if (!routed) this.direct.add(label);
    step?.({ kind: "route", label, route: routed ? "anon" : "direct", network: anon.status().network });
    const doFetch = routed ? anon.fetch : globalThis.fetch.bind(globalThis);
    let res: Response;
    try {
      res = await doFetch(`${this.cfg.apiUrl.replace(/\/+$/, "")}${path}`, {
        method,
        headers: { "content-type": "application/json" },
        ...(method === "POST" ? { body: JSON.stringify(body) } : {}),
      });
    } catch (e) {
      throw new DriveError("NETWORK", `${label}: ${e instanceof Error ? e.message : String(e)}`);
    }
    const payload = (await res.json().catch(() => ({}))) as T & { error?: { code?: string; message?: string } };
    if (!res.ok) {
      const code = payload.error?.code as DriveError["code"] | undefined;
      throw new DriveError(code ?? (res.status === 429 ? "RATE_LIMITED" : "NETWORK"), payload.error?.message ?? `${label}: HTTP ${res.status}`);
    }
    return payload;
  }

  private async info(): Promise<ApiInfo> {
    return (this.apiInfo ??= await this.api<ApiInfo>("/config", undefined, undefined, "GET"));
  }

  // ------------------------------------------------------------ gas

  /**
   * Makes sure K or K_room can pay for the next transactions: asks the API for a drip (sent in batches) and waits
   * for it. Stealth members are never dripped; their sharer funded them.
   */
  private async ensureGas(h: Holding, need: { sepolia?: boolean; arkiv?: boolean }, step: StepSink) {
    const enough = async () => {
      const [eth, glm] = await Promise.all([
        need.sepolia ? this.sepolia(undefined, h.address).getBalance({ address: h.address }) : Promise.resolve(MIN_ETH),
        need.arkiv ? this.arkiv(undefined, h.address).getBalance({ address: h.address }) : Promise.resolve(MIN_TGLM),
      ]);
      return eth >= MIN_ETH && glm >= MIN_TGLM;
    };
    if (await enough()) return;
    if (h.source === "share") {
      throw new DriveError("UNKNOWN", "Your access here has no gas yet. The folder's owner tops it up when their app opens.");
    }
    const drip = await this.api<DripResponse>("/drip", { address: h.address, registry: h.folder }, step);
    step({ kind: "check", label: "Gas requested from the Cloakroom API", detail: `sent in a batch at ${new Date(drip.sendsAt * 1000).toLocaleTimeString()}`, ok: true });
    const deadline = Math.max(drip.sendsAt, now()) + 180;
    while (now() < deadline) {
      await new Promise((r) => setTimeout(r, 5000));
      if (await enough()) return;
    }
    throw new DriveError("RATE_LIMITED", "Gas from the Cloakroom API didn't arrive in time. Try again in a minute.");
  }

  // ------------------------------------------------------------ session

  signInMessage(address: Address): string {
    return buildSignInMessage(this.cfg.appOrigin, address);
  }

  private async children(registry: Address, fresh = false): Promise<ChildName[]> {
    const id = lower(registry);
    const hit = this.childCache.get(id);
    if (hit && !fresh && now() - hit.at < 30) return hit.children;
    const children = await listChildren(this.sepolia(), registry, {
      fromBlock: BigInt(cloakroom.driveRegistryImplBlock ?? 0),
    });
    this.childCache.set(id, { at: now(), children });
    return children;
  }

  /** The name a wallet (or a passkey/"Try it" drive key) claimed, found from cloakroom.eth's registrations. */
  private async nameOwnedBy(owner: Address): Promise<string | null> {
    const app = requireDeployed("appRegistry");
    const mine = (await this.children(app, true)).filter((c) => isAddressEqual(c.owner, owner) && c.registry);
    const last = mine.sort((a, b) => Number(b.blockNumber - a.blockNumber))[0];
    return last ? `${last.label}.cloakroom.eth` : null;
  }

  async needsSecondSignature(address: Address): Promise<boolean> {
    const name = await this.nameOwnedBy(getAddress(address));
    if (!name) return true;
    return (await getCloakKey(this.sepolia(), name)) === null;
  }

  private identity(): Identity {
    const k = this.requireKeys();
    return { ensName: this.ensName, wallet: k.wallet, driveKey: k.driveAddress, spendingPublicKey: k.spendingPublicKey };
  }

  private requireKeys(): IdentityKeys {
    if (!this.keys) throw new DriveError("NOT_SIGNED_IN");
    return this.keys;
  }

  private async loadName(keys: IdentityKeys) {
    const name = await this.nameOwnedBy(keys.wallet ?? keys.driveAddress);
    if (name) {
      assertMatchesPublished(keys, await getCloakKey(this.sepolia(), name));
      this.driveRoot = await findRegistry(this.sepolia(), name);
    }
    this.ensName = name;
    await this.cfg.storage.set(STORE.name, json(name));
  }

  async signIn(source: SignInSource): Promise<Identity> {
    return this.receipts.run("Sign in", async (step) => {
      const material = await keyMaterialFrom(source, {
        appOrigin: this.cfg.appOrigin,
        firstDevice: () => this.needsSecondSignature((source as { address: Address }).address),
        getCode: (a) => this.sepolia(step).getCode({ address: a }),
      });
      const keys = deriveKeys(material);
      await this.loadName(keys);
      this.keys = keys;
      this.holdings.clear();
      await this.cfg.storage.set(STORE.seed, encodeSeed(material));
      step({ kind: "check", label: "Keys made on this device", detail: this.ensName ? `matched to ${this.ensName}` : "no name claimed yet", ok: true });
      if (this.ensName) {
        await this.ensureOwnKeyLog(step).catch(() => undefined);
        await this.ensureDevice(step).catch(() => undefined);
      }
      return this.identity();
    });
  }

  async restore(): Promise<Identity | null> {
    const seed = await this.cfg.storage.get(STORE.seed);
    if (!seed) return null;
    const keys = deriveKeys(importSeed(seed));
    this.keys = keys;
    this.ensName = parse<string | null>(await this.cfg.storage.get(STORE.name));
    if (this.ensName) this.driveRoot = await findRegistry(this.sepolia(), this.ensName).catch(() => null);
    else await this.loadName(keys).catch(() => undefined);
    if (this.ensName) {
      // A device the user revoked from another device signs itself out here (a copy of the seed taken elsewhere is
      // not stopped by this; see the README).
      const device = await this.ensureDevice().catch(() => "unknown" as const);
      if (device === "revoked") {
        await this.signOut();
        return null;
      }
      void this.ensureOwnKeyLog().catch(() => undefined);
    }
    return this.identity();
  }

  async signOut(): Promise<void> {
    for (const k of Object.values(STORE)) await this.cfg.storage.delete(k);
    this.keys = null;
    this.ensName = null;
    this.driveRoot = null;
    this.holdings.clear();
    this.fileCache.clear();
  }

  async exportSeed(): Promise<Uint8Array> {
    return encodeSeed(this.requireKeys().material);
  }

  async isNameAvailable(label: string): Promise<boolean> {
    try {
      checkUserLabel(label);
    } catch {
      return false;
    }
    return isLabelAvailable(this.sepolia(), requireDeployed("appRegistry"), label);
  }

  async claimName(label: string): Promise<Identity> {
    const keys = this.requireKeys();
    return this.receipts.run(`Claim ${label}.cloakroom.eth`, async (step) => {
      checkUserLabel(label);
      const k = privateKeyToAccount(keys.driveKey);
      const request = await signClaim(k, {
        label,
        mainWallet: keys.wallet,
        spendingPublicKey: keys.spendingPublicKey,
        time: now(),
      });
      const claimed = await this.api<ClaimResponse>("/claim", request, step);
      await verifyClaim(this.sepolia(step), {
        ensName: claimed.ensName,
        resolver: claimed.resolver,
        driveRoot: claimed.driveRoot,
        api: claimed.api,
        spendingPublicKey: keys.spendingPublicKey,
      });
      step({ kind: "check", label: "The API kept no role, and cloak.key is your key", detail: claimed.ensName, ok: true });
      this.ensName = claimed.ensName;
      this.driveRoot = claimed.driveRoot;
      await this.cfg.storage.set(STORE.name, json(claimed.ensName));
      // Add-on F1: seq 0 of the name's public key log, and this device. Relayed by the API, so no gas is needed.
      try {
        await this.ensureOwnKeyLog(step);
      } catch (e) {
        step({ kind: "check", label: "Public key log not written yet", detail: `${toDriveError(e).message}; retried when the app next opens`, ok: false });
      }
      await this.ensureDevice(step).catch(() => undefined);
      // Gas for K, so it can make folders. Batched by the API; not waited for here.
      await this.api<DripResponse>("/drip", { address: k.address, registry: claimed.driveRoot }, step).catch(() => undefined);
      return this.identity();
    });
  }

  // ------------------------------------------------------------ holdings

  private ownHolding(folder: Address, ensName?: string): Holding {
    const keys = this.requireKeys();
    const h: Holding = {
      folder,
      key: keys.driveKey,
      address: keys.driveAddress,
      seal: ownSealKey(keys.driveKey, folder),
      source: "own",
      ...(ensName ? { ensName } : {}),
    };
    this.holdings.set(lower(folder), h);
    return h;
  }

  private roomHolding(folder: Address, n: number, ensName?: string): Holding {
    const key = roomKey(this.requireKeys(), n);
    const h: Holding = {
      folder,
      key,
      address: privateKeyToAccount(key).address,
      seal: ownSealKey(key, folder),
      source: "room",
      ...(ensName ? { ensName } : {}),
    };
    this.holdings.set(lower(folder), h);
    return h;
  }

  private async storedShares(): Promise<StoredShare[]> {
    return parse<StoredShare[]>(await this.cfg.storage.get(STORE.shares)) ?? [];
  }

  private shareHolding(s: StoredShare): Holding {
    const folder = getAddress(s.folder);
    const h: Holding = {
      folder,
      key: s.sk,
      address: privateKeyToAccount(s.sk).address,
      seal: hexToBytes(s.mk),
      source: "share",
    };
    this.holdings.set(lower(folder), h);
    return h;
  }

  /** The key the user holds for a folder: own drive, a room, or a share. */
  private async holding(folder: Address): Promise<Holding> {
    const hit = this.holdings.get(lower(folder));
    if (hit) return hit;
    for (const s of await this.storedShares()) if (isAddressEqual(s.folder, folder)) return this.shareHolding(s);
    // Owned folders and rooms: the registry's owner is K or one of the K_room keys.
    const owner = await driveOwner(this.sepolia(), folder);
    const keys = this.requireKeys();
    if (isAddressEqual(owner, keys.driveAddress)) return this.ownHolding(folder);
    const rooms = parse<number>(await this.cfg.storage.get(STORE.rooms)) ?? 0;
    for (let n = 0; n <= rooms + 2; n++) {
      if (isAddressEqual(owner, privateKeyToAccount(roomKey(keys, n)).address)) return this.roomHolding(folder, n);
    }
    throw new DriveError("NOT_AUTHORIZED", "You don't hold a key for this folder.");
  }

  // ------------------------------------------------------------ folder state

  private async readFolder(folder: Address, h: Holding, step?: StepSink): Promise<FolderKeys> {
    const reader = this.arkiv(step, h.address);
    const [rotations, refreshes, files, tombs, copies] = await Promise.all([
      listRotations(reader, folder),
      listRefreshes(reader, folder),
      arkivListFiles(reader, folder),
      listTombs(reader, folder),
      listKeyCopies(reader, folder, h.address),
    ]);
    const validator = this.validator(step, h.address);
    const reading = await validator.folder({
      folder,
      rotations: rotations.records,
      refreshes: refreshes.records,
      files: files.records,
      tombs: tombs.records,
      malformed: rotations.malformed + refreshes.malformed + files.malformed + tombs.malformed,
    });
    const checked = await validator.shareRecords(copies.records);
    const mine = new Map<number, KeyCopy>();
    for (const c of checked.valid) {
      try {
        mine.set(c.version, await openKeyCopy(h.seal, folder, c.version, c.sealed));
      } catch {
        // a copy for someone else's material, or tampered: ignore
      }
    }
    // The name: from the newest version whose epoch 0 I can open.
    let info: FolderInfo | null = null;
    let displayName = "";
    for (const v of [...reading.versions.keys()].sort((a, b) => b - a)) {
      const key = epochKeyFrom(mine, v, 0);
      if (!key) continue;
      try {
        const raw = await openFolderName(key, folder, v, reading.versions.get(v)!.name);
        try {
          const parsed = JSON.parse(raw) as FolderInfo;
          info = parsed;
          displayName = parsed.d;
        } catch {
          displayName = raw;
        }
        break;
      } catch {
        // try an older version
      }
    }
    return { reading, copies: mine, info, displayName };
  }

  private async toFolder(folder: Address, h: Holding, fk: FolderKeys, step?: StepSink): Promise<Folder> {
    const a = await accessOf(this.sepolia(step, h.address), folder, h.address);
    const role = roleOf(a.roles);
    const ensName = fk.info?.e ?? h.ensName ?? "";
    if (fk.info?.e) h.ensName = fk.info.e;
    return {
      registry: folder,
      ensName,
      displayName: fk.displayName || "Untitled",
      kind: ensName ? kindOf(ensName) : "drive",
      parent: fk.info?.p ?? null,
      inherit: false,
      myAccess:
        a.via === "owner"
          ? { role: "owner", until: null, via: "owner" }
          : role
            ? { role, until: a.until, via: (a.via ?? "direct") as AccessVia }
            : null,
      version: fk.reading.latestVersion,
      refreshPending: fk.reading.refreshOpen,
    };
  }

  async getFolder(folder: Address): Promise<Folder> {
    const f = getAddress(folder);
    const h = await this.holding(f);
    return this.toFolder(f, h, await this.readFolder(f, h));
  }

  /** Writes a folder version: a new secret, its rotation (with the sealed name), roster and every key copy. */
  private async writeVersion(
    h: Holding,
    p: { version: number; info: FolderInfo; roster: Roster; label: string },
    step: StepSink,
  ): Promise<Hex[]> {
    const t0 = now();
    const schedule: EpochSchedule = { t0, epochSeconds: epochSecondsFor(this.cfg.demoMode) };
    const fs = randomBytes(32);
    const head = chainHead(fs);
    const ops: CreateOp[] = [
      rotationOp({
        folder: h.folder,
        version: p.version,
        t0,
        epochLength: schedule.epochSeconds,
        name: await sealFolderName(deriveEpochKey(head, 0), h.folder, p.version, JSON.stringify(p.info)),
      }),
      rosterOp({ folder: h.folder, version: p.version, ...(await sealRoster(rosterKey(fs), h.folder, p.version, p.roster)) }),
      keyCopyOp({
        folder: h.folder,
        recipient: h.address,
        version: p.version,
        sealed: await sealKeyCopy(h.seal, h.folder, { kind: "secret", version: p.version, key: fs }),
        until: null,
      }),
    ];
    for (const m of [...p.roster.managers, ...p.roster.members]) {
      if (m.until !== null && m.until <= t0) continue;
      const copy: KeyCopy | null =
        m.role === "manager"
          ? { kind: "secret", version: p.version, key: fs }
          : (() => {
              const e = epochKeyFor(head, schedule, m.until);
              return e ? { kind: "epoch" as const, version: p.version, ...e } : null;
            })();
      if (!copy) continue;
      ops.push(
        keyCopyOp({ folder: h.folder, recipient: m.address, version: p.version, sealed: await sealKeyCopy(m.memberKey, h.folder, copy), until: m.until }),
      );
    }
    return (await writeEntities(this.arkivWriter(h.key, step, h.address), ops, p.label, step)).keys;
  }

  private async latestRoster(folder: Address, fk: FolderKeys, h: Holding): Promise<{ roster: Roster; version: number } | null> {
    const v = fk.reading.latestVersion;
    const copy = fk.copies.get(v);
    if (!copy || copy.kind !== "secret") return null;
    const rosters = await listRosters(this.arkiv(undefined, h.address), folder);
    const valid = (await this.validator(undefined, h.address).shareRecords(rosters.records)).valid
      .filter((r: RosterRecord) => r.version === v)
      .sort((a, b) => Number(b.createdAtBlock - a.createdAtBlock));
    for (const r of valid) {
      try {
        return { roster: await openRoster(rosterKey(copy.key), folder, v, r), version: v };
      } catch {
        // not openable: try the next
      }
    }
    return { roster: { managers: [], members: [] }, version: v };
  }

  // ------------------------------------------------------------ folders

  async listFolders(parent: Address | "root" | "rooms" | "groups"): Promise<Folder[]> {
    const keys = this.requireKeys();
    let found: { registry: Address; holding: Holding }[] = [];
    if (parent === "rooms") {
      const rooms = requireDeployed("roomsRegistry");
      const byOwner = new Map((await this.children(rooms)).filter((c) => c.registry).map((c) => [lower(c.owner), c]));
      for (let n = 0; ; n++) {
        const c = byOwner.get(lower(privateKeyToAccount(roomKey(keys, n)).address));
        if (!c) break;
        found.push({ registry: c.registry!, holding: this.roomHolding(c.registry!, n, `${c.label}.rooms.cloakroom.eth`) });
      }
      await this.cfg.storage.set(STORE.rooms, json(found.length));
    } else {
      const registry = parent === "root" || parent === "groups" ? this.driveRoot : getAddress(parent);
      if (!registry) return [];
      const prefix = parent === "groups" ? "g-" : "f-";
      const parentName = parent === "root" || parent === "groups" ? this.ensName : (await this.holding(registry)).ensName;
      for (const c of await this.children(registry)) {
        if (!c.registry || !c.label.startsWith(prefix)) continue;
        const name = parentName ? `${c.label}.${parentName}` : undefined;
        if (isAddressEqual(c.owner, keys.driveAddress)) found.push({ registry: c.registry, holding: this.ownHolding(c.registry, name) });
        else {
          const h = this.holdings.get(lower(c.registry));
          if (h) found.push({ registry: c.registry, holding: h });
        }
      }
    }
    const folders = await Promise.all(
      found.map(async ({ registry, holding }) => {
        try {
          return await this.toFolder(registry, holding, await this.readFolder(registry, holding));
        } catch {
          return null; // e.g. created but its first version isn't written yet
        }
      }),
    );
    return folders.filter((f): f is Folder => f !== null && f.version > 0);
  }

  async createFolder(parent: Address | "root", displayName: string, opts?: { inherit?: boolean }): Promise<Folder> {
    return this.makeFolder(parent, displayName, "f", opts);
  }

  async createGroup(displayName: string): Promise<Folder> {
    return this.makeFolder("root", displayName, "g");
  }

  private async makeFolder(parent: Address | "root", displayName: string, prefix: "f" | "g", opts?: { inherit?: boolean }) {
    const keys = this.requireKeys();
    if (!this.driveRoot || !this.ensName) throw new DriveError("NOT_SIGNED_IN", "Claim a name first.");
    if (opts?.inherit) throw new DriveError("UNKNOWN", "Folders that share their parent's access aren't available yet.");
    const parentRegistry = parent === "root" ? this.driveRoot : getAddress(parent);
    const parentName = parent === "root" ? this.ensName : (await this.holding(parentRegistry)).ensName;
    if (!parentName) throw new DriveError("NOT_FOUND", "Unknown parent folder.");
    return this.receipts.run(prefix === "g" ? `New group "${displayName}"` : `New folder "${displayName}"`, async (step) => {
      const k: Holding = { folder: parentRegistry, key: keys.driveKey, address: keys.driveAddress, seal: new Uint8Array(32), source: "own" };
      await this.ensureGas({ ...k, folder: this.driveRoot! }, { sepolia: true, arkiv: true }, step);
      const label = randomLabel(prefix);
      const { registry } = await ensCreateFolder(
        this.sepoliaWriter(keys.driveKey, step),
        { parent: parentRegistry, implementation: requireDeployed("driveRegistryImpl"), driveKey: keys.driveAddress, mainWallet: keys.wallet, label },
        step,
      );
      const ensName = `${label}.${parentName}`;
      const h = this.ownHolding(registry, ensName);
      await this.writeVersion(
        h,
        { version: 1, info: { d: displayName, e: ensName, p: parent === "root" ? null : parentRegistry }, roster: { managers: [], members: [] }, label: "Folder keys, version 1" },
        step,
      );
      this.childCache.delete(lower(parentRegistry));
      return this.toFolder(registry, h, await this.readFolder(registry, h, step), step);
    });
  }

  async createRoom(displayName: string): Promise<Folder> {
    const keys = this.requireKeys();
    return this.receipts.run(`New room "${displayName}"`, async (step) => {
      const existing = (await this.listFolders("rooms").catch(() => [])).length;
      const n = Math.max(existing, parse<number>(await this.cfg.storage.get(STORE.rooms)) ?? 0);
      const key = roomKey(keys, n);
      const address = privateKeyToAccount(key).address;
      const { roomPowDifficulty } = await this.info();
      const nonce = await solveRoomPow(address, roomPowDifficulty);
      step({ kind: "check", label: "Proof of work for a new room", detail: `${roomPowDifficulty} bits`, ok: true });
      const room = await this.api<RoomResponse>("/room", { roomKey: address, nonce }, step);
      await this.cfg.storage.set(STORE.rooms, json(n + 1));
      const h = this.roomHolding(getAddress(room.registry), n, room.ensName);
      await this.ensureGas(h, { arkiv: true }, step);
      await this.writeVersion(
        h,
        { version: 1, info: { d: displayName, e: room.ensName, p: null }, roster: { managers: [], members: [] }, label: "Room keys, version 1" },
        step,
      );
      this.childCache.delete(lower(requireDeployed("roomsRegistry")));
      return this.toFolder(h.folder, h, await this.readFolder(h.folder, h, step), step);
    });
  }

  // ------------------------------------------------------------ files

  private async uploaderLabel(folder: Address, h: Holding, creator: Address, roster: Roster | null): Promise<string> {
    if (isAddressEqual(creator, h.address)) return "you";
    const m = roster && [...roster.managers, ...roster.members].find((r) => isAddressEqual(r.address, creator));
    if (m?.label) return m.label;
    try {
      if (isAddressEqual(await driveOwner(this.sepolia(undefined, h.address), folder), creator)) {
        const owner = h.ensName ? ownerNameOf(h.ensName) : null;
        return owner ?? "the owner";
      }
    } catch {
      // fall through
    }
    return "private member";
  }

  private async entries(folder: Address, h: Holding, fk: FolderKeys): Promise<FileEntry[]> {
    const roster = (await this.latestRoster(folder, fk, h).catch(() => null))?.roster ?? null;
    const byFile = new Map<string, (FileRecord & { createdAt: number })[]>();
    for (const f of fk.reading.files) byFile.set(f.fileId, [...(byFile.get(f.fileId) ?? []), f]);
    const out: FileEntry[] = [];
    const labels = new Map<string, string>();
    for (const [, revisions] of byFile) {
      revisions.forEach((record, i) => (record as { revision?: number }).revision = i + 1);
      for (const record of revisions) {
        const key = epochKeyFrom(fk.copies, record.version, record.epoch);
        let meta: FileMeta | null = null;
        if (key) {
          try {
            meta = await openFileMeta(key, record, record.meta);
          } catch {
            meta = null;
          }
        }
        this.fileCache.set(lower(record.key), { record, meta });
        const c = lower(record.creator);
        if (!labels.has(c)) labels.set(c, await this.uploaderLabel(folder, h, record.creator, roster));
        out.push({
          fileId: record.fileId,
          folder,
          readable: meta !== null,
          name: meta?.name ?? null,
          mime: meta?.mime ?? null,
          size: meta?.size ?? null,
          version: (record as { revision?: number }).revision ?? 1,
          epoch: record.epoch,
          uploadedAt: record.createdAt,
          uploadedBy: { address: record.creator, label: labels.get(c)! },
          swarmRef: record.swarmRef,
          arkivKey: record.key,
        });
      }
    }
    return out;
  }

  async listFiles(folder: Address): Promise<FileEntry[]> {
    const f = getAddress(folder);
    const h = await this.holding(f);
    const all = await this.entries(f, h, await this.readFolder(f, h));
    const latest = new Map<string, FileEntry>();
    for (const e of all) if ((latest.get(e.fileId)?.version ?? 0) < e.version) latest.set(e.fileId, e);
    return [...latest.values()].sort((a, b) => b.uploadedAt - a.uploadedAt);
  }

  async listVersions(folder: Address, fileId: string): Promise<FileEntry[]> {
    const f = getAddress(folder);
    const h = await this.holding(f);
    return (await this.entries(f, h, await this.readFolder(f, h))).filter((e) => e.fileId === fileId).sort((a, b) => b.version - a.version);
  }

  async upload(folder: Address, file: Blob, name: string, onProgress?: (fraction: number) => void): Promise<FileEntry> {
    const f = getAddress(folder);
    if (file.size > MAX_FILE_BYTES) throw new DriveError("TOO_LARGE", "Files can be up to 25 MB.");
    return this.receipts.run(`Upload ${name}`, async (step) => {
      const h = await this.holding(f);
      onProgress?.(0.05);
      const fk = await this.readFolder(f, h, step);
      const v = fk.reading.latestVersion;
      const copy = fk.copies.get(v);
      const manager = copy?.kind === "secret";
      if (fk.reading.refreshOpen && !manager) throw new DriveError("REFRESH_PENDING");
      if (!copy) throw new DriveError(fk.reading.refreshOpen ? "REFRESH_PENDING" : "NOT_AUTHORIZED");
      const rotation = fk.reading.versions.get(v)!;
      const schedule = scheduleOf(rotation);
      if (isExhausted(schedule, now())) throw new DriveError("REFRESH_PENDING", "This folder's keys need refreshing.");
      const epoch = epochAt(schedule, now());
      const key = epochKeyFrom(fk.copies, v, epoch);
      if (!key) throw new DriveError("EXPIRED");
      step({ kind: "check", label: "Write rule", detail: `latest key version ${v}, epoch ${epoch}${fk.reading.refreshOpen ? ", refresh open (manager)" : ""}`, ok: true });
      await this.ensureGas(h, { arkiv: true }, step);

      // A file with the same name becomes a new version of it.
      const existing = (await this.entries(f, h, fk)).find((e) => e.readable && e.name === name);
      const fileId = existing?.fileId ?? newFileId();
      const fileKey = randomBytes(32);
      const plain = new Uint8Array(await file.arrayBuffer());
      const padded = await encryptPadded(fileKey, plain);
      onProgress?.(0.25);
      const swarmRef = await uploadEncrypted(this.swarm(), privateKeyToAccount(h.key), f, padded, step, h.address);
      onProgress?.(0.7);
      const meta: FileMeta = { name, mime: file.type || "application/octet-stream", size: plain.length, fileKey };
      const sealed = await sealFileMeta(key, { folder: f, fileId, version: v, epoch, swarmRef }, meta);
      const { keys } = await writeEntities(
        this.arkivWriter(h.key, step, h.address),
        [fileOp({ folder: f, fileId, version: v, epoch, swarmRef, meta: sealed })],
        "File entry",
        step,
      );
      if (keys[0]) await this.ring(h, fk, { type: "file", arkivKey: keys[0] }, step);
      onProgress?.(1);
      return {
        fileId,
        folder: f,
        readable: true,
        name,
        mime: meta.mime,
        size: meta.size,
        version: (existing?.version ?? 0) + 1,
        epoch,
        uploadedAt: now(),
        uploadedBy: { address: h.address, label: "you" },
        swarmRef,
        arkivKey: keys[0] ?? ("0x" as Hex),
      };
    });
  }

  private async cached(file: FileEntry) {
    let hit = this.fileCache.get(lower(file.arkivKey));
    if (!hit) {
      await this.listVersions(file.folder, file.fileId);
      hit = this.fileCache.get(lower(file.arkivKey));
    }
    if (!hit) throw new DriveError("NOT_FOUND");
    if (!hit.meta) throw new DriveError("EXPIRED", "This file was added after your access ended.");
    return hit as { record: FileRecord & { createdAt: number }; meta: FileMeta };
  }

  async download(file: FileEntry): Promise<Blob> {
    const { meta, record } = await this.cached(file);
    const h = await this.holding(getAddress(file.folder));
    const blob = await downloadEncrypted(this.swarm(), record.swarmRef, undefined, h.address);
    const plain = await decryptPadded(meta.fileKey, blob);
    return new Blob([new Uint8Array(plain)], { type: meta.mime });
  }

  async downloadFolder(folder: Address, onProgress?: (fraction: number) => void): Promise<Map<string, Blob>> {
    const f = getAddress(folder);
    const h = await this.holding(f);
    const files = await this.listFiles(f);
    // Fetch every file, readable or not, so the storage node can't tell which ones you can open.
    const blobs = await downloadFolderBlobs(this.swarm(), files.map((x) => x.swarmRef), onProgress, undefined, h.address);
    const out = new Map<string, Blob>();
    for (const x of files) {
      if (!x.readable) continue;
      const { meta, record } = await this.cached(x);
      const sealed = blobs.get(record.swarmRef.toLowerCase() as Hex) ?? blobs.get(record.swarmRef);
      if (!sealed) continue;
      let name = meta.name;
      for (let i = 1; out.has(name); i++) name = `${meta.name} (${i})`;
      out.set(name, new Blob([new Uint8Array(await decryptPadded(meta.fileKey, sealed))], { type: meta.mime }));
    }
    return out;
  }

  async deleteFile(file: FileEntry): Promise<void> {
    const f = getAddress(file.folder);
    await this.receipts.run(`Delete ${file.name ?? "file"}`, async (step) => {
      const h = await this.holding(f);
      await this.ensureGas(h, { arkiv: true }, step);
      await writeEntities(this.arkivWriter(h.key, step, h.address), [tombOp({ folder: f, fileId: file.fileId })], "Delete entry", step);
    });
  }

  // ------------------------------------------------------------ sharing

  async lookupRecipient(input: string): Promise<{ ensName: string; canReceive: boolean }> {
    const name = normName(input);
    const r = await this.readKeyLog(name).catch(() => null);
    const canReceive = !!r && !r.checked.problem && !!r.current && ensAgreement(r.current, r.cloakKey) !== "mismatch";
    return { ensName: name, canReceive };
  }

  // ------------------------------------------------------------ F1: public key directory (keydir.ts)

  /** A name's key log, checked: controller now, valid chain, ignored (forged) entries, and the cloak.key record. */
  private async readKeyLog(name: string, step?: StepSink, isolationKey?: string) {
    const sep = this.sepolia(step, isolationKey);
    const [controller, page, cloakKey] = await Promise.all([
      nameController(sep, name).catch(() => null),
      listKeyLog(this.arkiv(step, isolationKey), name),
      getCloakKey(sep, name).catch(() => null),
    ]);
    const checked = await checkKeyLog(page.records, controller);
    return { name, controller, checked, cloakKey, current: currentKey(checked.chain) };
  }

  async lookupKey(name: string): Promise<KeyInfo> {
    const r = await this.readKeyLog(normName(name));
    const times = await this.clock.timesOf(r.checked.chain.map((e) => e.createdAtBlock));
    const ensRecord = ensAgreement(r.current, r.cloakKey);
    return {
      ensName: r.name,
      current: r.current,
      fingerprint: r.current ? fingerprint(r.current) : [],
      history: r.checked.chain.map((e) => ({
        seq: e.seq,
        kind: e.kind as KeyInfo["history"][number]["kind"],
        spendingPublicKey: compressKey(e.spendingPublicKey),
        at: times.get(e.createdAtBlock) ?? 0,
        arkivKey: e.key,
      })),
      matchesEns: r.current !== null && ensRecord !== "mismatch",
      changedSinceLastShare: await this.keyMemory.changed(r.name, r.current),
      ensRecord,
      ignored: r.checked.ignored.map((e) => ({ arkivKey: e.key, creator: e.creator, seq: e.seq })),
      problem: r.checked.problem,
      controller: r.controller,
    };
  }

  async confirmKeyChange(name: string): Promise<void> {
    const r = await this.readKeyLog(normName(name));
    if (r.checked.problem) throw keyProblem(r.name, "broken", r.checked.problem);
    if (!r.current) throw keyProblem(r.name, "missing");
    if (ensAgreement(r.current, r.cloakKey) === "mismatch") throw keyProblem(r.name, "mismatch");
    await this.keyMemory.remember(r.name, r.current, now());
  }

  /** Rules 1–3 before any share: a valid chain, agreement with cloak.key, and no unconfirmed change. */
  private async requireTrustedKey(name: string, step?: StepSink, isolationKey?: string): Promise<Hex> {
    const r = await this.readKeyLog(name, step, isolationKey);
    if (r.checked.problem) throw keyProblem(r.name, "broken", r.checked.problem);
    if (!r.current) throw keyProblem(r.name, "missing");
    if (ensAgreement(r.current, r.cloakKey) === "mismatch") throw keyProblem(r.name, "mismatch");
    if (await this.keyMemory.changed(r.name, r.current)) {
      const last = r.checked.chain[r.checked.chain.length - 1];
      const at = last ? await this.clock.timeOf(last.createdAtBlock).catch(() => 0) : 0;
      throw keyProblem(r.name, "changed", at ? new Date(at * 1000).toLocaleDateString() : undefined);
    }
    step?.({ kind: "check", label: "Recipient's key matches its public log", detail: fingerprintText(r.current), ok: true });
    return r.current;
  }

  private async relayKeyLog(request: KeyLogRelayRequest, label: string, step?: StepSink): Promise<KeyLogRelayResponse> {
    const out = await this.api<KeyLogRelayResponse>("/keylog", request, step);
    step?.({ kind: "arkiv-tx", label, hash: out.txHash, explorerUrl: `${EXPLORERS.arkiv}/tx/${out.txHash}`, ok: true });
    return out;
  }

  /** Publishes (or rotates to) this identity's key on its own name's log, if the log doesn't already say so. */
  private async ensureOwnKeyLog(step?: StepSink): Promise<void> {
    const keys = this.requireKeys();
    if (!this.ensName) return;
    const r = await this.readKeyLog(this.ensName, step);
    if (r.checked.problem) {
      step?.({ kind: "check", label: "Your public key log is broken", detail: r.checked.problem, ok: false });
      return;
    }
    if (r.current && sameKey(r.current, keys.spendingPublicKey)) return;
    const entry = nextEntry(r.checked.chain, {
      ensName: this.ensName,
      kind: r.current ? "rotate" : "publish",
      spendingPublicKey: keys.spendingPublicKey,
    });
    const sig = await privateKeyToAccount(keys.driveKey).signTypedData(keyLogTypedData(entry));
    await this.relayKeyLog({ type: "entry", entry, sig }, `Public key log: seq ${entry.seq} (${entry.kind})`, step);
  }

  /** A random key per sign-in on this device, kept in local storage (deleted on sign out). */
  private async deviceKey(): Promise<Hex> {
    const stored = await this.cfg.storage.get(STORE.device);
    if (stored && stored.length === 32) return toHex(stored);
    const key = toPrivateKey(randomBytes(32));
    await this.cfg.storage.set(STORE.device, hexToBytes(key));
    return key;
  }

  private async devicePublic(): Promise<{ pub: Hex; id: string }> {
    const pub = compressKey(bytesToHex(secp256k1.getPublicKey(hexToBytes(await this.deviceKey()), true)));
    return { pub, id: deviceIdOf(pub) };
  }

  /** This device's entry in cloak.device: written when missing or close to expiring. "revoked" when the log says so. */
  private async ensureDevice(step?: StepSink): Promise<"ok" | "revoked"> {
    const keys = this.requireKeys();
    if (!this.ensName) return "ok";
    const { pub, id } = await this.devicePublic();
    const reader = this.arkiv(step);
    const [r, entries, head] = await Promise.all([
      this.readKeyLog(this.ensName, step),
      listDeviceEntries(reader, this.ensName),
      reader.getBlockNumber(),
    ]);
    const checks = await checkDevices(entries.records, r.controller, r.checked.chain, head);
    const mine = checks.find((c) => c.record.deviceId === id);
    if (mine?.why === "revoked") return "revoked";
    if (mine?.trusted && Number(mine.record.expiresAtBlock - head) * 2 > DEVICE_RENEW_SECONDS) return "ok";
    const label = bytesToHex(await sealDeviceLabel(keys.driveKey, id, deviceLabel()));
    const device = { ensName: this.ensName, deviceId: id, devicePublicKey: pub, label };
    const sig = await privateKeyToAccount(keys.driveKey).signTypedData(deviceTypedData(device));
    await this.relayKeyLog({ type: "device", device, sig }, "This device, in your public device list", step);
    return "ok";
  }

  async listDevices(): Promise<DeviceInfo[]> {
    const keys = this.requireKeys();
    if (!this.ensName) return [];
    const { id: mine } = await this.devicePublic();
    const reader = this.arkiv();
    const [r, entries, head] = await Promise.all([this.readKeyLog(this.ensName), listDeviceEntries(reader, this.ensName), reader.getBlockNumber()]);
    const checks = await checkDevices(entries.records, r.controller, r.checked.chain, head);
    const t = now();
    return Promise.all(
      checks.map(async (c) => ({
        deviceId: c.record.deviceId,
        label: await openDeviceLabel(keys.driveKey, c.record.deviceId, c.record.label),
        lastSeen: await this.clock.timeOf(c.record.createdAtBlock),
        expiresAt: t + Number(c.record.expiresAtBlock - head) * 2,
        thisDevice: c.record.deviceId === mine,
        trusted: c.trusted,
      })),
    ).then((list) => list.sort((a, b) => b.lastSeen - a.lastSeen));
  }

  async revokeDevice(deviceId: string): Promise<void> {
    const keys = this.requireKeys();
    if (!this.ensName) throw new DriveError("NOT_SIGNED_IN", "Claim a name first.");
    const name = this.ensName;
    await this.receipts.run("Revoke a device", async (step) => {
      const reader = this.arkiv(step);
      const [r, entries, head] = await Promise.all([this.readKeyLog(name, step), listDeviceEntries(reader, name), reader.getBlockNumber()]);
      if (r.checked.problem || !r.current) throw keyProblem(name, r.checked.problem ? "broken" : "missing", r.checked.problem ?? undefined);
      const target = (await checkDevices(entries.records, r.controller, r.checked.chain, head)).find((c) => c.record.deviceId === deviceId);
      if (!target) throw new DriveError("NOT_FOUND", "That device isn't in your list.");
      if (target.why === "revoked") return;
      const entry = nextEntry(r.checked.chain, {
        ensName: name,
        kind: "revoke-device",
        spendingPublicKey: r.current,
        devicePublicKey: target.record.devicePublicKey,
      });
      const sig = await privateKeyToAccount(keys.driveKey).signTypedData(keyLogTypedData(entry));
      await this.relayKeyLog({ type: "entry", entry, sig }, `Public key log: seq ${entry.seq} (revoke device)`, step);
    });
  }

  async linkName(name: string, signTypedData: SignTypedData): Promise<KeyInfo> {
    const keys = this.requireKeys();
    const n = normName(name);
    if (isCloakroomUserName(n)) throw new DriveError("NOT_AUTHORIZED", "Names under cloakroom.eth are linked when they're claimed.");
    await this.receipts.run(`Link ${n}`, async (step) => {
      const r = await this.readKeyLog(n, step);
      if (!r.controller) throw new DriveError("NOT_FOUND", `${n} isn't registered, or has expired.`);
      if (r.checked.problem) throw keyProblem(n, "broken", r.checked.problem);
      if (r.current && sameKey(r.current, keys.spendingPublicKey)) return;
      const entry = nextEntry(r.checked.chain, { ensName: n, kind: r.current ? "rotate" : "publish", spendingPublicKey: keys.spendingPublicKey });
      step({ kind: "check", label: "Sign with the wallet that owns the name", detail: r.controller, ok: true });
      const sig = await signTypedData(keyLogTypedData(entry) as unknown as Parameters<SignTypedData>[0]);
      await this.relayKeyLog({ type: "entry", entry, sig }, `Public key log for ${n}: seq ${entry.seq}`, step);
    });
    return this.lookupKey(n);
  }

  // ------------------------------------------------------------ sharing

  async share(folder: Address, recipient: string, opts: ShareOptions): Promise<Member> {
    const f = getAddress(folder);
    if (isAddress(recipient)) throw new DriveError("UNKNOWN", "Sharing with a group isn't available in this version yet.");
    if (opts.until !== null && opts.until <= now()) throw new DriveError("EXPIRED", "That end date has passed.");
    const name = normName(recipient);
    return this.receipts.run(`Share with ${name}`, async (step) => {
      const h = await this.holding(f);
      const fk = await this.readFolder(f, h, step);
      const current = await this.latestRoster(f, fk, h);
      if (!current) throw new DriveError("NOT_AUTHORIZED", "Only managers can share this folder.");
      const P = await this.requireTrustedKey(name, step, h.address);
      const { added, rosterKey } = await this.addMembers(f, h, fk, current, [{ name, key: P }], opts, step);
      await this.keyMemory.remember(name, P, now());
      if (rosterKey) await this.ring(h, fk, { type: "member", arkivKey: rosterKey }, step);
      const m = added[0]!;
      return { address: m.address, label: name, role: opts.role, until: opts.until, via: "direct", hiddenFromMembers: opts.hideFromMembers, needsGas: false };
    });
  }

  /**
   * Adds people to a folder: per person a fresh stealth address, the onchain grant, gas for writers, then welcome notes,
   * key copies and the new roster on Arkiv (at most OPS_PER_TX creates per transaction; the roster goes last).
   * `rosterEdit` changes the roster that gets written (e.g. adds a subtree rule).
   */
  private async addMembers(
    f: Address,
    h: Holding,
    fk: FolderKeys,
    current: { roster: Roster; version: number },
    people: { name: string; key: Hex; rule?: string; holder?: Address }[],
    opts: ShareOptions,
    step: StepSink,
    rosterEdit?: (r: Roster) => Roster,
  ): Promise<{ added: RosterMember[]; rosterKey: Hex | null }> {
    if (fk.reading.refreshOpen) throw new DriveError("REFRESH_PENDING");
    if (opts.until !== null && opts.until <= now()) throw new DriveError("EXPIRED", "That end date has passed.");
    const v = current.version;
    const rotation = fk.reading.versions.get(v)!;
    const fsCopy = fk.copies.get(v)!;
    const head = chainHead(fsCopy.key);
    const ops: CreateOp[] = [];
    const added: RosterMember[] = [];
    if (people.length) await this.ensureGas(h, { sepolia: true, arkiv: true }, step);
    for (const p of people) {
      const welcome = await createWelcome({ recipientSpendingPublicKey: p.key, folder: f });
      const S = welcome.stealthAddress;
      step({ kind: "check", label: `New private address for ${people.length > 1 ? p.name : "this member"}`, detail: S, ok: true });
      await grantRoleUntil(this.sepoliaWriter(h.key, step, h.address), f, S, opts.role, opts.until, step);
      if (opts.role !== "viewer") {
        await sendGlm(this.arkivWriter(h.key, step, h.address), S, MEMBER_TGLM, step, "Gas for the new member (tGLM, from this folder's key)");
      }
      if (opts.role === "manager") {
        const w = this.sepoliaWriter(h.key, step, h.address);
        const hash = await w.wallet.sendTransaction({ account: w.wallet.account, chain: sepolia, to: S, value: MANAGER_ETH });
        await w.public.waitForTransactionReceipt({ hash });
        step({ kind: "sepolia-tx", label: "Gas for the new manager (Sepolia ETH)", hash, explorerUrl: `${EXPLORERS.sepolia}/tx/${hash}`, ok: true });
      }
      added.push({
        address: S,
        memberKey: welcome.memberKey,
        role: opts.role,
        until: opts.until,
        hiddenFromMembers: opts.hideFromMembers,
        label: p.name,
        via: "direct",
        ...(p.rule ? { rule: p.rule } : {}),
        ...(p.holder ? { holder: p.holder } : {}),
        ...(p.rule ? { sharedKey: p.key } : {}),
      });
      const copy: KeyCopy | null =
        opts.role === "manager"
          ? { kind: "secret", version: v, key: fsCopy.key }
          : (() => {
              const e = epochKeyFor(head, scheduleOf(rotation), opts.until);
              return e ? { kind: "epoch" as const, version: v, ...e } : null;
            })();
      ops.push(
        welcomeOp({
          folder: f,
          bucket: weekBucket(now()),
          ephemeralPub: compressed(welcome.note.ephemeralPublicKey),
          sealedMemberKey: welcome.note.sealedMemberKey,
          until: opts.until,
        }),
      );
      if (copy) ops.push(keyCopyOp({ folder: f, recipient: S, version: v, sealed: await sealKeyCopy(welcome.memberKey, f, copy), until: opts.until }));
    }
    const managers = added.filter((m) => m.role === "manager");
    const members = added.filter((m) => m.role !== "manager");
    let roster: Roster = { ...current.roster, managers: [...current.roster.managers, ...managers], members: [...current.roster.members, ...members] };
    if (rosterEdit) roster = rosterEdit(roster);
    ops.push(rosterOp({ folder: f, version: v, ...(await sealRoster(rosterKey(fsCopy.key), f, v, roster)) }));
    let last: Hex[] = [];
    for (let i = 0; i < ops.length; i += OPS_PER_TX) {
      const chunk = ops.slice(i, i + OPS_PER_TX);
      const final = i + OPS_PER_TX >= ops.length;
      last = (
        await writeEntities(
          this.arkivWriter(h.key, step, h.address),
          chunk,
          people.length === 0 ? "Roster" : final ? "Welcome notes, key copies and roster" : "Welcome notes and key copies",
          step,
        )
      ).keys;
    }
    return { added, rosterKey: last[last.length - 1] ?? null };
  }

  /** Rewrites the roster of the current version (no new keys): for rule changes that remove nobody. */
  private async writeRoster(h: Holding, fk: FolderKeys, current: { roster: Roster; version: number }, roster: Roster, step: StepSink) {
    const fsCopy = fk.copies.get(current.version)!;
    await this.ensureGas(h, { arkiv: true }, step);
    await writeEntities(
      this.arkivWriter(h.key, step, h.address),
      [rosterOp({ folder: h.folder, version: current.version, ...(await sealRoster(rosterKey(fsCopy.key), h.folder, current.version, roster)) })],
      "Roster",
      step,
    );
  }

  async listMembers(folder: Address): Promise<(Member & { rule?: string })[]> {
    const f = getAddress(folder);
    const h = await this.holding(f);
    const fk = await this.readFolder(f, h);
    const current = await this.latestRoster(f, fk, h);
    const reader = this.arkiv(undefined, h.address);
    if (current) {
      const people = [...current.roster.managers, ...current.roster.members];
      return Promise.all(
        people.map(async (m) => ({
          address: m.address,
          label: m.label ?? "private member",
          role: m.role,
          until: m.until,
          via: m.via,
          hiddenFromMembers: m.hiddenFromMembers,
          needsGas: m.role !== "viewer" && (m.until === null || m.until > now()) && (await reader.getBalance({ address: m.address })) < LOW_TGLM,
          ...(m.rule ? { rule: m.rule } : {}),
        })),
      );
    }
    // Not a manager: everyone who holds a role now, from the registry's own events. Names stay private.
    const owner = await driveOwner(this.sepolia(undefined, h.address), f);
    return (await this.holders(f, h.address))
      .filter((x) => !isAddressEqual(x.address, owner))
      .map((x) => ({
        address: x.address,
        label: isAddressEqual(x.address, h.address) ? "you" : "private member",
        role: roleOf(x.roles) ?? "viewer",
        until: x.until,
        via: "direct" as const,
        hiddenFromMembers: true,
        needsGas: false,
      }));
  }

  /** Every account holding a drive role in `folder` now, from AccessGranted events and the live accessOf. */
  private async holders(folder: Address, isolationKey?: string, step?: StepSink) {
    const client = this.sepolia(step, isolationKey);
    const event = driveRegistryAbi.find((e) => e.type === "event" && e.name === "AccessGranted");
    if (!event || event.type !== "event") throw new Error("AccessGranted missing from the ABI");
    const logs = await client.getLogs({ address: folder, event, fromBlock: BigInt(cloakroom.driveRegistryImplBlock ?? 0) });
    const accounts = [...new Set(parseEventLogs({ abi: driveRegistryAbi, eventName: "AccessGranted", logs }).map((l) => getAddress(l.args.account)))];
    const out: { address: Address; roles: bigint; until: Timestamp | null }[] = [];
    for (const address of accounts) {
      const a = await accessOf(client, folder, address);
      if (a.roles !== 0n) out.push({ address, roles: a.roles, until: a.until });
    }
    return out;
  }

  /** A new version for everyone left in the roster: what removal and an open refresh request both need. */
  private async refresh(f: Address, h: Holding, fk: FolderKeys, roster: Roster, step: StepSink) {
    const info: FolderInfo = fk.info ?? { d: fk.displayName, e: h.ensName ?? "", p: null };
    const keys = await this.writeVersion(h, { version: fk.reading.latestVersion + 1, info, roster, label: `Refresh keys: version ${fk.reading.latestVersion + 1}` }, step);
    // Rung on the OLD topic: that's the one current members are listening to.
    if (keys[0]) await this.ring(h, fk, { type: "rotation", arkivKey: keys[0] }, step);
  }

  /** Revokes each address onchain, then ONE new key version for everyone left (with `rosterEdit` applied). */
  private async removeMembers(
    f: Address,
    h: Holding,
    fk: FolderKeys,
    current: { roster: Roster; version: number },
    addresses: Address[],
    step: StepSink,
    rosterEdit?: (r: Roster) => Roster,
  ) {
    await this.ensureGas(h, { sepolia: true, arkiv: true }, step);
    for (const a of addresses) {
      const access = await accessOf(this.sepolia(step, h.address), f, a);
      if (access.roles !== 0n) await revokeAccess(this.sepoliaWriter(h.key, step, h.address), f, a, step);
    }
    const gone = new Set(addresses.map(lower));
    const keep = (m: RosterMember) => !gone.has(lower(m.address));
    let roster: Roster = { ...current.roster, managers: current.roster.managers.filter(keep), members: current.roster.members.filter(keep) };
    if (rosterEdit) roster = rosterEdit(roster);
    await this.refresh(f, h, fk, roster, step);
  }

  async removeMember(folder: Address, member: Address): Promise<void> {
    const f = getAddress(folder);
    await this.receipts.run("Remove a member", async (step) => {
      const h = await this.holding(f);
      const fk = await this.readFolder(f, h, step);
      const current = await this.latestRoster(f, fk, h);
      if (!current) throw new DriveError("NOT_AUTHORIZED", "Only managers can remove people.");
      await this.removeMembers(f, h, fk, current, [getAddress(member)], step);
    });
  }

  // ------------------------------------------------------------ F2: private ENS subtree sharing (subtree.ts)

  /** A name's usable key for a subtree share, or why not. Never throws. */
  private async keyForName(name: string, isolationKey?: string): Promise<{ key: Hex | null; why?: string }> {
    const r = await this.readKeyLog(name, undefined, isolationKey);
    if (r.checked.problem) return { key: null, why: "its public key log is broken" };
    if (!r.current) return { key: null, why: "no Cloakroom key yet" };
    if (ensAgreement(r.current, r.cloakKey) === "mismatch") return { key: null, why: "its key doesn't match its cloak.key record" };
    return { key: r.current };
  }

  private holdersOf(parent: string, isolationKey?: string, step?: StepSink): Promise<SubtreeHolder[]> {
    return listSubtreeHolders(this.sepolia(step, isolationKey), parent, (n) => this.keyForName(n, isolationKey));
  }

  async previewSubtree(parentEnsName: string): Promise<SubtreePreview> {
    const parent = normName(parentEnsName);
    const holders = await this.holdersOf(parent);
    return {
      parent,
      ready: holders.filter((x) => x.key).map((x) => x.name),
      noKey: holders.filter((x) => !x.key).map((x) => ({ name: x.name, why: x.why ?? "no Cloakroom key yet" })),
    };
  }

  private async syncedAt(folder: Address): Promise<Record<string, number>> {
    const all = parse<Record<string, Record<string, number>>>(await this.cfg.storage.get(STORE.synced)) ?? {};
    return all[lower(folder)] ?? {};
  }

  private async markSynced(folder: Address, parents: string[]) {
    const all = parse<Record<string, Record<string, number>>>(await this.cfg.storage.get(STORE.synced)) ?? {};
    const mine = (all[lower(folder)] ??= {});
    for (const p of parents) mine[p] = now();
    await this.cfg.storage.set(STORE.synced, json(all));
  }

  private toRule(rule: SubtreeRuleData, roster: Roster, synced: Record<string, number>): SubtreeRule {
    return {
      parent: rule.parent,
      role: rule.role,
      until: rule.until,
      excluded: rule.excluded,
      memberCount: [...roster.managers, ...roster.members].filter((m) => m.rule === rule.parent).length,
      lastSyncedAt: Math.max(synced[rule.parent] ?? 0, rule.syncedAt),
    };
  }

  private async managed(f: Address, step?: StepSink) {
    const h = await this.holding(f);
    const fk = await this.readFolder(f, h, step);
    const current = await this.latestRoster(f, fk, h);
    if (!current) throw new DriveError("NOT_AUTHORIZED", "Only managers can change who has access.");
    return { h, fk, current };
  }

  async shareWithSubtree(folder: Address, parentEnsName: string, opts: ShareOptions): Promise<SubtreeRule> {
    const f = getAddress(folder);
    const parent = normName(parentEnsName);
    return this.receipts.run(`Share with everyone at ${parent}`, async (step) => {
      const { h, fk, current } = await this.managed(f, step);
      if (current.roster.subtrees?.some((r) => r.parent === parent)) throw new DriveError("UNKNOWN", `This folder is already shared with ${parent}.`);
      const holders = await this.holdersOf(parent, h.address, step);
      const ready = holders.filter((x) => x.key);
      step({ kind: "check", label: `Names under ${parent}`, detail: `${ready.length} found with a Cloakroom key, ${holders.length - ready.length} without`, ok: true });
      const rule: SubtreeRuleData = { parent, role: opts.role, until: opts.until, excluded: [], hideFromMembers: opts.hideFromMembers, syncedAt: now() };
      const everyone = [...current.roster.managers, ...current.roster.members];
      const plan = planSync(rule, everyone, holders);
      if (overCap(everyone, plan.remove, plan.add.length)) {
        throw new DriveError("RATE_LIMITED", `That would give more than 14 people access to one folder. Use several rooms, or split the team.`);
      }
      const { added } = await this.addMembers(
        f,
        h,
        fk,
        current,
        plan.add.map((x) => ({ name: x.name, key: x.key!, rule: parent, holder: x.controller })),
        opts,
        step,
        (r) => ({ ...r, subtrees: [...(r.subtrees ?? []), rule] }),
      );
      for (const x of plan.add) await this.keyMemory.remember(x.name, x.key!, now());
      await this.markSynced(f, [parent]);
      step({ kind: "check", label: "What the chain sees", detail: `${added.length} random addresses; nothing links them to ${parent}`, ok: true });
      return { parent, role: rule.role, until: rule.until, excluded: [], memberCount: added.length, lastSyncedAt: now() };
    });
  }

  async listSubtreeRules(folder: Address): Promise<SubtreeRule[]> {
    const f = getAddress(folder);
    const h = await this.holding(f);
    const fk = await this.readFolder(f, h);
    const current = await this.latestRoster(f, fk, h);
    if (!current) return [];
    const synced = await this.syncedAt(f);
    return (current.roster.subtrees ?? []).map((r) => this.toRule(r, current.roster, synced));
  }

  /**
   * One sync of every subtree rule on a folder: removals first (revoke, then one key refresh, so a removed holder can't
   * read anything written afterwards), then new holders as ordinary stealth shares. Returns whether it changed anything.
   */
  private async syncFolder(f: Address, step: StepSink | null): Promise<boolean> {
    const { h, fk, current } = await this.managed(f, step ?? undefined);
    const rules = current.roster.subtrees ?? [];
    if (!rules.length) return false;
    const everyone = [...current.roster.managers, ...current.roster.members];
    const remove: RosterMember[] = [];
    const add: { rule: SubtreeRuleData; holders: SubtreeHolder[] }[] = [];
    for (const rule of rules) {
      const plan = planSync(rule, everyone, await this.holdersOf(rule.parent, h.address));
      remove.push(...plan.remove);
      if (plan.add.length) add.push({ rule, holders: plan.add });
    }
    let room = 0;
    {
      const removed = new Set(remove.map((m) => lower(m.address)));
      const staying = everyone.filter((m) => (m.until === null || m.until > now()) && !removed.has(lower(m.address))).length;
      room = Math.max(0, 14 - staying);
    }
    await this.markSynced(f, rules.map((r) => r.parent));
    if (!remove.length && !add.length) return false;
    const run = step ? null : this.receipts.start("Team sync");
    const sink = step ?? run!.step;
    try {
      if (remove.length) {
        sink({ kind: "check", label: "Names gone, excluded or transferred", detail: `${remove.length} to remove`, ok: true });
        await this.removeMembers(f, h, fk, current, remove.map((m) => m.address), sink);
      }
      if (add.length) {
        let state = remove.length ? await this.managed(f, sink) : { h, fk, current };
        for (const { rule, holders } of add) {
          const fit = holders.slice(0, room);
          room -= fit.length;
          if (fit.length < holders.length) {
            sink({ kind: "check", label: `Over the 14-person limit for ${rule.parent}`, detail: `${holders.length - fit.length} not added`, ok: false });
          }
          if (!fit.length) continue;
          await this.addMembers(
            f,
            state.h,
            state.fk,
            state.current,
            fit.map((x) => ({ name: x.name, key: x.key!, rule: rule.parent, holder: x.controller })),
            { role: rule.role, until: rule.until, hideFromMembers: rule.hideFromMembers },
            sink,
          );
          for (const x of fit) await this.keyMemory.remember(x.name, x.key!, now());
          state = await this.managed(f, sink);
        }
      }
      run?.finish();
      return true;
    } catch (e) {
      run?.finish(e);
      throw e;
    }
  }

  async syncSubtrees(folder: Address): Promise<void> {
    const f = getAddress(folder);
    await this.receipts.run("Team sync", async (step) => {
      const changed = await this.syncFolder(f, step);
      if (!changed) step({ kind: "check", label: "Team sync", detail: "everyone is up to date", ok: true });
    });
  }

  async excludeFromSubtree(folder: Address, parentEnsName: string, memberEnsName: string): Promise<void> {
    const f = getAddress(folder);
    const parent = normName(parentEnsName);
    const member = normName(memberEnsName);
    await this.receipts.run(`Exclude ${member}`, async (step) => {
      const { h, fk, current } = await this.managed(f, step);
      if (!current.roster.subtrees?.some((r) => r.parent === parent)) throw new DriveError("NOT_FOUND", `This folder isn't shared with ${parent}.`);
      const edit = (r: Roster): Roster => ({
        ...r,
        subtrees: (r.subtrees ?? []).map((x) => (x.parent === parent && !x.excluded.includes(member) ? { ...x, excluded: [...x.excluded, member] } : x)),
      });
      const gone = [...current.roster.managers, ...current.roster.members].filter((m) => m.rule === parent && m.label === member);
      if (gone.length) await this.removeMembers(f, h, fk, current, gone.map((m) => m.address), step, edit);
      else await this.writeRoster(h, fk, current, edit(current.roster), step);
    });
  }

  async removeSubtreeRule(folder: Address, parentEnsName: string): Promise<void> {
    const f = getAddress(folder);
    const parent = normName(parentEnsName);
    await this.receipts.run(`Stop sharing with ${parent}`, async (step) => {
      const { h, fk, current } = await this.managed(f, step);
      const edit = (r: Roster): Roster => ({ ...r, subtrees: (r.subtrees ?? []).filter((x) => x.parent !== parent) });
      const gone = [...current.roster.managers, ...current.roster.members].filter((m) => m.rule === parent);
      if (gone.length) await this.removeMembers(f, h, fk, current, gone.map((m) => m.address), step, edit);
      else await this.writeRoster(h, fk, current, edit(current.roster), step);
    });
  }

  // ------------------------------------------------------------ F4: live updates (doorbell.ts)

  private async doorbellConfig(): Promise<DoorbellConfig | null> {
    try {
      return (await this.info()).doorbell ?? null;
    } catch {
      return null;
    }
  }

  private gsocFor(folder: Address, epochKey: Uint8Array, config: DoorbellConfig): { topic: Uint8Array; key: GsocKey } {
    const topic = doorbellTopic(epochKey, folder);
    const id = `${toHex(topic)}/${config.overlay}/${config.proximity}`;
    let key = this.gsocKeys.get(id);
    if (!key) {
      key = mineGsocKey(topic, config);
      this.gsocKeys.set(id, key);
    }
    return { topic, key };
  }

  /** Rings the folder's doorbell for the current epoch. Best effort: Arkiv stays the source of truth. */
  private async ring(h: Holding, fk: FolderKeys, event: DoorbellEvent, step?: StepSink): Promise<void> {
    try {
      const config = await this.doorbellConfig();
      if (!config) return;
      const v = fk.reading.latestVersion;
      const rotation = fk.reading.versions.get(v);
      if (!rotation) return;
      const key = epochKeyFrom(fk.copies, v, epochAt(scheduleOf(rotation), now()));
      if (!key) return;
      const { topic, key: g } = this.gsocFor(h.folder, key, config);
      const ring = await signRing(g, await sealDoorbell(topic, g.address, event));
      await this.api("/doorbell", ring, step);
    } catch (e) {
      step?.({ kind: "check", label: "Live update not sent", detail: `members see it on their next refresh (${toDriveError(e).message})`, ok: false });
    }
  }

  subscribe(folders: Address[], listener: (e: LiveEvent) => void, onStatus?: (s: LiveStatus) => void): () => void {
    let stopped = false;
    const stops: (() => void)[] = [];
    const wsBase = this.cfg.apiUrl.replace(/\/+$/, "").replace(/^http/, "ws");

    const watch = async (f: Address) => {
      let known: Set<string> | null = null;
      let refreshWasOpen = false;
      let pollTimer: ReturnType<typeof setInterval> | null = null;
      let epochTimer: ReturnType<typeof setTimeout> | null = null;
      let retryTimer: ReturnType<typeof setTimeout> | null = null;
      let sockets: WebSocket[] = [];

      const snapshot = async () => {
        const h = await this.holding(f);
        const fk = await this.readFolder(f, h);
        const keys = new Set<string>([...fk.reading.files.map((x) => lower(x.key)), ...[...fk.reading.versions.values()].map((r) => lower(r.key))]);
        return { h, fk, keys };
      };
      const emit = (type: LiveEvent["type"], arkivKey: Hex) => listener({ folder: f, type, arkivKey, receivedAt: now() });

      /** Re-reads the folder and reports what's new. With `expect`, only an event the validator accepted is reported. */
      const check = async (expect?: DoorbellEvent) => {
        const s = await snapshot();
        if (expect) {
          let valid = s.keys.has(lower(expect.arkivKey)) || (expect.type === "refresh" && s.fk.reading.refreshOpen);
          if (!valid && expect.type === "member") {
            const rosters = await listRosters(this.arkiv(undefined, s.h.address), f);
            valid = (await this.validator(undefined, s.h.address).shareRecords(rosters.records)).valid.some((r) => lower(r.key) === lower(expect.arkivKey));
          }
          if (valid) emit(expect.type, expect.arkivKey);
        } else if (known) {
          for (const x of s.fk.reading.files) if (!known.has(lower(x.key))) emit("file", x.key);
          for (const r of s.fk.reading.versions.values()) if (!known.has(lower(r.key))) emit("rotation", r.key);
          if (s.fk.reading.refreshOpen && !refreshWasOpen) emit("refresh", "0x0000000000000000000000000000000000000000000000000000000000000000");
        }
        known = s.keys;
        refreshWasOpen = s.fk.reading.refreshOpen;
        return s;
      };

      const closeSockets = () => {
        const old = sockets;
        sockets = [];
        for (const ws of old) {
          ws.onclose = null;
          ws.onerror = null;
          ws.close();
        }
      };

      const startPolling = (detail: string) => {
        closeSockets();
        if (stopped || pollTimer) return;
        onStatus?.({ folder: f, mode: "polling", detail });
        pollTimer = setInterval(() => void check().catch(() => undefined), POLL_SECONDS * 1000);
      };

      const goLive = async () => {
        if (stopped) return;
        if (epochTimer) clearTimeout(epochTimer);
        epochTimer = null;
        closeSockets();
        const s = await check();
        const config = await this.doorbellConfig();
        if (!config) return startPolling("live updates are off on this server");
        if (typeof WebSocket === "undefined") return startPolling("this runtime has no WebSocket");
        const v = s.fk.reading.latestVersion;
        const rotation = s.fk.reading.versions.get(v);
        if (!rotation) return startPolling("no keys yet");
        const schedule = scheduleOf(rotation);
        const e = epochAt(schedule, now());
        const topics = [e, e + 1]
          .map((i) => epochKeyFrom(s.fk.copies, v, i))
          .filter((k): k is Uint8Array => k !== null)
          .map((k) => this.gsocFor(f, k, config));
        if (!topics.length) return startPolling("your access has ended");
        this.direct.add("Swarm doorbell subscription (WebSocket to the Cloakroom API)");
        let failed = false;
        for (const { topic, key } of topics) {
          const ws = new WebSocket(`${wsBase}/doorbell/subscribe/${key.address.slice(2)}`);
          ws.binaryType = "arraybuffer";
          ws.onmessage = (m) => {
            const data = m.data instanceof ArrayBuffer ? new Uint8Array(m.data) : typeof m.data === "string" ? hexToBytes(m.data as Hex) : null;
            if (!data) return;
            void openDoorbell(topic, key.address, data).then((event) => (event ? check(event) : undefined)).catch(() => undefined);
          };
          ws.onerror = ws.onclose = () => {
            if (stopped || failed) return;
            failed = true;
            startPolling("the live connection dropped");
            retryTimer = setTimeout(() => {
              if (pollTimer) clearInterval(pollTimer);
              pollTimer = null;
              void goLive().catch(() => startPolling("couldn't reconnect"));
            }, 60_000);
          };
          sockets.push(ws);
        }
        if (pollTimer) clearInterval(pollTimer);
        pollTimer = null;
        onStatus?.({ folder: f, mode: "live" });
        // New topic at the next epoch boundary.
        epochTimer = setTimeout(() => void goLive().catch(() => startPolling("couldn't move to the next epoch")), Math.max(1, epochEnd(schedule, e) - now() + 1) * 1000);
      };

      stops.push(() => {
        closeSockets();
        if (pollTimer) clearInterval(pollTimer);
        if (epochTimer) clearTimeout(epochTimer);
        if (retryTimer) clearTimeout(retryTimer);
      });
      try {
        await goLive();
      } catch (e) {
        startPolling(toDriveError(e).message);
      }
    };

    for (const folder of folders) void watch(getAddress(folder));
    return () => {
      stopped = true;
      for (const stop of stops) stop();
    };
  }

  async sharedWithMe(opts?: { since?: Timestamp }): Promise<IncomingShare[]> {
    const keys = this.requireKeys();
    const t = now();
    const from = weekBucket(opts?.since ?? t - WELCOME_WEEKS * 7 * 86_400);
    const buckets = Array.from({ length: Math.min(weekBucket(t) - from + 1, 26) }, (_, i) => weekBucket(t) - i);
    const welcomes = await listWelcomes(this.arkiv(), buckets);
    const valid = (await this.validator().shareRecords(welcomes.records)).valid;
    const stored = await this.storedShares();
    const known = new Set(stored.map((s) => lower(s.folder)));
    for (const w of valid) {
      if (known.has(lower(w.folder))) continue;
      const opened = await openWelcome({
        spendingPrivateKey: keys.spendingPrivateKey,
        folder: w.folder,
        note: { ephemeralPublicKey: w.ephemeralPub, sealedMemberKey: w.sealedMemberKey },
      });
      if (!opened) continue;
      stored.push({ folder: w.folder, sk: opened.stealthPrivateKey, mk: toHex(opened.memberKey), seen: w.createdAt });
      known.add(lower(w.folder));
    }
    await this.cfg.storage.set(STORE.shares, json(stored));
    const since = opts?.since ?? 0;
    const shares = await Promise.all(
      stored
        .filter((s) => s.seen >= since)
        .map(async (s): Promise<IncomingShare | null> => {
          try {
            const h = this.shareHolding(s);
            const folder = await this.toFolder(h.folder, h, await this.readFolder(h.folder, h));
            const access = await accessOf(this.sepolia(undefined, h.address), h.folder, h.address);
            const history = access.roles ? null : await this.sepolia(undefined, h.address).readContract({
              address: h.folder,
              abi: driveRegistryAbi,
              functionName: "historyOf",
              args: [h.address],
            });
            const last = history?.[history.length - 1];
            const role: Role = roleOf(access.roles) ?? (last ? roleOf(last.roles) : null) ?? "viewer";
            const until = access.roles ? access.until : last ? (last.endedAt ? Number(last.endedAt) : Number(last.until)) : null;
            return {
              folder,
              sharedBy: folder.kind === "room" ? "unlinked room" : (ownerNameOf(folder.ensName) ?? "a Cloakroom user"),
              role,
              until,
              firstSeenAt: s.seen,
            };
          } catch {
            return null;
          }
        }),
    );
    return shares.filter((s): s is IncomingShare => s !== null).sort((a, b) => b.firstSeenAt - a.firstSeenAt);
  }

  async maintain(): Promise<Receipt[]> {
    const done: Receipt[] = [];
    const managed = [...(await this.listFolders("root").catch(() => [])), ...(await this.listFolders("rooms").catch(() => []))];
    for (const folder of managed) {
      const h = await this.holding(folder.registry);
      const fk = await this.readFolder(folder.registry, h);
      const current = await this.latestRoster(folder.registry, fk, h);
      if (!current) continue;
      const reader = this.arkiv(undefined, h.address);
      const low: RosterMember[] = [];
      for (const m of [...current.roster.managers, ...current.roster.members]) {
        if (m.role === "viewer" || (m.until !== null && m.until <= now())) continue;
        if ((await reader.getBalance({ address: m.address })) < LOW_TGLM) low.push(m);
      }
      // Add-on F2: subtree rules turn into shares and removals here (on open in the web app, every 15 minutes in the
      // extension).
      if (current.roster.subtrees?.length) {
        try {
          await this.syncFolder(folder.registry, null);
        } catch (e) {
          const run = this.receipts.start(`Team sync: ${folder.displayName}`);
          done.push(run.finish(toDriveError(e)));
        }
      }
      if (!fk.reading.refreshOpen && low.length === 0) continue;
      const run = this.receipts.start(`Housekeeping: ${folder.displayName}`);
      try {
        await this.ensureGas(h, { arkiv: true }, run.step);
        for (const m of low) await sendGlm(this.arkivWriter(h.key, run.step, h.address), m.address, MEMBER_TGLM, run.step, `Top up ${m.label ?? "a member"}`);
        if (fk.reading.refreshOpen) await this.refresh(folder.registry, h, fk, current.roster, run.step);
        done.push(run.finish());
      } catch (e) {
        done.push(run.finish(toDriveError(e)));
      }
    }
    return done;
  }

  // ------------------------------------------------------------ links and mounts

  async createLink(file: FileEntry, expiresAt: Timestamp): Promise<ShareLink> {
    const f = getAddress(file.folder);
    return this.receipts.run(`Link to ${file.name ?? "file"}`, async (step) => {
      const h = await this.holding(f);
      if (h.source === "share") throw new DriveError("NOT_AUTHORIZED", "Only the folder's owner can make links.");
      const { meta, record } = await this.cached(file);
      const folderName = h.ensName ?? (await this.getFolder(f)).ensName;
      await this.ensureGas(h, { sepolia: true, arkiv: true }, step);
      const { label } = await createLinkName(this.sepoliaWriter(h.key, step, h.address), { folder: f, owner: h.address, expiresAt }, step);
      const ensName = `${label}.${folderName}`;
      const node = nameNode(ensName);
      const secret = randomBytes(32);
      const bundle = await sealLinkBundle(secret, node, { ...meta, folder: f, fileId: record.fileId, swarmRef: record.swarmRef });
      await writeEntities(this.arkivWriter(h.key, step, h.address), [linkOp({ link: node, folder: f, bundle, expiresAt })], "Link entry", step);
      const url = `${this.cfg.appOrigin.replace(/\/+$/, "")}/l/?n=${encodeURIComponent(ensName)}#${toHex(secret).slice(2)}`;
      return { url, ensName, expiresAt };
    });
  }

  async openLink(url: string): Promise<{ file: FileEntry; blob: Blob }> {
    const u = new URL(url);
    const ensName = u.searchParams.get("n") ?? "";
    const secretHex = u.hash.replace(/^#/, "");
    if (!ensName || !/^[0-9a-f]{64}$/i.test(secretHex)) throw new DriveError("NOT_FOUND", "This link is incomplete.");
    const node = nameNode(ensName);
    const records = await listLinks(this.arkiv(), node);
    const valid = (await this.validator().shareRecords(records.records)).valid;
    const record = valid[valid.length - 1];
    if (!record) throw new DriveError("NOT_FOUND", "This link has ended or doesn't exist.");
    const label = ensName.split(".")[0]!;
    const expiry = await this.sepolia().readContract({ address: record.folder, abi: driveRegistryAbi, functionName: "getExpiry", args: [labelId(label)] });
    if (Number(expiry) <= now()) throw new DriveError("EXPIRED", "This link has ended.");
    const bundle = await openLinkBundle(hexToBytes(`0x${secretHex}`), node, record.bundle);
    const sealed = await downloadEncrypted(this.swarm(), bundle.swarmRef);
    const plain = await decryptPadded(bundle.fileKey, sealed);
    return {
      file: {
        fileId: bundle.fileId,
        folder: bundle.folder,
        readable: true,
        name: bundle.name,
        mime: bundle.mime,
        size: bundle.size,
        version: 1,
        epoch: 0,
        uploadedAt: record.createdAt,
        uploadedBy: { address: record.creator, label: "the sharer" },
        swarmRef: bundle.swarmRef,
        arkivKey: record.key,
      },
      blob: new Blob([new Uint8Array(plain)], { type: bundle.mime }),
    };
  }

  async mount(folder: Address, label: string): Promise<void> {
    const keys = this.requireKeys();
    if (!this.driveRoot) throw new DriveError("NOT_SIGNED_IN", "Claim a name first.");
    const f = getAddress(folder);
    const target = await this.getFolder(f);
    if (target.kind === "room") throw new DriveError("NOT_AUTHORIZED", "Rooms can't be mounted: it would publish a link to you.");
    await this.receipts.run(`Mount ${target.displayName}`, async (step) => {
      checkUserLabel(label);
      await this.ensureGas({ folder: this.driveRoot!, key: keys.driveKey, address: keys.driveAddress, seal: new Uint8Array(32), source: "own" }, { sepolia: true }, step);
      await mountFolder(this.sepoliaWriter(keys.driveKey, step), { driveRoot: this.driveRoot!, owner: keys.driveAddress, label, target: f }, step);
    });
  }

  // ------------------------------------------------------------ transparency

  async publicView(folder: Address): Promise<PublicView> {
    const f = getAddress(folder);
    this.direct.clear();
    const h = this.holdings.get(lower(f)) ?? (this.keys ? await this.holding(f).catch(() => null) : null);
    const iso = h?.address;
    const reader = this.arkiv(undefined, iso);
    const [members, rotations, rosters, files, tombs, refreshes, copies, welcomes] = await Promise.all([
      this.holders(f, iso),
      listRotations(reader, f),
      listRosters(reader, f),
      arkivListFiles(reader, f),
      listTombs(reader, f),
      listRefreshes(reader, f),
      listFolderKeyCopies(reader, f),
      listFolderWelcomes(reader, f),
    ]);
    const validator = this.validator(undefined, iso);
    const reading = await validator.folder({
      folder: f,
      rotations: rotations.records,
      refreshes: refreshes.records,
      files: files.records,
      tombs: tombs.records,
      malformed: rotations.malformed + files.malformed + tombs.malformed + refreshes.malformed,
    });
    const shareChecked = await validator.shareRecords([...rosters.records, ...copies.records, ...welcomes.records]);
    const block = await reader.getBlockNumber();
    const toTime = (b: bigint) => now() + Number(b - block) * 2;
    const bytesOf = (r: Record<string, unknown>) =>
      Object.values(r).reduce<number>((n, v) => n + (v instanceof Uint8Array ? v.length : 0), 0);
    const arkiv = [
      ...rotations.records.map((r) => ({ r, schema: "cloak.rotation" })),
      ...rosters.records.map((r) => ({ r, schema: "cloak.roster" })),
      ...files.records.map((r) => ({ r, schema: "cloak.file" })),
      ...tombs.records.map((r) => ({ r, schema: "cloak.tomb" })),
      ...refreshes.records.map((r) => ({ r, schema: "cloak.refresh" })),
      ...copies.records.map((r) => ({ r, schema: "cloak.keycopy" })),
      ...welcomes.records.map((r) => ({ r, schema: "cloak.welcome" })),
    ].map(({ r, schema }) => ({
      key: r.key,
      schema,
      owner: r.owner,
      expiresAt: toTime(r.expiresAtBlock),
      bytes: bytesOf(r as unknown as Record<string, unknown>),
      explorerUrl: `${EXPLORERS.arkiv}/entity/${r.key}`,
    }));

    // Padded sizes: a HEAD request per blob, the same route the files take.
    const swarm: { ref: Hex; paddedBytes: number }[] = [];
    const anon = this.cfg.anon;
    const routed = anon.supportsAnyHttps && isAnonymous(anon.status());
    if (!routed && reading.files.length) this.direct.add("Swarm (file sizes)");
    const doFetch = routed ? (iso ? anon.isolated(iso) : anon.fetch) : globalThis.fetch.bind(globalThis);
    for (const file of reading.files) {
      try {
        const res = await doFetch(`${this.cfg.beeUrl.replace(/\/+$/, "")}/bytes/${file.swarmRef.slice(2)}`, { method: "HEAD" });
        const length = Number(res.headers.get("content-length"));
        if (res.ok && length > 0) swarm.push({ ref: file.swarmRef, paddedBytes: length });
      } catch {
        // not reachable: leave it out rather than guess
      }
    }

    const ensName = h?.ensName ?? "";
    const kind = ensName ? kindOf(ensName) : "drive";
    const ownerVisible = kind !== "room";
    const ending = members.filter((m) => m.until !== null).length;
    const padded = swarm.reduce((n, s) => n + s.paddedBytes, 0);
    const mb = padded / (1024 * 1024);
    const created = reading.versions.get(1)?.createdAt;
    const summary =
      `Anyone can see that this ${kind === "room" ? "room" : "folder"} exists` +
      `${created ? ` (created ${new Date(created * 1000).toLocaleDateString(undefined, { day: "numeric", month: "short" })})` : ""}, ` +
      `that ${members.length} address${members.length === 1 ? "" : "es"} hold access` +
      `${ending ? ` (${ending} with an end date)` : ""}, and that it holds ${reading.files.length} file${reading.files.length === 1 ? "" : "s"}` +
      `${padded ? ` of about ${mb >= 1 ? `${Math.round(mb)} MB` : `${Math.max(1, Math.round(padded / 1024))} KB`} padded` : ""}. ` +
      (ownerVisible
        ? `Its name shows it belongs to ${ownerNameOf(ensName) ?? "its owner"}. They can't see who the members are, or any names or contents.`
        : "They can't see who owns it, who the members are, or any names or contents.");
    return {
      folder: f,
      ensName,
      summary,
      ownerVisible,
      members: members.map((m) => ({ address: m.address, roles: rolesIn(m.roles), until: m.until })),
      arkiv,
      swarm,
      ignoredWrites: reading.hidden + shareChecked.hidden.length,
      directCalls: [...this.direct],
    };
  }

  onReceipt(listener: (receipt: Receipt) => void): () => void {
    return this.receipts.on(listener);
  }
}

/** The one DriveClient. Every value it returns is read live from Sepolia, Arkiv and Swarm. */
export function createDriveClient(config: DriveConfig): CloakroomClient {
  return new Client(config);
}

// Re-exported for the e2e script.
export type { EpochKey };
