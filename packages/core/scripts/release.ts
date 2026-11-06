// Add-on F3: publish a verified frontend release, attest a rebuild, or revoke a release.
//
//   pnpm --filter @cloakroom/core release manifest            hash apps/web/out → out/release-manifest.json, print root
//   pnpm --filter @cloakroom/core release publish             manifest + site to Swarm, signed cloak.release on Arkiv
//   pnpm --filter @cloakroom/core release rebuild <rootHash>  compare a local rebuild, post cloak.rebuild (any wallet)
//   pnpm --filter @cloakroom/core release revoke <rootHash>   R withdraws a release (cloak.release-revoke)
//
// Build first, from a clean checkout of the commit, with a fixed build id:
//   CLOAKROOM_BUILD_ID=$(git rev-parse HEAD) SOURCE_DATE_EPOCH=0 pnpm --filter @cloakroom/web build
// Needs (repo-root .env): publish → BEE_URL, POSTAGE_BATCH_ID, RELEASE_PRIVATE_KEY (R; holds tGLM), ARKIV_RPC_URL,
// ARKIV_ACCESS_KEY; rebuild → REBUILDER_PRIVATE_KEY (any funded key), ARKIV_*; revoke → RELEASE_PRIVATE_KEY, ARKIV_*.
// Setting cloakroom.eth's contenthash to the printed site reference is done by the name's owner (the team multisig).

import { execSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Hex, ReceiptStep } from "@cloakroom/types";
import { isHex } from "viem";
import { privateKeyToAccount } from "viem/accounts";

import {
  arkivReader,
  arkivWriter,
  listReleases,
  manifestRootHash,
  MANIFEST_EXTENSIONS,
  passthroughAnon,
  rebuildOp,
  releaseOp,
  releaseRevokeOp,
  sha256Hex,
  signRelease,
  storeOnBee,
  storeSiteOnBee,
  validReleases,
  writeEntities,
  type ReleaseManifest,
  type SiteFile,
} from "../src/index";
import { listReleaseRevokes } from "../src/arkiv";
import { utf8 } from "../src/crypto";

const here = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(here, "../../..");
const OUT = resolve(ROOT, "apps/web/out");
const MANIFEST_FILE = "release-manifest.json";

for (const file of [resolve(ROOT, ".env"), resolve(ROOT, "apps/api/.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (repo-root .env)`);
  return value;
}
function key(name: string): Hex {
  const value = env(name);
  if (!isHex(value) || value.length !== 66) throw new Error(`${name} must be a 0x-hex private key`);
  return value;
}

const log = (line = "") => console.log(line);
const step = (s: ReceiptStep) => {
  if (s.kind === "arkiv-tx") log(`- ${s.label}: ${s.ok ? "ok" : "FAILED"} — ${s.explorerUrl}`);
};

/** Every file of the static export, sorted, with forward-slash paths. */
function siteFiles(): SiteFile[] {
  if (!existsSync(OUT)) throw new Error(`no build at ${OUT}: build apps/web first`);
  const files: SiteFile[] = [];
  const walk = (dir: string) => {
    for (const name of readdirSync(dir)) {
      const full = join(dir, name);
      if (statSync(full).isDirectory()) walk(full);
      else files.push({ path: relative(OUT, full).split(sep).join("/"), bytes: new Uint8Array(readFileSync(full)) });
    }
  };
  walk(OUT);
  return files.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
}

function gitCommit(): string {
  const commit = execSync("git rev-parse HEAD", { cwd: ROOT }).toString().trim();
  const dirty = execSync("git status --porcelain -- apps/web packages/ui packages/platform packages/types", { cwd: ROOT })
    .toString()
    .trim();
  return dirty ? `${commit}-dirty` : commit;
}

/** The manifest of the current build: every .js, .css and .html (not the manifest itself). */
function buildManifest(): ReleaseManifest {
  const version = JSON.parse(readFileSync(resolve(ROOT, "apps/web/package.json"), "utf8")).version as string;
  const files: Record<string, string> = {};
  for (const f of siteFiles()) {
    if (f.path === MANIFEST_FILE) continue;
    if (MANIFEST_EXTENSIONS.some((ext) => f.path.endsWith(ext))) files[f.path] = sha256Hex(f.bytes);
  }
  return { version: process.env.RELEASE_VERSION || version, gitCommit: gitCommit(), files };
}

const arkivConnection = () => ({ rpcUrl: env("ARKIV_RPC_URL"), accessKey: env("ARKIV_ACCESS_KEY"), anon: passthroughAnon() });

const [command, arg] = process.argv.slice(2);

if (command === "manifest") {
  const manifest = buildManifest();
  writeFileSync(resolve(OUT, MANIFEST_FILE), JSON.stringify(manifest, null, 2));
  log(`${Object.keys(manifest.files).length} files, commit ${manifest.gitCommit}`);
  log(`rootHash ${manifestRootHash(manifest)}`);
} else if (command === "publish") {
  const manifest = buildManifest();
  if (manifest.gitCommit.endsWith("-dirty")) throw new Error("uncommitted changes in the app: publish from a clean checkout");
  const rootHash = manifestRootHash(manifest);
  const manifestBytes = utf8(JSON.stringify(manifest, null, 2));
  writeFileSync(resolve(OUT, MANIFEST_FILE), manifestBytes);
  const bee = env("BEE_URL");
  const batch = env("POSTAGE_BATCH_ID");
  const manifestSwarmRef = await storeOnBee(bee, batch, manifestBytes);
  const siteSwarmRef = await storeSiteOnBee(bee, batch, siteFiles());
  const r = key("RELEASE_PRIVATE_KEY");
  const unsigned = { version: manifest.version, rootHash, gitCommit: manifest.gitCommit, manifestSwarmRef, siteSwarmRef };
  const sig = await signRelease(r, unsigned);
  await writeEntities(arkivWriter(arkivConnection(), r), [releaseOp({ ...unsigned, sig })], "Publish release", step);
  log(`release ${manifest.version} (${manifest.gitCommit}) signed by R ${privateKeyToAccount(r).address}`);
  log(`rootHash ${rootHash}`);
  log(`manifest ${manifestSwarmRef}`);
  log(`site     ${siteSwarmRef}  → set as cloakroom.eth's contenthash (bzz://${siteSwarmRef.slice(2)})`);
} else if (command === "rebuild" || command === "revoke") {
  if (!arg || !isHex(arg) || arg.length !== 66) throw new Error(`usage: release ${command} <rootHash>`);
  const rootHash = arg.toLowerCase() as Hex;
  if (command === "rebuild") {
    const local = manifestRootHash(buildManifest());
    const matched = local === rootHash;
    log(`local rebuild ${local}: ${matched ? "MATCHES" : "does NOT match"} ${rootHash}`);
    await writeEntities(arkivWriter(arkivConnection(), key("REBUILDER_PRIVATE_KEY")), [rebuildOp({ rootHash, matched })], "Post rebuild result", step);
  } else {
    const r = key("RELEASE_PRIVATE_KEY");
    const R = privateKeyToAccount(r).address;
    const reader = arkivReader(arkivConnection());
    const known = await validReleases((await listReleases(reader, R)).records, (await listReleaseRevokes(reader, R)).records, R);
    if (!known.releases.some((x) => x.rootHash.toLowerCase() === rootHash)) log("note: no current release has that root hash");
    await writeEntities(arkivWriter(arkivConnection(), r), [releaseRevokeOp({ rootHash })], "Revoke release", step);
  }
} else {
  log("usage: release manifest | publish | rebuild <rootHash> | revoke <rootHash>");
  process.exitCode = 1;
}
