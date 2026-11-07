// The add-ons' part of the client interface (F1 key directory, F2 subtree sharing, F4 live updates, Z1 anonymous
// writes).
//
// packages/types/src/index.ts is frozen on our branches (CLAUDE.md), so these additions live here as an extension of
// DriveClient. They are exactly the optional members the add-ons spec lists, plus a few fields the UI needed
// (marked). docs/requests-b.md asks for them to be copied into @haven/types on main once both people agree.

import type { Address, DriveClient, FileEntry, Member, Hex, Role, ShareOptions, Timestamp } from "@haven/types";

// ---------------------------------------------------------------- F1

export interface KeyLogEntry {
  seq: number;
  kind: "publish" | "rotate" | "revoke-device";
  spendingPublicKey: Hex;
  at: Timestamp;
  arkivKey: Hex;
}

export interface KeyInfo {
  ensName: string;
  /** The current key from the log (compressed), or null when the name has no valid log. */
  current: Hex | null;
  fingerprint: string[];
  history: KeyLogEntry[];
  matchesEns: boolean;
  changedSinceLastShare: boolean;
  /** Added: the haven.key record compared with the log ("none" for names without the record). */
  ensRecord: "match" | "mismatch" | "none";
  /** Added: entries written about this name by anyone other than its controller, ignored. */
  ignored: { arkivKey: Hex; creator: Address; seq: number }[];
  /** Added: why the chain is broken, or null. */
  problem: string | null;
  /** Added: who must sign this name's entries (K for haven.eth names, the owner wallet otherwise). */
  controller: Address | null;
}

export interface DeviceInfo {
  deviceId: string;
  label: string;
  lastSeen: Timestamp;
  expiresAt: Timestamp;
  /** Added. */
  thisDevice: boolean;
  trusted: boolean;
}

/** Signs EIP-712 typed data with the user's wallet (wagmi's signTypedData). */
export type SignTypedData = (typedData: {
  domain: Record<string, unknown>;
  types: Record<string, readonly { name: string; type: string }[]>;
  primaryType: string;
  message: Record<string, unknown>;
}) => Promise<Hex>;

// ---------------------------------------------------------------- F2

export interface SubtreeRule {
  /** The ENS parent ("acme.eth"), or "group:<registry>" for one of the user's groups. */
  parent: string;
  /** Added: how to show the rule, e.g. `the group "Design"` (absent for ENS parents). */
  label?: string;
  role: Role;
  until: Timestamp | null;
  excluded: string[];
  memberCount: number;
  lastSyncedAt: Timestamp;
}

export interface SubtreePreview {
  parent: string;
  /** Names with a valid public key log: these would get access. */
  ready: string[];
  /** Names without one, with the reason. */
  noKey: { name: string; why: string }[];
}

// ---------------------------------------------------------------- F4

export interface LiveEvent {
  folder: Address;
  type: "file" | "member" | "refresh" | "rotation";
  arkivKey: Hex;
  receivedAt: Timestamp;
}

export interface LiveStatus {
  folder: Address;
  /** "live": a Swarm GSOC subscription is open; "polling": Arkiv is re-read every 30 s instead. */
  mode: "live" | "polling" | "off";
  detail?: string;
}

// ---------------------------------------------------------------- Z1

export interface AnonymousWriters {
  folder: Address;
  /** This user's key for the folder is in the writer group. */
  joined: boolean;
  /** Holds WRITE now (owner, editor or manager), so it can join. */
  canJoin: boolean;
  /** Writers in the group now: an anonymous upload could be any of them. */
  writers: number;
  /** Anonymous uploads need at least this many writers in the group. */
  minimum: number;
}

/** What an anonymous file's zero-knowledge proof showed. */
export interface FileProof {
  arkivKey: Hex;
  /** The writer group's Merkle root the proof was checked against. */
  root: Hex;
  nullifier: Hex;
  /** Writers in the group when it was written: the file could be from any of them. */
  writers: number;
  /** This user wrote it (only they can tell, from the nullifier). */
  mine: boolean;
}

export interface HavenClient extends DriveClient {
  /**
   * Hears when the client signs itself out on its own: restore() opens with what the device knows and checks it
   * afterwards, so a device revoked elsewhere finds out after the app has opened.
   */
  onSignedOut(listener: () => void): () => void;

  /** Adds who came in through a team rule ("Via acme.eth") and who follows a parent folder. */
  listMembers(folder: Address): Promise<(Member & { rule?: string; inherited?: boolean })[]>;
  /** The permanent owner key of a group or folder registry. */
  folderOwner(folder: Address): Promise<Address>;

  // F1
  lookupKey(ensName: string): Promise<KeyInfo>;
  confirmKeyChange(ensName: string): Promise<void>;
  listDevices(): Promise<DeviceInfo[]>;
  revokeDevice(deviceId: string): Promise<void>;
  /** Links another ENS name the user's wallet owns (e.g. priya.acme.eth) to this identity, signed by that wallet. */
  linkName(ensName: string, signTypedData: SignTypedData): Promise<KeyInfo>;

  // F2
  previewSubtree(parentEnsName: string): Promise<SubtreePreview>;
  shareWithSubtree(folder: Address, parentEnsName: string, opts: ShareOptions): Promise<SubtreeRule>;
  listSubtreeRules(folder: Address): Promise<SubtreeRule[]>;
  excludeFromSubtree(folder: Address, parentEnsName: string, memberEnsName: string): Promise<void>;
  removeSubtreeRule(folder: Address, parentEnsName: string): Promise<void>;
  syncSubtrees(folder: Address): Promise<void>;

  // F4
  subscribe(folders: Address[], listener: (e: LiveEvent) => void, onStatus?: (s: LiveStatus) => void): () => void;

  // Z1
  anonymousWriters(folder: Address): Promise<AnonymousWriters>;
  /** Puts the user's commitment in the folder's writer group (relayed, no gas). */
  joinAnonymousWriters(folder: Address): Promise<AnonymousWriters>;
  /** Like upload, but the entry proves it's from one of the folder's writers without saying which. */
  uploadAnonymously(folder: Address, file: Blob, name: string, onProgress?: (fraction: number) => void): Promise<FileEntry>;
  /** The proof behind an anonymous file, or null for a signed one. */
  fileProof(file: FileEntry): Promise<FileProof | null>;
}
