"use client";

import { createDriveClient, type CloakroomClient } from "@cloakroom/core";
import { createWebStorage, requestVerifiedKeys } from "@cloakroom/platform";
import type { Identity, KeyValueStore, Receipt } from "@cloakroom/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { getAnon } from "./anon";
import { CLIENT_NEEDS, config, missingConfig } from "./config";

/** The one place the app gets a DriveClient: @cloakroom/core's createDriveClient. There is no mock. */

/** Whose keys this tab is using: your own, or one of the two "Try it" personas, each with its own storage. */
export type Profile = "me" | "founder" | "investor";
const PROFILE_KEY = "cloakroom:profile";

function storageName(p: Profile) {
  return p === "me" ? "cloakroom" : `cloakroom-try-${p}`;
}

// ---------------------------------------------------------------- add-on F3: keys kept in the extension

const CUSTODY_KEY = "cloakroom:custody";
const SEED_KEY = "seed";

/** True when the user chose "Keep keys in the extension": the seed is then never written to this site's storage. */
export function keysInExtension(): boolean {
  return typeof window !== "undefined" && localStorage.getItem(CUSTODY_KEY) === "extension";
}

/** Turns extension custody on or off. Turning it on deletes the seed this site stored. */
export async function setKeysInExtension(on: boolean): Promise<void> {
  if (on) {
    localStorage.setItem(CUSTODY_KEY, "extension");
    await createWebStorage({ dbName: storageName("me") }).delete(SEED_KEY);
  } else localStorage.removeItem(CUSTODY_KEY);
}

/** Keeps the seed in memory only while extension custody is on, so a swapped copy of this site finds nothing stored. */
function custodyStorage(base: KeyValueStore): KeyValueStore {
  const memory = new Map<string, Uint8Array>();
  return {
    get: (k) => (k === SEED_KEY && keysInExtension() ? Promise.resolve(memory.get(k) ?? null) : base.get(k)),
    set: (k, v) => {
      if (k === SEED_KEY && keysInExtension()) {
        memory.set(k, v);
        return Promise.resolve();
      }
      return base.set(k, v);
    },
    delete: (k) => {
      memory.delete(k);
      return base.delete(k);
    },
  };
}

function unavailableReason(): string | null {
  const missing = missingConfig(CLIENT_NEEDS);
  if (missing.length) return `This deployment is missing settings: ${missing.join(", ")}.`;
  return null;
}

/** A client for one profile. Exported for "Try it", which keeps both personas signed in at once. */
export function makeClient(profile: Profile): CloakroomClient | null {
  if (unavailableReason()) return null;
  const storage = createWebStorage({ dbName: storageName(profile) });
  return createDriveClient({
    anon: getAnon(),
    storage: profile === "me" ? custodyStorage(storage) : storage,
    appOrigin: config.appOrigin,
    apiUrl: config.apiUrl,
    beeUrl: config.beeUrl,
    sepoliaRpcUrl: config.sepoliaRpcUrl,
    arkivRpcUrl: config.arkivRpcUrl,
    arkivAccessKey: config.arkivAccessKey,
    demoMode: config.demoMode,
  });
}

interface DriveState {
  client: CloakroomClient | null;
  /** Why there is no client, in a sentence for the screen. */
  unavailable: string | null;
  profile: Profile;
  setProfile: (p: Profile) => void;
  identity: Identity | null;
  /** True until the stored session has been checked. */
  restoring: boolean;
  setIdentity: (i: Identity | null) => void;
  receipts: Receipt[];
  /** Add-on F3: why the extension didn't hand this page its keys, when custody is on. */
  custodyProblem: string | null;
}

const Ctx = createContext<DriveState | null>(null);

export function DriveProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile>("me");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [receipts, setReceipts] = useState<Receipt[]>([]);
  const [custodyProblem, setCustodyProblem] = useState<string | null>(null);

  useEffect(() => {
    const saved = sessionStorage.getItem(PROFILE_KEY);
    if (saved === "founder" || saved === "investor") setProfileState(saved);
  }, []);

  const client = useMemo(() => (typeof window === "undefined" ? null : makeClient(profile)), [profile]);
  const unavailable = useMemo(() => unavailableReason(), []);

  useEffect(() => {
    setIdentity(null);
    setReceipts([]);
    if (!client) return setRestoring(false);
    setRestoring(true);
    let live = true;
    client
      .restore()
      .then(async (i) => {
        // Keys in the extension: nothing is stored here, so ask it. It checks this page's files first.
        if (!i && profile === "me" && keysInExtension()) {
          const keys = await requestVerifiedKeys();
          if (!keys.ok) {
            if (live) setCustodyProblem(keys.reason);
            return null;
          }
          setCustodyProblem(null);
          const me = await client.signIn({ kind: "seed", seed: keys.seed });
          keys.seed.fill(0);
          return me;
        }
        return i;
      })
      .then((i) => live && setIdentity(i))
      .catch(() => live && setIdentity(null))
      .finally(() => live && setRestoring(false));
    const off = client.onReceipt((r) =>
      setReceipts((list) => [r, ...list.filter((x) => x.id !== r.id)].sort((a, b) => b.startedAt - a.startedAt).slice(0, 50)),
    );
    return () => {
      live = false;
      off();
    };
  }, [client, profile]);

  const setProfile = useCallback((p: Profile) => {
    if (p === "me") sessionStorage.removeItem(PROFILE_KEY);
    else sessionStorage.setItem(PROFILE_KEY, p);
    setProfileState(p);
  }, []);

  const value = useMemo(
    () => ({ client, unavailable, profile, setProfile, identity, restoring, setIdentity, receipts, custodyProblem }),
    [client, unavailable, profile, setProfile, identity, restoring, receipts, custodyProblem],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDrive(): DriveState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDrive outside DriveProvider");
  return v;
}

/** Runs `load` with the client whenever its inputs change, with loading and error state. */
export function useLoad<T>(load: ((c: CloakroomClient) => Promise<T>) | null, deps: unknown[]) {
  const { client } = useDrive();
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (!client || !load) return;
    let live = true;
    setLoading(true);
    setError(null);
    load(client)
      .then((d) => live && setData(d))
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tick, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
