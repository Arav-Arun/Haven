"use client";

import type { Address, DriveClient, Hex, Timestamp } from "@cloakroom/types";
import { useEffect, useRef, useState } from "react";

/** A doorbell from Swarm (add-on F4): "this changed, check Arkiv". Never data to trust on its own. */
export interface LiveEvent {
  folder: Address;
  type: "file" | "member" | "refresh" | "rotation";
  arkivKey: Hex;
  receivedAt: Timestamp;
}

export type LiveStatus = "live" | "polling";

/**
 * Add-on F4's optional DriveClient method (the add-on's proposed type, plus an optional status callback so screens can
 * say whether they're live or polling). @cloakroom/core's doorbell.ts implements it.
 */
type LiveClient = DriveClient & {
  subscribe?: (folders: Address[], listener: (e: LiveEvent) => void, onStatus?: (s: LiveStatus) => void) => () => void;
};

/** How often screens refresh when there's no doorbell connection. */
export const POLL_MS = 30_000;

/**
 * Calls `onChange` when something in one of `folders` changes: right away on a doorbell, or every 30 seconds while
 * doorbells aren't available (no subscribe in this client, or the Bee connection dropped). Returns the current mode.
 */
export function useLiveFolders(
  client: DriveClient | null,
  folders: Address[],
  onChange: (e: LiveEvent | null) => void,
  /** Keep the 30-second refresh even while live, e.g. to find brand-new shares, which ring no known doorbell. */
  options: { alwaysPoll?: boolean } = {},
) {
  const alwaysPoll = options.alwaysPoll === true;
  const [status, setStatus] = useState<LiveStatus>("polling");
  const latest = useRef(onChange);
  latest.current = onChange;
  const key = folders.join(",");

  useEffect(() => {
    if (!client) return;
    const c = client as LiveClient;
    const canListen = !!c.subscribe && folders.length > 0;
    let mode: LiveStatus = canListen ? "live" : "polling";
    setStatus(mode);
    const stop = (canListen ? c.subscribe : undefined)?.(
      folders,
      (e) => latest.current(e),
      (s) => {
        mode = s;
        setStatus(s);
      },
    );
    const poll = setInterval(() => {
      if (mode === "polling" || alwaysPoll) latest.current(null);
    }, POLL_MS);
    return () => {
      clearInterval(poll);
      stop?.();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client, key, alwaysPoll]);

  return status;
}
