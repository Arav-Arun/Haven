import { config } from "@/lib/config";
import { FROM_EXT, FROM_WEB, type KeysReply, type PairReply, type VerifyReply } from "@/lib/messages";

if (!config.appOrigin) throw new Error("WXT_APP_ORIGIN is required: the extension pairs only with the configured website.");
const app = new URL(config.appOrigin);

/**
 * Every script, stylesheet and HTML document this page has loaded so far (add-on F3), from the resource timeline plus
 * the DOM. Same-origin JSON and data fetches aren't code, so they're left out; any cross-origin script or stylesheet
 * is kept, since it can never be part of a release.
 */
function loadedCode(): string[] {
  const urls = new Set<string>([location.href]);
  const isCode = (u: string) => /\.(js|mjs|css|html)(\?|#|$)/i.test(new URL(u, location.href).pathname + new URL(u, location.href).search);
  for (const e of performance.getEntriesByType("resource") as PerformanceResourceTiming[]) {
    const crossOrigin = new URL(e.name).origin !== location.origin;
    if (["script", "link", "css"].includes(e.initiatorType) && (crossOrigin || isCode(e.name))) urls.add(e.name);
    else if (!crossOrigin && isCode(e.name)) urls.add(e.name);
  }
  document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.add(s.src));
  document
    .querySelectorAll<HTMLLinkElement>('link[rel="stylesheet"], link[rel="modulepreload"], link[rel="preload"][as="script"], link[rel="preload"][as="style"]')
    .forEach((l) => urls.add(l.href));
  return [...urls].filter((u) => /^https?:/.test(u));
}

/** A full-page warning in a closed shadow root, so the page's own code can't restyle or remove it easily. */
function showMismatch(result: VerifyReply) {
  if (document.getElementById("cloakroom-verify-overlay")) return;
  const host = document.createElement("div");
  host.id = "cloakroom-verify-overlay";
  const root = host.attachShadow({ mode: "closed" });
  const files = (result.mismatchedFiles ?? []).slice(0, 5).map((f) => `<li>${escapeHtml(f)}</li>`).join("");
  root.innerHTML = `
    <style>
      .wrap { position: fixed; inset: 0; z-index: 2147483647; background: rgba(22,48,42,.92); display: grid; place-items: center; font: 15px/1.5 system-ui, sans-serif; }
      .card { max-width: 32rem; margin: 1rem; background: #fafbf8; color: #16302a; border-radius: 10px; padding: 1.5rem; box-shadow: 0 18px 50px -20px rgba(0,0,0,.5); }
      h2 { margin: 0 0 .5rem; color: #b3261e; font-size: 1.2rem; }
      ul { margin: .5rem 0; padding-left: 1.2rem; font: 12px ui-monospace, monospace; color: #56655f; word-break: break-all; }
      .row { display: flex; gap: .5rem; flex-wrap: wrap; margin-top: 1rem; }
      a, button { border-radius: 6px; padding: .55rem .9rem; font: inherit; font-weight: 600; cursor: pointer; text-decoration: none; }
      a { background: #16302a; color: #f1f2ee; }
      button { background: transparent; border: 1px solid #d6dbd3; color: #16302a; }
    </style>
    <div class="wrap" role="alertdialog" aria-label="Cloakroom warning">
      <div class="card">
        <h2>This page's code doesn't match any published Cloakroom release</h2>
        <p>Someone may have changed the website. The Cloakroom extension won't give this page your keys. Don't sign in here.</p>
        ${files ? `<p>Files that don't match:</p><ul>${files}</ul>` : ""}
        <div class="row">
          ${result.verifiedCopyUrl ? `<a href="${escapeHtml(result.verifiedCopyUrl)}" rel="noreferrer noopener">Open the verified copy</a>` : ""}
          <button type="button">Close (keys stay locked)</button>
        </div>
      </div>
    </div>`;
  root.querySelector("button")?.addEventListener("click", () => host.remove());
  document.documentElement.append(host);
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

const post = (data: Record<string, unknown>) => window.postMessage({ source: FROM_EXT, ...data }, app.origin);

async function verifyNow(): Promise<VerifyReply> {
  const result = (await chrome.runtime.sendMessage({ type: "verify-page", urls: loadedCode() })) as VerifyReply;
  if (result.status === "mismatch") showMismatch(result);
  post({ type: "verification", result });
  return result;
}

/**
 * Runs only on the Cloakroom website. It tells the page the extension is installed, passes a pairing request (the
 * account seed, sent after the user confirms on the website) to the background worker, checks the page's code
 * against the published releases (add-on F3), and hands the page the keys only when that check passes.
 */
export default defineContentScript({
  // Match patterns can't carry a port; the exact origin is checked below.
  matches: [`${app.protocol}//${app.hostname}/*`],
  main() {
    if (location.origin !== app.origin) return;
    const announce = () => post({ type: "present" });
    announce();

    // Check once the page has settled, so the chunks it loads at start-up are included.
    const start = () => setTimeout(() => void verifyNow().catch(() => undefined), 500);
    if (document.readyState === "complete") start();
    else window.addEventListener("load", start, { once: true });

    window.addEventListener("message", (e: MessageEvent) => {
      if (e.source !== window || e.origin !== app.origin) return;
      const d = e.data as { source?: string; type?: string; seed?: unknown; persist?: unknown } | null;
      if (d?.source !== FROM_WEB) return;
      if (d.type === "ping") return announce();
      if (d.type === "verify") return void verifyNow().catch(() => undefined);
      if (d.type === "request-keys") {
        chrome.runtime
          .sendMessage({ type: "release-keys", urls: loadedCode() })
          .then((reply: KeysReply) => {
            if (!reply.ok && reply.result?.status === "mismatch") showMismatch(reply.result);
            post({ type: "keys", ...reply });
          })
          .catch((err: unknown) => post({ type: "keys", ok: false, error: String(err) }));
        return;
      }
      if (d.type === "pair" && Array.isArray(d.seed) && d.seed.every((b) => Number.isInteger(b) && b >= 0 && b < 256)) {
        chrome.runtime
          .sendMessage({ type: "pair", seed: d.seed as number[], persist: d.persist === true })
          .then((reply: PairReply) => post({ type: "paired", ...reply }))
          .catch((err: unknown) => post({ type: "paired", ok: false, error: String(err) }));
      }
    });
  },
});
