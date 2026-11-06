// Key copies (cloak.keycopy): one per member per folder version, sealed so only that member opens it.
//   members  get { epoch, version, j, E_v[j] }   (j = last epoch ending at or before their end; N if no end)
//   managers get { secret, version, FS_v }
// Sealed with a key from the member's MK_S (from their welcome note), or, for the user's own copies, from
// HKDF(K or K_room, folder) (keys.ownSealKey). Each copy is bound to its folder and version.

import type { Address } from "@cloakroom/types";

import { aesDecrypt, aesEncrypt, hkdf } from "./crypto";
import { EPOCHS } from "./epochs";
import { folderAad } from "./stealth";

export type KeyCopy =
  | { kind: "epoch"; version: number; index: number; key: Uint8Array }
  | { kind: "secret"; version: number; key: Uint8Array };

const KIND_CODES = { epoch: 0, secret: 1 } as const;
const ENCODED_LENGTH = 1 + 4 + 4 + 32;

function encode(copy: KeyCopy): Uint8Array {
  if (copy.key.length !== 32) throw new Error("key must be 32 bytes");
  if (!Number.isInteger(copy.version) || copy.version < 0 || copy.version > 0xffffffff) {
    throw new RangeError("bad version");
  }
  const index = copy.kind === "epoch" ? copy.index : 0;
  if (!Number.isInteger(index) || index < 0 || index > EPOCHS) throw new RangeError("bad epoch index");
  const out = new Uint8Array(ENCODED_LENGTH);
  const view = new DataView(out.buffer);
  out[0] = KIND_CODES[copy.kind];
  view.setUint32(1, copy.version, false);
  view.setUint32(5, index, false);
  out.set(copy.key, 9);
  return out;
}

function decode(bytes: Uint8Array): KeyCopy {
  if (bytes.length !== ENCODED_LENGTH) throw new Error("malformed key copy");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const version = view.getUint32(1, false);
  const key = bytes.slice(9);
  if (bytes[0] === KIND_CODES.secret) return { kind: "secret", version, key };
  if (bytes[0] === KIND_CODES.epoch) {
    const index = view.getUint32(5, false);
    if (index > EPOCHS) throw new Error("malformed key copy");
    return { kind: "epoch", version, index, key };
  }
  throw new Error("malformed key copy");
}

function copyKey(sealMaterial: Uint8Array, folder: Address, version: number): Uint8Array {
  return hkdf(sealMaterial, `keycopy/${folder.toLowerCase()}/${version}`);
}

/** `sealMaterial` is MK_S for a member, or ownSealKey(K, folder) for the user's own copy. */
export async function sealKeyCopy(sealMaterial: Uint8Array, folder: Address, copy: KeyCopy): Promise<Uint8Array> {
  return aesEncrypt(copyKey(sealMaterial, folder, copy.version), encode(copy), folderAad(folder));
}

/** Throws if the copy isn't sealed for this material, folder and version. */
export async function openKeyCopy(
  sealMaterial: Uint8Array,
  folder: Address,
  version: number,
  sealed: Uint8Array,
): Promise<KeyCopy> {
  const copy = decode(await aesDecrypt(copyKey(sealMaterial, folder, version), sealed, folderAad(folder)));
  if (copy.version !== version) throw new Error("key copy is for another version");
  return copy;
}
