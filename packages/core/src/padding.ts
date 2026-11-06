// Padding: every encrypted file is exactly one bucket size, so its real size doesn't show
// (HAVEN_PLAN.md section 7). The AES-GCM nonce and tag are counted inside the bucket.
//
//   blob = AES-GCM(fileKey, [4-byte big-endian length][data][zeros])  →  nonce ‖ ciphertext ‖ tag
//   len(blob) = bucket, exactly

import { DriveError } from "@haven/types";

import { AES_OVERHEAD, aesDecrypt, aesEncrypt } from "./crypto";

const KiB = 1024;
const MiB = 1024 * KiB;

/** Blob sizes. Every encrypted file is exactly one of these. */
export const PAD_BUCKETS = [64 * KiB, 256 * KiB, 1 * MiB, 4 * MiB, 16 * MiB, 32 * MiB] as const;

/** Largest file accepted (the plan's 25 MB; the API enforces the same cap). */
export const MAX_FILE_BYTES = 25 * MiB;

const LENGTH_PREFIX = 4;

/** The blob size a file of `plainLength` bytes ends up as. */
export function paddedSize(plainLength: number): number {
  if (!Number.isInteger(plainLength) || plainLength < 0) throw new RangeError("length must be a whole number ≥ 0");
  if (plainLength > MAX_FILE_BYTES) throw new DriveError("TOO_LARGE", `files are limited to ${MAX_FILE_BYTES} bytes`);
  const needed = plainLength + LENGTH_PREFIX + AES_OVERHEAD;
  const bucket = PAD_BUCKETS.find((b) => b >= needed);
  if (bucket === undefined) throw new DriveError("TOO_LARGE");
  return bucket;
}

/** Frames and zero-pads `data` so that, once encrypted, it is exactly one bucket. */
export function pad(data: Uint8Array): Uint8Array {
  const framed = new Uint8Array(paddedSize(data.length) - AES_OVERHEAD);
  new DataView(framed.buffer).setUint32(0, data.length, false);
  framed.set(data, LENGTH_PREFIX);
  return framed;
}

export function unpad(framed: Uint8Array): Uint8Array {
  if (framed.length < LENGTH_PREFIX) throw new Error("padded data too short");
  const length = new DataView(framed.buffer, framed.byteOffset, framed.byteLength).getUint32(0, false);
  if (length > framed.length - LENGTH_PREFIX) throw new Error("corrupt padding length");
  return framed.slice(LENGTH_PREFIX, LENGTH_PREFIX + length);
}

/** Pads, then encrypts with a per-file key. The result's length is always a bucket size. */
export async function encryptPadded(fileKey: Uint8Array, data: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  return aesEncrypt(fileKey, pad(data), aad);
}

export async function decryptPadded(fileKey: Uint8Array, blob: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  return unpad(await aesDecrypt(fileKey, blob, aad));
}
