// Low-level crypto shared by keys, epochs, padding and stealth.
// - HKDF-SHA256 and SHA-256: @noble/hashes (synchronous, audited, same in Node, browser and extension).
// - AES-256-GCM and randomness: WebCrypto (globalThis.crypto), available in all three.

import { secp256k1 } from "@noble/curves/secp256k1";
import { hkdf as nobleHkdf } from "@noble/hashes/hkdf";
import { sha256 as nobleSha256 } from "@noble/hashes/sha2";
import { bytesToBigInt, numberToHex, type Hex } from "viem";

/** Domain-separation salt for every HKDF call in Cloakroom. Changing it changes every derived key. */
const HKDF_SALT = utf8("cloakroom/v1");

const AES_NONCE_BYTES = 12;
const AES_TAG_BYTES = 16;
/** Bytes AES-GCM adds to a plaintext: the nonce in front and the tag at the end. */
export const AES_OVERHEAD = AES_NONCE_BYTES + AES_TAG_BYTES;

export function utf8(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

export function concatBytes(...parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
}

/** Compares in time independent of where the first difference is. */
export function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= (a[i] ?? 0) ^ (b[i] ?? 0);
  return diff === 0;
}

/** WebCrypto refuses more than this many bytes per getRandomValues call. */
const MAX_RANDOM_CHUNK = 65_536;

export function randomBytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let offset = 0; offset < length; offset += MAX_RANDOM_CHUNK) {
    globalThis.crypto.getRandomValues(out.subarray(offset, Math.min(length, offset + MAX_RANDOM_CHUNK)));
  }
  return out;
}

export function sha256(data: Uint8Array): Uint8Array {
  return nobleSha256(data);
}

/** HKDF-SHA256 with the Cloakroom salt. `info` names the purpose, e.g. "drive", "room/3", "welcome". */
export function hkdf(ikm: Uint8Array, info: string, length = 32): Uint8Array {
  return nobleHkdf(nobleSha256, ikm, HKDF_SALT, utf8(info), length);
}

/** Maps 32+ bytes of key material to a valid secp256k1 private key in [1, n-1]. The bias is negligible (~2^-128). */
export function toPrivateKey(material: Uint8Array): Hex {
  const n = secp256k1.CURVE.n;
  return numberToHex((bytesToBigInt(material) % (n - 1n)) + 1n, { size: 32 });
}

/** Copies into a fresh ArrayBuffer-backed array, which is what WebCrypto's types accept. */
function own(bytes: Uint8Array): Uint8Array<ArrayBuffer> {
  return new Uint8Array(bytes);
}

async function aesKey(key: Uint8Array, usage: "encrypt" | "decrypt"): Promise<CryptoKey> {
  if (key.length !== 32) throw new Error("AES-256-GCM needs a 32-byte key");
  return globalThis.crypto.subtle.importKey("raw", own(key), "AES-GCM", false, [usage]);
}

/** AES-256-GCM. Returns nonce ‖ ciphertext ‖ tag. `aad` binds the ciphertext to its context (e.g. a folder). */
export async function aesEncrypt(key: Uint8Array, plaintext: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  const iv = randomBytes(AES_NONCE_BYTES);
  const params: AesGcmParams = { name: "AES-GCM", iv: own(iv), tagLength: AES_TAG_BYTES * 8 };
  if (aad) params.additionalData = own(aad);
  const sealed = await globalThis.crypto.subtle.encrypt(params, await aesKey(key, "encrypt"), own(plaintext));
  return concatBytes(iv, new Uint8Array(sealed));
}

/** Inverse of aesEncrypt. Throws if the key, the aad or any byte is wrong. */
export async function aesDecrypt(key: Uint8Array, sealed: Uint8Array, aad?: Uint8Array): Promise<Uint8Array> {
  if (sealed.length < AES_OVERHEAD) throw new Error("ciphertext too short");
  const params: AesGcmParams = {
    name: "AES-GCM",
    iv: own(sealed.subarray(0, AES_NONCE_BYTES)),
    tagLength: AES_TAG_BYTES * 8,
  };
  if (aad) params.additionalData = own(aad);
  const plain = await globalThis.crypto.subtle.decrypt(
    params,
    await aesKey(key, "decrypt"),
    own(sealed.subarray(AES_NONCE_BYTES)),
  );
  return new Uint8Array(plain);
}
