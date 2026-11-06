// Add-on F3 against the real static export (apps/web/out): serve it over HTTP, collect what each page loads the way
// the extension's content script does (the page URL plus every script and stylesheet it references), re-download and
// hash them the way the background worker does, and check them with verifyLoaded against a manifest of the build and a
// release signed by a fresh R. Then change one byte of a real chunk and expect a mismatch naming it.
// Skipped when there is no build: run `next build` in apps/web first.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Hex } from "@cloakroom/types";
import { toHex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import type { ReleaseRecord } from "../src/arkiv";
import { randomBytes, utf8 } from "../src/crypto";
import {
  manifestRootHash,
  MANIFEST_EXTENSIONS,
  sha256Hex,
  signRelease,
  verifyLoaded,
  type LoadedFile,
  type ReleaseManifest,
} from "../src/release";

const OUT = resolve(dirname(fileURLToPath(import.meta.url)), "../../../apps/web/out");
const built = existsSync(join(OUT, "index.html"));

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(relative(OUT, full).split(sep).join("/"));
  }
  return out;
}

/** Bytes the server sends; a test can swap one file to play a hacked host. */
const overrides = new Map<string, Uint8Array>();
let server: Server;
let origin = "";

beforeAll(async () => {
  if (!built) return;
  server = createServer((req, res) => {
    let path = decodeURIComponent(new URL(req.url ?? "/", "http://x").pathname).replace(/^\/+/, "");
    if (path === "" || path.endsWith("/")) path += "index.html";
    const body = overrides.get(path) ?? (existsSync(join(OUT, path)) ? readFileSync(join(OUT, path)) : null);
    if (!body) return void res.writeHead(404).end();
    res.writeHead(200, { "content-type": extname(path) === ".js" ? "text/javascript" : "text/plain" }).end(body);
  });
  await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
});
afterAll(() => server?.close());

/** The content script's view: the page plus the scripts and stylesheets its HTML references. */
async function pageLoads(page: string): Promise<string[]> {
  const html = await (await fetch(`${origin}/${page}`)).text();
  const refs = [...html.matchAll(/<(?:script[^>]*\ssrc|link[^>]*\shref)="([^"]+\.(?:js|css)[^"]*)"/g)].map((m) => m[1]!);
  return [`${origin}/${page}`, ...refs.map((r) => new URL(r, `${origin}/${page}`).href)];
}

/** The background worker's view: re-download and hash. */
async function hashAll(urls: string[]): Promise<LoadedFile[]> {
  return Promise.all(
    urls.map(async (url) => ({ url, sha256: sha256Hex(new Uint8Array(await (await fetch(url)).arrayBuffer())) })),
  );
}

describe.skipIf(!built)("a real static build", () => {
  const manifest: ReleaseManifest = { version: "test", gitCommit: "local", files: {} };
  let sources: Parameters<typeof verifyLoaded>[0];

  beforeAll(async () => {
    for (const path of walk(OUT)) {
      if (path === "release-manifest.json" || !MANIFEST_EXTENSIONS.some((e) => path.endsWith(e))) continue;
      manifest.files[path] = sha256Hex(new Uint8Array(readFileSync(join(OUT, path))));
    }
    const r = generatePrivateKey();
    const unsigned = {
      version: manifest.version,
      rootHash: manifestRootHash(manifest),
      gitCommit: manifest.gitCommit,
      manifestSwarmRef: toHex(randomBytes(32)) as Hex,
      siteSwarmRef: toHex(randomBytes(32)) as Hex,
    };
    const release: ReleaseRecord = {
      ...unsigned,
      sig: await signRelease(r, unsigned),
      key: toHex(randomBytes(32)),
      creator: privateKeyToAddress(r),
      owner: privateKeyToAddress(r),
      createdAtBlock: 1n,
      expiresAtBlock: 2n,
      readonly: true,
    };
    const manifestBytes = utf8(JSON.stringify(manifest));
    sources = {
      signer: privateKeyToAddress(r),
      listReleases: async () => [release],
      listRevokes: async () => [],
      listRebuilds: async () => [],
      fetchManifest: async () => manifestBytes,
    };
  });

  it("every exported page verifies, with each file it loads in the manifest", async () => {
    const pages = walk(OUT)
      .filter((p) => p.endsWith("index.html"))
      .map((p) => p.replace(/index\.html$/, ""));
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      const loaded = await hashAll(await pageLoads(page));
      expect(loaded.length).toBeGreaterThan(1);
      expect(await verifyLoaded(sources, loaded, origin), page || "/").toMatchObject({ status: "verified" });
    }
  });

  it("one changed byte in a served chunk is a mismatch naming that file", async () => {
    const urls = await pageLoads("drive/");
    const chunk = urls.find((u) => u.endsWith(".js"))!;
    const path = new URL(chunk).pathname.slice(1);
    const bytes = new Uint8Array(readFileSync(join(OUT, path)));
    bytes[bytes.length - 1]! ^= 1;
    overrides.set(path, bytes);
    try {
      expect(await verifyLoaded(sources, await hashAll(urls), origin)).toMatchObject({
        status: "mismatch",
        mismatchedFiles: [path],
      });
    } finally {
      overrides.delete(path);
    }
  });
});
