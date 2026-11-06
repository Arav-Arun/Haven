// Shared by the live scripts (bootstrap, A1 checks, A4): env loading, clients, receipts printed as evidence lines.
// Keys come from the gitignored repo-root .env and apps/api/.env; only derived addresses are ever printed.

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Hex, ReceiptStep } from "@cloakroom/types";
import { createPublicClient, createWalletClient, isHex, type TransactionReceipt } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { sepolia } from "viem/chains";

import type { SepoliaWriter } from "../src/ens";
import { anonTransport, passthroughAnon } from "../src/transport";

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = resolve(here, "../../..");

for (const file of [resolve(repoRoot, ".env"), resolve(repoRoot, "apps/api/.env")]) {
  if (!existsSync(file)) continue;
  for (const line of readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (m && m[2] !== "" && !process.env[m[1]!]) process.env[m[1]!] = m[2]!.replace(/^["']|["']$/g, "");
  }
}

/** contracts/deployments/sepolia.json, or DEPLOYMENT_FILE for a rehearsal on a local fork (so it can't touch the real one). */
export const deploymentPath = process.env.DEPLOYMENT_FILE
  ? resolve(process.env.DEPLOYMENT_FILE)
  : resolve(repoRoot, "contracts/deployments/sepolia.json");
export const isRehearsal = Boolean(process.env.DEPLOYMENT_FILE);

export function env(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is not set (repo-root .env or apps/api/.env)`);
  return value;
}

export function envKey(name: string): Hex {
  const value = env(name);
  if (!isHex(value) || value.length !== 66) throw new Error(`${name} must be a 0x-prefixed 32-byte hex key`);
  return value;
}

export const anon = passthroughAnon();

export function sepoliaReader() {
  return createPublicClient({ chain: sepolia, transport: anonTransport({ url: env("SEPOLIA_RPC_URL"), anon }) });
}

export function sepoliaWriter(key: Hex): SepoliaWriter {
  return {
    public: sepoliaReader(),
    wallet: createWalletClient({
      chain: sepolia,
      transport: anonTransport({ url: env("SEPOLIA_RPC_URL"), anon }),
      account: privateKeyToAccount(key),
    }),
  };
}

export function log(line = "") {
  console.log(line);
}

export function check(label: string, ok: boolean, detail = "") {
  log(`- ${ok ? "PASS" : "FAIL"} ${label}${detail ? ` — ${detail}` : ""}`);
  if (!ok) process.exitCode = 1;
}

let printing: Promise<void> = Promise.resolve();

/** Prints each transaction (with its gas, read from the receipt) and Swarm step as an evidence line, in order. */
export function stepLogger(actor: string, client = sepoliaReader()) {
  return (step: ReceiptStep) => {
    printing = printing.then(async () => {
      if (step.kind === "sepolia-tx") {
        const gas = await client
          .getTransactionReceipt({ hash: step.hash })
          .then((r: TransactionReceipt) => ` — gas ${r.gasUsed}`)
          .catch(() => "");
        log(`- ${actor}: ${step.label} — ${step.ok ? "ok" : "FAILED"}${gas} — ${step.explorerUrl}`);
      } else if (step.kind === "arkiv-tx") {
        log(`- ${actor}: ${step.label} — ${step.ok ? "ok" : "FAILED"} — ${step.explorerUrl}`);
      } else if (step.kind === "swarm") {
        log(`- ${actor}: ${step.label} — ref ${step.ref} (${step.paddedBytes} bytes padded)`);
      }
    });
  };
}

/** Waits until every queued evidence line has printed. */
export function flushLogs(): Promise<void> {
  return printing;
}

export function readDeployment(): { cloakroom: Record<string, unknown> } & Record<string, unknown> {
  return JSON.parse(readFileSync(deploymentPath, "utf8"));
}

/** Records our addresses under "cloakroom" in contracts/deployments/sepolia.json (the single source for addresses). */
export function recordDeployment(entries: Record<string, string | number>) {
  const json = readDeployment();
  json.cloakroom = { ...json.cloakroom, ...entries };
  writeFileSync(deploymentPath, `${JSON.stringify(json, null, 2)}\n`);
}
