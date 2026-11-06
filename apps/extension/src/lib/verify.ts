// Add-on F3, extension side: does the Haven tab run a published release?
//
// The page's scripts, styles and HTML are re-downloaded here (MV3 can't read response bodies directly), hashed, and
// compared with the manifest of a haven.release entity signed by the release key R (WXT_RELEASE_SIGNER) and not
// revoked. This catches files swapped for everyone (the Bybit case); a host that serves bad code to one targeted visitor
// only could still slip past a re-download, which is why the Swarm copy (fixed by its hash) is offered too.

import type { Address } from "@haven/types";
import {
  arkivReader,
  compareWithManifest,
  listRebuilds,
  listReleases,
  listUnreleases,
  manifestMatches,
  manifestPath,
  matchingRebuilds,
  sha256Hex,
  trustedReleases,
  type VerificationResult,
} from "@haven/core";

import { getAnon } from "./client";
import { config } from "./config";

const MAX_RELEASES = 5;

async function hashOf(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, { credentials: "omit", cache: "no-store" });
    if (!res.ok) return null;
    return sha256Hex(new Uint8Array(await res.arrayBuffer()));
  } catch {
    return null;
  }
}

export async function verifyUrls(urls: string[]): Promise<VerificationResult> {
  const signer = config.releaseSigner;
  if (!/^0x[0-9a-fA-F]{40}$/.test(signer)) return { status: "unknown", detail: "This build of the extension has no release key (WXT_RELEASE_SIGNER)." };
  const loaded = new Map<string, string | null>();
  for (const url of new Set(urls)) {
    const path = manifestPath(url, config.appOrigin);
    if (path === null) loaded.set(url, null);
    else if (!loaded.has(path)) loaded.set(path, await hashOf(url));
  }
  const reader = arkivReader({ rpcUrl: config.arkivRpcUrl, accessKey: "", anon: getAnon() });
  const [releases, unreleases] = await Promise.all([listReleases(reader), listUnreleases(reader)]);
  const trusted = (await trustedReleases(releases.records, unreleases.records, signer as Address)).slice(0, MAX_RELEASES);
  if (!trusted.length) return { status: "unknown", detail: "No published Haven release was found on Arkiv." };
  let best: { files: string[]; version: string } | null = null;
  for (const r of trusted) {
    const res = await getAnon().fetch(`${config.beeUrl.replace(/\/+$/, "")}/bytes/${r.manifestSwarmRef.slice(2)}`).catch(() => null);
    if (!res?.ok) continue;
    const manifest = manifestMatches(new Uint8Array(await res.arrayBuffer()), r.rootHash);
    if (!manifest) continue;
    const bad = compareWithManifest(loaded, manifest);
    if (!bad.length) {
      const rebuilds = matchingRebuilds((await listRebuilds(reader, r.rootHash)).records, signer as Address);
      return { status: "verified", version: r.version, gitCommit: r.gitCommit, rootHash: r.rootHash, rebuilds, siteSwarmRef: r.siteSwarmRef };
    }
    if (!best || bad.length < best.files.length) best = { files: bad, version: r.version };
  }
  return {
    status: "mismatch",
    mismatchedFiles: best?.files ?? [...loaded.keys()],
    siteSwarmRef: trusted[0]!.siteSwarmRef,
    detail: best ? `closest release: ${best.version}` : "no release manifest could be read from Swarm",
  };
}

/** https://<cid>.bzz.link/ for a Swarm site: CIDv1, swarm-manifest codec (0xfa), keccak-256 multihash (0x1b), base32. */
export function verifiedCopyUrl(siteSwarmRef: string): string | null {
  if (!/^(0x)?[0-9a-f]{64}$/i.test(siteSwarmRef)) return null;
  const ref = siteSwarmRef.replace(/^0x/, "");
  const bytes = [0x01, 0xfa, 0x01, 0x1b, 0x20, ...ref.match(/../g)!.map((h) => parseInt(h, 16))];
  const alphabet = "abcdefghijklmnopqrstuvwxyz234567";
  let bits = 0;
  let value = 0;
  let out = "b";
  for (const b of bytes) {
    value = (value << 8) | b;
    bits += 8;
    while (bits >= 5) {
      out += alphabet[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += alphabet[(value << (5 - bits)) & 31];
  return `https://${out}.bzz.link/`;
}
