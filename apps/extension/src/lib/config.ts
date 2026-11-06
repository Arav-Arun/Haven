import type { PrivateNetwork } from "@cloakroom/types";

/**
 * Settings, from WXT_* env at build time (see .env.example). Nothing has a built-in default; missing ones are listed
 * in the popup instead of being guessed.
 */
const raw = {
  WXT_APP_ORIGIN: import.meta.env.WXT_APP_ORIGIN as string | undefined,
  WXT_API_URL: import.meta.env.WXT_API_URL as string | undefined,
  WXT_BEE_URL: import.meta.env.WXT_BEE_URL as string | undefined,
  WXT_SEPOLIA_RPC_URL: import.meta.env.WXT_SEPOLIA_RPC_URL as string | undefined,
  WXT_ARKIV_RPC_URL: import.meta.env.WXT_ARKIV_RPC_URL as string | undefined,
  WXT_PRIVATE_NETWORK: import.meta.env.WXT_PRIVATE_NETWORK as string | undefined,
  WXT_DEMO_MODE: import.meta.env.WXT_DEMO_MODE as string | undefined,
};

export function missingConfig(): string[] {
  const keys = ["WXT_APP_ORIGIN", "WXT_API_URL", "WXT_BEE_URL", "WXT_SEPOLIA_RPC_URL", "WXT_ARKIV_RPC_URL", "WXT_PRIVATE_NETWORK"] as const;
  const missing: string[] = keys.filter((k) => !raw[k]);
  // The extension bootstraps its worker from Sepolia only, so only Nox (or off) is available here.
  if (raw.WXT_PRIVATE_NETWORK && !["nox", "off"].includes(raw.WXT_PRIVATE_NETWORK))
    missing.push("WXT_PRIVATE_NETWORK (the extension supports nox or off)");
  return missing;
}

export const config = {
  appOrigin: (raw.WXT_APP_ORIGIN ?? "").replace(/\/$/, ""),
  apiUrl: raw.WXT_API_URL ?? "",
  beeUrl: raw.WXT_BEE_URL ?? "",
  sepoliaRpcUrl: raw.WXT_SEPOLIA_RPC_URL ?? "",
  arkivRpcUrl: raw.WXT_ARKIV_RPC_URL ?? "",
  network: (raw.WXT_PRIVATE_NETWORK ?? "off") as PrivateNetwork,
  demoMode: raw.WXT_DEMO_MODE === "true",
};
