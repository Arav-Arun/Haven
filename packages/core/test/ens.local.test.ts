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
  grantRoleUntil,
  historyOf,
  isLabelAvailable,
  listChildren,
  mountFolder,
  randomLabel,
  revokeAccess,
  ROLE_DRIVE_READ,
  ROLE_DRIVE_SHARE,
  ROLE_DRIVE_WRITE,
  roleBits,
  roleOf,
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
