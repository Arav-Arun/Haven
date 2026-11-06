// A real local chain for tests: anvil, with the compiled ENSv2 pieces (ContractNamer, LabelStore, VerifiableFactory)
// and our DriveRegistry implementation deployed from contracts/out (run `forge build` in contracts/ first).
// Accounts are fresh random keys funded with anvil_setBalance; nothing is pre-seeded.

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { createServer } from "node:net";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import type { Address, Hex } from "@cloakroom/types";
import {
  type Abi,
  type Account,
  createPublicClient,
  createWalletClient,
  getAddress,
  http,
  parseEther,
  type PublicClient,
  type Transport,
  type WalletClient,
} from "viem";
import { generatePrivateKey, privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";

import type { SepoliaWriter } from "../src/ens";

const here = dirname(fileURLToPath(import.meta.url));
const OUT = resolve(here, "../../../contracts/out");

function artifact(file: string, name: string): { abi: Abi; bytecode: Hex } {
  const path = resolve(OUT, `${file}/${name}.json`);
  if (!existsSync(path)) throw new Error(`missing ${path}: run \`forge build\` in contracts/`);
  const json = JSON.parse(readFileSync(path, "utf8")) as { abi: Abi; bytecode: { object: Hex } };
  return { abi: json.abi, bytecode: json.bytecode.object };
}

async function freePort(): Promise<number> {
  return new Promise((ok, fail) => {
    const server = createServer();
    server.once("error", fail);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address ? address.port : 0;
      server.close(() => ok(port));
    });
  });
}

export interface LocalChain {
  url: string;
  public: PublicClient<Transport, typeof foundry>;
  factory: Address;
  implementation: Address;
  labelStore: Address;
  namer: Address;
  /** Deploys any compiled contract from contracts/out with a funded throwaway key. */
  deploy(file: string, name: string, args?: unknown[]): Promise<Address>;
  /** A fresh funded key, as a SepoliaWriter for ens.ts. */
  newWriter(): Promise<{ key: Hex; address: Address; writer: SepoliaWriter }>;
  /** Unix time of the latest block. */
  now(): Promise<number>;
  /** Mines a block `seconds` after the latest one. */
  warp(seconds: number): Promise<number>;
  stop(): void;
}

export async function startLocalChain(): Promise<LocalChain> {
  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const anvil: ChildProcess = spawn("anvil", ["--port", String(port), "--silent", "--chain-id", String(foundry.id)], {
    stdio: "ignore",
  });
  const publicClient = createPublicClient({ chain: foundry, transport: http(url), pollingInterval: 20 });
  for (let i = 0; ; i++) {
    try {
      await publicClient.getBlockNumber();
      break;
    } catch {
      if (i > 100) throw new Error("anvil did not start");
      await new Promise((r) => setTimeout(r, 50));
    }
  }

  const fund = async (address: Address) =>
    publicClient.request({ method: "anvil_setBalance" as never, params: [address, `0x${parseEther("100").toString(16)}`] as never });

  const deployerKey = generatePrivateKey();
  const deployer = privateKeyToAccount(deployerKey);
  await fund(deployer.address);
  const wallet: WalletClient<Transport, typeof foundry, Account> = createWalletClient({
    chain: foundry,
    transport: http(url),
    account: deployer,
  });
  async function deploy(file: string, name: string, args: unknown[] = []): Promise<Address> {
    const { abi, bytecode } = artifact(file, name);
    const hash = await wallet.deployContract({ abi, bytecode, args });
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    if (!receipt.contractAddress) throw new Error(`deploying ${name} failed`);
    return getAddress(receipt.contractAddress);
  }
  const namer = await deploy("ContractNamer.sol", "ContractNamer");
  const labelStore = await deploy("LabelStore.sol", "LabelStore", [namer]);
  const factory = await deploy("VerifiableFactory.sol", "VerifiableFactory");
  const implementation = await deploy("DriveRegistry.sol", "DriveRegistry", [labelStore, namer]);

  const chain: LocalChain = {
    url,
    public: publicClient,
    factory,
    implementation,
    labelStore,
    namer,
    deploy,
    async newWriter() {
      const key = generatePrivateKey();
      const account = privateKeyToAccount(key);
      await fund(account.address);
      const w = createWalletClient({ chain: foundry, transport: http(url), account, pollingInterval: 20 });
      return { key, address: account.address, writer: { public: publicClient, wallet: w } };
    },
    async now() {
      return Number((await publicClient.getBlock()).timestamp);
    },
    async warp(seconds: number) {
      const next = (await chain.now()) + seconds;
      await publicClient.request({ method: "evm_setNextBlockTimestamp" as never, params: [next] as never });
      await publicClient.request({ method: "evm_mine" as never, params: [] as never });
      return next;
    },
    stop() {
      anvil.kill();
    },
  };
  return chain;
}
