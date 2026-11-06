import type { PrivateNetwork } from "@cloakroom/types";

/**
 * Anon-RPC worker specifiers: protocol constants published in the anon-rpc repo's adopters.json5
 * (github.com/ethereum/anon-rpc), like a contract address. `chainId` is the chain the specifier
 * contract lives on, so the bootstrap RPC passed to createAnonFetch must be for that chain.
 * Nothing else about a network is assumed here: whether it forwards any HTTPS request is measured
 * at runtime (see `probeUrl` in createAnonFetch), and Tor gateways come from configuration.
 */
export interface NetworkInfo {
  id: Exclude<PrivateNetwork, "off">;
  label: string;
  specifier: `0x${string}`;
  chainId: 1 | 11155111;
}

export const NETWORKS: Record<NetworkInfo["id"], NetworkInfo> = {
  nym: { id: "nym", label: "Nym mixnet", specifier: "0x3aCD9742C68F6d993066Ae25533e09b9e1f60eD0", chainId: 1 },
  nox: { id: "nox", label: "Nox mixnet", specifier: "0x35133267A8F7EC35046a83DCA0f4Ca8A6e1b7A9A", chainId: 11155111 },
  tor: { id: "tor", label: "Tor", specifier: "0x700dA3193D35fA54Cd3fBf29B66f2a2A0385659e", chainId: 1 },
};

export function networkInfo(network: PrivateNetwork): NetworkInfo | null {
  return network === "off" ? null : NETWORKS[network];
}
