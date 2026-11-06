// Copies the anon-rpc extension harness's packaged pages (offscreen document and sandboxed worker page) into
// public/, from node_modules, on every build: the harness README warns that a stale copy fails silently.
import { cpSync, rmSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
// Either separator: on Windows the resolved path uses backslashes.
const pkgDir = dirname(require.resolve("@anon-rpc/browser-extension-harness")).replace(/[\\/]dist$/, "");
const target = fileURLToPath(new URL("../public/anon-rpc", import.meta.url));
rmSync(target, { recursive: true, force: true });
cpSync(join(pkgDir, "dist/static/anon-rpc"), target, { recursive: true });
console.log("anon-rpc harness pages copied to public/anon-rpc");
