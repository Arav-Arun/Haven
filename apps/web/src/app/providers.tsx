"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { custom } from "viem";
import { sepolia } from "viem/chains";
import { createConfig, WagmiProvider } from "wagmi";
import { injected } from "wagmi/connectors";
import { anonJsonRpc } from "@/lib/anon";
import { config } from "@/lib/config";

export function Providers({ children }: { children: ReactNode }) {
  const [wagmi] = useState(() =>
    createConfig({
      chains: [sepolia],
      connectors: [injected()],
      // Every Sepolia read goes through Anon-RPC (or plain fetch when the private network is off).
      transports: { [sepolia.id]: custom({ request: anonJsonRpc(config.sepoliaRpcUrl) }) },
      ssr: true,
    }),
  );
  const [queries] = useState(() => new QueryClient());
  return (
    <WagmiProvider config={wagmi}>
      <QueryClientProvider client={queries}>{children}</QueryClientProvider>
    </WagmiProvider>
  );
}
