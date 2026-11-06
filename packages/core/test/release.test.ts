// Add-on F3: release manifests, R's signatures, revocation, rebuild counts and the page check, with real signatures.
// The records are shaped as arkiv.ts reads them back; the live run publishes and reads the same entities.

import type { Address, Hex } from "@cloakroom/types";
import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { describe, expect, it } from "vitest";

import type { RebuildRecord, ReleaseRecord, ReleaseRevokeRecord } from "../src/arkiv";
import { randomBytes, utf8 } from "../src/crypto";
import {
  canonicalJson,
  compareToManifest,
  countRebuilds,
  manifestPath,
  manifestRootHash,
  parseManifest,
  sha256Hex,
  signRelease,
  validReleases,
  verifyLoaded,
  type ReleaseManifest,
} from "../src/release";
import { tarArchive } from "../src/swarm";

const ORIGIN = "https://cloakroom.vercel.app";
const ref = (): Hex => toHex(randomBytes(32));

const site = {
  "index.html": utf8("<html>home</html>"),
  "drive/index.html": utf8("<html>drive</html>"),
  "_next/static/chunks/app.js": utf8("console.log('app')"),
  "_next/static/css/app.css": utf8("body{}"),
};

function manifestOf(files: Record<string, Uint8Array>, version = "1.0.0"): ReleaseManifest {
  return {
    version,
    gitCommit: "abc1234",
    files: Object.fromEntries(Object.entries(files).map(([p, b]) => [p, sha256Hex(b)])),
  };
}

/** What a tab loaded: each URL with the hash of the bytes it got. */
function loadedFrom(files: Record<string, Uint8Array>, page = "drive/?f=0x12") {
  return [
    { url: `${ORIGIN}/${page}`, sha256: sha256Hex(files["drive/index.html"]!) },
    { url: `${ORIGIN}/_next/static/chunks/app.js`, sha256: sha256Hex(files["_next/static/chunks/app.js"]!) },
    { url: `${ORIGIN}/_next/static/css/app.css`, sha256: sha256Hex(files["_next/static/css/app.css"]!) },
  ];
}

let block = 100n;
async function release(r: Hex, manifest: ReleaseManifest, over: Partial<ReleaseRecord> = {}): Promise<ReleaseRecord> {
  const unsigned = {
    version: manifest.version,
    rootHash: manifestRootHash(manifest),
    gitCommit: manifest.gitCommit,
    manifestSwarmRef: ref(),
    siteSwarmRef: ref(),
  };
  const createdAtBlock = block++;
  return {
    ...unsigned,
    sig: await signRelease(r, unsigned),
    key: ref(),
    creator: privateKeyToAddress(r),
    owner: privateKeyToAddress(r),
    createdAtBlock,
    expiresAtBlock: createdAtBlock + 1_000_000n,
    readonly: true,
    ...over,
  };
}

const entity = (creator: Address) => {
  const createdAtBlock = block++;
  return { key: ref(), creator, owner: creator, createdAtBlock, expiresAtBlock: createdAtBlock + 1n, readonly: true };
};

describe("manifest", () => {
  it("canonical JSON sorts keys, so the root hash doesn't depend on insertion order", () => {
    const a = manifestOf(site);
    const b: ReleaseManifest = { gitCommit: a.gitCommit, files: Object.fromEntries(Object.entries(a.files).reverse()), version: a.version };
    expect(canonicalJson(a)).toBe(canonicalJson(b));
    expect(manifestRootHash(a)).toBe(manifestRootHash(b));
    expect(manifestRootHash({ ...a, version: "1.0.1" })).not.toBe(manifestRootHash(a));
  });

  it("round-trips through bytes and refuses malformed manifests", () => {
    const m = manifestOf(site);
    expect(parseManifest(utf8(JSON.stringify(m)))).toEqual(m);
    expect(() => parseManifest(utf8(JSON.stringify({ ...m, files: { "../x.js": "00" } })))).toThrow();
    expect(() => parseManifest(utf8(JSON.stringify({ ...m, files: { "a.js": "not-a-hash" } })))).toThrow();
    expect(() => parseManifest(utf8("{}"))).toThrow();
  });

  it("maps page URLs to manifest paths", () => {
    expect(manifestPath(`${ORIGIN}/`, ORIGIN)).toBe("index.html");
    expect(manifestPath(`${ORIGIN}/drive/?f=0x1#x`, ORIGIN)).toBe("drive/index.html");
    expect(manifestPath(`${ORIGIN}/_next/static/chunks/a.js?v=1`, ORIGIN)).toBe("_next/static/chunks/a.js");
    expect(manifestPath("https://evil.example/x.js", ORIGIN)).toBeNull();
  });
});

describe("comparing a page with a manifest", () => {
  it("an unmodified build matches", () => {
    expect(compareToManifest(loadedFrom(site), manifestOf(site), ORIGIN)).toEqual([]);
  });

  it("one byte changed in a served JS file is a mismatch", () => {
    const js = new Uint8Array(site["_next/static/chunks/app.js"]);
    js[0]! ^= 1;
    const tampered = { ...site, "_next/static/chunks/app.js": js };
    expect(compareToManifest(loadedFrom(tampered), manifestOf(site), ORIGIN)).toEqual(["_next/static/chunks/app.js"]);
  });

  it("a script that isn't in the release, or comes from another origin, is a mismatch", () => {
    const extra = [...loadedFrom(site), { url: `${ORIGIN}/_next/static/chunks/injected.js`, sha256: "00".repeat(32) }];
    expect(compareToManifest(extra, manifestOf(site), ORIGIN)).toEqual(["_next/static/chunks/injected.js"]);
    const external = [...loadedFrom(site), { url: "https://cdn.example/x.js", sha256: "00".repeat(32) }];
    expect(compareToManifest(external, manifestOf(site), ORIGIN)).toEqual(["https://cdn.example/x.js"]);
  });
});

describe("which releases count", () => {
  it("keeps R's signed, read-only releases newest first; drops forged, unsigned and revoked ones", async () => {
    const r = generatePrivateKey();
    const R = privateKeyToAddress(r);
    const old = await release(r, manifestOf(site, "1.0.0"));
    const current = await release(r, manifestOf(site, "1.1.0"));
    const forgedByOther = await release(generatePrivateKey(), manifestOf(site, "9.9.9"));
    const replayed = { ...current, key: ref(), creator: privateKeyToAddress(generatePrivateKey()) };
    const tampered = { ...(await release(r, manifestOf(site, "2.0.0"))), gitCommit: "evil" };
    const revokedOne = await release(r, manifestOf(site, "1.2.0"));
    const revokes: ReleaseRevokeRecord[] = [
      { ...entity(R), rootHash: revokedOne.rootHash },
      { ...entity(privateKeyToAddress(generatePrivateKey())), rootHash: current.rootHash }, // not R: ignored
    ];
    const { releases, ignored } = await validReleases([old, current, forgedByOther, replayed, tampered, revokedOne], revokes, R);
    expect(releases.map((x) => x.version)).toEqual(["1.1.0", "1.0.0"]);
    expect(ignored).toBe(3);
  });

  it("counts matching rebuilds once per independent writer, never R", () => {
    const R = privateKeyToAddress(generatePrivateKey());
    const root = toHex(randomBytes(32));
    const alice = privateKeyToAddress(generatePrivateKey());
    const bob = privateKeyToAddress(generatePrivateKey());
    const rebuilds: RebuildRecord[] = [
      { ...entity(alice), rootHash: root, matched: true },
      { ...entity(alice), rootHash: root, matched: true },
      { ...entity(bob), rootHash: root, matched: true },
      { ...entity(R), rootHash: root, matched: true },
      { ...entity(privateKeyToAddress(generatePrivateKey())), rootHash: root, matched: false },
      { ...entity(privateKeyToAddress(generatePrivateKey())), rootHash: toHex(randomBytes(32)), matched: true },
    ];
    expect(countRebuilds(rebuilds, root, R)).toBe(2);
  });
});

describe("verifyLoaded", () => {
  async function sources(opts: { revokeLatest?: boolean; manifests?: Record<string, ReleaseManifest>; noReleases?: boolean } = {}) {
    const r = generatePrivateKey();
    const R = privateKeyToAddress(r);
    const manifest = manifestOf(site, "1.0.0");
    const rel = await release(r, manifest);
    const stored = new Map<string, Uint8Array>([[rel.manifestSwarmRef, utf8(JSON.stringify(opts.manifests?.[rel.manifestSwarmRef] ?? manifest))]]);
    const rebuilder = privateKeyToAddress(generatePrivateKey());
    return {
      rel,
      stored,
      src: {
        signer: R,
        listReleases: async () => (opts.noReleases ? [] : [rel]),
        listRevokes: async () => (opts.revokeLatest ? [{ ...entity(R), rootHash: rel.rootHash }] : []),
        listRebuilds: async () => [{ ...entity(rebuilder), rootHash: rel.rootHash, matched: true }],
        fetchManifest: async (h: Hex) => {
          const bytes = stored.get(h);
          if (!bytes) throw new Error("not on Swarm");
          return bytes;
        },
      },
    };
  }

  it("an unmodified build is verified, with its version, commit and rebuild count", async () => {
    const { src, rel } = await sources();
    expect(await verifyLoaded(src, loadedFrom(site), ORIGIN)).toEqual({
      status: "verified",
      version: "1.0.0",
      gitCommit: "abc1234",
      rebuilds: 1,
      siteSwarmRef: rel.siteSwarmRef,
    });
  });

  it("one altered byte is a mismatch naming the file, with the verified copy to open instead", async () => {
    const { src, rel } = await sources();
    const css = new Uint8Array(site["_next/static/css/app.css"]);
    css[2]! ^= 1;
    const result = await verifyLoaded(src, loadedFrom({ ...site, "_next/static/css/app.css": css }), ORIGIN);
    expect(result).toEqual({ status: "mismatch", mismatchedFiles: ["_next/static/css/app.css"], siteSwarmRef: rel.siteSwarmRef });
  });

  it("a revoked release no longer verifies anything", async () => {
    const { src } = await sources({ revokeLatest: true });
    expect((await verifyLoaded(src, loadedFrom(site), ORIGIN)).status).toBe("unknown");
  });

  it("a manifest on Swarm that isn't the one R signed is not trusted", async () => {
    const swapped = manifestOf({ ...site, "_next/static/chunks/app.js": utf8("evil()") });
    const { src, rel, stored } = await sources();
    stored.set(rel.manifestSwarmRef, utf8(JSON.stringify(swapped)));
    const evilLoaded = loadedFrom({ ...site, "_next/static/chunks/app.js": utf8("evil()") });
    expect((await verifyLoaded(src, evilLoaded, ORIGIN)).status).not.toBe("verified");
  });

  it("no published release is 'unknown', never 'verified'", async () => {
    const { src } = await sources({ noReleases: true });
    expect(await verifyLoaded(src, loadedFrom(site), ORIGIN)).toMatchObject({ status: "unknown" });
  });
});

describe("tar for the Swarm site upload", () => {
  it("writes valid ustar headers with checksums, padding and the end marker", () => {
    const tar = tarArchive([
      { path: "index.html", bytes: utf8("hi") },
      { path: `${"deep/".repeat(25)}file.js`, bytes: utf8("x".repeat(600)) },
    ]);
    expect(tar.length % 512).toBe(0);
    const header = tar.subarray(0, 512);
    expect(new TextDecoder().decode(header.subarray(0, 10))).toBe("index.html");
    expect(new TextDecoder().decode(header.subarray(257, 262))).toBe("ustar");
    const stored = parseInt(new TextDecoder().decode(header.subarray(148, 154)), 8);
    const copy = new Uint8Array(header);
    copy.fill(0x20, 148, 156);
    expect(copy.reduce((s, b) => s + b, 0)).toBe(stored);
    expect(parseInt(new TextDecoder().decode(header.subarray(124, 135)), 8)).toBe(2);
    // second header after one padded data block; long path split into prefix + name
    const second = tar.subarray(1024, 1536);
    expect(new TextDecoder().decode(second.subarray(0, 7))).toBe("file.js");
    expect(tar.subarray(tar.length - 1024).every((b) => b === 0)).toBe(true);
    // the same files always give the same archive
    expect(tarArchive([{ path: "index.html", bytes: utf8("hi") }])).toEqual(tarArchive([{ path: "index.html", bytes: utf8("hi") }]));
  });
});
