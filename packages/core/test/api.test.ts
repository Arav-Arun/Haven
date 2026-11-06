import { describe, expect, it } from "vitest";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";

import { checkRoomPow, signClaim, solveRoomPow, verifyClaimRequest } from "../src/api";
import { deriveKeys, randomMaterial } from "../src/keys";

describe("API request formats", () => {
  it("accepts a claim signed by its drive key, and refuses tampering, other signers and old requests", async () => {
    const keys = deriveKeys(randomMaterial());
    const k = privateKeyToAccount(keys.driveKey);
    const t = Math.floor(Date.now() / 1000);
    const claim = await signClaim(k, { label: "alice", mainWallet: null, spendingPublicKey: keys.spendingPublicKey, time: t });
    expect((await verifyClaimRequest(claim, t)).driveKey).toBe(k.address);
    await expect(verifyClaimRequest({ ...claim, label: "mallory" }, t)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    const other = privateKeyToAccount(generatePrivateKey());
    await expect(verifyClaimRequest({ ...claim, driveKey: other.address }, t)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(verifyClaimRequest(claim, t + 3600)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
    await expect(verifyClaimRequest({ label: 1 }, t)).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });

  it("solves and checks the room proof-of-work", async () => {
    const roomKey = privateKeyToAccount(generatePrivateKey()).address;
    const nonce = await solveRoomPow(roomKey, 12);
    expect(checkRoomPow({ roomKey, nonce }, 12)).toBe(true);
    const other = privateKeyToAccount(generatePrivateKey()).address;
    // the same nonce almost never works for another key at a higher difficulty
    expect(checkRoomPow({ roomKey: other, nonce }, 24)).toBe(false);
    expect(checkRoomPow({ roomKey, nonce: -1 }, 1)).toBe(false);
  });
});
