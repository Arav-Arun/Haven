/**
 * Files waiting on this device for the user to pick a folder, shared into the phone app from another app. They stay in this origin's IndexedDB until they are
 * encrypted and uploaded, then they're removed. The website's service worker (public/sw.js) writes the same store.
 */
export interface InboxFile {
  id: IDBValidKey;
  name: string;
  type: string;
  blob: Blob;
  at: number;
}

const DB = "haven-inbox";
const STORE = "files";

function open(idb: IDBFactory = globalThis.indexedDB): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = idb.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { autoIncrement: true });
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function done(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function addToInbox(files: { name: string; type: string; blob: Blob }[], idb?: IDBFactory): Promise<void> {
  const db = await open(idb);
  const tx = db.transaction(STORE, "readwrite");
  for (const f of files) tx.objectStore(STORE).add({ ...f, at: Date.now() });
  await done(tx);
  db.close();
}

export async function readInbox(idb?: IDBFactory): Promise<InboxFile[]> {
  const db = await open(idb);
  const out: InboxFile[] = [];
  await new Promise<void>((resolve, reject) => {
    const req = db.transaction(STORE).objectStore(STORE).openCursor();
    req.onsuccess = () => {
      const c = req.result;
      if (!c) return resolve();
      const v = c.value as Omit<InboxFile, "id">;
      out.push({ id: c.key, name: v.name, type: v.type, blob: v.blob, at: v.at });
      c.continue();
    };
    req.onerror = () => reject(req.error);
  });
  db.close();
  return out;
}

export async function removeFromInbox(id: IDBValidKey, idb?: IDBFactory): Promise<void> {
  const db = await open(idb);
  const tx = db.transaction(STORE, "readwrite");
  tx.objectStore(STORE).delete(id);
  await done(tx);
  db.close();
}
