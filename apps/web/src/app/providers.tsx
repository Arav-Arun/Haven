"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { custom } from "viem";
import { sepolia } from "viem/chains";
import { createConfig, WagmiProvider, type CreateConnectorFn } from "wagmi";
import { injected, walletConnect } from "wagmi/connectors";
import { anonJsonRpc } from "@/lib/anon";
import { config } from "@/lib/config";
import { DriveProvider } from "@/lib/drive";

function connectors(): CreateConnectorFn[] {
  const list: CreateConnectorFn[] = [injected()];
  if (config.walletConnectProjectId) {
    // Phone wallets. We draw the QR code ourselves (showQrModal: false), so Reown's hosted modal and its
    // assets never load, and WalletConnect's telemetry is off. The relay itself is required by the
    // protocol and is listed in the README's CROPS section.
    const params = {
      projectId: config.walletConnectProjectId,
      showQrModal: false,
      telemetryEnabled: false,
      metadata: {
        name: "Cloakroom",
        description: "Private file sharing with ENS names",
        url: config.appOrigin,
        icons: [],
      },
    };
    list.push(walletConnect(params as Parameters<typeof walletConnect>[0]));
  }
  return list;
}

/**
 * One wagmi config per page load, made in the browser only: wallets and WalletConnect's relay connection don't
 * exist while the static pages are prerendered, and React's strict mode would otherwise start WalletConnect twice.
 */
let wagmiConfig: ReturnType<typeof createConfig> | null = null;
function getWagmiConfig() {
  const browser = typeof window !== "undefined";
  if (browser && wagmiConfig) return wagmiConfig;
  const made = createConfig({
    chains: [sepolia],
    connectors: browser ? connectors() : [],
    // Every Sepolia read goes through Anon-RPC (or plain fetch when the private network is off).
    transports: { [sepolia.id]: custom({ request: anonJsonRpc(config.sepoliaRpcUrl) }) },
    ssr: true,
  });
  if (browser) wagmiConfig = made;
  return made;
}

export function Providers({ children }: { children: ReactNode }) {
  const [wagmi] = useState(getWagmiConfig);
  const [queries] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmi}>
      <QueryClientProvider client={queries}>
        <DriveProvider>{children}</DriveProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
