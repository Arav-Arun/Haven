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
  /** Block the implementation was deployed in: no Cloakroom registry is older, so log scans start here. */
  driveRegistryImplBlock?: number;
  /** cloakroom.eth's resolver (contenthash of the Swarm copy). */
  appResolver?: Address;
  /** The API's key: holds only ROLE_REGISTRAR on appRegistry and roomsRegistry. */
  relayer?: Address;
  /** Owns cloakroom.eth until the team Safe takes over. */
  deployer?: Address;
}

export const cloakroom: CloakroomDeployment = sepoliaDeployment.cloakroom as CloakroomDeployment;

export function requireDeployed(
  name: "driveRegistryImpl" | "appRegistry" | "roomsRegistry" | "appResolver" | "relayer" | "deployer",
  deployment = cloakroom,
): Address {
  const address = deployment[name];
  if (!address) throw new DriveError("UNKNOWN", `${name} is not deployed yet (contracts/deployments/sepolia.json)`);
  return address;
}

// The live Sepolia ENSv2 deployment is ENS branch audit-results-19102026 (6aac7c6), newer than the 48b3e2d our
// DriveRegistry inherits. These are the functions we call on the live contracts, copied from that branch and checked
// against their onchain selectors (contracts/test/DriveRegistry.fork.t.sol runs every flow through them).

/** UniversalResolverV2: resolution only. */
export const universalResolverV2Abi = parseAbi([
  "function findResolver(bytes name) view returns (address resolver, bytes32 node, uint256 offset)",
  "function resolve(bytes name, bytes data) view returns (bytes, address)",
]);

/** UniversalHelper: the registry walk (it moved out of UniversalResolverV2 in the live deployment). */
export const universalHelperAbi = parseAbi([
  "function findExactRegistry(bytes name) view returns (address)",
  "function findRegistries(bytes name) view returns (address[])",
  "function findExactOwner(bytes name) view returns (address)",
  "function findCanonicalName(address registry) view returns (bytes)",
]);

/** ETHRegistrar: commit, wait MIN_COMMITMENT_AGE, register; paid in an ERC-20 the price oracle accepts. */
export const ethRegistrarAbi = parseAbi([
  "function isAvailable(string label) view returns (bool)",
  "function MIN_COMMITMENT_AGE() view returns (uint64)",
  "function getRegisterPrice(string label, uint64 duration, address paymentToken) view returns (uint256 base, uint256 premium)",
  "function makeCommitment(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, bytes32 referrer) pure returns (bytes32)",
  "function commit(bytes32 commitment)",
  "function register(string label, address owner, bytes32 secret, address subregistry, address resolver, uint64 duration, address paymentToken, bytes32 referrer) returns (uint256)",
]);

/** The testnet payment tokens (free mint). */
export const mockTokenAbi = parseAbi([
  "function mint(address to, uint256 amount)",
  "function approve(address spender, uint256 amount) returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
]);

/** A role grant at initialisation (EAC Grant). */
export const grantTuple = "(address account, uint256 roleBitmap)[]";

/** Stock UserRegistry (cloakroom.eth's and rooms.cloakroom.eth's registries). */
export const liveUserRegistryAbi = parseAbi([`function initialize(${grantTuple} grants)`]);

/** PermissionedResolver: records keyed by DNS-encoded name; setters run without role checks during initialize. */
export const permissionedResolverAbi = parseAbi([
  `function initialize(${grantTuple} grants, bytes[] calls)`,
  "function setText(bytes name, string key, string value)",
  "function resolve(bytes name, bytes data) view returns (bytes)",
  "function text(bytes32 node, string key) view returns (string)",
  "function roles(uint256 resource, address account) view returns (uint256)",
]);

export function txUrl(chain: "sepolia" | "arkiv", hash: string): string {
  return `${EXPLORERS[chain]}/tx/${hash}`;
}
