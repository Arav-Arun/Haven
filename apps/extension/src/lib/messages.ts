import type { VerificationResult } from "@cloakroom/core";

/** Messages between the website (through the pairing content script), the popup and the background worker. */
export type ExtMessage =
  | { type: "pair"; seed: number[]; persist: boolean }
  | { type: "check-now" }
  | { type: "seen" }
  /** Add-on F3: what the Cloakroom tab loaded, to check against the published releases. */
  | { type: "verify-page"; urls: string[] }
  /** Add-on F3: the page asks for the keys; they're released only if the page verifies right now. */
  | { type: "release-keys"; urls: string[] };

export type PairReply = { ok: true; ensName: string | null } | { ok: false; error: string };

export type VerifyReply = VerificationResult & { verifiedCopyUrl?: string };

export type KeysReply = { ok: true; seed: number[]; ensName: string | null } | { ok: false; error: string; result?: VerifyReply };

/** window.postMessage envelopes on the website's page. Both sides check the origin. */
export const FROM_WEB = "cloakroom-web";
export const FROM_EXT = "cloakroom-ext";

export const NEW_SHARES_KEY = "cloak:newShares";
export const LAST_CHECK_KEY = "cloak:lastCheck";
