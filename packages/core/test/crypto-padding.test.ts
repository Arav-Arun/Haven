import { secp256k1 } from "@noble/curves/secp256k1";
import fc from "fast-check";
import { hexToBytes } from "viem";
import { describe, expect, it } from "vitest";

import { AES_OVERHEAD, aesDecrypt, aesEncrypt, equalBytes, hkdf, randomBytes, toPrivateKey } from "../src/crypto";
import { decryptPadded, encryptPadded, MAX_FILE_BYTES, PAD_BUCKETS, paddedSize } from "../src/padding";

const key32 = fc.uint8Array({ minLength: 32, maxLength: 32 });

describe("AES-256-GCM", () => {
  it("round-trips, and any flipped byte, wrong key or wrong aad is rejected", async () => {
    await fc.assert(
      fc.asyncProperty(key32, fc.uint8Array({ maxLength: 2048 }), fc.uint8Array({ maxLength: 40 }), fc.nat(), async (key, plain, aad, flip) => {
        const sealed = await aesEncrypt(key, plain, aad);
        expect(sealed.length).toBe(plain.length + AES_OVERHEAD);
        expect(await aesDecrypt(key, sealed, aad)).toEqual(plain);

        const tampered = sealed.slice();
        tampered[flip % tampered.length]! ^= 0x01;
        await expect(aesDecrypt(key, tampered, aad)).rejects.toThrow();
        const otherKey = key.slice();
        otherKey[0]! ^= 0xff;
        await expect(aesDecrypt(otherKey, sealed, aad)).rejects.toThrow();
        await expect(aesDecrypt(key, sealed, new Uint8Array([...aad, 1]))).rejects.toThrow();
      }),
      { numRuns: 50 },
    );
  });
});

describe("randomBytes", () => {
  it("serves more than WebCrypto's 64 KiB per-call limit, and isn't all zeros past the first chunk", () => {
    const bytes = randomBytes(200_000);
    expect(bytes).toHaveLength(200_000);
    expect(bytes.subarray(65_536).some((b) => b !== 0)).toBe(true);
    expect(bytes.subarray(131_072).some((b) => b !== 0)).toBe(true);
  });
});

describe("HKDF and private keys", () => {
  it("HKDF is deterministic and separates labels", () => {
    const ikm = randomBytes(32);
    expect(hkdf(ikm, "drive")).toEqual(hkdf(ikm, "drive"));
    expect(equalBytes(hkdf(ikm, "drive"), hkdf(ikm, "room/0"))).toBe(false);
    expect(hkdf(ikm, "x", 64)).toHaveLength(64);
  });

  it("toPrivateKey always gives a valid secp256k1 key, including edge inputs", () => {
    const n = secp256k1.CURVE.n;
    const edges = [new Uint8Array(32), new Uint8Array(32).fill(0xff), hexToBytes(`0x${n.toString(16)}`)];
    for (const e of edges) expect(secp256k1.utils.isValidPrivateKey(hexToBytes(toPrivateKey(e)))).toBe(true);
    fc.assert(
      fc.property(key32, (m) => {
        expect(secp256k1.utils.isValidPrivateKey(hexToBytes(toPrivateKey(m)))).toBe(true);
      }),
    );
  });
});

describe("padding", () => {
  it("bucket boundaries: an exact fit stays, one more byte moves up, past the cap is TOO_LARGE", () => {
    const overhead = 4 + AES_OVERHEAD;
    expect(paddedSize(0)).toBe(PAD_BUCKETS[0]);
    for (let b = 0; b < PAD_BUCKETS.length - 1; b++) {
      expect(paddedSize(PAD_BUCKETS[b]! - overhead)).toBe(PAD_BUCKETS[b]);
      expect(paddedSize(PAD_BUCKETS[b]! - overhead + 1)).toBe(PAD_BUCKETS[b + 1]);
    }
    expect(paddedSize(MAX_FILE_BYTES)).toBe(32 * 1024 * 1024);
    expect(() => paddedSize(MAX_FILE_BYTES + 1)).toThrow(expect.objectContaining({ code: "TOO_LARGE" }));
  });

  it("an encrypted file is exactly a bucket size and round-trips", async () => {
    await fc.assert(
      fc.asyncProperty(key32, fc.integer({ min: 0, max: 300_000 }), async (key, length) => {
        const data = randomBytes(length);
        const blob = await encryptPadded(key, data);
        expect(blob.length).toBe(paddedSize(length));
        expect(PAD_BUCKETS).toContain(blob.length);
        expect(await decryptPadded(key, blob)).toEqual(data);
      }),
      { numRuns: 20 },
    );
  });

  it("files of different sizes in one bucket are indistinguishable by length", async () => {
    const key = randomBytes(32);
    const small = await encryptPadded(key, randomBytes(10));
    const large = await encryptPadded(key, randomBytes(60_000));
    expect(small.length).toBe(large.length);
  });
});
