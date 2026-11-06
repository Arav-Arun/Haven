import type { DriveErrorCode } from "@haven/types";

export interface ErrorCopy {
  code: DriveErrorCode;
  title: string;
  detail: string;
}

const COPY: Record<DriveErrorCode, { title: string; detail: string }> = {
  NOT_SIGNED_IN: { title: "You're signed out", detail: "Sign in again to continue." },
  WALLET_NOT_SUPPORTED: {
    title: "This wallet can't sign in",
    detail:
      "Smart-contract wallets, and wallets that sign the same message differently each time, can't rebuild your keys. Connect a regular wallet instead, or try Haven without one.",
  },
  KEY_MISMATCH: {
    title: "This sign-in gives different keys",
    detail: "The keys from this signature don't match this name's Haven key. Your files are safe; sign in with the wallet that set up this name.",
  },
  NAME_TAKEN: { title: "That name is taken", detail: "Try another name." },
  NO_HAVEN_KEY: {
    title: "This name hasn't set up Haven yet",
    detail: "Ask them to sign in to Haven once. Then you can share with them.",
  },
  NOT_AUTHORIZED: { title: "You don't have access to do that", detail: "Ask a manager of this folder." },
  EXPIRED: { title: "Your access has ended", detail: "New files are locked for you. What you already opened, you keep." },
  REFRESH_PENDING: {
    title: "Waiting for the owner to refresh access",
    detail: "Someone was removed, so new keys are needed before anyone can add files. A manager's app does this when it next opens.",
  },
  TOO_LARGE: { title: "That file is too large", detail: "Files can be up to 32 MB." },
  NOT_FOUND: { title: "Not found", detail: "It may have been removed, or the link has ended." },
  RATE_LIMITED: { title: "Too many requests", detail: "Wait a minute and try again." },
  NETWORK: {
    title: "Couldn't reach the network",
    detail: "Check the private network status at the top of the page, then try again.",
  },
  UNKNOWN: { title: "Something went wrong", detail: "Try again. If it keeps happening, check the receipts for the failing step." },
};

/** Turns any thrown value into copy for the screen. DriveError codes get fixed wording; anything else keeps its message. */
export function describeError(e: unknown): ErrorCopy {
  const code = (e as { code?: unknown } | null)?.code;
  if (typeof code === "string" && code in COPY) {
    const c = COPY[code as DriveErrorCode];
    return { code: code as DriveErrorCode, ...c };
  }
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  // Wallet rejections arrive as viem/EIP-1193 errors with code 4001.
  if (code === 4001 || /user rejected|denied/i.test(message))
    return { code: "UNKNOWN", title: "Cancelled in your wallet", detail: "Nothing was signed or sent." };
  return { code: "UNKNOWN", title: COPY.UNKNOWN.title, detail: message || COPY.UNKNOWN.detail };
}
