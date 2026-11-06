"use client";

import { createAnonFetch, NETWORKS } from "@cloakroom/platform";
import type { AnonFetch } from "@cloakroom/types";
import { config } from "./config";

let instance: AnonFetch | null = null;

/** One Anon-RPC worker per tab, created on first use in the browser. */
export function getAnon(): AnonFetch {
  if (instance) return instance;
  const n = config.network;
  const bootstrapRpcUrl = n === "off" ? undefined : NETWORKS[n].chainId === 1 ? config.mainnetRpcUrl : config.sepoliaRpcUrl;
  instance = createAnonFetch({
    platform: "web",
    network: n,
    bootstrapRpcUrl,
    iframeUrl: "/anon-rpc-iframe.html",
    probeUrl: config.beeUrl ? `${config.beeUrl.replace(/\/$/, "")}/health` : undefined,
    torGateways: config.torGateways,
  });
  return instance;
}

/** An EIP-1193 request function that sends JSON-RPC through Anon-RPC (for viem's `custom` transport). */
export function anonJsonRpc(url: string, isolationKey?: string) {
  let id = 0;
  return async ({ method, params }: { method: string; params?: unknown }) => {
    const anon = getAnon();
    const doFetch = isolationKey ? anon.isolated(isolationKey) : anon.fetch;
    const res = await doFetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: ++id, method, params: params ?? [] }),
    });
    const body = (await res.json()) as { result?: unknown; error?: { code?: number; message?: string; data?: unknown } };
    if (body.error) throw Object.assign(new Error(body.error.message ?? "RPC error"), body.error);
    return body.result;
  };
}
