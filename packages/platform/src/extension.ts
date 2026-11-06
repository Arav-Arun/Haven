// Add-on F3, page side: ask the Cloakroom extension for this account's keys. The extension first re-downloads and hashes
// every file this page loaded and compares them with a published release; only a verified page gets the seed. The
// reply comes back on a MessageChannel port, never on window.postMessage, so other listeners on the page don't see it.

const FROM_WEB = "cloakroom-web";
const FROM_EXT = "cloakroom-ext";

export type VerifiedKeys = { ok: true; seed: Uint8Array } | { ok: false; reason: string };

/** True when the extension's content script answers on this page within `timeoutMs`. */
export function extensionPresent(timeoutMs = 1500): Promise<boolean> {
  if (typeof window === "undefined") return Promise.resolve(false);
  return new Promise((resolve) => {
    const done = (v: boolean) => {
      window.removeEventListener("message", onMessage);
      clearTimeout(timer);
      resolve(v);
    };
    const onMessage = (e: MessageEvent) => {
      if (e.source !== window || e.origin !== window.location.origin) return;
      const d = e.data as { source?: string; type?: string } | null;
      if (d?.source === FROM_EXT && d.type === "present") done(true);
    };
    const timer = setTimeout(() => done(false), timeoutMs);
    window.addEventListener("message", onMessage);
    window.postMessage({ source: FROM_WEB, type: "ping" }, window.location.origin);
  });
}

/** The account seed from the extension, after it verified this page; or why not. */
export async function requestVerifiedKeys(timeoutMs = 60_000): Promise<VerifiedKeys> {
  if (!(await extensionPresent())) return { ok: false, reason: "The Cloakroom extension isn't installed in this browser." };
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const timer = setTimeout(() => {
      channel.port1.close();
      resolve({ ok: false, reason: "The extension didn't answer in time." });
    }, timeoutMs);
    channel.port1.onmessage = (e: MessageEvent) => {
      clearTimeout(timer);
      channel.port1.close();
      const d = e.data as { ok?: boolean; seed?: unknown; reason?: string } | null;
      if (d?.ok && Array.isArray(d.seed) && d.seed.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
        resolve({ ok: true, seed: Uint8Array.from(d.seed as number[]) });
      } else resolve({ ok: false, reason: d?.reason ?? "The extension refused." });
    };
    window.postMessage({ source: FROM_WEB, type: "keys-request" }, window.location.origin, [channel.port2]);
  });
}
