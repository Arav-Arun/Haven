// Serves the Anon-RPC harness bootstrap from our own origin, so a strict CSP can forbid inline scripts
// (anon-rpc browser-harness README, "Strict Content Security Policies").
import { copyFileSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
copyFileSync(require.resolve("@anon-rpc/browser-harness/iframe-boot.js"), new URL("../public/anon-rpc-iframe.js", import.meta.url));
writeFileSync(
  new URL("../public/anon-rpc-iframe.html", import.meta.url),
  '<!doctype html><meta charset="utf-8"><script src="/anon-rpc-iframe.js"></script>\n',
);
