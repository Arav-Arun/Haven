// Verified frontend (add-on F3).
//
// Keys live in the browser, so the biggest real risk is the website itself being swapped: a hacked host, DNS, CDN or
// dependency serving different JavaScript (how the Bybit theft worked in Feb 2025). So:
//   1. every release publishes a manifest (path → SHA-256 of every .js, .css and .html), and its root hash goes to a
//      public cloak.release entity on Arkiv, signed by a dedicated release key R; the site itself goes to Swarm;
//   2. the extension hashes what a Cloakroom tab actually loaded and compares it with a published, non-revoked
//      release, and gives keys to the page only when every file matches;
//   3. anyone can rebuild a commit and post a cloak.rebuild saying whether the hashes matched.
// Limits (also in the README): this catches files swapped for everyone, not a host that serves bad code to one
// targeted visitor and good code to the extension's re-download. The Swarm copy defends against that case.

import type { Address, Hex } from "@cloakroom/types";
import { bytesToHex, isAddressEqual, recoverTypedDataAddress } from "viem";
import { signTypedData } from "viem/accounts";

import type { RebuildRecord, ReleaseRecord, ReleaseRevokeRecord } from "./arkiv";
import { sha256, utf8 } from "./crypto";
import { KEYDIR_DOMAIN } from "./keydir";

// ---------------------------------------------------------------- the manifest

export interface ReleaseManifest {
  version: string;
  gitCommit: string;
  /** Path relative to the site root ("index.html", "drive/index.html", "_next/static/…js") → SHA-256, lowercase hex. */
  files: Record<string, string>;
}

/** The file types a manifest covers: everything that can run or style code on the page. */
export const MANIFEST_EXTENSIONS = [".js", ".css", ".html"] as const;

/** JSON with object keys sorted at every level, so the same manifest always gives the same bytes and root hash. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(",")}}`;
}

export function sha256Hex(bytes: Uint8Array): string {
  return bytesToHex(sha256(bytes)).slice(2);
}

export function manifestRootHash(manifest: ReleaseManifest): Hex {
  return bytesToHex(sha256(utf8(canonicalJson(manifest))));
}

/** Reads a manifest downloaded from Swarm, refusing anything that isn't exactly the expected shape. */
export function parseManifest(bytes: Uint8Array): ReleaseManifest {
  const value = JSON.parse(new TextDecoder().decode(bytes)) as Record<string, unknown>;
  const files = value.files as Record<string, unknown> | undefined;
  if (typeof value.version !== "string" || typeof value.gitCommit !== "string" || !files || typeof files !== "object") {
    throw new Error("malformed release manifest");
  }
  for (const [path, hash] of Object.entries(files)) {
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash) || path.startsWith("/") || path.includes("..")) {
      throw new Error("malformed release manifest");
    }
  }
  return { version: value.version, gitCommit: value.gitCommit, files: files as Record<string, string> };
}

/**
 * The manifest path a loaded URL corresponds to, or null for a URL from another origin (never part of a release).
 * Query strings and fragments don't change the file ("/drive/?f=0x…" is "drive/index.html").
 */
export function manifestPath(url: string, origin: string): string | null {
  const u = new URL(url, origin);
  if (u.origin !== new URL(origin).origin) return null;
  let path = decodeURIComponent(u.pathname).replace(/^\/+/, "");
  if (path === "" || path.endsWith("/")) path += "index.html";
  return path;
}

export interface LoadedFile {
  url: string;
  /** SHA-256 of the bytes, lowercase hex. */
  sha256: string;
}

/** Every loaded file that isn't in the manifest with exactly this hash (a cross-origin script is never in it). */
export function compareToManifest(loaded: readonly LoadedFile[], manifest: ReleaseManifest, origin: string): string[] {
  const bad: string[] = [];
  for (const f of loaded) {
    const path = manifestPath(f.url, origin);
    if (path === null) bad.push(f.url);
    else if (manifest.files[path] !== f.sha256.toLowerCase()) bad.push(path);
  }
  return [...new Set(bad)];
}

// ---------------------------------------------------------------- signatures (EIP-712, by the release key R)

const RELEASE_TYPES = {
  Release: [
    { name: "version", type: "string" },
    { name: "rootHash", type: "bytes32" },
    { name: "gitCommit", type: "string" },
    { name: "manifestSwarmRef", type: "bytes" },
    { name: "siteSwarmRef", type: "bytes" },
  ],
} as const;

export interface UnsignedRelease {
  version: string;
  rootHash: Hex;
  gitCommit: string;
  manifestSwarmRef: Hex;
  siteSwarmRef: Hex;
}

const releaseMessage = (r: UnsignedRelease) => ({
  version: r.version,
  rootHash: r.rootHash,
  gitCommit: r.gitCommit,
  manifestSwarmRef: r.manifestSwarmRef,
  siteSwarmRef: r.siteSwarmRef,
});

export function signRelease(releaseKey: Hex, release: UnsignedRelease): Promise<Hex> {
  return signTypedData({
    privateKey: releaseKey,
    domain: KEYDIR_DOMAIN,
    types: RELEASE_TYPES,
    primaryType: "Release",
    message: releaseMessage(release),
  });
}

async function releaseSigner(r: UnsignedRelease & { sig: Hex }): Promise<Address | null> {
  try {
    return await recoverTypedDataAddress({
      domain: KEYDIR_DOMAIN,
      types: RELEASE_TYPES,
      primaryType: "Release",
      message: releaseMessage(r),
      signature: r.sig,
    });
  } catch {
    return null;
  }
}

// ---------------------------------------------------------------- which releases count

/**
 * R's valid releases, newest first, minus revoked ones. A release counts only if R both wrote it (read-only) and
 * signed it; a revocation counts only if R wrote it.
 */
export async function validReleases(
  releases: readonly ReleaseRecord[],
  revokes: readonly ReleaseRevokeRecord[],
  signer: Address,
): Promise<{ releases: ReleaseRecord[]; revoked: Set<string>; ignored: number }> {
  const revoked = new Set(
    revokes.filter((r) => r.readonly && isAddressEqual(r.creator, signer)).map((r) => r.rootHash.toLowerCase()),
  );
  const valid: ReleaseRecord[] = [];
  let ignored = 0;
  for (const r of releases) {
    const by = r.readonly && isAddressEqual(r.creator, signer) ? await releaseSigner(r) : null;
    if (!by || !isAddressEqual(by, signer)) ignored++;
    else if (!revoked.has(r.rootHash.toLowerCase())) valid.push(r);
  }
  valid.sort((a, b) => (a.createdAtBlock === b.createdAtBlock ? 0 : a.createdAtBlock > b.createdAtBlock ? -1 : 1));
  return { releases: valid, revoked, ignored };
}

/** Independent rebuilds that matched: one per distinct writer, never counting R itself. */
export function countRebuilds(rebuilds: readonly RebuildRecord[], rootHash: Hex, signer: Address): number {
  const writers = new Set<string>();
  for (const r of rebuilds) {
    if (r.readonly && r.matched && r.rootHash.toLowerCase() === rootHash.toLowerCase() && !isAddressEqual(r.creator, signer)) {
      writers.add(r.creator.toLowerCase());
    }
  }
  return writers.size;
}

// ---------------------------------------------------------------- verifying a page

export interface VerificationResult {
  status: "verified" | "mismatch" | "unknown";
  version?: string;
  gitCommit?: string;
  rebuilds?: number;
  mismatchedFiles?: string[];
  /** The verified copy on Swarm (latest valid release), for "Open the verified copy". */
  siteSwarmRef?: Hex;
  /** Why the status is "unknown" (no release published, the network failed…). */
  reason?: string;
}

export interface ReleaseSources {
  /** The release key R's address (configuration, from env). */
  signer: Address;
  listReleases: () => Promise<ReleaseRecord[]>;
  listRevokes: () => Promise<ReleaseRevokeRecord[]>;
  listRebuilds: (rootHash: Hex) => Promise<RebuildRecord[]>;
  /** Manifest bytes by Swarm reference. */
  fetchManifest: (ref: Hex) => Promise<Uint8Array>;
}

/** How many recent releases a page may match: a deploy rolling out, or a tab opened just before one. */
export const RELEASES_TO_TRY = 3;

/**
 * Checks what a tab loaded against the newest valid releases. "verified" only if every file matches one release's
 * manifest, and that manifest's root hash is the one R signed.
 */
export async function verifyLoaded(
  sources: ReleaseSources,
  loaded: readonly LoadedFile[],
  origin: string,
): Promise<VerificationResult> {
  let candidates: ReleaseRecord[];
  try {
    const [releases, revokes] = await Promise.all([sources.listReleases(), sources.listRevokes()]);
    candidates = (await validReleases(releases, revokes, sources.signer)).releases;
  } catch (error) {
    return { status: "unknown", reason: `couldn't read releases: ${error instanceof Error ? error.message : String(error)}` };
  }
  if (!candidates.length) return { status: "unknown", reason: "no release has been published yet" };
  if (!loaded.length) return { status: "unknown", reason: "the page hasn't loaded any code yet" };

  const latest = candidates[0]!;
  let firstMismatch: string[] | null = null;
  for (const release of candidates.slice(0, RELEASES_TO_TRY)) {
    let manifest: ReleaseManifest;
    try {
      manifest = parseManifest(await sources.fetchManifest(release.manifestSwarmRef));
    } catch {
      continue; // unreadable or unavailable: try the next release
    }
    if (manifestRootHash(manifest).toLowerCase() !== release.rootHash.toLowerCase()) continue; // not what R signed
    const bad = compareToManifest(loaded, manifest, origin);
    if (bad.length === 0) {
      let rebuilds = 0;
      try {
        rebuilds = countRebuilds(await sources.listRebuilds(release.rootHash), release.rootHash, sources.signer);
      } catch {
        // the count is informational
      }
      return {
        status: "verified",
        version: release.version,
        gitCommit: release.gitCommit,
        rebuilds,
        siteSwarmRef: latest.siteSwarmRef,
      };
    }
    firstMismatch ??= bad;
  }
  if (!firstMismatch) return { status: "unknown", reason: "no release manifest could be read", siteSwarmRef: latest.siteSwarmRef };
  return { status: "mismatch", mismatchedFiles: firstMismatch, siteSwarmRef: latest.siteSwarmRef };
}
