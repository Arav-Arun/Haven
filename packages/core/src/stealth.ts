// Private shares: stealth member addresses and welcome notes (HAVEN_PLAN.md section 7, "Private share").
//
// Sharer, given the recipient's spending public key P (their haven.key record):
//   e random;  S = Fluidkey generateStealthAddresses([P], e)        ← the address that gets the onchain grant
//   note = { e·G, AES-GCM(HKDF(ECDH(e, P), "welcome"), MK_S, aad = folder) }
// Recipient, for each note:
//   ECDH(s, e·G) is the same shared secret → opens MK_S, or fails (the note is for someone else)
//   S's private key = Fluidkey generateStealthPrivateKey(s, e·G)
// The kit hashes the same ECDH secret with keccak256 for S; the seal uses HKDF with its own label, so the two never
// share a key.

import { generateStealthAddresses, generateStealthPrivateKey } from "@fluidkey/stealth-account-kit";
import { DriveError, type Address, type Hex } from "@haven/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, getAddress, hexToBytes } from "viem";
import { privateKeyToAddress } from "viem/accounts";

import { aesDecrypt, aesEncrypt, hkdf, randomBytes } from "./crypto";

/** What goes on Arkiv as haven.welcome (besides the folder and the week bucket). */
export interface WelcomeNote {
  /** e·G, uncompressed. */
  ephemeralPublicKey: Hex;
  sealedMemberKey: Uint8Array;
}

export interface CreatedWelcome {
  note: WelcomeNote;
  /** S: grant the role to this address. */
  stealthAddress: Address;
  /** MK_S, which also goes into the managers' roster. */
  memberKey: Uint8Array;
}

export interface OpenedWelcome {
  memberKey: Uint8Array;
  stealthAddress: Address;
  stealthPrivateKey: Hex;
}

/** Binds a sealed value to its folder, so it can't be replayed into another folder. */
export function folderAad(folder: Address): Uint8Array {
  return hexToBytes(getAddress(folder));
}

function parsePoint(hex: string): Uint8Array | null {
  try {
    return secp256k1.ProjectivePoint.fromHex(hex.replace(/^0x/, "")).toRawBytes(false);
  } catch {
    return null;
  }
}

function welcomeKey(sharedPoint: Uint8Array): Uint8Array {
  return hkdf(sharedPoint.subarray(1), "welcome"); // x ‖ y, as the kit uses
}

/** Sharer side. Throws NO_HAVEN_KEY if the recipient's published key isn't a valid public key. */
export async function createWelcome(params: {
  recipientSpendingPublicKey: string;
  folder: Address;
  memberKey?: Uint8Array;
}): Promise<CreatedWelcome> {
  const P = parsePoint(params.recipientSpendingPublicKey);
  if (!P) throw new DriveError("NO_HAVEN_KEY", "the recipient's haven.key is not a valid public key");
  const memberKey = params.memberKey ?? randomBytes(32);
  if (memberKey.length !== 32) throw new Error("member key must be 32 bytes");

  const e = secp256k1.utils.randomPrivateKey();
  const [S] = generateStealthAddresses({ spendingPublicKeys: [bytesToHex(P)], ephemeralPrivateKey: bytesToHex(e) })
    .stealthAddresses;
  if (!S) throw new Error("stealth address generation failed");
  const sealedMemberKey = await aesEncrypt(
    welcomeKey(secp256k1.getSharedSecret(e, P, false)),
    memberKey,
    folderAad(params.folder),
  );
  return {
    note: { ephemeralPublicKey: bytesToHex(secp256k1.getPublicKey(e, false)), sealedMemberKey },
    stealthAddress: getAddress(S),
    memberKey,
  };
}

/** Recipient side. Returns null when the note isn't for this key (or isn't for this folder, or was tampered with). */
export async function openWelcome(params: {
  spendingPrivateKey: Hex;
  folder: Address;
  note: WelcomeNote;
}): Promise<OpenedWelcome | null> {
  const ePub = parsePoint(params.note.ephemeralPublicKey);
  if (!ePub) return null;
  let memberKey: Uint8Array;
  try {
    memberKey = await aesDecrypt(
      welcomeKey(secp256k1.getSharedSecret(hexToBytes(params.spendingPrivateKey), ePub, false)),
      params.note.sealedMemberKey,
      folderAad(params.folder),
    );
  } catch {
    return null;
  }
  if (memberKey.length !== 32) return null;
  const { stealthPrivateKey } = generateStealthPrivateKey({
    spendingPrivateKey: params.spendingPrivateKey,
    ephemeralPublicKey: bytesToHex(ePub),
  });
  return { memberKey, stealthPrivateKey, stealthAddress: privateKeyToAddress(stealthPrivateKey) };
}
