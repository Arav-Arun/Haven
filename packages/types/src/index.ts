// Frozen shared interface between Plan A (implements DriveClient) and Plan B (uses it).
export type Address = `0x${string}`;
export type Hex = `0x${string}`;
/** Unix time in seconds. */
export type Timestamp = number;

export type Role = "viewer" | "editor" | "manager";
export type AccessVia = "owner" | "direct" | "parent" | "group";
export type FolderKind = "drive" | "room" | "group";
export type PrivateNetwork = "nym" | "nox" | "tor" | "off";

// ---------- Platform adapters (B implements, A consumes) ----------

export interface AnonStatus {
  network: PrivateNetwork;
  state: "connecting" | "ready" | "failed" | "off";
  detail?: string;
}

export interface AnonFetch {
  /** Anonymized fetch. When network is "off" this is plain fetch. */
  fetch: typeof fetch;
  /** Same, but calls under different keys must not be linkable (anonOptions.isolationKey). */
  isolated(key: string): typeof fetch;
  /** True only if the worker forwards any HTTPS request, not just JSON-RPC (first-hour check). */
  supportsAnyHttps: boolean;
  status(): AnonStatus;
  onStatus(listener: (status: AnonStatus) => void): () => void;
  close(): void;
}

export interface KeyValueStore {
  get(key: string): Promise<Uint8Array | null>;
  set(key: string, value: Uint8Array): Promise<void>;
  delete(key: string): Promise<void>;
}

// ---------- Domain types ----------

export interface Identity {
  ensName: string | null;            // "alice.haven.eth" once claimed
  wallet: Address | null;            // main wallet W (null for passkey or "Try it")
  driveKey: Address;                 // K
  spendingPublicKey: Hex;            // published as the haven.key text record
}

export interface Access {
  role: Role | "owner";
  until: Timestamp | null;
  via: AccessVia;
}

export interface Folder {
  registry: Address;                 // the folder's ID everywhere
  ensName: string;                   // "f-7k2x.alice.haven.eth" or "r-9f3k2x.rooms.haven.eth"
  displayName: string;               // decrypted ("Series A")
  kind: FolderKind;
  parent: Address | null;
  inherit: boolean;                  // fixed at creation
  myAccess: Access | null;
  version: number;                   // current key version
  refreshPending: boolean;           // true = editors are blocked until a manager refreshes keys
}

export interface FileEntry {
  fileId: string;
  folder: Address;
  /** false when the file exists but you have no key for its epoch (e.g. written after your access ended). */
  readable: boolean;
  name: string | null;               // null when not readable
  mime: string | null;
  size: number | null;               // real size; padded size is in PublicView
  version: number;
  epoch: number;
  uploadedAt: Timestamp;
  uploadedBy: { address: Address; label: string };  // "you", a visible ENS name, or "private member"
  swarmRef: Hex;
  arkivKey: Hex;
}

export interface Member {
  address: Address;                  // the random address the chain shows
  label: string;                     // ENS name if visible to you, else "private member"
  role: Role;
  until: Timestamp | null;
  via: "direct" | "group";
  hiddenFromMembers: boolean;
  needsGas: boolean;                 // editors/managers below the top-up threshold
}

export interface ShareOptions {
  role: Role;
  until: Timestamp | null;
  hideFromMembers: boolean;
}

export interface IncomingShare {
  folder: Folder;
  sharedBy: string;                  // owner's ENS name, or "unlinked room"
  role: Role;
  until: Timestamp | null;
  firstSeenAt: Timestamp;
}

export interface ShareLink {
  url: string;
  ensName: string;
  expiresAt: Timestamp;
}

export type ReceiptStep =
  | { kind: "sepolia-tx" | "arkiv-tx"; label: string; hash: Hex; explorerUrl: string; ok: boolean }
  | { kind: "swarm"; label: string; ref: Hex; paddedBytes: number; ok: boolean }
  | { kind: "check"; label: string; detail: string; ok: boolean }
  | { kind: "route"; label: string; route: "anon" | "direct"; network: PrivateNetwork; isolationKey?: string };

export interface Receipt {
  id: string;
  action: string;
  startedAt: Timestamp;
  steps: ReceiptStep[];
  done: boolean;
  error?: DriveErrorCode;
}

export interface PublicView {
  folder: Address;
  ensName: string;
  /** Plain sentence: what anyone can see, and what they can't. */
  summary: string;
  ownerVisible: boolean;             // false for rooms
  members: { address: Address; roles: Role[]; until: Timestamp | null }[];
  arkiv: { key: Hex; schema: string; owner: Address; expiresAt: Timestamp; bytes: number; explorerUrl: string }[];
  swarm: { ref: Hex; paddedBytes: number }[];
  ignoredWrites: number;             // entities hidden by the validator
  directCalls: string[];             // traffic that did not go through Anon-RPC, if any
}

export type DriveErrorCode =
  | "NOT_SIGNED_IN"
  | "WALLET_NOT_SUPPORTED"           // contract wallet, or signatures differ
  | "KEY_MISMATCH"                   // derived key != haven.key on this name
  | "NAME_TAKEN"
  | "NO_HAVEN_KEY"                    // recipient has no haven.key record
  | "NOT_AUTHORIZED"
  | "EXPIRED"
  | "REFRESH_PENDING"                // editors blocked until a manager refreshes keys
  | "TOO_LARGE"
  | "NOT_FOUND"
  | "RATE_LIMITED"
  | "NETWORK"
  | "UNKNOWN";

export class DriveError extends Error {
  readonly code: DriveErrorCode;
  constructor(code: DriveErrorCode, message?: string) {
    super(message ?? code);
    this.name = "DriveError";
    this.code = code;
  }
}

// ---------- Client ----------

export interface DriveConfig {
  anon: AnonFetch;
  storage: KeyValueStore;
  appOrigin: string;                 // used in the sign-in message
  apiUrl: string;
  beeUrl: string;
  sepoliaRpcUrl: string;
  arkivRpcUrl: string;
  arkivAccessKey: string;
  demoMode: boolean;                 // true = 1-minute epochs
}

export type SignInSource =
  | { kind: "wallet"; address: Address; signatures: Hex[] }   // 2 signatures on the first device, else 1
  | { kind: "passkey"; prfOutput: Uint8Array }
  | { kind: "random" }                                          // "Try it"
  | { kind: "seed"; seed: Uint8Array };                         // extension pairing

export interface DriveClient {
  // session
  signInMessage(address: Address): string;
  /** True when this address has no haven.key yet, so the UI must collect two signatures. */
  needsSecondSignature(address: Address): Promise<boolean>;
  signIn(source: SignInSource): Promise<Identity>;
  restore(): Promise<Identity | null>;
  signOut(): Promise<void>;
  exportSeed(): Promise<Uint8Array>;                 // extension pairing only
  isNameAvailable(label: string): Promise<boolean>;
  claimName(label: string): Promise<Identity>;

  // folders and rooms
  listFolders(parent: Address | "root" | "rooms" | "groups"): Promise<Folder[]>;
  getFolder(folder: Address): Promise<Folder>;
  createFolder(parent: Address | "root", displayName: string, opts?: { inherit?: boolean }): Promise<Folder>;
  createRoom(displayName: string): Promise<Folder>;
  createGroup(displayName: string): Promise<Folder>;

  // files
  listFiles(folder: Address): Promise<FileEntry[]>;
  upload(folder: Address, file: Blob, name: string, onProgress?: (fraction: number) => void): Promise<FileEntry>;
  download(file: FileEntry): Promise<Blob>;
  downloadFolder(folder: Address, onProgress?: (fraction: number) => void): Promise<Map<string, Blob>>;
  deleteFile(file: FileEntry): Promise<void>;
  listVersions(folder: Address, fileId: string): Promise<FileEntry[]>;

  // sharing
  lookupRecipient(ensName: string): Promise<{ ensName: string; canReceive: boolean }>;
  /** recipient: an ENS name, or a group folder's registry address. */
  share(folder: Address, recipient: string, opts: ShareOptions): Promise<Member>;
  listMembers(folder: Address): Promise<Member[]>;
  removeMember(folder: Address, member: Address): Promise<void>;
  sharedWithMe(opts?: { since?: Timestamp }): Promise<IncomingShare[]>;
  /** Owner/manager housekeeping: gas top-ups, open refresh requests, renewals. Returns what it did. */
  maintain(): Promise<Receipt[]>;

  // links and mounts (Should)
  createLink(file: FileEntry, expiresAt: Timestamp): Promise<ShareLink>;
  openLink(url: string): Promise<{ file: FileEntry; blob: Blob }>;
  mount(folder: Address, label: string): Promise<void>;

  // transparency
  publicView(folder: Address): Promise<PublicView>;
  onReceipt(listener: (receipt: Receipt) => void): () => void;
}

export type CreateDriveClient = (config: DriveConfig) => DriveClient;
