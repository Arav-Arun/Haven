// Every fixed address the client uses (CLOAKROOM_PLAN.md section 6). The single source is
// contracts/deployments/sepolia.json, copied into generated.ts by `pnpm --filter @cloakroom/core gen`; nothing here is
// typed by hand. Our own contracts appear under `cloakroom` once they are deployed.

import { DriveError, type Address } from "@cloakroom/types";
import { parseAbi } from "viem";
import { sepolia } from "viem/chains";

import { sepoliaDeployment } from "./generated";

export const SEPOLIA_CHAIN_ID = sepolia.id;
export const ARKIV_CHAIN_ID = 7794095;

export const EXPLORERS = {
  sepolia: "https://sepolia.etherscan.io",
  arkiv: "https://rabdi.explorer.arkiv.network",
} as const;

export const ensv2 = sepoliaDeployment.ensv2;

/** Our deployments. Missing until the matching step has deployed them. */
export interface CloakroomDeployment {
  /** DriveRegistry implementation behind every folder and room proxy. */
  driveRegistryImpl?: Address;
  /** Subregistry of cloakroom.eth (user names). */
  appRegistry?: Address;
  /** Subregistry of rooms.cloakroom.eth (unlinked rooms). */
  roomsRegistry?: Address;
}

export const cloakroom: CloakroomDeployment = sepoliaDeployment.cloakroom as CloakroomDeployment;

export function requireDeployed(name: keyof CloakroomDeployment, deployment = cloakroom): Address {
  const address = deployment[name];
  if (!address) throw new DriveError("UNKNOWN", `${name} is not deployed yet (contracts/deployments/sepolia.json)`);
  return address;
}

/** Only the UniversalResolverV2 functions we call, copied from ensdomains/contracts-v2@48b3e2d. */
export const universalResolverV2Abi = parseAbi([
  "function findExactRegistry(bytes name) view returns (address)",
  "function findRegistries(bytes name) view returns (address[])",
  "function findOwner(bytes name) view returns (address)",
  "function findResolver(bytes name) view returns (address resolver, bytes32 node, uint256 offset)",
]);

/** PermissionedResolver text records, from ensdomains/contracts-v2@48b3e2d. */
export const permissionedResolverAbi = parseAbi([
  "function text(bytes32 node, string key) view returns (string)",
  "function setText(bytes32 node, string key, string value)",
]);

export function txUrl(chain: "sepolia" | "arkiv", hash: string): string {
  return `${EXPLORERS[chain]}/tx/${hash}`;
}
