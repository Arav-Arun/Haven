import type { VerificationResult } from "@cloakroom/core";
import { config } from "@/lib/config";
import { FROM_EXT, FROM_WEB, type KeysReply, type PairReply } from "@/lib/messages";
import { verifiedCopyUrl } from "@/lib/verify";

if (!config.appOrigin) throw new Error("WXT_APP_ORIGIN is required: the extension pairs only with the configured website.");
const app = new URL(config.appOrigin);

/** Every script, stylesheet and the page itself, as loaded so far (add-on F3). */
function loadedUrls(): string[] {
  const urls = new Set<string>([location.href]);
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    if (["script", "link", "css"].includes(e.initiatorType) || /\.(js|css)(\?|$)/.test(e.name)) urls.add(e.name);
  }
  for (const s of Array.from(document.scripts)) if (s.src) urls.add(s.src);
  for (const l of Array.from(document.querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="modulepreload"], link[rel="preload"][as="script"]'))) {
    if (l.href) urls.add(l.href);
  }
  return [...urls];
}

/** The red warning: this page's code isn't a published release, so the extension won't give it keys. */
function showOverlay(result: VerificationResult) {
  if (document.getElementById("cloakroom-verify-overlay")) return;
  const host = document.createElement("div");
  host.id = "cloakroom-verify-overlay";
  const root = host.attachShadow({ mode: "closed" });
  const copy = result.siteSwarmRef ? verifiedCopyUrl(result.siteSwarmRef) : null;
  const files = (result.mismatchedFiles ?? []).slice(0, 6);
  root.innerHTML = `
    <style>
      .wrap { position: fixed; inset: 0; z-index: 2147483647; background: rgba(60, 10, 8, 0.92); color: #fff;
        display: grid; place-items: center; font: 15px/1.5 system-ui, sans-serif; padding: 24px; }
      .card { max-width: 560px; background: #9c2b21; border-radius: 16px; padding: 28px; box-shadow: 0 20px 60px rgba(0,0,0,.4); }
      h1 { font-size: 22px; margin: 0 0 8px; }
      p { margin: 0 0 12px; }
      code { display: block; font: 12px ui-monospace, monospace; background: rgba(0,0,0,.25); padding: 8px; border-radius: 8px;
        white-space: pre-wrap; word-break: break-all; margin-bottom: 16px; }
      .row { display: flex; gap: 10px; flex-wrap: wrap; }
      a, button { font: inherit; border-radius: 999px; padding: 10px 18px; border: 0; cursor: pointer; text-decoration: none; }
      a { background: #fff; color: #9c2b21; font-weight: 600; }
      button { background: transparent; color: #fff; border: 1px solid rgba(255,255,255,.6); }
    </style>
    <div class="wrap" role="alertdialog" aria-labelledby="t">
      <div class="card">
        <h1 id="t">This page's code doesn't match any published Cloakroom release</h1>
        <p>The Cloakroom extension won't give your keys to this page. Someone may have changed the website's files.</p>
        ${files.length ? `<code></code>` : ""}
        <div class="row">
          ${copy ? `<a href="${copy}" rel="noreferrer">Open the verified copy</a>` : ""}
          <button type="button">Dismiss (your keys stay locked)</button>
        </div>
      </div>
    </div>`;
  const code = root.querySelector("code");
  if (code) code.textContent = files.join("\n");
  root.querySelector("button")!.addEventListener("click", () => host.remove());
  document.documentElement.appendChild(host);
}

/**
 * Runs only on the Cloakroom website. It tells the page the extension is installed, passes a pairing request (the
 * account seed, sent after the user confirms on the website) to the background worker, checks the page's files against
 * the published release, and hands the page its keys only when that check passes.
 */
export default defineContentScript({
  // Match patterns can't carry a port; the exact origin is checked below.
  matches: [`${app.protocol}//${app.hostname}/*`],
  main() {
    if (location.origin !== app.origin) return;
    const announce = () => window.postMessage({ source: FROM_EXT, type: "present" }, app.origin);
    announce();

    const check = () =>
      chrome.runtime
        .sendMessage({ type: "verify", urls: loadedUrls() })
        .then((r: VerificationResult) => {
          window.postMessage({ source: FROM_EXT, type: "verification", result: r }, app.origin);
          if (r?.status === "mismatch") showOverlay(r);
        })
        .catch(() => undefined);
    if (document.readyState === "complete") setTimeout(check, 500);
    else window.addEventListener("load", () => setTimeout(check, 500), { once: true });

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
      // Keys go back on the MessageChannel port the page sent, never on window.postMessage.
      if (d.type === "keys-request" && e.ports[0]) {
        const port = e.ports[0];
        chrome.runtime
          .sendMessage({ type: "release-keys", urls: loadedUrls() })
          .then((reply: KeysReply) => {
            port.postMessage(reply);
            if (!reply.ok) void check();
          })
          .catch((err: unknown) => port.postMessage({ ok: false, reason: String(err) }));
      }
    });
  },
});
