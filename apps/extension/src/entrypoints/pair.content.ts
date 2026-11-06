import { config } from "@/lib/config";
import { FROM_EXT, FROM_WEB, type PairReply } from "@/lib/messages";

if (!config.appOrigin) throw new Error("WXT_APP_ORIGIN is required: the extension pairs only with the configured website.");
const app = new URL(config.appOrigin);

/**
 * Runs only on the Cloakroom website. It tells the page the extension is installed, and passes a pairing request
 * (the account seed, sent after the user confirms on the website) to the background worker.
 */
export default defineContentScript({
  // Match patterns can't carry a port; the exact origin is checked below.
  matches: [`${app.protocol}//${app.hostname}/*`],
  main() {
    if (location.origin !== app.origin) return;
    const announce = () => window.postMessage({ source: FROM_EXT, type: "present" }, app.origin);
    announce();
    window.addEventListener("message", (e: MessageEvent) => {
      if (e.source !== window || e.origin !== app.origin) return;
      const d = e.data as { source?: string; type?: string; seed?: unknown; persist?: unknown } | null;
      if (d?.source !== FROM_WEB) return;
      if (d.type === "ping") return announce();
      if (d.type === "pair" && Array.isArray(d.seed) && d.seed.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
        chrome.runtime
          .sendMessage({ type: "pair", seed: d.seed as number[], persist: d.persist === true })
          .then((reply: PairReply) => window.postMessage({ source: FROM_EXT, type: "paired", ...reply }, app.origin))
          .catch((err: unknown) =>
            window.postMessage({ source: FROM_EXT, type: "paired", ok: false, error: String(err) }, app.origin),
          );
      }
    });
  },
});
