"use client";

import { Button, ErrorNote, shortAddress } from "@cloakroom/ui";
import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, usePublicClient } from "wagmi";
import { WalletConnectQr } from "./WalletConnectQr";

export type WalletKind = "checking" | "eoa" | "contract" | "error";

/**
 * Whether the connected address is a plain key (EOA) or a contract, read from Sepolia through Anon-RPC.
 * Contract wallets can't give the same signature twice, so they can't rebuild Cloakroom keys.
 */
export function useWalletKind(): WalletKind | null {
  const { address } = useAccount();
  const client = usePublicClient();
  const [kind, setKind] = useState<WalletKind | null>(null);
  useEffect(() => {
    if (!address || !client) return setKind(null);
    let live = true;
    setKind("checking");
    client
      .getCode({ address })
      .then((code) => live && setKind(code && code !== "0x" ? "contract" : "eoa"))
      .catch(() => live && setKind("error"));
    return () => {
      live = false;
    };
  }, [address, client]);
  return kind;
}

/** Connects a wallet: browser wallets found on the page, or a phone wallet through a locally drawn QR code. */
export function ConnectWallet() {
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const kind = useWalletKind();
  // Wallets are only found in the browser, so the list is drawn after hydration to match the prerendered page.
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted) return null;

  if (!isConnected)
    return (
      <div className="flex flex-col gap-2">
        {connectors.map((c) => (
          <Button key={c.uid} variant="primary" onClick={() => connect({ connector: c })} disabled={isPending}>
            <Wallet size={18} aria-hidden />
            {c.name === "Injected" ? "Browser wallet" : c.name === "WalletConnect" ? "Phone wallet (WalletConnect)" : c.name}
          </Button>
        ))}
        <ErrorNote error={error} />
        <WalletConnectQr />
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
          Connect a regular wallet instead, or try Cloakroom without a wallet.
        </p>
      )}
      {kind === "error" && <p className="text-danger">Couldn&apos;t reach Sepolia to check this wallet. See the network status at the top.</p>}
      <button onClick={() => disconnect()} className="self-start text-muted underline">
        Use a different wallet
      </button>
    </div>
  );
}
