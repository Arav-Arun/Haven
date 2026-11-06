import type { PrivateNetwork } from "@haven/types";
import { sepolia } from "viem/chains";

/**
 * Every setting comes from env (see .env.example at the repo root). Nothing has a built-in fallback:
 * a missing value is reported on screen instead of being guessed.
 * Next inlines NEXT_PUBLIC_* only when each is read by its literal name, so they are listed one by one.
 */
const raw = {
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
  NEXT_PUBLIC_APP_ORIGIN: process.env.NEXT_PUBLIC_APP_ORIGIN,
  NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL,
  NEXT_PUBLIC_BEE_URL: process.env.NEXT_PUBLIC_BEE_URL,
  NEXT_PUBLIC_SEPOLIA_RPC_URL: process.env.NEXT_PUBLIC_SEPOLIA_RPC_URL,
  NEXT_PUBLIC_MAINNET_RPC_URL: process.env.NEXT_PUBLIC_MAINNET_RPC_URL,
  NEXT_PUBLIC_TOR_GATEWAYS: process.env.NEXT_PUBLIC_TOR_GATEWAYS,
  NEXT_PUBLIC_ARKIV_RPC_URL: process.env.NEXT_PUBLIC_ARKIV_RPC_URL,
  NEXT_PUBLIC_PRIVATE_NETWORK: process.env.NEXT_PUBLIC_PRIVATE_NETWORK,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
  /** Optional: the extension's Chrome Web Store page, once listed. Until then /extension offers the zip. */
  NEXT_PUBLIC_EXTENSION_STORE_URL: process.env.NEXT_PUBLIC_EXTENSION_STORE_URL,
} as const;

type Key = keyof typeof raw;
const NETWORKS: PrivateNetwork[] = ["nym", "nox", "tor", "off"];

/** Settings the shell needs: wallet sign-in and the private network. */
const REQUIRED_NOW: Key[] = ["NEXT_PUBLIC_APP_ORIGIN", "NEXT_PUBLIC_SEPOLIA_RPC_URL", "NEXT_PUBLIC_PRIVATE_NETWORK"];

/** Settings the drive client needs on top of those: our API, the Bee node, and the API's Arkiv pass-through. */
export const CLIENT_NEEDS: Key[] = [...REQUIRED_NOW, "NEXT_PUBLIC_API_URL", "NEXT_PUBLIC_BEE_URL", "NEXT_PUBLIC_ARKIV_RPC_URL"];

export function missingConfig(keys: Key[] = REQUIRED_NOW): Key[] {
  const missing = keys.filter((k) => !raw[k]);
  const network = raw.NEXT_PUBLIC_PRIVATE_NETWORK as PrivateNetwork | undefined;
  if (network && !NETWORKS.includes(network)) missing.push("NEXT_PUBLIC_PRIVATE_NETWORK");
  if ((network === "nym" || network === "tor") && !raw.NEXT_PUBLIC_MAINNET_RPC_URL) missing.push("NEXT_PUBLIC_MAINNET_RPC_URL");
  if (network === "tor" && !raw.NEXT_PUBLIC_TOR_GATEWAYS) missing.push("NEXT_PUBLIC_TOR_GATEWAYS");
  return [...new Set(missing)];
}

export const config = {
  demoMode: raw.NEXT_PUBLIC_DEMO_MODE === "true",
  appOrigin: raw.NEXT_PUBLIC_APP_ORIGIN ?? "",
  apiUrl: raw.NEXT_PUBLIC_API_URL ?? "",
  beeUrl: raw.NEXT_PUBLIC_BEE_URL ?? "",
  sepoliaRpcUrl: raw.NEXT_PUBLIC_SEPOLIA_RPC_URL ?? "",
  mainnetRpcUrl: raw.NEXT_PUBLIC_MAINNET_RPC_URL ?? "",
  torGateways: (raw.NEXT_PUBLIC_TOR_GATEWAYS ?? "").split(",").map((s) => s.trim()).filter(Boolean),
  arkivRpcUrl: raw.NEXT_PUBLIC_ARKIV_RPC_URL ?? "",
  // The Arkiv access key never reaches browsers: arkivRpcUrl is our API's /arkiv-rpc pass-through, which adds it.
  arkivAccessKey: "",
  network: (raw.NEXT_PUBLIC_PRIVATE_NETWORK ?? "off") as PrivateNetwork,
  walletConnectProjectId: raw.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
  extensionStoreUrl: raw.NEXT_PUBLIC_EXTENSION_STORE_URL ?? "",
  /** Sepolia's block explorer, from viem's chain definition. */
  explorerUrl: sepolia.blockExplorers.default.url,
  /** The parent of every claimed name (HAVEN_PLAN.md section 5): alice.haven.eth. */
  ensParent: "haven.eth",
};
