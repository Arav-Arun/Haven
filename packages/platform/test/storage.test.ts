import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { createExtensionStorage, createMemoryStorage, createWebStorage } from "../src";

const bytes = (...n: number[]) => new Uint8Array(n);

describe("storage adapters", () => {
  it("memory store round-trips and copies values", async () => {
    const s = createMemoryStorage();
    const v = bytes(1, 2, 3);
    await s.set("k", v);
    v[0] = 9;
    expect(await s.get("k")).toEqual(bytes(1, 2, 3));
    await s.delete("k");
    expect(await s.get("k")).toBeNull();
  });

  it("web store encrypts at rest and round-trips", async () => {
    const idb = new IDBFactory();
    const s = createWebStorage({ idb, dbName: "t" });
    await s.set("seed", bytes(7, 7, 7, 7));
    expect(await s.get("seed")).toEqual(bytes(7, 7, 7, 7));
    // The raw stored value is IV + ciphertext, never the plaintext.
    const raw = await new Promise<Uint8Array>((resolve) => {
      const open = idb.open("t", 1);
      open.onsuccess = () => {
        const req = open.result.transaction("values").objectStore("values").get("seed");
        req.onsuccess = () => resolve(req.result as Uint8Array);
      };
    });
    expect(raw.length).toBe(12 + 4 + 16);
    await s.delete("seed");
    expect(await s.get("seed")).toBeNull();
  });

  it("extension store uses the given chrome.storage area", async () => {
    const data: Record<string, unknown> = {};
    const area = {
      get: async (k: string) => ({ [k]: data[k] }),
      set: async (items: Record<string, unknown>) => void Object.assign(data, items),
      remove: async (k: string) => void delete data[k],
    };
    const s = createExtensionStorage({ area });
    await s.set("seed", bytes(1, 255));
    expect(await s.get("seed")).toEqual(bytes(1, 255));
    expect(Object.keys(data)).toEqual(["cloak:seed"]);
  });
});
