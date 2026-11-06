import tailwind from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { loadEnv } from "vite";
import { defineConfig } from "wxt";

/** A host match pattern for a configured URL. Match patterns can't carry a port, and need none. */
function hostPattern(url: string | undefined): string[] {
  if (!url) return [];
  const u = new URL(url);
  return [`${u.protocol}//${u.hostname}/*`];
}

// Where the Nox worker's code is fetched from: the workerResolvers() of its specifier contract on Sepolia
// (0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A), read on 2026-11-06. The harness checks the bytes against the
// contract's workerHash, so these hosts can't change what runs.
const WORKER_RESOLVERS = ["https://raw.githubusercontent.com/*", "https://cdn.jsdelivr.net/*", "https://unpkg.com/*"];

export default defineConfig({
  srcDir: "src",
  vite: () => ({ plugins: [react(), tailwind()] }),
  manifest: ({ mode }) => {
    const env = loadEnv(mode, process.cwd(), "WXT_");
    return {
      name: "Cloakroom",
      description: "Share files privately with any ENS name. Save images and pages to your drive, and see new shares.",
      permissions: ["storage", "contextMenus", "alarms", "notifications", "offscreen"],
      // Our own services and the worker's code only. Saving from other sites asks for that site when used.
      host_permissions: [
        ...new Set([
          // The website itself: its files are re-downloaded and hashed before keys are released to it (add-on F3).
          ...hostPattern(env.WXT_APP_ORIGIN),
          ...hostPattern(env.WXT_SEPOLIA_RPC_URL),
          ...hostPattern(env.WXT_API_URL),
          ...hostPattern(env.WXT_BEE_URL),
          ...hostPattern(env.WXT_ARKIV_RPC_URL),
          ...WORKER_RESOLVERS,
        ]),
      ],
      optional_host_permissions: ["<all_urls>"],
      action: { default_title: "Cloakroom" },
      // The anon-rpc worker runs in a sandboxed page at a null origin (harness README, "Manifest").
      sandbox: { pages: ["anon-rpc/*/sandbox.html"] },
      content_security_policy: {
        extension_pages: "script-src 'self'; object-src 'self'",
        sandbox:
          "sandbox allow-scripts; script-src 'self' 'unsafe-inline' 'unsafe-eval' blob:; child-src 'self' blob:; worker-src 'self' blob:; connect-src *;",
      },
    };
  },
});
