import type { PrivateNetwork } from "@cloakroom/types";

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
  NEXT_PUBLIC_ARKIV_ACCESS_KEY: process.env.NEXT_PUBLIC_ARKIV_ACCESS_KEY,
  NEXT_PUBLIC_PRIVATE_NETWORK: process.env.NEXT_PUBLIC_PRIVATE_NETWORK,
  NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID: process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID,
} as const;

type Key = keyof typeof raw;
const NETWORKS: PrivateNetwork[] = ["nym", "nox", "tor", "off"];

/** Settings the shell needs today. The data screens add API, Bee and Arkiv when core lands. */
const REQUIRED_NOW: Key[] = ["NEXT_PUBLIC_APP_ORIGIN", "NEXT_PUBLIC_SEPOLIA_RPC_URL", "NEXT_PUBLIC_PRIVATE_NETWORK"];

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
  arkivAccessKey: raw.NEXT_PUBLIC_ARKIV_ACCESS_KEY ?? "",
  network: (raw.NEXT_PUBLIC_PRIVATE_NETWORK ?? "off") as PrivateNetwork,
  walletConnectProjectId: raw.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? "",
};
