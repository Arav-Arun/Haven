// Add-on F3 against the real static export (apps/web/out), not hand-made fixtures: serve it over HTTP, collect what each
// page loads (the page plus every script and stylesheet it references), re-download and hash them as a verifier
// would, and compare with a manifest of the build.
// Then change one byte of a real chunk and expect a mismatch naming it.
// Skipped when there is no build: run `next build` in apps/web first.

import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { dirname, extname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { utf8 } from "../src/crypto";
import {
  buildManifest,
  canonicalJson,
  compareWithManifest,
  manifestMatches,
  manifestPath,
  rootHashOf,
  sha256Hex,
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

/** A verifier's view: manifest path → sha256 of a fresh download, null for another origin. */
async function hashAll(urls: string[]): Promise<Map<string, string | null>> {
  const loaded = new Map<string, string | null>();
  for (const url of urls) {
    const path = manifestPath(url, origin);
    if (path === null) loaded.set(url, null);
    else loaded.set(path, sha256Hex(new Uint8Array(await (await fetch(url)).arrayBuffer())));
  }
  return loaded;
}

describe.skipIf(!built)("a real static build", () => {
  let manifest: ReleaseManifest;

  beforeAll(() => {
    manifest = buildManifest(
      walk(OUT).map((path) => ({ path, bytes: new Uint8Array(readFileSync(join(OUT, path))) })),
      { version: "test", gitCommit: "local", publicEnv: {} },
    );
  });

  it("the manifest round-trips through its root hash, as a verifier reads it from Swarm", () => {
    expect(manifestMatches(utf8(canonicalJson(manifest)), rootHashOf(manifest))).toEqual(manifest);
  });

  it("every exported page verifies, with each file it loads in the manifest", async () => {
    const pages = walk(OUT)
      .filter((p) => p.endsWith("index.html"))
      .map((p) => p.replace(/index\.html$/, ""));
    expect(pages.length).toBeGreaterThan(5);
    for (const page of pages) {
      const loaded = await hashAll(await pageLoads(page));
      expect(loaded.size).toBeGreaterThan(1);
      expect(compareWithManifest(loaded, manifest), page || "/").toEqual([]);
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
      expect(compareWithManifest(await hashAll(urls), manifest)).toEqual([path]);
    } finally {
      overrides.delete(path);
    }
  });
});
