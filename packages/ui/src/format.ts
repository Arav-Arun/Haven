import type { PrivateNetwork, Role, Timestamp } from "@cloakroom/types";
import { useEffect, useState } from "react";

export function cx(...parts: (string | false | null | undefined)[]): string {
  return parts.filter(Boolean).join(" ");
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 10 || Number.isInteger(v) ? Math.round(v) : v.toFixed(1)} ${units[i]}`;
}

export function shortAddress(a: string): string {
  return a.length > 12 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a;
}

/** The ticket number: the first six hex digits of the random address the chain shows for this member. */
export function ticketSerial(address: string): string {
  return address.replace(/^0x/, "").slice(0, 6).toUpperCase();
}

export function networkName(n: PrivateNetwork): string {
  return n === "off" ? "Off" : n[0]!.toUpperCase() + n.slice(1);
}

export const ROLE_LABEL: Record<Role | "owner", string> = {
  owner: "Owner",
  manager: "Manager",
  editor: "Editor",
  viewer: "Viewer",
};

export const ROLE_ABOUT: Record<Role, string> = {
  viewer: "Can open files.",
  editor: "Can open and add files.",
  manager: "Can open and add files, and share or remove people.",
};

export function nowSeconds(): Timestamp {
  return Math.floor(Date.now() / 1000);
}

/** Re-renders every `everyMs` and returns the current Unix time in seconds, for countdowns. */
export function useNow(everyMs = 1000): Timestamp {
  const [now, setNow] = useState(nowSeconds);
  useEffect(() => {
    const t = setInterval(() => setNow(nowSeconds()), everyMs);
    return () => clearInterval(t);
  }, [everyMs]);
  return now;
}

function span(seconds: number): string {
  const s = Math.max(0, Math.round(seconds));
  if (s < 60) return `${s} s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 48) return m % 60 ? `${h} h ${m % 60} min` : `${h} h`;
  return `${Math.floor(h / 24)} days`;
}

/** "No end date", "Ends in 3 h 12 min" or "Ended 2 min ago". */
export function formatUntil(until: Timestamp | null, now: Timestamp): string {
  if (until === null) return "No end date";
  return until > now ? `Ends in ${span(until - now)}` : `Ended ${span(now - until)} ago`;
}

export function formatDate(ts: Timestamp): string {
  return new Date(ts * 1000).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
}

export function formatAgo(ts: Timestamp, now: Timestamp): string {
  return now - ts < 5 ? "just now" : `${span(now - ts)} ago`;
}
