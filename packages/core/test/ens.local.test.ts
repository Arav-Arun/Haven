// ens.ts against a real local chain running the compiled DriveRegistry, VerifiableFactory and LabelStore.
// (Reads through UniversalResolverV2, haven.key and the registry walk, need the full ENSv2 root, so they are covered
// by the live A4 script on Sepolia.)

import type { ReceiptStep } from "@haven/types";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import {
  accessOf,
  createFolder,
  createLinkName,
  deployDrive,
  driveOwner,
  expectProxy,
  getSubregistry,
  grantRoleUntil,
  historyOf,
  isLabelAvailable,
  listChildren,
  mountFolder,
  NO_END,
  planDrive,
  randomLabel,
  registerTx,
  revokeAccess,
  ROLE_DRIVE_READ,
  ROLE_DRIVE_SHARE,
  ROLE_DRIVE_WRITE,
  roleBits,
  roleOf,
  sendTxs,
  serialSends,
  sweep,
  wasAllowed,
  wasAllowedMany,
} from "../src/ens";
import { startLocalChain, type LocalChain } from "./localchain";

let chain: LocalChain;

beforeAll(async () => {
  chain = await startLocalChain();
}, 30_000);
afterAll(() => chain?.stop());

async function newDrive(mainWallet: boolean) {
  const K = await chain.newWriter();
  const W = mainWallet ? await chain.newWriter() : null;
  const steps: ReceiptStep[] = [];
  const { registry, blockNumber } = await deployDrive(
    K.writer,
    { implementation: chain.implementation, driveKey: K.address, mainWallet: W?.address ?? null, factory: chain.factory },
    (s) => steps.push(s),
  );
  return { K, W, registry, blockNumber, steps };
}

describe("folders and names", () => {
  it("deploys a drive, creates a child folder, and lists it from the registration logs", async () => {
    const { K, W, registry: root, blockNumber, steps } = await newDrive(true);
    expect(steps).toEqual([expect.objectContaining({ kind: "sepolia-tx", ok: true })]);
    expect(await driveOwner(chain.public, root)).toBe(K.address);
    expect((await accessOf(chain.public, root, K.address)).via).toBe("owner");
    expect((await accessOf(chain.public, root, W!.address)).roles & roleBits("manager")).toBe(0n);

    const folderSteps: ReceiptStep[] = [];
    const folder = await createFolder(
      K.writer,
      { parent: root, implementation: chain.implementation, driveKey: K.address, mainWallet: W!.address, factory: chain.factory },
      (s) => folderSteps.push(s),
    );
    expect(folder.label).toMatch(/^f-[a-z2-7]{10}$/);
    expect(folderSteps.map((s) => s.kind)).toEqual(["sepolia-tx", "sepolia-tx"]);
    expect(await isLabelAvailable(chain.public, root, folder.label)).toBe(false);
    expect(await isLabelAvailable(chain.public, root, randomLabel("f"))).toBe(true);

    const link = await createLinkName(K.writer, { folder: folder.registry, owner: K.address, expiresAt: (await chain.now()) + 3600 });
    const mounted = randomLabel("f");
    await mountFolder(K.writer, { driveRoot: root, owner: K.address, label: mounted, target: folder.registry });

    // tiny ranges force the halving/paging path too
    const children = await listChildren(chain.public, root, { fromBlock: blockNumber, maxRange: 2n });
    expect(children.map((c) => c.label).sort()).toEqual([folder.label, mounted].sort());
    expect(children.find((c) => c.label === folder.label)?.registry).toBe(folder.registry);
    expect(children.find((c) => c.label === mounted)?.registry).toBe(folder.registry);
    const inFolder = await listChildren(chain.public, folder.registry, { fromBlock: blockNumber });
    expect(inFolder).toEqual([expect.objectContaining({ label: link.label, registry: null })]);
  });

  it("refuses a taken label with NAME_TAKEN and a caller without the role with NOT_AUTHORIZED", async () => {
    const { K, registry: root } = await newDrive(false);
    const label = randomLabel("f");
    const params = { parent: root, implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory, label };
    await createFolder(K.writer, params);
    await expect(createFolder(K.writer, params)).rejects.toMatchObject({ code: "NAME_TAKEN" });
    const outsider = await chain.newWriter();
    await expect(
      createFolder(outsider.writer, { ...params, label: randomLabel("f"), driveKey: outsider.address }),
    ).rejects.toMatchObject({ code: "NOT_AUTHORIZED" });
  });
});

describe("sending a registry and its name together (claims and rooms)", () => {
  // Mine on a 1 s timer, as a real chain does, instead of one block per transaction.
  async function timedBlocks<T>(run: () => Promise<T>): Promise<T> {
    await chain.public.request({ method: "evm_setAutomine" as never, params: [false] as never });
    await chain.public.request({ method: "evm_setIntervalMining" as never, params: [1] as never });
    try {
      return await run();
    } finally {
      await chain.public.request({ method: "evm_setIntervalMining" as never, params: [0] as never });
      await chain.public.request({ method: "evm_setAutomine" as never, params: [true] as never });
    }
  }

  it("lands both in one block, at the address planned before sending", async () => {
    const { K, registry: root } = await newDrive(false);
    const label = randomLabel("f");
    const steps: ReceiptStep[] = [];
    const drive = await planDrive(K.writer, { implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory });
    expect(await chain.public.getCode({ address: drive.address })).toBeUndefined();
    const register = registerTx({ parent: root, label, owner: K.address, subregistry: drive.address, expiry: NO_END });

    const receipts = await timedBlocks(() => sendTxs(K.writer, [drive, register], (s) => steps.push(s)));

    expect(receipts).toHaveLength(2);
    expect(receipts[0]!.blockNumber).toBe(receipts[1]!.blockNumber);
    expect(() => expectProxy(receipts[0]!, drive)).not.toThrow();
    expect(await getSubregistry(chain.public, root, label)).toBe(drive.address);
    expect(await driveOwner(chain.public, drive.address)).toBe(K.address);
    expect(steps).toEqual([
      expect.objectContaining({ kind: "sepolia-tx", label: "Create folder registry", ok: true }),
      expect.objectContaining({ kind: "sepolia-tx", label: `Register ${label}`, ok: true }),
    ]);
  });

  it("createFolder puts the registry and its name in one block", async () => {
    const { K, registry: root } = await newDrive(false);
    const steps: ReceiptStep[] = [];
    const folder = await timedBlocks(() =>
      createFolder(K.writer, { parent: root, implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory }, (s) => steps.push(s)),
    );
    const blocks = await Promise.all(
      steps.map(async (s) => (s.kind === "sepolia-tx" ? (await chain.public.getTransactionReceipt({ hash: s.hash })).blockNumber : null)),
    );
    expect(blocks).toHaveLength(2);
    expect(blocks[0]).toBe(blocks[1]);
    expect(blocks[0]).toBe(folder.blockNumber);
    expect(await getSubregistry(chain.public, root, folder.label)).toBe(folder.registry);
  });

  it("with the app's per-key send lock, two folders made at the same moment by one key both succeed", async () => {
    const { K, registry: root } = await newDrive(false);
    const writer = { ...K.writer, serialize: serialSends() };
    const params = { parent: root, implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory };
    const [a, b] = await timedBlocks(() => Promise.all([createFolder(writer, params), createFolder(writer, params)]));
    expect(a.registry).not.toBe(b.registry);
    expect(await getSubregistry(chain.public, root, a.label)).toBe(a.registry);
    expect(await getSubregistry(chain.public, root, b.label)).toBe(b.registry);
  });

  it("the send lock runs sends strictly in order, and a failed send doesn't block the next", async () => {
    const serialize = serialSends();
    const order: string[] = [];
    const slow = (name: string, ms: number, fail = false) =>
      serialize(async () => {
        order.push(`${name} start`);
        await new Promise((r) => setTimeout(r, ms));
        order.push(`${name} end`);
        if (fail) throw new Error(name);
        return name;
      });
    const results = await Promise.allSettled([slow("a", 30), slow("b", 5, true), slow("c", 1)]);
    expect(order).toEqual(["a start", "a end", "b start", "b end", "c start", "c end"]);
    expect(results.map((r) => r.status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
  });

  it("can send ETH in the same block (a new key's first gas, or a batch of drips)", async () => {
    const { K, registry: root } = await newDrive(false);
    const newKeys = [(await chain.newWriter()).address, (await chain.newWriter()).address];
    const before = await Promise.all(newKeys.map((address) => chain.public.getBalance({ address })));
    const drive = await planDrive(K.writer, { implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory });
    const register = registerTx({ parent: root, label: randomLabel("f"), owner: K.address, subregistry: drive.address, expiry: NO_END });
    const gas = newKeys.map((to) => ({ label: "Gas", to, data: "0x" as const, value: 12345n }));
    const receipts = await timedBlocks(() => sendTxs(K.writer, [drive, register, ...gas]));
    expect(new Set(receipts.map((r) => r.blockNumber)).size).toBe(1);
    const after = await Promise.all(newKeys.map((address) => chain.public.getBalance({ address })));
    expect(after.map((b, i) => b - before[i]!)).toEqual([12345n, 12345n]);
  });

  it("leaves out an optional transaction that would fail; the required ones still land together", async () => {
    const { K, registry: root } = await newDrive(false);
    const label = randomLabel("f");
    const steps: ReceiptStep[] = [];
    const drive = await planDrive(K.writer, { implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory });
    const register = registerTx({ parent: root, label, owner: K.address, subregistry: drive.address, expiry: NO_END });
    // The factory has no way to receive ETH, so this one fails its dry run.
    const rejected = { label: "Gas", to: chain.factory, data: "0x" as const, value: 1n, optional: true };
    const receipts = await timedBlocks(() => sendTxs(K.writer, [drive, register, rejected], (s) => steps.push(s)));
    expect(receipts).toHaveLength(2);
    expect(receipts[0]!.blockNumber).toBe(receipts[1]!.blockNumber);
    expect(await getSubregistry(chain.public, root, label)).toBe(drive.address);
    expect(steps).toContainEqual(expect.objectContaining({ kind: "check", label: "Gas", ok: false }));
    await expect(sendTxs(K.writer, [rejected, register])).rejects.toThrow(/optional transactions must come after/);
  });

  it("sends nothing when any transaction in the batch would fail", async () => {
    const { K, registry: root } = await newDrive(false);
    const label = randomLabel("f");
    await createFolder(K.writer, { parent: root, implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory, label });
    const nonceBefore = await chain.public.getTransactionCount({ address: K.address });
    const drive = await planDrive(K.writer, { implementation: chain.implementation, driveKey: K.address, mainWallet: null, factory: chain.factory });
    const taken = registerTx({ parent: root, label, owner: K.address, subregistry: drive.address, expiry: NO_END });

    await expect(sendTxs(K.writer, [drive, taken])).rejects.toMatchObject({ code: "NAME_TAKEN" });
    expect(await chain.public.getTransactionCount({ address: K.address })).toBe(nonceBefore);
    expect(await chain.public.getCode({ address: drive.address })).toBeUndefined();
  });
});

describe("access that ends", () => {
  it("grants until a time; access, history and wasAllowed agree before, during and after", async () => {
    const { K, registry } = await newDrive(false);
    const viewer = (await chain.newWriter()).address;
    const editor = (await chain.newWriter()).address;
    const start = await chain.now();
    const steps: ReceiptStep[] = [];
    await grantRoleUntil(K.writer, registry, viewer, "viewer", start + 100, (s) => steps.push(s));
    await grantRoleUntil(K.writer, registry, editor, "editor", null);
    expect(steps).toEqual([expect.objectContaining({ kind: "sepolia-tx", label: "Grant viewer", ok: true })]);

    const during = await accessOf(chain.public, registry, viewer);
    expect(roleOf(during.roles)).toBe("viewer");
    expect(during.via).toBe("direct");
    expect(during.until).toBe(start + 100);
    expect((await accessOf(chain.public, registry, editor)).until).toBeNull();
    const t = await chain.now();
    expect(await wasAllowed(chain.public, registry, viewer, ROLE_DRIVE_READ, t)).toBe(true);
    expect(await wasAllowed(chain.public, registry, viewer, ROLE_DRIVE_WRITE, t)).toBe(false);

    await chain.warp(150);
    expect((await accessOf(chain.public, registry, viewer)).roles).toBe(0n);
    expect(
      await wasAllowedMany(chain.public, registry, [viewer, viewer, viewer], ROLE_DRIVE_READ, [start - 10, t, start + 100]),
    ).toEqual([false, true, false]);

    // the expired grant still holds a slot until anyone sweeps it; the history stays
    await sweep(K.writer, registry, viewer);
    expect(await historyOf(chain.public, registry, viewer)).toHaveLength(1);
    expect(await wasAllowed(chain.public, registry, viewer, ROLE_DRIVE_READ, t)).toBe(true);
  });

  it("removing early closes the interval at the removal time", async () => {
    const { K, registry } = await newDrive(false);
    const editor = (await chain.newWriter()).address;
    await grantRoleUntil(K.writer, registry, editor, "editor", null);
    const before = await chain.now();
    await chain.warp(30);
    await revokeAccess(K.writer, registry, editor);
    const removedAt = await chain.now();
    const [interval] = await historyOf(chain.public, registry, editor);
    expect(interval?.endedAt).toBe(removedAt);
    expect(await wasAllowedMany(chain.public, registry, [editor, editor], ROLE_DRIVE_WRITE, [before, removedAt])).toEqual([
      true,
      false,
    ]);
  });

  it("a manager can share within their own end; an editor can't share at all", async () => {
    const { K, registry } = await newDrive(false);
    const manager = await chain.newWriter();
    const editor = await chain.newWriter();
    const now = await chain.now();
    await grantRoleUntil(K.writer, registry, manager.address, "manager", now + 1000);
    await grantRoleUntil(K.writer, registry, editor.address, "editor", null);
    const someone = (await chain.newWriter()).address;
    await expect(grantRoleUntil(manager.writer, registry, someone, "viewer", now + 2000)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    await grantRoleUntil(manager.writer, registry, someone, "viewer", now + 500);
    expect(await wasAllowed(chain.public, registry, manager.address, ROLE_DRIVE_SHARE, await chain.now())).toBe(true);
    await expect(grantRoleUntil(editor.writer, registry, someone, "viewer", now + 500)).rejects.toMatchObject({
      code: "NOT_AUTHORIZED",
    });
    await expect(grantRoleUntil(K.writer, registry, someone, "viewer", now - 1)).rejects.toMatchObject({ code: "EXPIRED" });
  });
});
