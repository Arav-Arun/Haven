// Add-on F3: a verified frontend. Keys live in the browser, so a swapped website (hacked host, DNS, CDN or dependency)
// could steal them, the way the Bybit attackers swapped a wallet site's JavaScript in February 2025.
//
// Every release publishes:
//   - manifest.json = { version, gitCommit, publicEnv, files: { "<path>": "<sha256 hex>" } } over every .html, .js and
//     .css file of the static build; rootHash = sha256(canonical JSON of the manifest);
//   - the manifest and the whole site on Swarm (cloakroom.eth's contenthash points at the site);
//   - a cloak.release entity on Arkiv, signed (EIP-712) by the release key R.
// The extension re-downloads every file a Cloakroom tab loaded, hashes it, and releases keys to the page only when every
// hash is in a published, non-revoked manifest.

import type { Address, Hex } from "@cloakroom/types";
import { bytesToHex, isAddressEqual, recoverTypedDataAddress } from "viem";

import type { RebuildRecord, ReleaseRecord, UnreleaseRecord } from "./arkiv";
import { sha256, utf8 } from "./crypto";
import { KEYLOG_DOMAIN } from "./keydir";

export interface ReleaseManifest {
  version: string;
  gitCommit: string;
  /** The NEXT_PUBLIC_* values the build used: needed to rebuild it byte for byte, and public anyway. */
  publicEnv: Record<string, string>;
  files: Record<string, string>;
}

export const HASHED_EXTENSIONS = [".html", ".js", ".css"];

/** JSON with keys sorted at every level and no whitespace, so the same manifest always gives the same bytes. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    return `{${Object.keys(o)
      .sort()
      .map((k) => `${JSON.stringify(k)}:${canonicalJson(o[k])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes)).slice(2);
}

export function rootHashOf(manifest: ReleaseManifest): Hex {
  return bytesToHex(sha256(utf8(canonicalJson(manifest))));
}

export function isHashedPath(path: string): boolean {
  return HASHED_EXTENSIONS.some((ext) => path.endsWith(ext));
}

/** Builds the manifest from the static export's files (paths relative to the export root, with "/" separators). */
export function buildManifest(
  files: Iterable<{ path: string; bytes: Uint8Array }>,
  meta: { version: string; gitCommit: string; publicEnv: Record<string, string> },
): ReleaseManifest {
  const out: Record<string, string> = {};
  for (const f of files) if (isHashedPath(f.path)) out[f.path] = sha256Hex(f.bytes);
  return { ...meta, files: out };
}

/**
 * The manifest path a URL on the app's origin is served from. The export uses trailingSlash, so "/drive/" is
 * "drive/index.html". Null for another origin (nothing from another origin is ever in a release).
 */
export function manifestPath(url: string, appOrigin: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.origin !== new URL(appOrigin).origin) return null;
  let p = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  if (p === "" || p.endsWith("/")) p += "index.html";
  else if (!/\.[a-z0-9]+$/i.test(p)) p += "/index.html";
  return p;
}

// ---------------------------------------------------------------- signatures

export const RELEASE_TYPES = {
  Release: [
    { name: "version", type: "string" },
    { name: "rootHash", type: "string" },
    { name: "gitCommit", type: "string" },
    { name: "manifestSwarmRef", type: "string" },
    { name: "siteSwarmRef", type: "string" },
  ],
} as const;

export const UNRELEASE_TYPES = { Unrelease: [{ name: "rootHash", type: "string" }] } as const;

export interface UnsignedRelease {
  version: string;
  rootHash: Hex;
  gitCommit: string;
  manifestSwarmRef: Hex;
  siteSwarmRef: string;
}

export function releaseTypedData(r: UnsignedRelease) {
  return { domain: KEYLOG_DOMAIN, types: RELEASE_TYPES, primaryType: "Release" as const, message: r };
}

export function unreleaseTypedData(rootHash: Hex) {
  return { domain: KEYLOG_DOMAIN, types: UNRELEASE_TYPES, primaryType: "Unrelease" as const, message: { rootHash } };
}

/** Releases signed by R and not revoked by R, newest first. */
export async function trustedReleases(
  releases: readonly ReleaseRecord[],
  unreleases: readonly UnreleaseRecord[],
  releaseSigner: Address,
): Promise<ReleaseRecord[]> {
  const revoked = new Set<string>();
  for (const u of unreleases) {
    try {
      const signer = await recoverTypedDataAddress({ ...unreleaseTypedData(u.rootHash), signature: u.sig });
      if (isAddressEqual(signer, releaseSigner)) revoked.add(u.rootHash.toLowerCase());
    } catch {
      // unsigned junk revokes nothing
    }
  }
  const out: ReleaseRecord[] = [];
  for (const r of releases) {
    if (revoked.has(r.rootHash.toLowerCase())) continue;
    try {
      const signer = await recoverTypedDataAddress({
        ...releaseTypedData({
          version: r.version,
          rootHash: r.rootHash,
          gitCommit: r.gitCommit,
          manifestSwarmRef: r.manifestSwarmRef,
          siteSwarmRef: r.siteSwarmRef,
        }),
        signature: r.sig,
      });
      if (isAddressEqual(signer, releaseSigner)) out.push(r);
    } catch {
      // ignored
    }
  }
  return out.sort((a, b) => Number(b.createdAtBlock - a.createdAtBlock));
}

/** Independent rebuilds that matched: one per creator, never R itself. */
export function matchingRebuilds(rebuilds: readonly RebuildRecord[], releaseSigner: Address): number {
  const who = new Set<string>();
  for (const r of rebuilds) if (r.matched && r.readonly && !isAddressEqual(r.creator, releaseSigner)) who.add(r.creator.toLowerCase());
  return who.size;
}

// ---------------------------------------------------------------- checking a page

export interface VerificationResult {
  status: "verified" | "mismatch" | "unknown";
  version?: string;
  gitCommit?: string;
  rootHash?: Hex;
  rebuilds?: number;
  /** Files whose hash isn't in the release (or that came from another origin). */
  mismatchedFiles?: string[];
  /** The Swarm reference of the verified build, for "Open the verified copy". */
  siteSwarmRef?: string;
  detail?: string;
}

/** Compares what a page loaded (manifest path → sha256 hex, or null for another origin) with one manifest. */
export function compareWithManifest(loaded: ReadonlyMap<string, string | null>, manifest: ReleaseManifest): string[] {
  const bad: string[] = [];
  for (const [path, hash] of loaded) {
    if (hash === null || manifest.files[path] !== hash) bad.push(path);
  }
  return bad.sort();
}

/** Checks the manifest fetched from Swarm is the one the release signed. */
export function manifestMatches(manifestBytes: Uint8Array, rootHash: Hex): ReleaseManifest | null {
  try {
    const manifest = JSON.parse(new TextDecoder().decode(manifestBytes)) as ReleaseManifest;
    return rootHashOf(manifest).toLowerCase() === rootHash.toLowerCase() ? manifest : null;
  } catch {
    return null;
  }
}
