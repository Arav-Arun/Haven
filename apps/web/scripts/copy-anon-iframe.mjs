// Serves the Anon-RPC harness bootstrap from our own origin, so a strict CSP can forbid inline scripts
// (anon-rpc browser-harness README, "Strict Content Security Policies").
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const publicDir = new URL("../public/", import.meta.url);
mkdirSync(publicDir, { recursive: true }); // fresh clones have no public/: it only holds these generated files
copyFileSync(require.resolve("@anon-rpc/browser-harness/iframe-boot.js"), new URL("anon-rpc-iframe.js", publicDir));
writeFileSync(new URL("anon-rpc-iframe.html", publicDir), '<!doctype html><meta charset="utf-8"><script src="/anon-rpc-iframe.js"></script>\n');
