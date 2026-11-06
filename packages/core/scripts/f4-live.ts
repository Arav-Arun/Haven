// Add-on F4 first checks, live on our Bee node:
//   1. our chunk encoding (BMT, span) gives the same address Bee does for a one-chunk upload;
//   2. a doorbell stamped through stampDoorbell (what the API's POST /doorbell does) reaches a WebSocket subscriber on
//      /gsoc/subscribe/<address>, and how long it takes;
//   3. a forged payload on the same topic arrives but is dropped by openDoorbell.
// If 2 fails, record it in docs/checks-a.md: the fallback is polling Arkiv every 30 seconds (subscribeRoom's
// onFallback), and nothing else changes.
//
// Run: pnpm --filter @cloakroom/core f4
// Needs (repo-root .env): BEE_URL, POSTAGE_BATCH_ID. Node 22+ (global WebSocket).

import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { toHex } from "viem";

import {
  beeTarget,
  cacAddress,
  gsocKey,
  gsocSubscribeUrl,
  makeDoorbellChunk,
  openDoorbell,
  randomBytes,
  roomTopic,
  sealDoorbell,
  stampDoorbell,
  storeOnBee,
} from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
for (const file of [resolve(here, "../../../.env"), resolve(here, "../../../apps/api/.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
const BEE_URL = process.env.BEE_URL;
const BATCH = process.env.POSTAGE_BATCH_ID;
if (!BEE_URL || !BATCH) throw new Error("BEE_URL and POSTAGE_BATCH_ID must be set (repo-root .env)");

const log = (line = "") => console.log(line);
function check(label: string, ok: boolean, detail = "") {
  log(`- ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

log(`# F4 live check, ${new Date().toISOString()}`);

log();
log("## 1. Chunk encoding");
const sample = randomBytes(300);
const beeRef = await storeOnBee(BEE_URL, BATCH, sample);
check("our CAC address equals Bee's reference for a one-chunk upload", beeRef === cacAddress(sample), beeRef);

log();
log("## 2. A doorbell reaches a subscriber");
const target = await beeTarget(BEE_URL);
log(`- Bee overlay ${target.overlay}, depth ${target.proximity}`);
const topic = roomTopic(randomBytes(32));
const { address } = gsocKey(topic, target);
const ws = new WebSocket(gsocSubscribeUrl(BEE_URL, address));
ws.binaryType = "arraybuffer";
const received: Uint8Array[] = [];
await new Promise<void>((ok, fail) => {
  ws.onopen = () => ok();
  ws.onerror = () => fail(new Error("WebSocket to /gsoc/subscribe failed"));
});
ws.onmessage = (e) => received.push(new Uint8Array(e.data as ArrayBuffer));

const arkivKey = toHex(randomBytes(32));
const payload = await sealDoorbell(topic, { type: "file", arkivKey });
const chunk = await makeDoorbellChunk(topic, target, payload);
const sentAt = Date.now();
await stampDoorbell(BEE_URL, BATCH, { owner: chunk.owner, identifier: chunk.identifier, signature: chunk.signature, data: toHex(chunk.data) });
while (received.length === 0 && Date.now() - sentAt < 15_000) await new Promise((r) => setTimeout(r, 100));
check("the subscriber got the ring", received.length > 0, `${Date.now() - sentAt} ms`);
if (received[0]) {
  const opened = await openDoorbell(topic, received[0]);
  check("it decrypts to the event that was rung", opened?.arkivKey === arkivKey && opened.type === "file");
}

log();
log("## 3. A forged payload is dropped");
const forged = await makeDoorbellChunk(topic, target, randomBytes(256));
const before = received.length;
await stampDoorbell(BEE_URL, BATCH, { owner: forged.owner, identifier: forged.identifier, signature: forged.signature, data: toHex(forged.data) });
const forgedAt = Date.now();
while (received.length === before && Date.now() - forgedAt < 15_000) await new Promise((r) => setTimeout(r, 100));
if (received.length > before) check("openDoorbell drops it", (await openDoorbell(topic, received[received.length - 1]!)) === null);
else log("- (the node didn't deliver a second write to the same address; nothing to drop)");
ws.close();
