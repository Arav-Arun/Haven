import type { KeyValueStore } from "@cloakroom/types";

/** In-memory store, for tests and "Try it". */
export function createMemoryStorage(): KeyValueStore {
  const map = new Map<string, Uint8Array>();
  return {
    async get(key) {
      const v = map.get(key);
      return v ? v.slice() : null;
    },
    async set(key, value) {
      map.set(key, value.slice());
    },
    async delete(key) {
      map.delete(key);
    },
  };
}

function idbRequest<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * IndexedDB store. Every value is encrypted with AES-GCM under a non-extractable key that also
 * lives in IndexedDB: the key can be used by this origin but never read out as bytes. This protects
 * against someone copying the browser profile's files; it does not protect against code running on
 * our origin (XSS), which is why the apps ship a strict CSP and no third-party scripts.
 */
export function createWebStorage(opts: { dbName?: string; idb?: IDBFactory } = {}): KeyValueStore {
  const factory = opts.idb ?? globalThis.indexedDB;
  const dbName = opts.dbName ?? "cloakroom";
  let dbPromise: Promise<IDBDatabase> | null = null;
  let keyPromise: Promise<CryptoKey> | null = null;

  const db = () =>
    (dbPromise ??= new Promise((resolve, reject) => {
      const req = factory.open(dbName, 1);
      req.onupgradeneeded = () => {
        req.result.createObjectStore("values");
        req.result.createObjectStore("meta");
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    }));

  const store = async (name: "values" | "meta", mode: IDBTransactionMode) =>
    (await db()).transaction(name, mode).objectStore(name);

  const wrappingKey = () =>
    (keyPromise ??= (async () => {
      const existing = (await idbRequest((await store("meta", "readonly")).get("wrapping-key"))) as CryptoKey | undefined;
      if (existing) return existing;
      const key = await crypto.subtle.generateKey({ name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"]);
      await idbRequest((await store("meta", "readwrite")).put(key, "wrapping-key"));
      return key;
    })());

  return {
    async get(key) {
      const sealed = (await idbRequest((await store("values", "readonly")).get(key))) as Uint8Array | undefined;
      if (!sealed) return null;
      const iv = sealed.slice(0, 12);
      const data = sealed.slice(12);
      const plain = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, await wrappingKey(), data);
      return new Uint8Array(plain);
    },
    async set(key, value) {
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const data = new Uint8Array(
        await crypto.subtle.encrypt({ name: "AES-GCM", iv }, await wrappingKey(), value as BufferSource),
      );
      const sealed = new Uint8Array(12 + data.length);
      sealed.set(iv, 0);
      sealed.set(data, 12);
      await idbRequest((await store("values", "readwrite")).put(sealed, key));
    },
    async delete(key) {
      await idbRequest((await store("values", "readwrite")).delete(key));
    },
  };
}

/** The subset of chrome.storage we use, so we don't depend on @types/chrome. */
interface ChromeStorageArea {
  get(keys: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(keys: string): Promise<void>;
}

const toB64 = (b: Uint8Array) => btoa(String.fromCharCode(...b));
const fromB64 = (s: string) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

/**
 * Extension store. Session storage (default) lives in memory and is cleared when the browser
 * closes. `persist: true` uses local storage so the user stays signed in, at the cost of keys
 * sitting on disk in the browser profile.
 */
export function createExtensionStorage(opts: { persist?: boolean; area?: ChromeStorageArea } = {}): KeyValueStore {
  const chromeGlobal = (globalThis as unknown as { chrome?: { storage: { session: ChromeStorageArea; local: ChromeStorageArea } } })
    .chrome;
  const area = opts.area ?? (opts.persist ? chromeGlobal?.storage.local : chromeGlobal?.storage.session);
  if (!area) throw new Error("chrome.storage is not available here");
  const prefix = "cloak:";
  return {
    async get(key) {
      const v = (await area.get(prefix + key))[prefix + key];
      return typeof v === "string" ? fromB64(v) : null;
    },
    async set(key, value) {
      await area.set({ [prefix + key]: toB64(value) });
    },
    async delete(key) {
      await area.remove(prefix + key);
    },
  };
}
