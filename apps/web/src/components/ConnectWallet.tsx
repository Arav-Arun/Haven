"use client";

import { Button, shortAddress } from "@haven/ui";
import { useConnectModal } from "@rainbow-me/rainbowkit";
import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useDisconnect, usePublicClient } from "wagmi";
import { config } from "@/lib/config";

export type WalletKind = "checking" | "eoa" | "contract" | "error";

/** How long to wait for Sepolia through the private network before asking the wallet itself. */
const CHECK_TIMEOUT_MS = 6000;

/**
 * An EIP-7702 account (MetaMask's "smart account") has a 23-byte delegation stub as its code, 0xef0100 + address,
 * but still signs with the same key, so it gives the same signature every time: it counts as a plain key.
 */
function kindOf(code: string | undefined): WalletKind {
  if (!code || code === "0x") return "eoa";
  return /^0xef0100[0-9a-f]{40}$/i.test(code) ? "eoa" : "contract";
}

/**
 * Whether the connected address is a plain key (EOA) or a contract, read from Sepolia through Anon-RPC.
 * Contract wallets can't give the same signature twice, so they can't rebuild Haven keys. If the private network
 * hasn't answered within a few seconds (still starting, or blocked), the wallet's own provider is asked instead: it
 * already knows this address, so that tells no one anything new.
 */
export function useWalletKind(): WalletKind | null {
  const { address, connector } = useAccount();
  const client = usePublicClient();
  const [kind, setKind] = useState<WalletKind | null>(null);
  useEffect(() => {
    if (!address || !client) return setKind(null);
    let live = true;
    setKind("checking");
    const viaWallet = async () => {
      const provider = (await connector?.getProvider()) as { request?: (a: { method: string; params: unknown[] }) => Promise<string> } | undefined;
      if (!provider?.request) throw new Error("no wallet provider");
      return provider.request({ method: "eth_getCode", params: [address, "latest"] });
    };
    const timeout = new Promise<never>((_, reject) => setTimeout(() => reject(new Error("timeout")), CHECK_TIMEOUT_MS));
    Promise.race([client.getCode({ address }), timeout])
      .catch(viaWallet)
      .then((code) => live && setKind(kindOf(code)))
      .catch(() => live && setKind("error"));
    return () => {
      live = false;
    };
  }, [address, client, connector]);
  return kind;
}

/** Connects injected and mobile wallets through RainbowKit. */
export function ConnectWallet() {
  const { address, isConnected, connector } = useAccount();
  const { openConnectModal } = useConnectModal();
  const { disconnect } = useDisconnect();
  const kind = useWalletKind();
  // Wallets are only found in the browser, so the list is drawn after hydration to match the prerendered page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  if (!isConnected)
    return (
      <div className="flex flex-col gap-2">
        <Button variant="primary" onClick={openConnectModal} disabled={!openConnectModal}>
          <Wallet size={18} aria-hidden /> Connect wallet
        </Button>
        {!config.walletConnectProjectId && <p className="text-muted">Mobile wallets need a WalletConnect project ID configured by the app.</p>}
      </div>
    );

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        Connected with {connector?.name}: <span title={address}>{address && shortAddress(address)}</span>
      </p>
      {kind === "checking" && <p className="text-muted">Checking your wallet type on Sepolia…</p>}
      {kind === "contract" && (
        <p className="text-danger">
          This is a smart-contract wallet. It can&apos;t give the same signature twice, so your keys couldn&apos;t be rebuilt.
          Connect a regular wallet instead, or try Haven without a wallet.
        </p>
      )}
      {kind === "error" && <p className="text-danger">Couldn&apos;t reach Sepolia to check this wallet. See the network status at the top.</p>}
      <button onClick={() => disconnect()} className="self-start text-muted underline">
        Use a different wallet
      </button>
    </div>
  );
}
