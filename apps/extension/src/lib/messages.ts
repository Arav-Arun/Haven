/** Messages between the website (through the pairing content script), the popup and the background worker. */
export type ExtMessage =
  | { type: "pair"; seed: number[]; persist: boolean }
  | { type: "check-now" }
  | { type: "seen" }
  /** Add-on F3: from the content script, the files this tab loaded. */
  | { type: "verify"; urls: string[] }
  /** Add-on F3: the page asks for the account seed; released only if the tab verified. */
  | { type: "release-keys"; urls: string[] }
  /** Add-on F3: the popup asks how the active tab verified. */
  | { type: "verification"; tabId: number };

export type KeysReply = { ok: true; seed: number[] } | { ok: false; reason: string };

export type PairReply = { ok: true; ensName: string | null } | { ok: false; error: string };

/** window.postMessage envelopes on the website's page. Both sides check the origin. */
export const FROM_WEB = "cloakroom-web";
export const FROM_EXT = "cloakroom-ext";

export const NEW_SHARES_KEY = "cloak:newShares";
export const LAST_CHECK_KEY = "cloak:lastCheck";
