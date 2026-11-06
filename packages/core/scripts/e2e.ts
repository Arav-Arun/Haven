// End to end through the real DriveClient (PLAN_A.md step A6 "Done when"), against live Sepolia, Arkiv, Bee and a
// running apps/api. Three fresh random identities, nothing pre-seeded:
//   1. Founder, Investor and Editor sign in and claim names.   2. Founder makes a room and uploads two files.
//   3. Founder shares: Investor as viewer until ~3 minutes from now, Editor as editor with no end.
//   4. Investor finds the share and opens both files.          5. Editor uploads; Founder sees it.
//   6. After Investor's end, Founder uploads; Investor sees it locked (readable: false), with no transaction.
//   7. Founder removes Editor early; Editor's next upload is refused.
//   8. The Public view: what anyone can read about the room.
// Writes every transaction link to docs/evidence.md.
//
// Run: pnpm --filter @cloakroom/api start   (in another terminal)   then   pnpm --filter @cloakroom/core e2e
// Needs (repo-root .env or apps/api/.env): SEPOLIA_RPC_URL, ARKIV_RPC_URL, ARKIV_ACCESS_KEY, BEE_URL, and API_URL
// (the running API, e.g. http://localhost:8787). Demo epochs (1 minute).

import { appendFileSync, existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { DriveClient, Receipt } from "@cloakroom/types";

import { createDriveClient, memoryStore, passthroughAnon } from "../src/index";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
for (const file of [resolve(root, ".env"), resolve(root, "apps/api/.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
const env = (k: string) => {
  const v = process.env[k];
  if (!v) throw new Error(`${k} is not set`);
  return v;
};

const evidence = resolve(root, "docs/evidence.md");
const out = (line = "") => {
  console.log(line);
  appendFileSync(evidence, `${line}\n`);
};
const check = (label: string, ok: boolean) => {
  out(`- ${ok ? "PASS" : "FAIL"} ${label}`);
  if (!ok) process.exitCode = 1;
};

function person(name: string): DriveClient {
  const client = createDriveClient({
    anon: passthroughAnon(),
    storage: memoryStore(),
    appOrigin: "http://localhost:3000",
    apiUrl: env("API_URL"),
    beeUrl: env("BEE_URL"),
    sepoliaRpcUrl: env("SEPOLIA_RPC_URL"),
    arkivRpcUrl: env("ARKIV_RPC_URL"),
    arkivAccessKey: env("ARKIV_ACCESS_KEY"),
    demoMode: true,
  });
  client.onReceipt((r: Receipt) => {
    if (!r.done) return;
    for (const s of r.steps)
      if (s.kind === "sepolia-tx" || s.kind === "arkiv-tx") out(`  - ${name}: ${r.action}: ${s.label} — ${s.explorerUrl}`);
      else if (s.kind === "swarm") out(`  - ${name}: ${s.label} — ${s.ref} (${s.paddedBytes} bytes)`);
  });
  return client;
}
const label = (p: string) => `${p}-${Math.random().toString(36).slice(2, 7)}`;
const text = (s: string) => new Blob([s], { type: "text/plain" });
const sleep = (s: number) => new Promise((r) => setTimeout(r, s * 1000));

out(`\n## e2e run, ${new Date().toISOString()}\n`);
const founder = person("Founder");
const investor = person("Investor");
const editor = person("Editor");

out("### 1. Sign in and claim names");
for (const [c, p] of [[founder, "founder"], [investor, "investor"], [editor, "editor"]] as const) {
  await c.signIn({ kind: "random" });
  const me = await c.claimName(label(p));
  out(`- ${p}: ${me.ensName}`);
}
const investorName = (await investor.restore())!.ensName!;
const editorName = (await editor.restore())!.ensName!;

out("### 2. Founder makes a room and uploads two files");
const room = await founder.createRoom("Series A");
out(`- room ${room.ensName} (${room.registry})`);
await founder.upload(room.registry, text("Deck: we are raising."), "deck.txt");
await founder.upload(room.registry, text("Financials: numbers."), "financials.txt");

out("### 3. Founder shares");
const investorEnd = Math.floor(Date.now() / 1000) + 180;
const inv = await founder.share(room.registry, investorName, { role: "viewer", until: investorEnd, hideFromMembers: true });
const ed = await founder.share(room.registry, editorName, { role: "editor", until: null, hideFromMembers: false });
out(`- investor as ${inv.address} until ${new Date(investorEnd * 1000).toISOString()}; editor as ${ed.address}`);

out("### 4. Investor finds the share and opens both files");
const shared = await investor.sharedWithMe();
check("investor sees the room in Shared with me", shared.some((s) => s.folder.registry === room.registry));
const invFiles = await investor.listFiles(room.registry);
check("investor can read both files", invFiles.filter((f) => f.readable).length === 2);
const deck = invFiles.find((f) => f.name === "deck.txt")!;
check("the deck decrypts to what was uploaded", (await (await investor.download(deck)).text()) === "Deck: we are raising.");

out("### 5. Editor uploads; Founder sees it");
await editor.sharedWithMe();
await editor.upload(room.registry, text("Term sheet draft."), "terms.txt");
check("founder sees the editor's file", (await founder.listFiles(room.registry)).some((f) => f.name === "terms.txt" && f.readable));

out("### 6. Investor's access ends; a new file is locked for them");
const wait = investorEnd - Math.floor(Date.now() / 1000) + 65;
out(`- waiting ${wait} s`);
await sleep(Math.max(0, wait));
await founder.upload(room.registry, text("Final terms."), "final.txt");
const after = await investor.listFiles(room.registry);
check("the new file is locked for the investor", after.some((f) => !f.readable));
check("files the investor could read before stay readable", after.filter((f) => f.readable).length >= 2);

out("### 7. Founder removes the editor early");
await founder.removeMember(room.registry, ed.address);
let refused = false;
try {
  await editor.upload(room.registry, text("After removal."), "late.txt");
} catch (e) {
  refused = true;
  out(`- refused: ${(e as Error).message}`);
}
check("the editor's upload after removal is refused", refused);

out("### 8. Public view");
const view = await founder.publicView(room.registry);
out(`- ${view.summary}`);
out(`- ${view.members.length} member addresses, ${view.arkiv.length} Arkiv entities, ${view.swarm.length} Swarm blobs, ${view.ignoredWrites} ignored writes`);
out(`- direct calls: ${view.directCalls.join(", ") || "none"}`);
out(process.exitCode ? "\nRESULT: FAIL" : "\nRESULT: PASS");
