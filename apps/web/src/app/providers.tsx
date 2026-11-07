"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { connectorsForWallets, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, phantomWallet, rabbyWallet, rainbowWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { useEffect, useState, type ReactNode } from "react";
import { custom } from "viem";
import { sepolia } from "viem/chains";
import { createConfig, WagmiProvider } from "wagmi";
import { anonJsonRpc } from "@/lib/anon";
import { config } from "@/lib/config";
import { DriveProvider } from "@/lib/drive";
import { registerServiceWorker } from "@/lib/pwa";

function connectors() {
  return connectorsForWallets(
    [
      {
        groupName: "Popular",
        // Without a WalletConnect project id only the wallet in this browser can connect (no QR codes): RainbowKit's
        // named wallets all need a project id, and throw at startup without one.
        wallets: config.walletConnectProjectId ? [metaMaskWallet, phantomWallet, rainbowWallet, rabbyWallet] : [injectedWallet],
      },
      ...(config.walletConnectProjectId ? [{ groupName: "More", wallets: [injectedWallet, walletConnectWallet] }] : []),
    ],
    {
      projectId: config.walletConnectProjectId,
      appName: "Haven",
      appDescription: "Private file sharing with ENS names",
      appUrl: config.appOrigin,
    },
  );
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
  useEffect(registerServiceWorker, []);
  return (
    <WagmiProvider config={wagmi}>
      <QueryClientProvider client={queries}>
        <RainbowKitProvider>
          <DriveProvider>
            {children}
          </DriveProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
