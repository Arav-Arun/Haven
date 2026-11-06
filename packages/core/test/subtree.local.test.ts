// Add-on F2 against a real local chain: a PermissionedRegistry stands in for acme.eth's subregistry (a DriveRegistry
// is one), subnames are registered and expire there, and a sync grants and revokes real roles on a separate room.
// The chain only ever sees random member addresses: the test reads every log of the room and checks for the team name.
// (Resolving acme.eth itself and the F1 key log need the full ENSv2 root and Arkiv: the live run covers those.)

import type { Address, Hex } from "@cloakroom/types";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, stringToHex } from "viem";
import { generatePrivateKey, privateKeyToAddress } from "viem/accounts";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  accessOf,
  creationBlock,
  deployDrive,
  grantRoleUntil,
  labelState,
  registeredLabels,
  registerName,
  revokeAccess,
} from "../src/ens";
import { compressKey } from "../src/keydir";
import type { SubtreeRuleState } from "../src/records";
import { listSubtreeHolders, SUBTREE_CAP, syncSubtree } from "../src/subtree";
import { startLocalChain, type LocalChain } from "./localchain";

let chain: LocalChain;
beforeAll(async () => {
  chain = await startLocalChain();
}, 30_000);
afterAll(() => chain?.stop());

const key = (): Hex => compressKey(bytesToHex(secp256k1.getPublicKey(secp256k1.utils.randomPrivateKey(), true)));

async function registry() {
  const K = await chain.newWriter();
  const { registry, blockNumber } = await deployDrive(K.writer, {
    implementation: chain.implementation,
    driveKey: K.address,
    mainWallet: null,
    factory: chain.factory,
  });
  return { K, registry, blockNumber };
}

describe("subnames from a registry's logs", () => {
  it("finds the creation block, lists labels incrementally, and reads live owner and expiry", async () => {
    const team = await registry();
    expect(await creationBlock(chain.public, team.registry)).toBe(team.blockNumber);

    const now = await chain.now();
    const [priya, raj, sam] = [privateKeyToAddress(generatePrivateKey()), privateKeyToAddress(generatePrivateKey()), privateKeyToAddress(generatePrivateKey())];
    await registerName(team.K.writer, { parent: team.registry, label: "priya", owner: priya, subregistry: null, expiry: BigInt(now + 3600) });
    await registerName(team.K.writer, { parent: team.registry, label: "raj", owner: raj, subregistry: null, expiry: BigInt(now + 60) });

    const first = await registeredLabels(chain.public, team.registry, { fromBlock: team.blockNumber });
    expect(first.labels.map((l) => [l.label, l.owner])).toEqual([
      ["priya", priya],
      ["raj", raj],
    ]);

    await registerName(team.K.writer, { parent: team.registry, label: "sam", owner: sam, subregistry: null, expiry: BigInt(now + 3600) });
    const next = await registeredLabels(chain.public, team.registry, { fromBlock: first.scannedTo + 1n });
    expect(next.labels.map((l) => l.label)).toEqual(["sam"]);

    expect((await labelState(chain.public, team.registry, "raj", await chain.now())).owner).toBe(raj);
    const later = await chain.warp(120);
    expect((await labelState(chain.public, team.registry, "raj", later)).owner).toBeNull();
    expect((await labelState(chain.public, team.registry, "priya", later)).owner).toBe(priya);
    expect((await labelState(chain.public, team.registry, "nobody", later)).owner).toBeNull();
  });
});

describe("a team sync on chain", () => {
  it("shares with each live subname through a random address, removes the expired one, and never names the team", async () => {
    const team = await registry();
    const room = await registry();
    const now = await chain.now();
    const people = { priya: privateKeyToAddress(generatePrivateKey()), raj: privateKeyToAddress(generatePrivateKey()) };
    await registerName(team.K.writer, { parent: team.registry, label: "priya", owner: people.priya, subregistry: null, expiry: BigInt(now + 3600) });
    await registerName(team.K.writer, { parent: team.registry, label: "raj", owner: people.raj, subregistry: null, expiry: BigInt(now + 90) });
    await registerName(team.K.writer, { parent: team.registry, label: "nokey", owner: people.raj, subregistry: null, expiry: BigInt(now + 3600) });

    // F1's lookup, standing in for the key log on Arkiv: priya and raj have one, "nokey" never set up Cloakroom.
    const keys = new Map([
      ["priya.acme.eth", key()],
      ["raj.acme.eth", key()],
    ]);
    const lookupKey = async (ensName: string) => {
      const current = keys.get(ensName);
      if (!current) throw Object.assign(new Error("no key log"), { code: "NO_CLOAK_KEY" });
      return { current, matchesEns: true };
    };

    // share and removeMember as the client does them, minus the Arkiv side: a fresh stealth address, a real grant.
    let chainTime = await chain.now();
    const stealthOf = new Map<Address, string>();
    const deps = {
      listHolders: (r: SubtreeRuleState) => listSubtreeHolders({ sepolia: chain.public, lookupKey }, r, Number(chainTime)),
      share: async (ensName: string, opts: { role: "viewer" | "editor" | "manager"; until: number | null }) => {
        const address = privateKeyToAddress(generatePrivateKey());
        await grantRoleUntil(room.K.writer, room.registry, address, opts.role, opts.until);
        stealthOf.set(address, ensName);
        return { address };
      },
      removeMember: async (address: Address) => {
        await revokeAccess(room.K.writer, room.registry, address);
      },
      capacity: SUBTREE_CAP,
      now: () => Number(chainTime),
    };

    let rule: SubtreeRuleState = {
      parent: "acme.eth",
      registry: team.registry,
      role: "viewer",
      until: null,
      hideFromMembers: true,
      excluded: [],
      members: [],
      labels: [],
      scannedTo: Number(await creationBlock(chain.public, team.registry)) - 1,
      createdAt: chainTime,
      lastSyncedAt: 0,
    };

    const first = await syncSubtree(rule, deps);
    rule = first.rule;
    expect(rule.members.map((m) => m.ensName).sort()).toEqual(["priya.acme.eth", "raj.acme.eth"]);
    expect(first.plan.skipped).toEqual([{ ensName: "nokey.acme.eth", reason: "no-key" }]);
    for (const m of rule.members) {
      expect((await accessOf(chain.public, room.registry, m.address)).roles).not.toBe(0n);
      expect(m.address).not.toBe(people.priya);
      expect(m.address).not.toBe(people.raj);
    }

    chainTime = await chain.warp(120); // raj's subname expires
    const second = await syncSubtree(rule, deps);
    rule = second.rule;
    expect(second.plan.remove.map((r) => [r.member.ensName, r.reason])).toEqual([["raj.acme.eth", "gone"]]);
    expect(rule.members.map((m) => m.ensName)).toEqual(["priya.acme.eth"]);
    const rajAddress = [...stealthOf].find(([, n]) => n === "raj.acme.eth")![0];
    expect((await accessOf(chain.public, room.registry, rajAddress)).roles).toBe(0n);

    // Everything the room's registry ever logged: no team name, no subname, no holder's real address.
    const logs = await chain.public.getLogs({ address: room.registry, fromBlock: room.blockNumber });
    const all = JSON.stringify(logs, (_, v) => (typeof v === "bigint" ? v.toString() : v)).toLowerCase();
    for (const needle of ["acme", "priya", "raj"]) expect(all.includes(stringToHex(needle).slice(2))).toBe(false);
    for (const real of Object.values(people)) expect(all.includes(real.slice(2).toLowerCase())).toBe(false);
  });
});
