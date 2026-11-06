// First-hour check 8 (HAVEN_PLAN.md section 17): the Fluidkey stealth-account-kit 1.1.1
//   - derives the same keys from the same signature of the fixed sign-in message;
//   - a sharer computes stealth address S from the recipient's spending public key P and a random ephemeral key e;
//   - the recipient recovers S's private key from its spending private key and e·G, and nobody else does.
// Run: pnpm --filter @haven/core check8
// Uses only local, freshly generated test keys. Nothing touches a network.

import assert from "node:assert/strict";
import {
  generateKeysFromSignature,
  generateStealthAddresses,
  generateStealthPrivateKey,
} from "@fluidkey/stealth-account-kit";
import { getAddress, isAddressEqual, type Hex } from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

const ROUNDS = 200;

/** The fixed SIWE-format message from HAVEN_PLAN.md section 5 (address must be EIP-55 checksummed). */
function signInMessage(address: Hex): string {
  return [
    "haven.vercel.app wants you to sign in with your Ethereum account:",
    getAddress(address),
    "",
    "Create your Haven keys. Anyone who gets this signature can read all your Haven files.",
    "Only sign this on https://haven.vercel.app.",
    "",
    "URI: https://haven.vercel.app",
    "Version: 1",
    "Chain ID: 11155111",
    "Nonce: havenkeysv1",
    "Issued At: 2026-11-06T00:00:00.000Z",
  ].join("\n");
}

/** A user: wallet W signs the message; the kit turns the signature into spending + viewing keys. */
async function newUser() {
  const wallet = privateKeyToAccount(generatePrivateKey());
  const message = signInMessage(wallet.address);
  const sig1 = await wallet.signMessage({ message });
  const sig2 = await wallet.signMessage({ message });
  const keys = generateKeysFromSignature(sig1);
  return {
    wallet,
    sig1,
    sig2,
    keys,
    spendingPublicKey: privateKeyToAccount(keys.spendingPrivateKey).publicKey, // uncompressed, 0x04…
  };
}

/** A share: the sharer picks e and computes S from P. Only e·G (not e) goes into the welcome note. */
function share(spendingPublicKey: Hex) {
  const e = generatePrivateKey();
  const ephemeralPublicKey = privateKeyToAccount(e).publicKey;
  const [S] = generateStealthAddresses({ spendingPublicKeys: [spendingPublicKey], ephemeralPrivateKey: e })
    .stealthAddresses;
  assert.ok(S, "kit returned no stealth address");
  return { S, ephemeralPublicKey };
}

function recover(spendingPrivateKey: Hex, ephemeralPublicKey: Hex) {
  const { stealthPrivateKey } = generateStealthPrivateKey({ spendingPrivateKey, ephemeralPublicKey });
  return privateKeyToAccount(stealthPrivateKey).address;
}

async function main() {
  const results: Record<string, string> = {};

  // 1. Determinism: same signature -> same keys; signing twice gives the same signature (local key, RFC 6979).
  const alice = await newUser();
  assert.equal(alice.sig1, alice.sig2, "local signer is not deterministic");
  assert.deepEqual(generateKeysFromSignature(alice.sig2), alice.keys, "same signature gave different keys");
  assert.notEqual(alice.keys.spendingPrivateKey, alice.keys.viewingPrivateKey);
  results["same signature -> same keys"] = "pass";

  // A different signature (another wallet) gives different keys. The two-signature check relies on this.
  const bob = await newUser();
  assert.notEqual(bob.keys.spendingPrivateKey, alice.keys.spendingPrivateKey);
  results["different signature -> different keys"] = "pass";

  // 2 + 3. Many random shares: the recipient recovers S, a wrong key never does, and each share gets a fresh S.
  const seen = new Set<string>();
  for (let i = 0; i < ROUNDS; i++) {
    const recipient = i === 0 ? alice : await newUser();
    const other = await newUser();
    const { S, ephemeralPublicKey } = share(recipient.spendingPublicKey);
    assert.ok(isAddressEqual(recover(recipient.keys.spendingPrivateKey, ephemeralPublicKey), S), `round ${i}: recipient failed`);
    assert.ok(!isAddressEqual(recover(other.keys.spendingPrivateKey, ephemeralPublicKey), S), `round ${i}: wrong key matched`);
    assert.ok(!seen.has(S.toLowerCase()), `round ${i}: stealth address repeated`);
    seen.add(S.toLowerCase());
  }
  results[`recipient recovers S (${ROUNDS} random rounds)`] = "pass";
  results[`wrong spending key never matches (${ROUNDS} rounds)`] = "pass";

  // Two shares to the same P are unlinkable on chain: different S each time.
  const a = share(alice.spendingPublicKey);
  const b = share(alice.spendingPublicKey);
  assert.ok(!isAddressEqual(a.S, b.S));
  results["two shares to the same name -> different S"] = "pass";

  // Scanning cost: "Shared with me" runs one recovery per welcome note.
  const N = 500;
  const t0 = performance.now();
  for (let i = 0; i < N; i++) recover(alice.keys.spendingPrivateKey, a.ephemeralPublicKey);
  const perOp = (performance.now() - t0) / N;
  results["recovery time per welcome note (Node, this laptop)"] = `${perOp.toFixed(2)} ms`;
  results["spending public key format"] = `uncompressed, ${(alice.spendingPublicKey.length - 2) / 2} bytes`;

  console.log(JSON.stringify({ check: 8, kit: "@fluidkey/stealth-account-kit@1.1.1", results }, null, 2));
}

main().catch((err) => {
  console.error("CHECK 8 FAILED:", err);
  process.exit(1);
});
