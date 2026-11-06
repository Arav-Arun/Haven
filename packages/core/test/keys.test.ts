import { generateKeysFromSignature } from "@fluidkey/stealth-account-kit";
import { secp256k1 } from "@noble/curves/secp256k1";
import fc from "fast-check";
import { bytesToHex, concat, hashMessage, hexToBytes, numberToHex, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { describe, expect, it } from "vitest";

import { randomBytes, toPrivateKey } from "../src/crypto";
import {
  assertMatchesPublished,
  checkWalletSignIn,
  deriveKeys,
  exportSeed,
  importSeed,
  isContractWallet,
  keyMaterialFrom,
  ownSealKey,
  randomMaterial,
  roomKey,
  signInMessage,
  type KeyMaterial,
} from "../src/keys";

const ORIGIN = "https://cloakroom.vercel.app";
const eoa = async () => undefined;

/** A valid signature of the message that differs from the deterministic (RFC 6979) one, like a wallet that adds
 *  randomness to its nonce. */
function randomizedSignature(privateKey: Hex, message: string): Hex {
  const sig = secp256k1.sign(hexToBytes(hashMessage(message)), hexToBytes(privateKey), {
    extraEntropy: randomBytes(32),
  });
  return concat([numberToHex(sig.r, { size: 32 }), numberToHex(sig.s, { size: 32 }), numberToHex(27 + sig.recovery)]);
}

async function walletSignIn(privateKey: Hex) {
  const account = privateKeyToAccount(privateKey);
  const message = signInMessage(ORIGIN, account.address);
  const signature = await account.signMessage({ message });
  return { account, message, signature };
}

describe("signInMessage", () => {
  it("is the plan's SIWE message with a one-line statement (ERC-4361 forbids line breaks in it)", () => {
    const address = "0x2222222222222222222222222222222222222222";
    expect(signInMessage(ORIGIN, address)).toBe(
      [
        "cloakroom.vercel.app wants you to sign in with your Ethereum account:",
        address,
        "",
        "Create your Cloakroom keys. Anyone who gets this signature can read all your Cloakroom files. " +
          "Only sign this on https://cloakroom.vercel.app.",
        "",
        "URI: https://cloakroom.vercel.app",
        "Version: 1",
        "Chain ID: 11155111",
        "Nonce: cloakroomkeysv1",
        "Issued At: 2026-11-06T00:00:00.000Z",
      ].join("\n"),
    );
  });

  it("checksums the address and takes the domain from the canonical origin", () => {
    const msg = signInMessage("https://example.org/some/path", "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd");
    expect(msg.split("\n")[0]).toBe("example.org wants you to sign in with your Ethereum account:");
    expect(msg.split("\n")[1]).toBe("0xABcdEFABcdEFabcdEfAbCdefabcdeFABcDEFabCD");
  });
});

describe("wallet sign-in", () => {
  it("same signature -> same keys (and the same keys as the Fluidkey kit)", async () => {
    await fc.assert(
      fc.asyncProperty(fc.uint8Array({ minLength: 32, maxLength: 32 }), async (raw) => {
        const { account, signature } = await walletSignIn(toPrivateKey(raw));
        const material = await checkWalletSignIn({
          appOrigin: ORIGIN,
          address: account.address,
          signatures: [signature, signature],
          firstDevice: true,
          getCode: eoa,
        });
        const a = deriveKeys(material);
        const b = deriveKeys(material);
        expect(a).toEqual(b);
        expect(a.spendingPrivateKey).toBe(generateKeysFromSignature(signature).spendingPrivateKey);
        expect(a.wallet).toBe(account.address);
      }),
      { numRuns: 25 },
    );
  });

  it("v encoded as 0/1 or 27/28 gives the same keys", async () => {
    const { account, signature } = await walletSignIn(generatePrivateKey());
    const v = Number.parseInt(signature.slice(-2), 16);
    const altered = (signature.slice(0, -2) + numberToHex(v - 27).slice(2).padStart(2, "0")) as Hex;
    const check = { appOrigin: ORIGIN, address: account.address, firstDevice: false, getCode: eoa };
    const a = deriveKeys(await checkWalletSignIn({ ...check, signatures: [signature] }));
    const b = deriveKeys(await checkWalletSignIn({ ...check, signatures: [altered] }));
    expect(b.driveKey).toBe(a.driveKey);
    expect(b.spendingPublicKey).toBe(a.spendingPublicKey);
  });

  it("different signatures -> WALLET_NOT_SUPPORTED", async () => {
    const privateKey = generatePrivateKey();
    const { account, message, signature } = await walletSignIn(privateKey);
    const other = randomizedSignature(privateKey, message);
    expect(other).not.toBe(signature);
    await expect(
      checkWalletSignIn({
        appOrigin: ORIGIN,
        address: account.address,
        signatures: [signature, other],
        firstDevice: true,
        getCode: eoa,
      }),
    ).rejects.toMatchObject({ code: "WALLET_NOT_SUPPORTED" });
  });

  it("refuses smart-contract wallets but accepts EIP-7702 delegated EOAs", async () => {
    const { account, signature } = await walletSignIn(generatePrivateKey());
    const base = { appOrigin: ORIGIN, address: account.address, signatures: [signature, signature], firstDevice: true };
    await expect(checkWalletSignIn({ ...base, getCode: async () => "0x6080604052" })).rejects.toMatchObject({
      code: "WALLET_NOT_SUPPORTED",
    });
    const delegated = `0xef0100${"11".repeat(20)}` as Hex;
    await expect(checkWalletSignIn({ ...base, getCode: async () => delegated })).resolves.toMatchObject({
      kind: "wallet",
    });
    expect(isContractWallet(undefined)).toBe(false);
    expect(isContractWallet("0x")).toBe(false);
  });

  it("refuses a signature from another address, a non-65-byte signature, and a missing second signature", async () => {
    const { account, signature } = await walletSignIn(generatePrivateKey());
    const intruder = privateKeyToAccount(generatePrivateKey());
    const foreign = await intruder.signMessage({ message: signInMessage(ORIGIN, account.address) });
    const base = { appOrigin: ORIGIN, address: account.address, firstDevice: false, getCode: eoa };
    await expect(checkWalletSignIn({ ...base, signatures: [foreign] })).rejects.toMatchObject({
      code: "WALLET_NOT_SUPPORTED",
    });
    const erc6492Style = concat([signature, "0x6492649264926492649264926492649264926492649264926492649264926492"]);
    await expect(checkWalletSignIn({ ...base, signatures: [erc6492Style] })).rejects.toMatchObject({
      code: "WALLET_NOT_SUPPORTED",
    });
    await expect(checkWalletSignIn({ ...base, firstDevice: true, signatures: [signature] })).rejects.toMatchObject({
      code: "UNKNOWN",
    });
  });
});

describe("derived keys", () => {
  const sources: KeyMaterial[] = [
    { kind: "passkey", prf: randomBytes(32) },
    randomMaterial(),
    { kind: "wallet", address: "0x1111111111111111111111111111111111111111", rs: randomBytes(64) },
  ];

  it("K, K_room[n] and spending keys are deterministic and all different", () => {
    for (const material of sources) {
      const keys = deriveKeys(material);
      expect(deriveKeys(material)).toEqual(keys);
      const rooms = [0, 1, 2, 3].map((n) => roomKey(keys, n));
      expect(rooms.map((_, n) => roomKey(keys, n))).toEqual(rooms);
      expect(new Set([keys.driveKey, keys.spendingPrivateKey, keys.viewingPrivateKey, ...rooms]).size).toBe(7);
      for (const k of [keys.driveKey, keys.spendingPrivateKey, ...rooms]) {
        expect(secp256k1.utils.isValidPrivateKey(hexToBytes(k))).toBe(true);
      }
    }
    expect(deriveKeys(sources[0]!).driveKey).not.toBe(deriveKeys(sources[1]!).driveKey);
  });

  it("own seal keys differ per folder and per key", () => {
    const keys = deriveKeys(randomMaterial());
    const f1 = "0x00000000000000000000000000000000000000a1";
    const f2 = "0x00000000000000000000000000000000000000a2";
    expect(bytesToHex(ownSealKey(keys.driveKey, f1))).not.toBe(bytesToHex(ownSealKey(keys.driveKey, f2)));
    expect(bytesToHex(ownSealKey(keys.driveKey, f1))).not.toBe(bytesToHex(ownSealKey(roomKey(keys, 0), f1)));
    expect(ownSealKey(keys.driveKey, f1)).toEqual(ownSealKey(keys.driveKey, f1.toUpperCase().replace("0X", "0x") as Hex));
  });

  it("an exported seed restores exactly the same identity (extension pairing)", () => {
    for (const material of sources) {
      const restored = deriveKeys(importSeed(exportSeed(material)));
      const original = deriveKeys(material);
      expect(restored.driveKey).toBe(original.driveKey);
      expect(restored.spendingPublicKey).toBe(original.spendingPublicKey);
      expect(restored.wallet).toBe(original.wallet);
      expect(roomKey(restored, 5)).toBe(roomKey(original, 5));
    }
    expect(() => importSeed(new Uint8Array([9, 0]))).toThrow();
    expect(() => importSeed(new Uint8Array([1, 2, 3]))).toThrow();
  });

  it("keyMaterialFrom handles every SignInSource", async () => {
    const ctx = { appOrigin: ORIGIN, firstDevice: async () => true, getCode: eoa };
    const prf = randomBytes(32);
    expect(await keyMaterialFrom({ kind: "passkey", prfOutput: prf }, ctx)).toEqual({ kind: "passkey", prf });
    expect((await keyMaterialFrom({ kind: "random" }, ctx)).kind).toBe("random");
    const material = randomMaterial();
    expect(await keyMaterialFrom({ kind: "seed", seed: exportSeed(material) }, ctx)).toEqual(material);
    const { account, signature } = await walletSignIn(generatePrivateKey());
    await expect(
      keyMaterialFrom({ kind: "wallet", address: account.address, signatures: [signature] }, ctx),
    ).rejects.toMatchObject({ code: "UNKNOWN" }); // first device needs two
  });
});

describe("cloak.key comparison", () => {
  it("accepts the same key in either encoding, refuses anything else with KEY_MISMATCH", () => {
    const keys = deriveKeys(randomMaterial());
    const compressed = bytesToHex(secp256k1.getPublicKey(hexToBytes(keys.spendingPrivateKey), true));
    expect(() => assertMatchesPublished(keys, keys.spendingPublicKey)).not.toThrow();
    expect(() => assertMatchesPublished(keys, compressed)).not.toThrow();
    expect(() => assertMatchesPublished(keys, null)).not.toThrow();

    const other = deriveKeys(randomMaterial());
    expect(() => assertMatchesPublished(keys, other.spendingPublicKey)).toThrow(
      expect.objectContaining({ code: "KEY_MISMATCH" }),
    );
    expect(() => assertMatchesPublished(keys, "0x1234")).toThrow(expect.objectContaining({ code: "KEY_MISMATCH" }));
  });
});
