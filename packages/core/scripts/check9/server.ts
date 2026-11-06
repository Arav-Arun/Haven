// Check 9 (PLAN_A A1): do real wallets sign the fixed sign-in message identically, is a smart wallet detected, and
// does the wallet warn when the message names another origin? Serves a local page (no third-party scripts) that asks
// the injected wallet for two signatures, then runs core's own checkWalletSignIn on them.
// Prints only the address, the wallet's name and pass/fail lines — never a signature (it would derive the user's keys).
//
// Run: pnpm --filter @cloakroom/core check9   then open http://localhost:8799 in the browser with the wallet.
// Uses SEPOLIA_RPC_URL for the smart-wallet check when set.

import { readFileSync } from "node:fs";
import { createServer } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { DriveError, type Address, type Hex } from "@cloakroom/types";
import { getAddress, isAddress } from "viem";

import { checkWalletSignIn, deriveKeys, signInMessage } from "../../src/keys";
import { log, sepoliaReader } from "../lib";

const APP_ORIGIN = process.env.NEXT_PUBLIC_APP_ORIGIN || "https://cloakroom.vercel.app";
const PORT = 8799;
const page = readFileSync(resolve(dirname(fileURLToPath(import.meta.url)), "index.html"));
const reader = process.env.SEPOLIA_RPC_URL ? sepoliaReader() : null;

async function body(req: import("node:http").IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString("utf8") || "{}");
}

createServer(async (req, res) => {
  const url = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  const json = (status: number, value: unknown) => res.writeHead(status, { "content-type": "application/json" }).end(JSON.stringify(value));
  try {
    if (req.method === "GET" && url.pathname === "/") {
      res.writeHead(200, { "content-type": "text/html; charset=utf-8" }).end(page);
    } else if (req.method === "GET" && url.pathname === "/message") {
      const address = url.searchParams.get("address") ?? "";
      if (!isAddress(address)) return json(400, { error: "bad address" });
      json(200, { message: signInMessage(APP_ORIGIN, getAddress(address)) });
    } else if (req.method === "POST" && url.pathname === "/check") {
      const b = await body(req);
      const address = getAddress(String(b.address)) as Address;
      const wallet = String(b.wallet ?? "unknown").slice(0, 60);
      try {
        const material = await checkWalletSignIn({
          appOrigin: APP_ORIGIN,
          address,
          signatures: (b.signatures as Hex[]) ?? [],
          firstDevice: true,
          getCode: async (a) => (reader ? reader.getCode({ address: a }) : undefined),
        });
        const keys = deriveKeys(material);
        const detail = `two identical signatures from ${address}; cloak.key ${keys.spendingPublicKey.slice(0, 18)}…${reader ? "; not a smart wallet" : "; smart-wallet check skipped (no SEPOLIA_RPC_URL)"}`;
        log(`- PASS check 9 (${wallet}): ${detail}`);
        json(200, { ok: true, detail });
      } catch (error) {
        const detail = error instanceof DriveError ? `${error.code}: ${error.message}` : String(error);
        log(`- FAIL check 9 (${wallet}) for ${address}: ${detail}`);
        json(200, { ok: false, detail });
      }
    } else if (req.method === "POST" && url.pathname === "/warning") {
      const b = await body(req);
      log(`- check 9 domain warning on a wrong origin: ${b.shown ? "shown" : "NOT shown"}`);
      json(200, { ok: true });
    } else {
      json(404, { error: "not found" });
    }
  } catch {
    json(400, { error: "bad request" });
  }
}).listen(PORT, "127.0.0.1", () => log(`check 9: open http://localhost:${PORT} in the browser with your wallet`));
