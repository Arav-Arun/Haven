"use client";

import { createDriveClient } from "@cloakroom/core";
import { createWebStorage } from "@cloakroom/platform";
import type { DriveClient, Identity, Receipt } from "@cloakroom/types";
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

function unavailableReason(): string | null {
  const missing = missingConfig(CLIENT_NEEDS);
  if (missing.length) return `This deployment is missing settings: ${missing.join(", ")}.`;
  return null;
}

/** A client for one profile. Exported for "Try it", which keeps both personas signed in at once. */
export function makeClient(profile: Profile): DriveClient | null {
  if (unavailableReason()) return null;
  return createDriveClient({
    anon: getAnon(),
    storage: createWebStorage({ dbName: storageName(profile) }),
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
  client: DriveClient | null;
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
  }, [client]);

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
export function useLoad<T>(load: ((c: DriveClient) => Promise<T>) | null, deps: unknown[]) {
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
