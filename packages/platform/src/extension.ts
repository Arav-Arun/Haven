// The website's side of the browser extension (add-on F3, verified frontend). The extension's content script runs on
// our origin only; the two sides talk with window.postMessage, each checking the origin and a source tag. (The plan's
// externally_connectable would need the extension's ID baked into the site, which differs between a packed and an
// unpacked build; the content script gives the same "our origin only" guarantee without it.)

/** What the extension found when it checked this page's code against the published releases. */
export interface PageVerification {
  status: "verified" | "mismatch" | "unknown";
  version?: string;
  gitCommit?: string;
  rebuilds?: number;
  mismatchedFiles?: string[];
  reason?: string;
  /** The same app, served from Swarm by content hash. */
  verifiedCopyUrl?: string;
}

const FROM_WEB = "cloakroom-web";
const FROM_EXT = "cloakroom-ext";

type ExtEnvelope = { source?: string; type?: string; [k: string]: unknown };

function listen(handler: (d: ExtEnvelope) => void): () => void {
  const onMessage = (e: MessageEvent) => {
    if (e.source !== window || e.origin !== window.location.origin) return;
    const d = e.data as ExtEnvelope | null;
    if (d?.source === FROM_EXT) handler(d);
  };
  window.addEventListener("message", onMessage);
  return () => window.removeEventListener("message", onMessage);
}

const send = (type: string) => window.postMessage({ source: FROM_WEB, type }, window.location.origin);

/** Resolves true if the extension answers on this page within `timeoutMs`. */
export function detectExtension(timeoutMs = 800): Promise<boolean> {
  return new Promise((resolve) => {
    const stop = listen((d) => {
      if (d.type !== "present") return;
      stop();
      clearTimeout(timer);
      resolve(true);
    });
    const timer = setTimeout(() => {
      stop();
      resolve(false);
    }, timeoutMs);
    send("ping");
  });
}

/** Calls `listener` with every verification result the extension reports for this page, and asks for one now. */
export function onPageVerification(listener: (v: PageVerification) => void): () => void {
  const stop = listen((d) => {
    if (d.type === "verification" && d.result && typeof d.result === "object") listener(d.result as PageVerification);
  });
  send("verify");
  return stop;
}

export type VerifiedKeys =
  | { ok: true; seed: Uint8Array; ensName: string | null }
  | { ok: false; error: string; verification?: PageVerification };

/**
 * Asks the extension for this account's keys. The extension re-checks every file this page has loaded against the
 * published releases at that moment, and answers with the seed only if they all match. Pass the seed to
 * DriveClient.signIn({ kind: "seed", seed }), then wipe it.
 */
export function requestVerifiedKeys(timeoutMs = 60_000): Promise<VerifiedKeys> {
  return new Promise((resolve) => {
    const stop = listen((d) => {
      if (d.type !== "keys") return;
      stop();
      clearTimeout(timer);
      if (d.ok === true && Array.isArray(d.seed)) {
        resolve({ ok: true, seed: Uint8Array.from(d.seed as number[]), ensName: (d.ensName as string | null) ?? null });
      } else {
        resolve({
          ok: false,
          error: typeof d.error === "string" ? d.error : "The extension refused.",
          ...(d.result ? { verification: d.result as PageVerification } : {}),
        });
      }
    });
    const timer = setTimeout(() => {
      stop();
      resolve({ ok: false, error: "The extension didn't answer. Is it installed and enabled for this site?" });
    }, timeoutMs);
    send("request-keys");
  });
}
