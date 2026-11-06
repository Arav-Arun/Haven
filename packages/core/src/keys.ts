// Sign-in and identity keys (HAVEN_PLAN.md section 5).
//
// Every identity comes from one secret seed:
//   wallet  → r ‖ s of the signature of the fixed sign-in message (v is ignored, as in the Fluidkey kit, because
//             wallets disagree on encoding it as 0/1 or 27/28)
//   passkey → the WebAuthn PRF output
//   random  → 32 random bytes ("Try it")
// From the seed:
//   spending and viewing keys: the Fluidkey kit for wallets; HKDF(seed, "spending" / "viewing") otherwise
//   K       = HKDF(seed, "drive")
//   K_room[n] = HKDF(seed, "room/n")

import { generateKeysFromSignature } from "@fluidkey/stealth-account-kit";
import { DriveError, type Address, type Hex, type SignInSource } from "@haven/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import {
  bytesToHex,
  getAddress,
  hexToBytes,
  isAddressEqual,
  isHex,
  recoverMessageAddress,
  size,
  slice,
} from "viem";
import { privateKeyToAddress } from "viem/accounts";
import { sepolia } from "viem/chains";

import { concatBytes, equalBytes, hkdf, randomBytes, toPrivateKey } from "./crypto";

// ---------------------------------------------------------------- the sign-in message

/** Part of key derivation: changing any of these changes every user's keys. */
export const SIGN_IN_CHAIN_ID = sepolia.id;
export const SIGN_IN_NONCE = "havenkeysv1";
export const SIGN_IN_ISSUED_AT = "2026-11-06T00:00:00.000Z";

/**
 * The fixed, SIWE-format (ERC-4361) sign-in message. It is constant per address, so it always gives the same keys,
 * and it names the canonical app origin, so SIWE-aware wallets warn on any other site. Pass the canonical origin
 * (config.appOrigin), never the page's own origin: the Swarm copy must produce the same keys, and gets the wallet's
 * warning by design.
 *
 * ERC-4361 forbids line breaks inside the statement, so the plan's two-line statement is one line here.
 * A strict SIWE parser would otherwise reject the message, and the domain warning wouldn't fire.
 */
export function signInMessage(appOrigin: string, address: Address): string {
  const origin = new URL(appOrigin);
  return [
    `${origin.host} wants you to sign in with your Ethereum account:`,
    getAddress(address),
    "",
    "Create your Haven keys. Anyone who gets this signature can read all your Haven files. " +
      `Only sign this on ${origin.origin}.`,
    "",
    `URI: ${origin.origin}`,
    "Version: 1",
    `Chain ID: ${SIGN_IN_CHAIN_ID}`,
    `Nonce: ${SIGN_IN_NONCE}`,
    `Issued At: ${SIGN_IN_ISSUED_AT}`,
  ].join("\n");
}

// ---------------------------------------------------------------- key material

export type KeyMaterial =
  | { kind: "wallet"; address: Address; rs: Uint8Array }
  | { kind: "passkey"; prf: Uint8Array }
  | { kind: "random"; seed: Uint8Array };

export interface IdentityKeys {
  material: KeyMaterial;
  /** Main wallet W (null for passkey and "Try it"). */
  wallet: Address | null;
  spendingPrivateKey: Hex;
  viewingPrivateKey: Hex;
  /** Uncompressed (0x04…), published as the haven.key text record. */
  spendingPublicKey: Hex;
  /** K, the drive key (private). */
  driveKey: Hex;
  driveAddress: Address;
}

function seedOf(material: KeyMaterial): Uint8Array {
  switch (material.kind) {
    case "wallet":
      return material.rs;
    case "passkey":
      return material.prf;
    case "random":
      return material.seed;
  }
}

function assertMaterial(material: KeyMaterial): void {
  const seed = seedOf(material);
  const want = material.kind === "wallet" ? 64 : 32;
  if (seed.length !== want) throw new DriveError("UNKNOWN", `${material.kind} key material must be ${want} bytes`);
}

export function randomMaterial(): KeyMaterial {
  return { kind: "random", seed: randomBytes(32) };
}

/** Derives the identity keys. Deterministic: the same material always gives the same keys. */
export function deriveKeys(material: KeyMaterial): IdentityKeys {
  assertMaterial(material);
  const seed = seedOf(material);
  let spendingPrivateKey: Hex;
  let viewingPrivateKey: Hex;
  if (material.kind === "wallet") {
    // The kit takes a 65-byte signature and uses only r and s; any v gives the same keys.
    ({ spendingPrivateKey, viewingPrivateKey } = generateKeysFromSignature(
      bytesToHex(concatBytes(material.rs, new Uint8Array([27]))),
    ));
  } else {
    spendingPrivateKey = toPrivateKey(hkdf(seed, "spending"));
    viewingPrivateKey = toPrivateKey(hkdf(seed, "viewing"));
  }
  const driveKey = toPrivateKey(hkdf(seed, "drive"));
  return {
    material,
    wallet: material.kind === "wallet" ? getAddress(material.address) : null,
    spendingPrivateKey,
    viewingPrivateKey,
    spendingPublicKey: bytesToHex(secp256k1.getPublicKey(hexToBytes(spendingPrivateKey), false)),
    driveKey,
    driveAddress: privateKeyToAddress(driveKey),
  };
}

/** K_room[n]: a fresh key per unlinked room. Rooms are found again by trying n = 0, 1, 2… */
export function roomKey(keys: IdentityKeys, n: number): Hex {
  if (!Number.isInteger(n) || n < 0) throw new RangeError("room index must be a whole number ≥ 0");
  return toPrivateKey(hkdf(seedOf(keys.material), `room/${n}`));
}

/** Seals the user's own key copies for a folder: HKDF(K or K_room, folder). */
export function ownSealKey(privateKey: Hex, folder: Address): Uint8Array {
  return hkdf(hexToBytes(privateKey), `seal/${folder.toLowerCase()}`);
}

/**
 * The passkey user's main wallet W: a key from a SECOND PRF evaluation (different salt), made only after a fresh
 * passkey prompt and never stored, so the dangerous roles stay behind a user gesture.
 */
export function passkeyMainWalletKey(secondPrf: Uint8Array): Hex {
  if (secondPrf.length !== 32) throw new DriveError("UNKNOWN", "PRF output must be 32 bytes");
  return toPrivateKey(hkdf(secondPrf, "main-wallet"));
}

// ---------------------------------------------------------------- wallet checks

/** EIP-7702 delegation designator: the account is still an EOA whose own key signs. */
const DELEGATION_PREFIX = "0xef0100";

/** Contract code that isn't a 7702 delegation means a smart-contract wallet. */
export function isContractWallet(code: Hex | undefined): boolean {
  if (!code || code === "0x") return false;
  return !code.toLowerCase().startsWith(DELEGATION_PREFIX);
}

const NOT_SUPPORTED = "This wallet can't create stable keys. Use passkey sign-in instead.";

export interface WalletSignInCheck {
  appOrigin: string;
  address: Address;
  signatures: Hex[];
  /** First device (no haven.key yet): two signatures are required and must match. */
  firstDevice: boolean;
  /** Code at the address on Sepolia (read through Anon-RPC). */
  getCode: (address: Address) => Promise<Hex | undefined>;
}

/**
 * Checks a wallet sign-in and returns its key material. Refuses (WALLET_NOT_SUPPORTED) smart-contract wallets,
 * signatures that aren't a plain 65-byte ECDSA signature from this address over the sign-in message, and, on a
 * first device, two signatures that differ (a wallet that doesn't sign deterministically would give new keys each
 * time).
 */
export async function checkWalletSignIn(check: WalletSignInCheck): Promise<KeyMaterial> {
  const needed = check.firstDevice ? 2 : 1;
  if (check.signatures.length < needed) {
    throw new DriveError("UNKNOWN", `${needed} signature(s) needed on ${check.firstDevice ? "a first" : "this"} device`);
  }
  if (isContractWallet(await check.getCode(check.address))) {
    throw new DriveError("WALLET_NOT_SUPPORTED", `Smart-contract wallet. ${NOT_SUPPORTED}`);
  }
  const message = signInMessage(check.appOrigin, check.address);
  const rsList: Uint8Array[] = [];
  for (const signature of check.signatures.slice(0, needed)) {
    if (!isHex(signature) || size(signature) !== 65) {
      throw new DriveError("WALLET_NOT_SUPPORTED", `Not a plain wallet signature. ${NOT_SUPPORTED}`);
    }
    let signer: Address;
    try {
      signer = await recoverMessageAddress({ message, signature });
    } catch {
      throw new DriveError("WALLET_NOT_SUPPORTED", `Unreadable signature. ${NOT_SUPPORTED}`);
    }
    if (!isAddressEqual(signer, check.address)) {
      throw new DriveError("WALLET_NOT_SUPPORTED", `The signature isn't from ${check.address}. ${NOT_SUPPORTED}`);
    }
    rsList.push(hexToBytes(slice(signature, 0, 64)));
  }
  const [first, second] = rsList;
  if (!first) throw new DriveError("UNKNOWN", "no signature");
  if (second && !equalBytes(first, second)) {
    throw new DriveError("WALLET_NOT_SUPPORTED", `The two signatures differ. ${NOT_SUPPORTED}`);
  }
  return { kind: "wallet", address: getAddress(check.address), rs: first };
}

/**
 * Later devices: the derived spending public key must equal the haven.key record on the user's name, or the app
 * stops instead of silently creating a second identity. No record (null or empty) means there is nothing to compare.
 */
export function assertMatchesPublished(keys: IdentityKeys, published: string | null | undefined): void {
  if (published === null || published === undefined || published === "") return;
  let same = false;
  try {
    same = secp256k1.ProjectivePoint.fromHex(published.replace(/^0x/, "")).equals(
      secp256k1.ProjectivePoint.fromHex(keys.spendingPublicKey.slice(2)),
    );
  } catch {
    same = false;
  }
  if (!same) {
    throw new DriveError("KEY_MISMATCH", "This sign-in gives different keys; your files are safe; use your original method.");
  }
}

/** Turns any SignInSource into key material (wallet sources are checked first). */
export async function keyMaterialFrom(
  source: SignInSource,
  context: { appOrigin: string; firstDevice: () => Promise<boolean>; getCode: WalletSignInCheck["getCode"] },
): Promise<KeyMaterial> {
  switch (source.kind) {
    case "wallet":
      return checkWalletSignIn({
        appOrigin: context.appOrigin,
        address: source.address,
        signatures: source.signatures,
        firstDevice: await context.firstDevice(),
        getCode: context.getCode,
      });
    case "passkey":
      return { kind: "passkey", prf: source.prfOutput };
    case "random":
      return randomMaterial();
    case "seed":
      return importSeed(source.seed);
  }
}

// ---------------------------------------------------------------- seed export (extension pairing)

const SEED_FORMAT_VERSION = 1;
const KIND_CODES = { wallet: 0, passkey: 1, random: 2 } as const;

/** [format version][kind][address (wallet only)][seed]. Secret: whoever holds it can read all the user's files. */
export function exportSeed(material: KeyMaterial): Uint8Array {
  assertMaterial(material);
  const head = new Uint8Array([SEED_FORMAT_VERSION, KIND_CODES[material.kind]]);
  if (material.kind === "wallet") return concatBytes(head, hexToBytes(getAddress(material.address)), material.rs);
  return concatBytes(head, seedOf(material));
}

export function importSeed(bytes: Uint8Array): KeyMaterial {
  const [version, kind] = bytes;
  if (version !== SEED_FORMAT_VERSION) throw new DriveError("UNKNOWN", "unknown seed format");
  let material: KeyMaterial;
  if (kind === KIND_CODES.wallet && bytes.length === 2 + 20 + 64) {
    material = { kind: "wallet", address: getAddress(bytesToHex(bytes.slice(2, 22))), rs: bytes.slice(22) };
  } else if (kind === KIND_CODES.passkey && bytes.length === 2 + 32) {
    material = { kind: "passkey", prf: bytes.slice(2) };
  } else if (kind === KIND_CODES.random && bytes.length === 2 + 32) {
    material = { kind: "random", seed: bytes.slice(2) };
  } else {
    throw new DriveError("UNKNOWN", "malformed seed");
  }
  return material;
}
