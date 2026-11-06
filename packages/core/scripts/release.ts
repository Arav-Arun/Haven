// Add-on F3: publish, check and revoke website releases.
//
//   pnpm --filter @cloakroom/core release manifest            root hash of apps/web/out (run after `pnpm --filter @cloakroom/web build`)
//   pnpm --filter @cloakroom/core release publish <version>   site + manifest to Swarm, cloak.release on Arkiv, cloakroom.eth contenthash
//   pnpm --filter @cloakroom/core release revoke <rootHash>   cloak.unrelease (the extension then treats that build as bad)
//   pnpm --filter @cloakroom/core release rebuild <rootHash>  rebuild yourself first; posts cloak.rebuild {matched} from your own key
//
// Env (repo-root .env, then apps/api/.env): SEPOLIA_RPC_URL, DEPLOYER_PRIVATE_KEY (owns cloakroom.eth), RELEASE_PRIVATE_KEY
// (R, needs tGLM), ARKIV_RPC_URL, ARKIV_ACCESS_KEY, BEE_URL, POSTAGE_BATCH_ID; REBUILDER_PRIVATE_KEY for `rebuild`.

import { execFileSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

import type { Address, Hex, ReceiptStep } from "@cloakroom/types";
import { concatBytes, createPublicClient, createWalletClient, encodeFunctionData, http, isAddressEqual, isHex, parseAbi, zeroAddress } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import {
  arkivWriter,
  buildManifest,
  canonicalJson,
  deployProxy,
  dnsEncode,
  driveRegistryAbi,
  ensv2,
  labelId,
  passthroughAnon,
  rebuildOp,
  releaseOp,
  releaseTypedData,
  rootHashOf,
  sendTx,
  unreleaseOp,
  unreleaseTypedData,
  utf8,
  writeEntities,
  type SepoliaWriter,
} from "../src/index";
import { ALL_ROLES, RESOLVER_UPGRADE_ROLES } from "../src/naming";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../../..");
const out = resolve(root, "apps/web/out");
for (const file of [resolve(root, ".env"), resolve(root, "apps/api/.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}
function env(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set (repo-root .env or apps/api/.env)`);
  return v;
}
function key(name: string): Hex {
  const v = env(name);
  if (!isHex(v) || v.length !== 66) throw new Error(`${name} must be 0x + 64 hex`);
  return v;
}

// ---------------------------------------------------------------- the build

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = resolve(dir, name);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

/** NEXT_PUBLIC_* values the build read (they're compiled into the JS anyway), so a rebuilder can match it. */
function publicEnv(): Record<string, string> {
  const vals: Record<string, string> = {};
  for (const f of [".env", ".env.production", ".env.local", ".env.production.local"]) {
    const p = resolve(root, "apps/web", f);
    if (!existsSync(p)) continue;
    for (const line of readFileSync(p, "utf8").split("\n")) {
      const m = line.match(/^\s*(NEXT_PUBLIC_[A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
      if (m) vals[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
    }
  }
  for (const [k, v] of Object.entries(process.env)) if (k.startsWith("NEXT_PUBLIC_") && v !== undefined) vals[k] = v;
  return vals;
}

function gitCommit(): string {
  return execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
}

function siteFiles() {
  if (!existsSync(resolve(out, "index.html"))) throw new Error("apps/web/out is missing: run `pnpm --filter @cloakroom/web build` first");
  return walk(out)
    .map((p) => ({ path: relative(out, p).split(sep).join("/"), bytes: new Uint8Array(readFileSync(p)) }))
    .sort((a, b) => (a.path < b.path ? -1 : 1));
}

function manifest(version: string) {
  return buildManifest(siteFiles(), { version, gitCommit: gitCommit(), publicEnv: publicEnv() });
}

// ---------------------------------------------------------------- Swarm

/** A plain ustar archive (what Bee's /bzz takes for a collection), files in sorted order with fixed metadata. */
function tar(files: { path: string; bytes: Uint8Array }[]): Uint8Array {
  const parts: Uint8Array[] = [];
  const enc = new TextEncoder();
  for (const f of files) {
    const header = new Uint8Array(512);
    let name = f.path;
    let prefix = "";
    if (enc.encode(name).length > 100) {
      const cut = name.lastIndexOf("/", 154);
      prefix = name.slice(0, cut);
      name = name.slice(cut + 1);
      if (enc.encode(name).length > 100 || enc.encode(prefix).length > 155) throw new Error(`path too long for tar: ${f.path}`);
    }
    const put = (text: string, at: number, len: number) => header.set(enc.encode(text).slice(0, len), at);
    const octal = (n: number, len: number) => n.toString(8).padStart(len - 1, "0") + "\0";
    put(name, 0, 100);
    put(octal(0o644, 8), 100, 8);
    put(octal(0, 8), 108, 8);
    put(octal(0, 8), 116, 8);
    put(octal(f.bytes.length, 12), 124, 12);
    put(octal(0, 12), 136, 12);
    put("        ", 148, 8);
    put("0", 156, 1);
    put("ustar\0", 257, 6);
    put("00", 263, 2);
    put(prefix, 345, 155);
    const sum = header.reduce((a, b) => a + b, 0);
    put(`${sum.toString(8).padStart(6, "0")}\0 `, 148, 8);
    parts.push(header, f.bytes, new Uint8Array((512 - (f.bytes.length % 512)) % 512));
  }
  parts.push(new Uint8Array(1024));
  return concatBytes(parts);
}

async function bee(path: string, body: Uint8Array, headers: Record<string, string>): Promise<string> {
  const res = await fetch(`${env("BEE_URL").replace(/\/+$/, "")}${path}`, {
    method: "POST",
    headers: { "swarm-postage-batch-id": env("POSTAGE_BATCH_ID"), ...headers },
    body: new Uint8Array(body),
  });
  const json = (await res.json().catch(() => ({}))) as { reference?: string; message?: string };
  if (!res.ok || !json.reference) throw new Error(`Bee ${path}: HTTP ${res.status} ${json.message ?? ""}`);
  return json.reference;
}

/** ENSIP-7 contenthash for a Swarm manifest: swarm-ns, CIDv1, swarm-manifest codec, keccak256 multihash, 32 bytes. */
function swarmContenthash(reference: string): Hex {
  if (!/^[0-9a-f]{64}$/i.test(reference)) throw new Error("expected a 32-byte Swarm reference");
  return `0xe40101fa011b20${reference.toLowerCase()}`;
}

// ---------------------------------------------------------------- Sepolia: cloakroom.eth's contenthash

const resolverAbi = parseAbi([
  "function initialize((address account, uint256 roleBitmap)[] grants, bytes[] calls)",
  // The live deployment keys records by DNS-encoded name (FEEDBACK-ENS.md, point 2).
  "function setContenthash(bytes name, bytes hash)",
]);

async function setContenthash(contenthash: Hex, log: (s: ReceiptStep) => void) {
  const deployer = privateKeyToAccount(key("DEPLOYER_PRIVATE_KEY"));
  const transport = http(env("SEPOLIA_RPC_URL"));
  const client = createPublicClient({ chain: sepolia, transport });
  const writer: SepoliaWriter = { public: client, wallet: createWalletClient({ chain: sepolia, transport, account: deployer }) };
  const name = dnsEncode("cloakroom.eth");
  const current = await client.readContract({ address: ensv2.ETHRegistry, abi: driveRegistryAbi, functionName: "getResolver", args: ["cloakroom"] });
  if (isAddressEqual(current, zeroAddress)) {
    const init = encodeFunctionData({
      abi: resolverAbi,
      functionName: "initialize",
      args: [[{ account: deployer.address, roleBitmap: ALL_ROLES & ~RESOLVER_UPGRADE_ROLES }], [encodeFunctionData({ abi: resolverAbi, functionName: "setContenthash", args: [name, contenthash] })]],
    });
    const { proxy } = await deployProxy(writer, { implementation: ensv2.PermissionedResolverImpl, init, label: "Create cloakroom.eth resolver" }, log);
    const data = encodeFunctionData({ abi: driveRegistryAbi, functionName: "setResolver", args: [labelId("cloakroom"), proxy] });
    await sendTx(writer, "Point cloakroom.eth at its resolver", ensv2.ETHRegistry, data, log);
  } else {
    await sendTx(writer, "Set cloakroom.eth contenthash", current as Address, encodeFunctionData({ abi: resolverAbi, functionName: "setContenthash", args: [name, contenthash] }), log);
  }
}

// ---------------------------------------------------------------- Arkiv

function arkiv(privateKey: Hex) {
  return arkivWriter({ rpcUrl: env("ARKIV_RPC_URL"), accessKey: env("ARKIV_ACCESS_KEY"), anon: passthroughAnon() }, privateKey);
}

const log = (s: ReceiptStep) => {
  if (s.kind === "sepolia-tx" || s.kind === "arkiv-tx") console.log(`  ${s.ok ? "ok" : "FAILED"}  ${s.label}  ${s.explorerUrl}`);
};

// ---------------------------------------------------------------- commands

const [command, arg] = process.argv.slice(2);

if (command === "manifest") {
  const m = manifest(arg ?? "unreleased");
  console.log(`${Object.keys(m.files).length} files, commit ${m.gitCommit}`);
  console.log(`rootHash ${rootHashOf(m)}`);
} else if (command === "publish") {
  if (!arg) throw new Error("usage: release publish <version>");
  const dirty = execFileSync("git", ["status", "--porcelain", "--", "apps/web", "packages"], { cwd: root, encoding: "utf8" }).trim();
  if (dirty) throw new Error("apps/web or packages has uncommitted changes: a release must be rebuildable from its commit");
  const files = siteFiles();
  const m = buildManifest(files, { version: arg, gitCommit: gitCommit(), publicEnv: publicEnv() });
  const rootHash = rootHashOf(m);
  console.log(`1. rootHash ${rootHash} (${Object.keys(m.files).length} files, commit ${m.gitCommit})`);
  const siteRef = await bee("/bzz", tar(files), {
    "content-type": "application/x-tar",
    "swarm-collection": "true",
    "swarm-index-document": "index.html",
    "swarm-error-document": "404.html",
  });
  console.log(`2. site on Swarm: ${siteRef}`);
  const manifestRef = await bee("/bytes", utf8(canonicalJson(m)), { "content-type": "application/octet-stream" });
  console.log(`3. manifest on Swarm: ${manifestRef}`);
  const R = privateKeyToAccount(key("RELEASE_PRIVATE_KEY"));
  const release = { version: arg, rootHash, gitCommit: m.gitCommit, manifestSwarmRef: `0x${manifestRef}` as Hex, siteSwarmRef: siteRef };
  const sig = await R.signTypedData(releaseTypedData(release));
  const { keys } = await writeEntities(arkiv(key("RELEASE_PRIVATE_KEY")), [releaseOp({ ...release, sig })], "cloak.release", log);
  console.log(`4. cloak.release ${keys[0]} signed by R = ${R.address} (set WXT_RELEASE_SIGNER to this)`);
  await setContenthash(swarmContenthash(siteRef), log);
  console.log(`5. cloakroom.eth contenthash → ${siteRef}`);
} else if (command === "revoke") {
  if (!arg || !isHex(arg)) throw new Error("usage: release revoke <rootHash>");
  const R = privateKeyToAccount(key("RELEASE_PRIVATE_KEY"));
  const sig = await R.signTypedData(unreleaseTypedData(arg));
  const { keys } = await writeEntities(arkiv(key("RELEASE_PRIVATE_KEY")), [unreleaseOp({ rootHash: arg, sig })], "cloak.unrelease", log);
  console.log(`revoked ${arg}: ${keys[0]}`);
} else if (command === "rebuild") {
  if (!arg || !isHex(arg)) throw new Error("usage: release rebuild <rootHash> (after building the release's commit yourself)");
  const mine = rootHashOf(manifest(process.env.RELEASE_VERSION ?? "unreleased"));
  // The version string is part of the manifest, so pass the release's version: RELEASE_VERSION=1.0.0
  const matched = mine.toLowerCase() === arg.toLowerCase();
  console.log(`your build: ${mine} → ${matched ? "MATCHES" : "differs"}`);
  const { keys } = await writeEntities(arkiv(key("REBUILDER_PRIVATE_KEY")), [rebuildOp({ rootHash: arg, matched })], "cloak.rebuild", log);
  console.log(`cloak.rebuild ${keys[0]}`);
} else {
  console.log("usage: release manifest | publish <version> | revoke <rootHash> | rebuild <rootHash>");
  process.exit(1);
}
