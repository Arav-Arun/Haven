// What goes inside the sealed Arkiv attributes. Each sealed value is bound (AES-GCM associated data) to where it lives,
// so a valid blob can't be copied into another folder, file, version or schema.
//
//   cloak.file.meta        { name, mime, size, fileKey }   sealed with E_v[epoch]
//   cloak.rotation.name    display name                    sealed with E_v[0] (every reader of version v can derive it)
//   cloak.roster.*         managers / members with MK_S    sealed with HKDF(FS_v, "managers")
//   cloak.link.bundle      one file's key and pointer      sealed with the link secret from the URL fragment

import type { Address, Hex, Role } from "@cloakroom/types";
import { getAddress, hexToBytes, isHex, toHex } from "viem";

import { aesDecrypt, aesEncrypt, randomBytes, utf8 } from "./crypto";

function aad(...parts: (string | number)[]): Uint8Array {
  return utf8(parts.map((p) => (typeof p === "string" ? p.toLowerCase() : String(p))).join("/"));
}

async function sealJson(key: Uint8Array, value: unknown, context: Uint8Array): Promise<Uint8Array> {
  return aesEncrypt(key, utf8(JSON.stringify(value)), context);
}

async function openJson(key: Uint8Array, sealed: Uint8Array, context: Uint8Array): Promise<unknown> {
  return JSON.parse(new TextDecoder().decode(await aesDecrypt(key, sealed, context)));
}

function hex32(value: unknown): Uint8Array {
  if (typeof value !== "string" || !isHex(value) || value.length !== 66) throw new Error("expected 32 bytes of hex");
  return hexToBytes(value);
}

function isText(value: unknown, max = 1024): value is string {
  return typeof value === "string" && value.length <= max;
}

/** A random file id: 16 bytes of hex. It reveals nothing about the file. */
export function newFileId(): string {
  return toHex(randomBytes(16)).slice(2);
}

// ---------------------------------------------------------------- file meta

export interface FileMeta {
  name: string;
  mime: string;
  /** The real size; only the padded size is public. */
  size: number;
  /** The AES-256-GCM key of the padded content on Swarm. */
  fileKey: Uint8Array;
}

export interface FilePlace {
  folder: Address;
  fileId: string;
  version: number;
  epoch: number;
  swarmRef: Hex;
}

const fileAad = (p: FilePlace) => aad("cloak.file", p.folder, p.fileId, p.version, p.epoch, p.swarmRef);

export function sealFileMeta(epochKey: Uint8Array, place: FilePlace, meta: FileMeta): Promise<Uint8Array> {
  if (meta.fileKey.length !== 32) throw new Error("file key must be 32 bytes");
  return sealJson(
    epochKey,
    { n: meta.name, m: meta.mime, s: meta.size, k: toHex(meta.fileKey) },
    fileAad(place),
  );
}

/** Throws if the key, the place or any byte is wrong. */
export async function openFileMeta(epochKey: Uint8Array, place: FilePlace, sealed: Uint8Array): Promise<FileMeta> {
  const v = (await openJson(epochKey, sealed, fileAad(place))) as Record<string, unknown>;
  if (!isText(v.n) || !isText(v.m, 255) || typeof v.s !== "number" || !Number.isSafeInteger(v.s) || v.s < 0) {
    throw new Error("malformed file meta");
  }
  return { name: v.n, mime: v.m, size: v.s, fileKey: hex32(v.k) };
}

// ---------------------------------------------------------------- folder name

const nameAad = (folder: Address, version: number) => aad("cloak.rotation", folder, version);

export function sealFolderName(epochZeroKey: Uint8Array, folder: Address, version: number, name: string) {
  if (!isText(name, 256)) throw new Error("folder name too long");
  return aesEncrypt(epochZeroKey, utf8(name), nameAad(folder, version));
}

export async function openFolderName(epochZeroKey: Uint8Array, folder: Address, version: number, sealed: Uint8Array) {
  return new TextDecoder().decode(await aesDecrypt(epochZeroKey, sealed, nameAad(folder, version)));
}

// ---------------------------------------------------------------- roster (managers only)

export interface RosterMember {
  /** The member's address in this folder (stealth S, or a group's registry). */
  address: Address;
  /** MK_S, so any manager can send this member new key copies. */
  memberKey: Uint8Array;
  role: Role;
  until: number | null;
  hiddenFromMembers: boolean;
  /** The ENS name the sharer typed. Only managers can read it. */
  label: string | null;
  via: "direct" | "group";
}

export interface Roster {
  managers: RosterMember[];
  members: RosterMember[];
}

const rosterAad = (part: "managers" | "members", folder: Address, version: number) =>
  aad("cloak.roster", part, folder, version);

function encodeMembers(list: RosterMember[]) {
  return list.map((m) => ({
    a: getAddress(m.address),
    k: toHex(m.memberKey),
    r: m.role,
    u: m.until,
    h: m.hiddenFromMembers,
    l: m.label,
    v: m.via,
  }));
}

function decodeMembers(value: unknown): RosterMember[] {
  if (!Array.isArray(value)) throw new Error("malformed roster");
  return value.map((m: Record<string, unknown>) => {
    if (typeof m.a !== "string" || !["viewer", "editor", "manager"].includes(m.r as string)) {
      throw new Error("malformed roster");
    }
    if (m.u !== null && (typeof m.u !== "number" || !Number.isSafeInteger(m.u))) throw new Error("malformed roster");
    if (m.l !== null && !isText(m.l, 255)) throw new Error("malformed roster");
    return {
      address: getAddress(m.a),
      memberKey: hex32(m.k),
      role: m.r as Role,
      until: m.u as number | null,
      hiddenFromMembers: m.h === true,
      label: m.l as string | null,
      via: m.v === "group" ? "group" : "direct",
    };
  });
}

export async function sealRoster(rosterKey: Uint8Array, folder: Address, version: number, roster: Roster) {
  return {
    managers: await sealJson(rosterKey, encodeMembers(roster.managers), rosterAad("managers", folder, version)),
    members: await sealJson(rosterKey, encodeMembers(roster.members), rosterAad("members", folder, version)),
  };
}

export async function openRoster(
  rosterKey: Uint8Array,
  folder: Address,
  version: number,
  sealed: { managers: Uint8Array; members: Uint8Array },
): Promise<Roster> {
  return {
    managers: decodeMembers(await openJson(rosterKey, sealed.managers, rosterAad("managers", folder, version))),
    members: decodeMembers(await openJson(rosterKey, sealed.members, rosterAad("members", folder, version))),
  };
}

// ---------------------------------------------------------------- link bundle

export interface LinkBundle extends FileMeta {
  folder: Address;
  fileId: string;
  swarmRef: Hex;
}

const linkAad = (link: string) => aad("cloak.link", link);

export function sealLinkBundle(linkSecret: Uint8Array, link: string, bundle: LinkBundle) {
  return sealJson(
    linkSecret,
    {
      f: getAddress(bundle.folder),
      i: bundle.fileId,
      r: bundle.swarmRef,
      n: bundle.name,
      m: bundle.mime,
      s: bundle.size,
      k: toHex(bundle.fileKey),
    },
    linkAad(link),
  );
}

export async function openLinkBundle(linkSecret: Uint8Array, link: string, sealed: Uint8Array): Promise<LinkBundle> {
  const v = (await openJson(linkSecret, sealed, linkAad(link))) as Record<string, unknown>;
  if (typeof v.f !== "string" || !isText(v.i, 64) || typeof v.r !== "string" || !isHex(v.r)) {
    throw new Error("malformed link");
  }
  if (!isText(v.n) || !isText(v.m, 255) || typeof v.s !== "number") throw new Error("malformed link");
  return {
    folder: getAddress(v.f),
    fileId: v.i,
    swarmRef: v.r,
    name: v.n,
    mime: v.m,
    size: v.s,
    fileKey: hex32(v.k),
  };
}
