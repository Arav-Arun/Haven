// Copies the Chrome zip `wxt zip` just made to the website, which serves it at /haven-extension.zip for
// /extension's "Download for Chrome" (until the extension is listed on the Chrome Web Store).
// Run: pnpm --filter @haven/extension zip:web
import { copyFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";

const out = new URL("../.output/", import.meta.url).pathname;
const zips = readdirSync(out).filter((f) => f.endsWith("-chrome.zip"));
if (!zips.length) throw new Error("No Chrome zip in .output; run `pnpm zip` first.");
const newest = zips.map((f) => join(out, f)).sort((a, b) => statSync(b).mtimeMs - statSync(a).mtimeMs)[0];
const target = new URL("../../web/public/haven-extension.zip", import.meta.url).pathname;
copyFileSync(newest, target);
console.log(`${newest} → ${target} (${(statSync(target).size / 1024).toFixed(0)} KB)`);
