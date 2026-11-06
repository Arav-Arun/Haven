"use client";

import type { AnonStatus } from "@cloakroom/types";
import { ShieldAlert, ShieldCheck, ShieldEllipsis } from "lucide-react";
import { useEffect, useState } from "react";
import { getAnon } from "@/lib/anon";

/** Live status of the Anon-RPC worker. Red whenever requests are not private. */
export function NetworkBadge() {
  const [status, setStatus] = useState<AnonStatus | null>(null);
  useEffect(() => {
    const anon = getAnon();
    setStatus(anon.status());
    return anon.onStatus(setStatus);
  }, []);
  if (!status) return null;
  const name = status.network === "off" ? "" : status.network[0]!.toUpperCase() + status.network.slice(1);
  if (status.state === "ready")
    return (
      <span title={status.detail} className="inline-flex items-center gap-1.5 rounded-full bg-accent-soft px-3 py-1 text-sm text-accent">
        <ShieldCheck size={16} aria-hidden /> Private: {name}
      </span>
    );
  if (status.state === "connecting")
    return (
      <span className="inline-flex items-center gap-1.5 rounded-full bg-line px-3 py-1 text-sm text-muted">
        <ShieldEllipsis size={16} aria-hidden /> Connecting privately ({name})…
      </span>
    );
  return (
    <span title={status.detail} role="alert" className="inline-flex items-center gap-1.5 rounded-full bg-danger-soft px-3 py-1 text-sm text-danger">
      <ShieldAlert size={16} aria-hidden /> Not private{status.detail ? `: ${status.detail}` : ""}
    </span>
  );
}
