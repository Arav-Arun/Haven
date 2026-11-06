import { IDBFactory } from "fake-indexeddb";
import { describe, expect, it } from "vitest";
import { addToInbox, readInbox, removeFromInbox } from "../src/inbox";

describe("inbox", () => {
  it("keeps files until they're removed", async () => {
    const idb = new IDBFactory();
    await addToInbox(
      [
        { name: "a.png", type: "image/png", blob: new Blob(["png"]) },
        { name: "b.txt", type: "text/plain", blob: new Blob(["hello"]) },
      ],
      idb,
    );
    const files = await readInbox(idb);
    expect(files.map((f) => f.name)).toEqual(["a.png", "b.txt"]);
    await removeFromInbox(files[0]!.id, idb);
    expect((await readInbox(idb)).map((f) => f.name)).toEqual(["b.txt"]);
  });
});
