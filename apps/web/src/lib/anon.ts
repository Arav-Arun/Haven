"use client";

import { createAnonFetch, NETWORKS } from "@haven/platform";
import type { AnonFetch, PrivateNetwork } from "@haven/types";
import { config } from "./config";

const CHOICE_KEY = "haven:network";
const ALL: PrivateNetwork[] = ["nox", "nym", "tor", "off"];

/** Why a network can't be used with this deployment's configuration, or null if it can. */
export function unavailableReason(n: PrivateNetwork): string | null {
  if (n === "off") return null;
  const rpc = NETWORKS[n].chainId === 1 ? config.mainnetRpcUrl : config.sepoliaRpcUrl;
  if (!rpc) return NETWORKS[n].chainId === 1 ? "needs NEXT_PUBLIC_MAINNET_RPC_URL (its worker is registered on mainnet)" : "needs NEXT_PUBLIC_SEPOLIA_RPC_URL";
  if (n === "tor" && !config.torGateways.length) return "needs NEXT_PUBLIC_TOR_GATEWAYS";
  return null;
}

/** The user's choice from Settings if it's usable here, else the deployment's configured network. */
export function selectedNetwork(): PrivateNetwork {
  const saved = typeof localStorage === "undefined" ? null : localStorage.getItem(CHOICE_KEY);
  const choice = ALL.find((n) => n === saved);
  return choice && !unavailableReason(choice) ? choice : config.network;
}

/** Saves the choice and reloads, because the worker for the old network can't be swapped in place. */
export function chooseNetwork(n: PrivateNetwork) {
  localStorage.setItem(CHOICE_KEY, n);
  location.reload();
}

let instance: AnonFetch | null = null;

/** One Anon-RPC worker per tab, created on first use in the browser. */
export function getAnon(): AnonFetch {
  if (instance) return instance;
  const n = selectedNetwork();
  const bootstrapRpcUrl = n === "off" ? undefined : NETWORKS[n].chainId === 1 ? config.mainnetRpcUrl : config.sepoliaRpcUrl;
  instance = createAnonFetch({
    platform: "web",
    network: n,
    bootstrapRpcUrl,
    // Versioned: browsers that loaded this page before 7 Nov kept it with headers that forbade framing it, and a
    // revalidation doesn't replace them. A new URL skips those copies; the page is now served no-store.
    iframeUrl: "/anon-rpc-iframe.html?v=2",
    probeUrl: config.beeUrl ? `${config.beeUrl.replace(/\/$/, "")}/health` : undefined,
    torGateways: config.torGateways,
  });
  return instance;
}

/** An EIP-1193 request function that sends JSON-RPC through Anon-RPC (for viem's `custom` transport). */
export function anonJsonRpc(url: string, isolationKey?: string) {
  let id = 0;
  // Several endpoints, comma-separated, best first: a rationed or failing one is skipped (see config.sepoliaRpcUrl).
  const urls = url
    .split(",")
    .map((u) => u.trim())
    .filter(Boolean);
  return async ({ method, params }: { method: string; params?: unknown }) => {
    const anon = getAnon();
    const doFetch = isolationKey ? anon.isolated(isolationKey) : anon.fetch;
    let last: unknown = new Error("no RPC endpoint configured");
    for (const u of urls) {
      try {
        const res = await doFetch(u, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
        });
        const body = (await res.json().catch(() => ({ error: { message: `HTTP ${res.status}` } }))) as {
          result?: unknown;
          error?: { code?: number; message?: string; data?: unknown };
        };
        if (body.error) {
          last = Object.assign(new Error(body.error.message ?? "RPC error"), body.error);
          if (!res.ok || /rate limit|limit exceeded|usage limit|too many|HTTP 5/i.test(body.error.message ?? "")) continue;
          throw last;
        }
        return body.result;
      } catch (e) {
        last = e;
        if (!(e instanceof TypeError) && !/rate limit|limit exceeded|usage limit|too many|HTTP 5/i.test(e instanceof Error ? e.message : "")) throw e;
      }
    }
    throw last;
  };
}
