"use client";

import { createDriveClient, type HavenClient } from "@haven/core";
import { createWebStorage } from "@haven/platform";
import type { Identity, Receipt } from "@haven/types";
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getAnon } from "./anon";
import { CLIENT_NEEDS, config, missingConfig } from "./config";

/** The one place the app gets a DriveClient: @haven/core's createDriveClient. There is no mock. */

/** Whose keys this tab is using: your own, or one of the two "Try it" personas, each with its own storage. */
export type Profile = "me" | "founder" | "investor";

/** How the two "Try it" personas are named on screen (the ids stay as they are, so saved sessions keep working). */
export const PERSONA = {
  founder: { name: "owner", title: "The owner", label: "owner" },
  investor: { name: "recipient", title: "The recipient", label: "guest" },
} as const;
const PROFILE_KEY = "haven:profile";

function storageName(p: Profile) {
  return p === "me" ? "haven" : `haven-try-${p}`;
}


function unavailableReason(): string | null {
  const missing = missingConfig(CLIENT_NEEDS);
  if (missing.length) return `This deployment is missing settings: ${missing.join(", ")}.`;
  return null;
}

/** A client for one profile. Exported for "Try it", which keeps both personas signed in at once. */
export function makeClient(profile: Profile): HavenClient | null {
  if (unavailableReason()) return null;
  const storage = createWebStorage({ dbName: storageName(profile) });
  return createDriveClient({
    anon: getAnon(),
    storage,
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
  client: HavenClient | null;
  /** Why there is no client, in a sentence for the screen. */
  unavailable: string | null;
  profile: Profile;
  setProfile: (p: Profile) => void;
  identity: Identity | null;
  /** True until the stored session has been checked. */
  restoring: boolean;
  setIdentity: (i: Identity | null) => void;
  receipts: Receipt[];
}

const Ctx = createContext<DriveState | null>(null);

export function DriveProvider({ children }: { children: ReactNode }) {
  const [profile, setProfileState] = useState<Profile>("me");
  const [identity, setIdentity] = useState<Identity | null>(null);
  const [restoring, setRestoring] = useState(true);
  const [receipts, setReceipts] = useState<Receipt[]>([]);

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
    () => ({ client, unavailable, profile, setProfile, identity, restoring, setIdentity, receipts }),
    [client, unavailable, profile, setProfile, identity, restoring, receipts],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDrive(): DriveState {
  const v = useContext(Ctx);
  if (!v) throw new Error("useDrive outside DriveProvider");
  return v;
}

/** Runs `load` with the client whenever its inputs change, with loading and error state. */
/**
 * Loads something from the client. With `cache`, the last result for this account is shown at once (kept on this
 * device until sign-out) while a fresh one loads behind it, so pages open with your folders straight away.
 */
export function useLoad<T>(load: ((c: HavenClient) => Promise<T>) | null, deps: unknown[], cache?: string) {
  const { client, identity, profile } = useDrive();
  const identityRef = useRef<string | null>(null);
  identityRef.current = identity?.driveKey ?? null;
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(false);
  const [tick, setTick] = useState(0);
  // Keyed by tab profile, not by the account: the account is only known after start-up lookups, which is what this is
  // here to skip. Each entry records whose it is, and is dropped if a different account turns out to be signed in.
  const key = cache ? `haven:view:${profile}:${cache}` : null;
  const me = identity?.driveKey ?? null;
  useEffect(() => {
    if (!key || !me) return;
    try {
      const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { who: string | null; data: T } | null;
      if (saved?.who && saved.who !== me) {
        localStorage.removeItem(key);
        setData(null);
      }
    } catch {
      // ignore
    }
  }, [key, me]);
  useEffect(() => {
    if (!client || !load) return;
    let live = true;
    if (key) {
      try {
        const saved = JSON.parse(localStorage.getItem(key) ?? "null") as { who: string | null; data: T } | null;
        if (saved && (!me || !saved.who || saved.who === me)) setData(saved.data);
      } catch {
        // a cache that can't be read is just skipped
      }
    }
    setLoading(true);
    setError(null);
    load(client)
      .then((d) => {
        if (!live) return;
        setData(d);
        if (key) {
          try {
            localStorage.setItem(key, JSON.stringify({ who: identityRef.current, data: d }));
          } catch {
            // full or not serialisable: no cache, nothing else changes
          }
        }
      })
      .catch((e) => live && setError(e))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, tick, key, ...deps]);
  return { data, error, loading, reload: () => setTick((t) => t + 1) };
}
