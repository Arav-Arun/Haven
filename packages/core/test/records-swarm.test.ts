import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import type { AnonFetch, AnonStatus, ReceiptStep } from "@haven/types";
import fc from "fast-check";
import { getAddress, toHex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { arkivEndpoint, expiryAt, weekBucket, WEEK_SECONDS } from "../src/arkiv";
import { randomBytes } from "../src/crypto";
import { encryptPadded, PAD_BUCKETS } from "../src/padding";
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
  type FilePlace,
} from "../src/records";
import {
  downloadEncrypted,
  downloadFolderBlobs,
  normalizeRef,
  signUpload,
  uploadEncrypted,
  uploadHeaders,
  verifyUpload,
} from "../src/swarm";

const folder = getAddress(toHex(randomBytes(20)));
const otherFolder = getAddress(toHex(randomBytes(20)));

describe("sealed records", () => {
  it("file meta opens only with its epoch key at its exact place", async () => {
    await fc.assert(
      fc.asyncProperty(
        fc.string({ maxLength: 200 }),
        fc.nat(25 * 1024 * 1024),
        fc.nat(8760),
        fc.integer({ min: 1, max: 50 }),
        async (name, size, epoch, version) => {
          const key = randomBytes(32);
          const place: FilePlace = { folder, fileId: newFileId(), version, epoch, swarmRef: toHex(randomBytes(32)) };
          const meta = { name, mime: "application/pdf", size, fileKey: randomBytes(32) };
          const sealed = await sealFileMeta(key, place, meta);
          expect(await openFileMeta(key, place, sealed)).toEqual(meta);
          for (const moved of [
            { ...place, folder: otherFolder },
            { ...place, fileId: newFileId() },
            { ...place, version: version + 1 },
            { ...place, epoch: epoch + 1 },
            { ...place, swarmRef: toHex(randomBytes(32)) },
          ]) {
            await expect(openFileMeta(key, moved, sealed)).rejects.toThrow();
          }
          await expect(openFileMeta(randomBytes(32), place, sealed)).rejects.toThrow();
        },
      ),
      { numRuns: 30 },
    );
  });

  it("folder names, rosters and link bundles round-trip and are bound to their place", async () => {
    const key = randomBytes(32);
    const name = await sealFolderName(key, folder, 3, "Series A");
    expect(await openFolderName(key, folder, 3, name)).toBe("Series A");
    await expect(openFolderName(key, folder, 4, name)).rejects.toThrow();

    const member = {
      address: getAddress(toHex(randomBytes(20))),
      memberKey: randomBytes(32),
      role: "editor" as const,
      until: 1_800_000_000,
      hiddenFromMembers: true,
      label: "vc.haven.eth",
      via: "direct" as const,
    };
    const roster = { managers: [{ ...member, role: "manager" as const, until: null, label: null }], members: [member] };
    const sealed = await sealRoster(key, folder, 2, roster);
    expect(await openRoster(key, folder, 2, sealed)).toEqual(roster);
    await expect(openRoster(key, otherFolder, 2, sealed)).rejects.toThrow();
    // the two halves can't be swapped
    await expect(openRoster(key, folder, 2, { managers: sealed.members, members: sealed.managers })).rejects.toThrow();

    const bundle = {
      folder,
      fileId: newFileId(),
      swarmRef: toHex(randomBytes(32)),
      name: "deck.pdf",
      mime: "application/pdf",
      size: 1234,
      fileKey: randomBytes(32),
    };
    const sealedLink = await sealLinkBundle(key, "0xabc", bundle);
    expect(await openLinkBundle(key, "0xabc", sealedLink)).toEqual(bundle);
    await expect(openLinkBundle(key, "0xabd", sealedLink)).rejects.toThrow();
  });
});

describe("arkiv helpers", () => {
  it("expiry: the member's end when Arkiv can keep it that long, else the longest lifetime; never in the past", () => {
    const now = 1_800_000_000;
    expect(expiryAt(null, now).minLifetime).toBe(7_884_000n);
    expect(expiryAt(now + 400 * 24 * 3600, now).minLifetime).toBe(7_884_000n);
    const soon = expiryAt(now + 3600, now);
    expect(soon.expiresAt).toEqual(new Date((now + 3600) * 1000));
    expect(() => expiryAt(now - 1, now)).toThrow(expect.objectContaining({ code: "EXPIRED" }));
  });

  it("week buckets and the access-key endpoint", () => {
    expect(weekBucket(WEEK_SECONDS * 2900 + 5)).toBe(2900);
    expect(weekBucket(WEEK_SECONDS * 2900 - 1)).toBe(2899);
    expect(arkivEndpoint("https://rpc.example/", "k/ey")).toBe("https://rpc.example/k%2Fey");
    expect(arkivEndpoint("https://rpc.example", "")).toBe("https://rpc.example");
  });
});

describe("signed uploads", () => {
  const writer = privateKeyToAccount(generatePrivateKey());
  const headersOf = (h: Record<string, string>) => new Headers(h);

  it("verifies only the exact body, signer, folder and a fresh time", async () => {
    const body = randomBytes(1000);
    const auth = await signUpload(writer, folder, body, 1_800_000_000);
    const headers = uploadHeaders(auth);
    expect(await verifyUpload(headersOf(headers), body, 1_800_000_100)).toMatchObject({
      folder,
      signer: writer.address,
    });
    const tampered = body.slice();
    tampered[0]! ^= 1;
    await expect(verifyUpload(headersOf(headers), tampered, 1_800_000_100)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(
      verifyUpload(headersOf({ ...headers, "x-haven-folder": otherFolder }), body, 1_800_000_100),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    const other = privateKeyToAccount(generatePrivateKey()).address;
    await expect(
      verifyUpload(headersOf({ ...headers, "x-haven-signer": other }), body, 1_800_000_100),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(verifyUpload(headersOf(headers), body, 1_800_000_301)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(verifyUpload(headersOf({}), body)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});

// A local HTTP server standing in for the API's /upload and Bee's /bytes, to check routing, sizes and errors.
describe("swarm client", () => {
  let server: Server;
  let base: string;
  const stored = new Map<string, Uint8Array>();
  beforeAll(async () => {
    server = createServer((req, res) => {
      const chunks: Buffer[] = [];
      req.on("data", (c: Buffer) => chunks.push(c));
      req.on("end", async () => {
        if (req.method === "POST" && req.url === "/upload") {
          const body = new Uint8Array(Buffer.concat(chunks));
          try {
            await verifyUpload({ get: (n) => (req.headers[n] as string | undefined) ?? null }, body);
          } catch {
            res.writeHead(403).end();
            return;
          }
          const reference = toHex(randomBytes(32)).slice(2);
          stored.set(reference, body);
          res.writeHead(201, { "content-type": "application/json" }).end(JSON.stringify({ reference }));
          return;
        }
        const match = req.url?.match(/^\/bytes\/([0-9a-f]{64})$/);
        if (req.method === "GET" && match) {
          const data = match[1] === "f".repeat(64) ? new Uint8Array(1000) : stored.get(match[1]!);
          if (!data) res.writeHead(404).end();
          else res.writeHead(200).end(Buffer.from(data));
          return;
        }
        res.writeHead(404).end();
      });
    });
    await new Promise<void>((ok) => server.listen(0, "127.0.0.1", ok));
    base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  });
  afterAll(() => server.close());

  function anon(supportsAnyHttps: boolean): AnonFetch {
    const status: AnonStatus = { network: "nym", state: "ready" };
    return {
      fetch: globalThis.fetch,
      isolated: () => globalThis.fetch,
      supportsAnyHttps,
      status: () => status,
      onStatus: () => () => {},
      close: () => {},
    };
  }

  it("uploads padded ciphertext, downloads it back, and records the route honestly", async () => {
    const writer = privateKeyToAccount(generatePrivateKey());
    const blob = await encryptPadded(randomBytes(32), randomBytes(5000));
    const routed = { apiUrl: base, beeUrl: base, anon: anon(true) };
    const steps: ReceiptStep[] = [];
    const ref = await uploadEncrypted(routed, writer, folder, blob, (s) => steps.push(s), "0xS");
    expect(steps).toEqual([
      expect.objectContaining({ kind: "route", route: "anon", isolationKey: "0xS" }),
      expect.objectContaining({ kind: "swarm", ref, paddedBytes: PAD_BUCKETS[0], ok: true }),
    ]);

    const directSteps: ReceiptStep[] = [];
    const direct = { apiUrl: base, beeUrl: base, anon: anon(false) };
    expect(await downloadEncrypted(direct, ref, (s) => directSteps.push(s))).toEqual(blob);
    expect(directSteps[0]).toMatchObject({ kind: "route", route: "direct", network: "nym" });

    const progress: number[] = [];
    const all = await downloadFolderBlobs(direct, [ref, ref.toUpperCase().replace("0X", "0x") as `0x${string}`], (p) => progress.push(p));
    expect([...all.keys()]).toEqual([normalizeRef(ref)]);
    expect(progress.at(-1)).toBe(1);
  });

  it("refuses unpadded uploads, odd-sized downloads, missing blobs and unauthorised uploads", async () => {
    const writer = privateKeyToAccount(generatePrivateKey());
    const config = { apiUrl: base, beeUrl: base, anon: anon(true) };
    await expect(uploadEncrypted(config, writer, folder, randomBytes(1000))).rejects.toThrow("padded");
    await expect(downloadEncrypted(config, `0x${"f".repeat(64)}`)).rejects.toThrow("not a padded");
    await expect(downloadEncrypted(config, `0x${"e".repeat(64)}`)).rejects.toMatchObject({ code: "NOT_FOUND" });
    // a signature over a different body is refused by the server
    const blob = await encryptPadded(randomBytes(32), randomBytes(10));
    const auth = await signUpload(writer, folder, randomBytes(10));
    const res = await fetch(`${base}/upload`, { method: "POST", headers: uploadHeaders(auth), body: Buffer.from(blob) });
    expect(res.status).toBe(403);
  });
});
