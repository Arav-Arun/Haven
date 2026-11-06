"use client";

import { Wallet } from "lucide-react";
import { useEffect, useState } from "react";
import { useAccount, useConnect, useDisconnect, usePublicClient } from "wagmi";

/**
 * Connects a wallet and checks, on Sepolia through Anon-RPC, whether the address has contract code.
 * Contract wallets can't produce the same signature twice, so they're pointed to passkey sign-in.
 */
export function ConnectWallet() {
  const { address, isConnected, connector } = useAccount();
  const { connect, connectors, isPending, error } = useConnect();
  const { disconnect } = useDisconnect();
  const client = usePublicClient();
  const [kind, setKind] = useState<"checking" | "eoa" | "contract" | "error">("checking");

  useEffect(() => {
    if (!address || !client) return;
    setKind("checking");
    client
      .getCode({ address })
      .then((code) => setKind(code && code !== "0x" ? "contract" : "eoa"))
      .catch(() => setKind("error"));
  }, [address, client]);

  if (!isConnected)
    return (
      <div className="flex flex-col gap-2">
        {connectors.length === 0 && <p className="text-sm text-muted">No browser wallet found. Install one, or use passkey sign-in.</p>}
        {connectors.map((c) => (
          <button
            key={c.uid}
            onClick={() => connect({ connector: c })}
            disabled={isPending}
            className="inline-flex items-center justify-center gap-2 rounded-lg bg-ink px-4 py-2.5 text-paper disabled:opacity-60"
          >
            <Wallet size={18} aria-hidden /> Connect {c.name}
          </button>
        ))}
        {error && <p className="text-sm text-danger">{error.message}</p>}
      </div>
    );

  return (
    <div className="flex flex-col gap-2 text-sm">
      <p>
        Connected with {connector?.name}: <span className="font-mono">{address}</span>
      </p>
      {kind === "checking" && <p className="text-muted">Checking your wallet type on Sepolia…</p>}
      {kind === "eoa" && <p className="text-accent">This wallet can sign in: it signs the same message the same way every time.</p>}
      {kind === "contract" && (
        <p className="text-danger">
          This is a smart-contract wallet. It can't give the same signature twice, so your keys wouldn't be recoverable. Use passkey
          sign-in instead.
        </p>
      )}
      {kind === "error" && <p className="text-danger">Couldn't reach Sepolia to check this wallet. See the network status above.</p>}
      <button onClick={() => disconnect()} className="self-start text-muted underline">
        Disconnect
      </button>
    </div>
  );
}
